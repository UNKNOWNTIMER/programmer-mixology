//! Explicitly enabled TLS transport and native guest adapter. It is never started by opening HostStore.
//! Only guest operations are exposed; administrator mutations remain local native commands.
use crate::{Event, HostError, HostStore, Order, OrderRequest, ServingSpec, SessionInfo, Ticket};
use rcgen::generate_simple_self_signed;
use reqwest::{blocking::Client, redirect::Policy};
use rustls::{
    pki_types::{CertificateDer, PrivateKeyDer},
    ServerConfig, ServerConnection, StreamOwned,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read, Write},
    net::{IpAddr, SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("local networking is disabled until explicitly enabled")]
    Disabled,
    #[error("explicit private IPv4 or loopback address required")]
    InvalidAddress,
    #[error("identity protection is unavailable on this platform")]
    KeyStorageUnavailable,
    #[error("TLS identity error")]
    Identity,
    #[error("saved certificate does not cover this IP; explicitly create a new identity and re-pair devices")]
    IdentityAddress,
    #[error("certificate fingerprint does not match confirmed pairing identity")]
    Fingerprint,
    #[error("TLS or network request failed")]
    Network,
    #[error("remote host rejected request ({0}): {1}")]
    Rejected(u16, String),
    #[error("protocol mismatch or malformed response")]
    Protocol,
    #[error("host service: {0}")]
    Host(#[from] HostError),
    #[error("local IO: {0}")]
    Io(#[from] std::io::Error),
}
pub type Result<T> = std::result::Result<T, TransportError>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkConfig {
    pub explicitly_enabled: bool,
    pub bind_address: SocketAddr,
    pub identity_directory: PathBuf,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairingIdentity {
    pub protocol_version: u32,
    pub host_id: String,
    pub address: SocketAddr,
    pub certificate_pem: String,
    pub certificate_sha256: String,
}
pub struct TlsHost {
    shutdown: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    pub identity: PairingIdentity,
}
fn allowed_address(address: SocketAddr) -> bool {
    match address.ip() {
        IpAddr::V4(ip) => ip.is_loopback() || ip.is_private(),
        IpAddr::V6(ip) => ip.is_loopback(),
    }
}
fn certificates(pem: &str) -> Result<Vec<CertificateDer<'static>>> {
    rustls_pemfile::certs(&mut Cursor::new(pem.as_bytes()))
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| TransportError::Identity)
}
fn fingerprint(cert: &CertificateDer<'_>) -> String {
    format!("{:x}", Sha256::digest(cert.as_ref()))
}
#[derive(Debug)]
struct PinnedVerifier {
    fingerprint: String,
    normal: Arc<rustls::client::WebPkiServerVerifier>,
}
impl rustls::client::danger::ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &rustls::pki_types::ServerName<'_>,
        ocsp: &[u8],
        now: rustls::pki_types::UnixTime,
    ) -> std::result::Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        if fingerprint(end_entity) != self.fingerprint {
            return Err(rustls::Error::InvalidCertificate(
                rustls::CertificateError::ApplicationVerificationFailure,
            ));
        }
        self.normal
            .verify_server_cert(end_entity, intermediates, server_name, ocsp, now)
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        self.normal.verify_tls12_signature(message, cert, dss)
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        self.normal.verify_tls13_signature(message, cert, dss)
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.normal.supported_verify_schemes()
    }
}

#[cfg(windows)]
fn protect(data: &[u8], decrypt: bool) -> Result<Vec<u8>> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    if data.len() > u32::MAX as usize {
        return Err(TransportError::Identity);
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI binds the private key to this Windows user. No ACL/firewall/UAC changes occur.
    let ok = unsafe {
        if decrypt {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err(TransportError::Identity);
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as *mut std::ffi::c_void);
    };
    Ok(result)
}
#[cfg(not(windows))]
fn protect(_data: &[u8], _decrypt: bool) -> Result<Vec<u8>> {
    Err(TransportError::KeyStorageUnavailable)
}

fn load_identity(dir: &Path, ip: IpAddr) -> Result<(String, PrivateKeyDer<'static>)> {
    fs::create_dir_all(dir)?;
    let cert_file = dir.join("host-certificate.pem");
    let key_file = dir.join("host-key.dpapi");
    if cert_file.exists() != key_file.exists() {
        return Err(TransportError::Identity);
    }
    if cert_file.exists() {
        let pem = fs::read_to_string(&cert_file)?;
        let key = protect(&fs::read(&key_file)?, true)?;
        let key = PrivateKeyDer::try_from(key).map_err(|_| TransportError::Identity)?;
        return Ok((pem, key));
    }
    let certified =
        generate_simple_self_signed(vec![ip.to_string(), "127.0.0.1".into(), "::1".into()])
            .map_err(|_| TransportError::Identity)?;
    let pem = certified.cert.pem();
    let der = certified.key_pair.serialize_der();
    let encrypted = protect(&der, false)?;
    // create_new avoids silently overwriting a known identity during concurrent activation.
    let mut key = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&key_file)?;
    key.write_all(&encrypted)?;
    key.sync_all()?;
    let mut cert = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&cert_file)?;
    cert.write_all(pem.as_bytes())?;
    cert.sync_all()?;
    Ok((
        pem,
        PrivateKeyDer::try_from(der).map_err(|_| TransportError::Identity)?,
    ))
}
impl TlsHost {
    pub fn start(store: HostStore, admin: &str, config: NetworkConfig) -> Result<Self> {
        if !config.explicitly_enabled {
            return Err(TransportError::Disabled);
        }
        if !allowed_address(config.bind_address) {
            return Err(TransportError::InvalidAddress);
        }
        store.admin_accounts(admin)?;
        let (pem, key) = load_identity(&config.identity_directory, config.bind_address.ip())?;
        let chain = certificates(&pem)?;
        let first = chain.first().ok_or(TransportError::Identity)?;
        let fingerprint = fingerprint(first);
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let mut roots = rustls::RootCertStore::empty();
        roots
            .add(first.clone())
            .map_err(|_| TransportError::Identity)?;
        let verifier = rustls::client::WebPkiServerVerifier::builder_with_provider(
            Arc::new(roots),
            provider.clone(),
        )
        .build()
        .map_err(|_| TransportError::Identity)?;
        rustls::client::danger::ServerCertVerifier::verify_server_cert(
            &*verifier,
            first,
            &[],
            &rustls::pki_types::ServerName::IpAddress(config.bind_address.ip().into()),
            &[],
            rustls::pki_types::UnixTime::now(),
        )
        .map_err(|_| TransportError::IdentityAddress)?;
        let tls = ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|_| TransportError::Identity)?
            .with_no_client_auth()
            .with_single_cert(chain, key)
            .map_err(|_| TransportError::Identity)?;
        let listener = TcpListener::bind(config.bind_address)?;
        listener.set_nonblocking(true)?;
        let identity = PairingIdentity {
            protocol_version: 1,
            host_id: store.host_id()?,
            address: listener.local_addr()?,
            certificate_pem: pem,
            certificate_sha256: fingerprint,
        };
        let public = identity.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let tls = Arc::new(tls);
        let active = Arc::new(AtomicUsize::new(0));
        let limits = Arc::new(Mutex::new(BTreeMap::<IpAddr, (Instant, u32)>::new()));
        let worker = thread::spawn(move || {
            while !flag.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((socket, peer)) => {
                        if !allowed_address(peer) {
                            drop(socket);
                            continue;
                        }
                        // Maximum eight simultaneous handshakes/requests; 120 requests per IP per minute.
                        let allowed = if let Ok(mut map) = limits.lock() {
                            if map.len() > 1024 {
                                map.retain(|_, v| v.0.elapsed() < Duration::from_secs(60));
                            }
                            let slot = map.entry(peer.ip()).or_insert((Instant::now(), 0));
                            if slot.0.elapsed() >= Duration::from_secs(60) {
                                *slot = (Instant::now(), 0)
                            }
                            slot.1 += 1;
                            slot.1 <= 120
                        } else {
                            false
                        };
                        if !allowed || active.fetch_add(1, Ordering::SeqCst) >= 8 {
                            if allowed {
                                active.fetch_sub(1, Ordering::SeqCst);
                            }
                            drop(socket);
                            continue;
                        }
                        let store = store.clone();
                        let tls = tls.clone();
                        let public = public.clone();
                        let active = active.clone();
                        let stopping = flag.clone();
                        thread::spawn(move || {
                            let _guard = ActiveGuard(active);
                            if !stopping.load(Ordering::SeqCst) {
                                let result = handle_connection(socket, tls, &store, &public);
                                #[cfg(test)]
                                if let Err(ref error) = result {
                                    eprintln!("TLS contract server diagnostic: {error:?}");
                                }
                                let _ = result;
                            }
                        });
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(30))
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            shutdown: stop,
            thread: Some(worker),
            identity,
        })
    }
    pub fn stop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}
impl Drop for TlsHost {
    fn drop(&mut self) {
        self.stop()
    }
}
struct ActiveGuard(Arc<AtomicUsize>);
impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
struct Request {
    method: String,
    path: String,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}
fn parse_request(stream: &mut impl Read) -> std::result::Result<Request, u16> {
    let mut header = Vec::new();
    let mut byte = [0u8; 1];
    while !header.ends_with(b"\r\n\r\n") {
        if header.len() >= 8192 {
            return Err(431);
        }
        if stream.read(&mut byte).map_err(|_| 408u16)? != 1 {
            return Err(400);
        }
        header.push(byte[0]);
    }
    let text = std::str::from_utf8(&header).map_err(|_| 400u16)?;
    let mut lines = text.split("\r\n");
    let start: Vec<_> = lines.next().ok_or(400u16)?.split(' ').collect();
    if start.len() != 3
        || start[2] != "HTTP/1.1"
        || !["GET", "POST"].contains(&start[0])
        || !start[1].starts_with("/v1/")
        || start[1].len() > 512
    {
        return Err(400);
    }
    let mut headers = BTreeMap::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        let (k, v) = line.split_once(':').ok_or(400u16)?;
        let key = k.to_ascii_lowercase();
        if headers.insert(key, v.trim().to_owned()).is_some() {
            return Err(400);
        }
    }
    if headers.contains_key("transfer-encoding") || headers.contains_key("content-encoding") {
        return Err(415);
    }
    let length = headers
        .get("content-length")
        .map(|s| s.parse::<usize>())
        .transpose()
        .map_err(|_| 400u16)?
        .unwrap_or(0);
    if length > 65536 {
        return Err(413);
    }
    if start[0] == "POST"
        && headers
            .get("content-type")
            .map(|s| s.split(';').next().unwrap_or("").trim())
            != Some("application/json")
    {
        return Err(415);
    }
    if start[0] == "GET" && length != 0 {
        return Err(400);
    }
    let mut body = vec![0u8; length];
    stream.read_exact(&mut body).map_err(|_| 400u16)?;
    Ok(Request {
        method: start[0].into(),
        path: start[1].into(),
        headers,
        body,
    })
}
fn respond(stream: &mut impl Write, status: u16, body: Value) -> std::io::Result<()> {
    let raw = serde_json::to_vec(&body).unwrap_or_default();
    write!(stream,"HTTP/1.1 {status} Result\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n\r\n",raw.len())?;
    stream.write_all(&raw)?;
    stream.flush()
}
fn error_response(error: HostError) -> (u16, Value) {
    let (status, code) = match error {
        HostError::Unauthorized => (401, "UNAUTHORIZED"),
        HostError::Forbidden => (403, "FORBIDDEN"),
        HostError::RateLimited => (429, "RATE_LIMITED"),
        HostError::IdempotencyConflict => (409, "IDEMPOTENCY_CONFLICT"),
        HostError::Conflict => (409, "CONFLICT"),
        HostError::NoValidTicket => (409, "NO_VALID_TICKET"),
        HostError::NotFound => (404, "NOT_FOUND"),
        HostError::Invalid(_) | HostError::Serialization(_) => (400, "INVALID_REQUEST"),
        HostError::Database(_) | HostError::Io(_) => (503, "HOST_BUSY_OR_UNAVAILABLE"),
    };
    (status, json!({"protocol_version":1,"error":code}))
}
struct TimedSocket {
    socket: TcpStream,
    deadline: Instant,
}
impl Read for TimedSocket {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let remaining = self
            .deadline
            .checked_duration_since(Instant::now())
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::TimedOut, "request deadline"))?;
        self.socket.set_read_timeout(Some(remaining))?;
        self.socket.read(buf)
    }
}
impl Write for TimedSocket {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.socket.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.socket.flush()
    }
}
fn handle_connection(
    socket: TcpStream,
    tls: Arc<ServerConfig>,
    store: &HostStore,
    identity: &PairingIdentity,
) -> Result<()> {
    // Windows accepts inherit the listener's nonblocking mode; TLS workers are bounded blocking IO.
    socket.set_nonblocking(false)?;
    socket.set_read_timeout(Some(Duration::from_secs(5)))?;
    socket.set_write_timeout(Some(Duration::from_secs(5)))?;
    let conn = ServerConnection::new(tls).map_err(|_| TransportError::Identity)?;
    let mut stream = StreamOwned::new(
        conn,
        TimedSocket {
            socket,
            deadline: Instant::now() + Duration::from_secs(5),
        },
    );
    match parse_request(&mut stream) {
        Ok(req) => {
            let result = route(req, store, identity);
            let (status, body) = match result {
                Ok(body) => (200, body),
                Err(err) => error_response(err),
            };
            respond(&mut stream, status, body)?
        }
        Err(code) => respond(
            &mut stream,
            code,
            json!({"protocol_version":1,"error":"INVALID_HTTP_REQUEST"}),
        )?,
    }
    Ok(())
}
fn decoded<T: serde::de::DeserializeOwned>(body: &[u8]) -> crate::Result<T> {
    serde_json::from_slice(body).map_err(HostError::from)
}
fn route(req: Request, store: &HostStore, identity: &PairingIdentity) -> crate::Result<Value> {
    let session = req
        .headers
        .get("authorization")
        .and_then(|s| s.strip_prefix("Bearer "))
        .unwrap_or("");
    if !matches!(
        (req.method.as_str(), req.path.as_str()),
        ("GET", "/v1/health") | ("POST", "/v1/session") | ("POST", "/v1/pair")
    ) {
        store.authorize_guest_transport(session)?;
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Login {
        protocol_version: u32,
        account_id: String,
        password: String,
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Pair {
        protocol_version: u32,
        invite: String,
        name: String,
        device: String,
    }
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/v1/health") => {
            Ok(json!({"protocol_version":1,"status":"ok","host_id":identity.host_id}))
        }
        ("POST", "/v1/session") => {
            let r: Login = decoded(&req.body)?;
            if r.protocol_version != 1 {
                return Err(HostError::Invalid("protocol version"));
            }
            let session = store.login(&r.account_id, &r.password)?;
            if session.role != "guest" {
                store.logout(&session.token)?;
                return Err(HostError::Forbidden);
            }
            Ok(serde_json::to_value(session)?)
        }
        ("POST", "/v1/pair") => {
            let r: Pair = decoded(&req.body)?;
            if r.protocol_version != 1 {
                return Err(HostError::Invalid("protocol version"));
            }
            Ok(
                json!({"protocol_version":1,"request_id":store.request_pair(&r.invite,&r.name,&r.device)?,"status":"pending_admin_approval"}),
            )
        }
        ("GET", "/v1/catalog") => Ok(serde_json::to_value(store.catalog(session)?)?),
        ("GET", "/v1/me/tickets") => Ok(serde_json::to_value(store.tickets(session)?)?),
        ("GET", "/v1/me/ticket-status") => Ok(serde_json::to_value(store.ticket_status(session)?)?),
        ("GET", "/v1/me/orders") => Ok(serde_json::to_value(store.own_orders(session)?)?),
        ("POST", "/v1/orders") => {
            let r: OrderRequest = decoded(&req.body)?;
            if req.headers.get("idempotency-key") != Some(&r.request_id) {
                return Err(HostError::Invalid("idempotency key required"));
            }
            Ok(serde_json::to_value(store.place_order(session, &r)?)?)
        }
        ("GET", path) if path.starts_with("/v1/orders/by-request/") => Ok(serde_json::to_value(
            store.order_by_request(session, path.trim_start_matches("/v1/orders/by-request/"))?,
        )?),
        ("GET", path) if path.starts_with("/v1/events?after_seq=") => {
            let seq = path
                .trim_start_matches("/v1/events?after_seq=")
                .parse()
                .map_err(|_| HostError::Invalid("event cursor"))?;
            Ok(serde_json::to_value(store.events(session, seq)?)?)
        }
        _ => Err(HostError::NotFound),
    }
}

/// A native-only client: confirms the supplied certificate fingerprint, validates normal TLS
/// hostname/time/signatures, and trusts only that certificate. No WebView TLS bypass exists.
pub struct GuestClient {
    client: Client,
    identity: PairingIdentity,
    session: Option<String>,
}
impl GuestClient {
    pub fn connect(identity: PairingIdentity, confirmed_fingerprint: &str) -> Result<Self> {
        if identity.protocol_version != 1 {
            return Err(TransportError::Protocol);
        }
        if !allowed_address(identity.address) || identity.address.port() == 0 {
            return Err(TransportError::InvalidAddress);
        }
        let certs = certificates(&identity.certificate_pem)?;
        if certs.len() != 1 {
            return Err(TransportError::Identity);
        }
        let digest = fingerprint(&certs[0]);
        if digest != identity.certificate_sha256
            || digest != confirmed_fingerprint.to_ascii_lowercase()
        {
            return Err(TransportError::Fingerprint);
        }
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let mut roots = rustls::RootCertStore::empty();
        roots
            .add(certs[0].clone())
            .map_err(|_| TransportError::Identity)?;
        let normal = rustls::client::WebPkiServerVerifier::builder_with_provider(
            Arc::new(roots),
            provider.clone(),
        )
        .build()
        .map_err(|_| TransportError::Identity)?;
        let verifier = Arc::new(PinnedVerifier {
            fingerprint: digest,
            normal,
        });
        // The custom verifier adds exact leaf pinning and delegates every normal certificate/signature check.
        let tls = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|_| TransportError::Identity)?
            .dangerous()
            .with_custom_certificate_verifier(verifier)
            .with_no_client_auth();
        let client = Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .https_only(true)
            .use_preconfigured_tls(tls)
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(|_| TransportError::Network)?;
        let guest = Self {
            client,
            identity,
            session: None,
        };
        let health = guest.get("/v1/health")?;
        if health["protocol_version"] != 1 || health["host_id"] != guest.identity.host_id {
            return Err(TransportError::Protocol);
        }
        Ok(guest)
    }
    fn url(&self, path: &str) -> String {
        format!("https://{}{path}", self.identity.address)
    }
    fn decode(mut reply: reqwest::blocking::Response) -> Result<Value> {
        let status = reply.status().as_u16();
        if reply.content_length().is_some_and(|n| n > 8 * 1024 * 1024) {
            return Err(TransportError::Protocol);
        }
        let mut bytes = Vec::new();
        reply
            .by_ref()
            .take(8 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err(TransportError::Protocol);
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| TransportError::Protocol)?;
        if !(200..300).contains(&status) {
            return Err(TransportError::Rejected(
                status,
                value["error"].as_str().unwrap_or("UNKNOWN").into(),
            ));
        }
        Ok(value)
    }
    fn get(&self, path: &str) -> Result<Value> {
        let mut r = self.client.get(self.url(path));
        if let Some(s) = &self.session {
            r = r.bearer_auth(s)
        }
        Self::decode(r.send().map_err(|error| {
            #[cfg(test)]
            eprintln!("TLS contract transport diagnostic: {error:?}");
            let _ = error;
            TransportError::Network
        })?)
    }
    fn post(&self, path: &str, body: &Value, key: Option<&str>) -> Result<Value> {
        let mut r = self.client.post(self.url(path)).json(body);
        if let Some(s) = &self.session {
            r = r.bearer_auth(s)
        }
        if let Some(k) = key {
            r = r.header("Idempotency-Key", k)
        }
        Self::decode(r.send().map_err(|_| TransportError::Network)?)
    }
    pub fn login(&mut self, account: &str, password: &str) -> Result<SessionInfo> {
        self.session = None;
        let response = self.post(
            "/v1/session",
            &json!({"protocol_version":1,"account_id":account,"password":password}),
            None,
        )?;
        let info: SessionInfo =
            serde_json::from_value(response).map_err(|_| TransportError::Protocol)?;
        self.session = Some(info.token.clone());
        Ok(info)
    }
    pub fn request_pair(&self, invite: &str, name: &str, device: &str) -> Result<Value> {
        self.post(
            "/v1/pair",
            &json!({"protocol_version":1,"invite":invite,"name":name,"device":device}),
            None,
        )
    }
    pub fn catalog(&self) -> Result<Vec<ServingSpec>> {
        serde_json::from_value(self.get("/v1/catalog")?).map_err(|_| TransportError::Protocol)
    }
    pub fn tickets(&self) -> Result<Vec<Ticket>> {
        serde_json::from_value(self.get("/v1/me/tickets")?).map_err(|_| TransportError::Protocol)
    }
    pub fn ticket_status(&self) -> Result<crate::TicketAvailability> {
        serde_json::from_value(self.get("/v1/me/ticket-status")?)
            .map_err(|_| TransportError::Protocol)
    }
    pub fn orders(&self) -> Result<Vec<Order>> {
        serde_json::from_value(self.get("/v1/me/orders")?).map_err(|_| TransportError::Protocol)
    }
    pub fn submit(&self, order: &OrderRequest) -> Result<Order> {
        let body = serde_json::to_value(order).map_err(|_| TransportError::Protocol)?;
        serde_json::from_value(self.post("/v1/orders", &body, Some(&order.request_id))?)
            .map_err(|_| TransportError::Protocol)
    }
    pub fn by_request(&self, id: &str) -> Result<Order> {
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(TransportError::Protocol);
        }
        serde_json::from_value(self.get(&format!("/v1/orders/by-request/{id}"))?)
            .map_err(|_| TransportError::Protocol)
    }
    pub fn events(&self, after: i64) -> Result<Vec<Event>> {
        if after < 0 {
            return Err(TransportError::Protocol);
        }
        serde_json::from_value(self.get(&format!("/v1/events?after_seq={after}"))?)
            .map_err(|_| TransportError::Protocol)
    }
}

#[cfg(test)]
mod parser_tests {
    use super::*;
    #[test]
    fn http_rejects_smuggling_oversize_and_encoding() {
        for raw in ["POST /v1/orders HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: 0\r\nContent-Length: 4\r\n\r\n","POST /v1/orders HTTP/1.1\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n","POST /v1/orders HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: 99999999\r\n\r\n","GET /v1/health HTTP/1.1\r\nContent-Encoding: gzip\r\n\r\n"]{assert!(parse_request(&mut Cursor::new(raw)).is_err());}
    }
    #[test]
    fn only_explicit_private_or_loopback_addresses_allowed() {
        assert!(allowed_address("192.168.1.10:8443".parse().unwrap()));
        for a in ["0.0.0.0:8443", "8.8.8.8:8443", "[::]:8443"] {
            assert!(!allowed_address(a.parse().unwrap()));
        }
    }
}
