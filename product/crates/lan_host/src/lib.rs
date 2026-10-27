//! Local authoritative host service. This crate deliberately opens no listener.
//! Calls require credentials even when invoked by an in-process native adapter.
pub mod transport;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Duration as ChronoDuration, LocalResult, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, HostError>;
#[derive(Debug, thiserror::Error)]
pub enum HostError {
    #[error("authentication required or expired")]
    Unauthorized,
    #[error("role or ownership does not permit this action")]
    Forbidden,
    #[error("request limit exceeded")]
    RateLimited,
    #[error("idempotency key reused with different payload")]
    IdempotencyConflict,
    #[error("no valid ticket")]
    NoValidTicket,
    #[error("record not found")]
    NotFound,
    #[error("version or state conflict")]
    Conflict,
    #[error("invalid input: {0}")]
    Invalid(&'static str),
    #[error("database: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("serialization: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("local IO: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone)]
pub struct HostStore {
    path: PathBuf,
    clock: fn() -> i64,
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn hash(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
fn text(s: &str, max: usize) -> bool {
    !s.trim().is_empty()
        && s.chars().count() <= max
        && !s.chars().any(|c| c.is_control() || c == '<' || c == '>')
}
fn password_hash(secret: &str) -> Result<String> {
    if secret.len() < 12 || secret.len() > 256 {
        return Err(HostError::Invalid("password must contain 12..256 bytes"));
    }
    Argon2::default()
        .hash_password(secret.as_bytes(), &SaltString::generate(&mut OsRng))
        .map(|x| x.to_string())
        .map_err(|_| HostError::Invalid("password hashing failed"))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetProfile {
    pub taste_bps: [u16; 5],
    pub sensory_0_10: [f64; 7],
}
impl TargetProfile {
    pub fn validate(&self) -> Result<()> {
        if self.taste_bps.iter().map(|n| *n as u32).sum::<u32>() != 10000
            || self
                .sensory_0_10
                .iter()
                .any(|n| !n.is_finite() || !(0.0..=10.0).contains(n))
        {
            return Err(HostError::Invalid("invalid target profile"));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServingPart {
    pub sku_id: String,
    pub ingredient_id: String,
    pub quantity_ml: f64,
    pub stage: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServingSpec {
    pub id: String,
    pub recipe_revision_id: String,
    pub name: String,
    /// Entire provenance-bearing recipe; is frozen alongside the operational spec.
    pub source_recipe: Value,
    pub parts: Vec<ServingPart>,
    pub steps: Vec<String>,
    pub glass: String,
    pub ice: String,
    pub dilution_ml: Option<f64>,
    pub capacity_ml: f64,
    pub max_ethanol_ml: f64,
    pub predicted_profile: TargetProfile,
    pub prediction_status: String,
    pub generated: bool,
    pub rules_version: Option<String>,
    pub model_version: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sku {
    pub id: String,
    pub ingredient_id: String,
    pub label: String,
    pub provenance: String,
    pub stock_ml: f64,
    pub abv_fraction: f64,
    pub maximum_dose_ml: f64,
    pub food_grade: bool,
    pub allergens_reviewed: bool,
    pub allergens: Vec<String>,
    pub carbonated: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrderRequest {
    pub protocol_version: u32,
    pub request_id: String,
    pub recipe_revision_id: String,
    pub serving_spec_id: String,
    pub target_profile: TargetProfile,
    pub units_count: u32,
    pub guest_note: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub guest_id: String,
    pub request_id: String,
    pub snapshot: Value,
    pub status: String,
    pub version: u32,
    pub created_at: i64,
    pub stamp_open: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Ticket {
    pub window_id: String,
    pub policy_version: String,
    pub quota: u32,
    pub spent: u32,
    pub starts: i64,
    pub expires: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TicketAvailability {
    pub server_now: i64,
    pub available: u32,
    pub serving_enabled: bool,
    pub tickets: Vec<Ticket>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Event {
    pub seq: i64,
    pub event_id: String,
    pub host_id: String,
    pub event_type: String,
    pub entity_id: String,
    pub entity_version: u32,
    pub payload: Value,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub token: String,
    pub account_id: String,
    pub role: String,
    pub expires_at: i64,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct PairCredentials {
    pub account_id: String,
    pub device_secret: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountInfo {
    pub id: String,
    pub name: String,
    pub role: String,
    pub disabled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PendingPair {
    pub id: String,
    pub name: String,
    pub device: String,
    pub expires_at: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupInfo {
    pub host_id: String,
    pub schema_version: u32,
    pub committed_orders: u64,
    pub outbox_events: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TicketPolicy {
    pub version: String,
    pub timezone: String,
    pub start_minute: u32,
    pub end_minute: u32,
    pub quota: u32,
    pub enabled: bool,
    pub date: Option<String>,
    pub effective_at: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TicketWindow {
    pub id: String,
    pub service_date: String,
    pub starts: i64,
    pub expires: i64,
}
struct Auth {
    id: String,
    name: String,
    role: String,
    excluded: Vec<String>,
    max_ethanol: f64,
}

const DDL: &str = r#"
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','guest')),password_hash TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,excluded TEXT NOT NULL DEFAULT '[]',max_ethanol REAL NOT NULL DEFAULT 24);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),expires INTEGER NOT NULL,window INTEGER NOT NULL DEFAULT 0,requests INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS login_limits(account_id TEXT PRIMARY KEY,window INTEGER NOT NULL,attempts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invites(token_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS pair_requests(id TEXT PRIMARY KEY,name TEXT NOT NULL,device TEXT NOT NULL,status TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sku(id TEXT PRIMARY KEY,json TEXT NOT NULL,stock REAL NOT NULL CHECK(stock>=0));
CREATE TABLE IF NOT EXISTS specs(id TEXT PRIMARY KEY,revision TEXT NOT NULL,json TEXT NOT NULL,approved_by TEXT NOT NULL REFERENCES accounts(id),approved_at INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS policies(version TEXT PRIMARY KEY,json TEXT NOT NULL,effective INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS grants(guest TEXT NOT NULL REFERENCES accounts(id),window_id TEXT NOT NULL,policy_version TEXT NOT NULL,service_date TEXT NOT NULL,quota INTEGER NOT NULL CHECK(quota>=0),spent INTEGER NOT NULL DEFAULT 0 CHECK(spent>=0 AND spent<=quota),starts INTEGER NOT NULL,expires INTEGER NOT NULL CHECK(expires>starts),PRIMARY KEY(guest,policy_version,window_id),UNIQUE(guest,service_date));
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,guest TEXT NOT NULL REFERENCES accounts(id),request_id TEXT NOT NULL,request_hash TEXT NOT NULL,snapshot TEXT NOT NULL,window_id TEXT NOT NULL,policy_version TEXT NOT NULL,created INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'received',version INTEGER NOT NULL DEFAULT 1,UNIQUE(guest,request_id));
CREATE TABLE IF NOT EXISTS stamps(account TEXT NOT NULL REFERENCES accounts(id),order_id TEXT NOT NULL REFERENCES orders(id),is_open INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account,order_id));
CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,host_id TEXT NOT NULL,type TEXT NOT NULL,entity TEXT NOT NULL,version INTEGER NOT NULL,guest TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refunds(order_id TEXT PRIMARY KEY REFERENCES orders(id),created INTEGER NOT NULL,admin TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS immutable_order BEFORE UPDATE OF snapshot,guest,request_id,request_hash,window_id,policy_version,created ON orders BEGIN SELECT RAISE(ABORT,'immutable order snapshot'); END;
CREATE TRIGGER IF NOT EXISTS immutable_spec BEFORE UPDATE OF json,revision ON specs BEGIN SELECT RAISE(ABORT,'immutable serving revision'); END;
"#;
const APPLICATION_ID: i64 = 0x504d4853;
fn schema_entries(c: &Connection) -> Result<Vec<(String, String, String)>> {
    let mut stmt=c.prepare("SELECT type,name,COALESCE(sql,'') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}
fn verify_schema(c: &Connection) -> Result<()> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(DDL)?;
    if schema_entries(c)? != schema_entries(&reference)? {
        return Err(HostError::Invalid("unrecognized host schema"));
    }
    Ok(())
}
fn inspect_backup_connection(c: &Connection) -> Result<BackupInfo> {
    if c.query_row("PRAGMA application_id", [], |r| r.get::<_, i64>(0))? != APPLICATION_ID
        || c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? != 1
    {
        return Err(HostError::Invalid("not a supported Programmer Mixology host backup"));
    }
    verify_schema(c)?;
    if c.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))? != "ok" {
        return Err(HostError::Invalid("host backup integrity failure"));
    }
    if c.prepare("PRAGMA foreign_key_check")?
        .query([])?
        .next()?
        .is_some()
    {
        return Err(HostError::Invalid("host backup foreign key failure"));
    }
    let host_id: String = c.query_row("SELECT value FROM meta WHERE key='host_id'", [], |r| {
        r.get(0)
    })?;
    if Uuid::parse_str(&host_id).is_err() {
        return Err(HostError::Invalid("host identity"));
    }
    Ok(BackupInfo {
        host_id,
        schema_version: 1,
        committed_orders: c.query_row("SELECT COUNT(*) FROM orders", [], |r| r.get(0))?,
        outbox_events: c.query_row("SELECT COUNT(*) FROM outbox", [], |r| r.get(0))?,
    })
}

impl HostStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let s = Self {
            path: path.as_ref().into(),
            clock: now,
        };
        let c = s.connect()?;
        let app: i64 = c.query_row("PRAGMA application_id", [], |r| r.get(0))?;
        let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if (app != 0 && app != APPLICATION_ID) || version > 1 {
            return Err(HostError::Invalid("foreign or newer host database"));
        }
        if !schema_entries(&c)?.is_empty() {
            verify_schema(&c)?;
        }
        c.execute_batch(DDL)?;
        c.pragma_update(None, "application_id", APPLICATION_ID)?;
        c.pragma_update(None, "user_version", 1)?;
        c.execute(
            "INSERT OR IGNORE INTO meta VALUES ('host_id',?1)",
            [Uuid::new_v4().to_string()],
        )?;
        Ok(s)
    }
    fn connect(&self) -> Result<Connection> {
        let c = Connection::open(&self.path)?;
        c.busy_timeout(Duration::from_secs(5))?;
        c.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
        Ok(c)
    }
    pub fn host_id(&self) -> Result<String> {
        Ok(self
            .connect()?
            .query_row("SELECT value FROM meta WHERE key='host_id'", [], |r| {
                r.get(0)
            })?)
    }
    pub fn is_initialized(&self) -> Result<bool> {
        Ok(self.connect()?.query_row(
            "SELECT count(*) FROM accounts WHERE role='admin'",
            [],
            |r| r.get::<_, i64>(0),
        )? > 0)
    }
    /// Consistent SQLite online backup includes committed WAL frames, orders, grants and outbox.
    /// Destinations are confined to the host database's sibling backups directory and must be new files.
    pub fn backup_to(&self, path: impl AsRef<Path>) -> Result<BackupInfo> {
        let target = path.as_ref();
        if !target.is_absolute()
            || target
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
            || target.extension().and_then(|s| s.to_str()) != Some("sqlite")
        {
            return Err(HostError::Invalid("backup destination"));
        }
        let source = self.path.canonicalize()?;
        let root = source
            .parent()
            .ok_or(HostError::Invalid("host database parent"))?
            .join("backups");
        std::fs::create_dir_all(&root)?;
        let parent = target
            .parent()
            .ok_or(HostError::Invalid("backup destination parent"))?
            .canonicalize()?;
        if !parent.starts_with(root.canonicalize()?) {
            return Err(HostError::Invalid(
                "backup must remain inside application backups",
            ));
        }
        let source = self.connect()?;
        inspect_backup_connection(&source)?;
        let placeholder = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)?;
        drop(placeholder);
        let mut destination = Connection::open(target)?;
        {
            let copy = rusqlite::backup::Backup::new(&source, &mut destination)?;
            copy.run_to_completion(128, Duration::from_millis(10), None)?;
        }
        inspect_backup_connection(&destination)
    }
    /// Read-only validation for a stopped-application recovery tool. Does not restore or overwrite anything.
    pub fn verify_backup(path: impl AsRef<Path>) -> Result<BackupInfo> {
        let c = Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        c.execute_batch("PRAGMA trusted_schema=OFF;PRAGMA query_only=ON;")?;
        inspect_backup_connection(&c)
    }
    pub(crate) fn authorize_guest_transport(&self, session: &str) -> Result<()> {
        let c = self.connect()?;
        self.authenticate(&c, session, Some("guest"), false)?;
        Ok(())
    }
    pub fn bootstrap_admin(&self, password: &str) -> Result<String> {
        if self.is_initialized()? {
            return Err(HostError::Conflict);
        }
        let ph = password_hash(password)?;
        let mut c = self.connect()?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.query_row("SELECT count(*) FROM accounts", [], |r| r.get::<_, i64>(0))? != 0 {
            return Err(HostError::Conflict);
        }
        let id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO accounts(id,name,role,password_hash) VALUES (?1,'主管理员','admin',?2)",
            params![id, ph],
        )?;
        tx.commit()?;
        Ok(id)
    }
    pub fn login(&self, account: &str, password: &str) -> Result<SessionInfo> {
        if account.len() > 100 || password.len() > 256 {
            return Err(HostError::Unauthorized);
        }
        let current = (self.clock)();
        let mut c = self.connect()?;
        {
            let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let prior: Option<(i64, i64)> = tx
                .query_row(
                    "SELECT window,attempts FROM login_limits WHERE account_id=?1",
                    [account],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let attempts = prior
                .filter(|p| current - p.0 < 60)
                .map(|p| p.1)
                .unwrap_or(0);
            if attempts >= 5 {
                return Err(HostError::RateLimited);
            }
            let start = prior
                .filter(|p| current - p.0 < 60)
                .map(|p| p.0)
                .unwrap_or(current);
            tx.execute("INSERT INTO login_limits VALUES(?1,?2,?3) ON CONFLICT(account_id) DO UPDATE SET window=excluded.window,attempts=excluded.attempts",params![account,start,attempts+1])?;
            tx.commit()?;
        }
        let row: Option<(String, String)> = c
            .query_row(
                "SELECT password_hash,role FROM accounts WHERE id=?1 AND disabled=0",
                [account],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (ph, role) = row.ok_or(HostError::Unauthorized)?;
        let parsed = PasswordHash::new(&ph).map_err(|_| HostError::Unauthorized)?;
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .map_err(|_| HostError::Unauthorized)?;
        let raw = token();
        let expires = current + 900;
        c.execute(
            "INSERT INTO sessions(token_hash,account_id,expires) VALUES(?1,?2,?3)",
            params![hash(&raw), account, expires],
        )?;
        Ok(SessionInfo {
            token: raw,
            account_id: account.into(),
            role,
            expires_at: expires,
        })
    }
    fn auth(&self, c: &Connection, session: &str, role: Option<&str>) -> Result<Auth> {
        self.authenticate(c, session, role, true)
    }
    fn authenticate(
        &self,
        c: &Connection,
        session: &str,
        role: Option<&str>,
        charge: bool,
    ) -> Result<Auth> {
        if session.len() != 64 {
            return Err(HostError::Unauthorized);
        }
        let current = (self.clock)();
        let found: Option<(String,String,String,String,f64)>=c.query_row("SELECT a.id,a.name,a.role,a.excluded,a.max_ethanol FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=?1 AND s.expires>?2 AND a.disabled=0",params![hash(session),current],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?;
        let (id, name, found_role, excluded, max_ethanol) = found.ok_or(HostError::Unauthorized)?;
        if role.is_some_and(|r| r != found_role) {
            return Err(HostError::Forbidden);
        }
        if charge {
            let changed=c.execute("UPDATE sessions SET requests=CASE WHEN window<=?2 THEN 1 ELSE requests+1 END,window=CASE WHEN window<=?2 THEN ?3 ELSE window END WHERE token_hash=?1 AND (window<=?2 OR requests<120)",params![hash(session),current-60,current])?;
            if changed != 1 {
                return Err(HostError::RateLimited);
            }
        }
        Ok(Auth {
            id,
            name,
            role: found_role,
            excluded: serde_json::from_str(&excluded)?,
            max_ethanol,
        })
    }
    pub fn logout(&self, session: &str) -> Result<()> {
        self.connect()?
            .execute("DELETE FROM sessions WHERE token_hash=?1", [hash(session)])?;
        Ok(())
    }
    pub fn create_guest(&self, admin: &str, display: &str, password: &str) -> Result<String> {
        let c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        if !text(display, 64) {
            return Err(HostError::Invalid("display name"));
        }
        let ph = password_hash(password)?;
        let id = Uuid::new_v4().to_string();
        c.execute(
            "INSERT INTO accounts(id,name,role,password_hash) VALUES(?1,?2,'guest',?3)",
            params![id, display, ph],
        )?;
        Ok(id)
    }
    pub fn revoke_guest(&self, admin: &str, guest: &str) -> Result<()> {
        let mut c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        self.authenticate(&tx, admin, Some("admin"), false)?;
        if tx.execute(
            "UPDATE accounts SET disabled=1 WHERE id=?1 AND role='guest'",
            [guest],
        )? != 1
        {
            return Err(HostError::NotFound);
        }
        tx.execute("DELETE FROM sessions WHERE account_id=?1", [guest])?;
        tx.commit()?;
        Ok(())
    }
    pub fn set_guest_constraints(
        &self,
        admin: &str,
        guest: &str,
        excluded: &[String],
        max_ethanol_ml: f64,
    ) -> Result<()> {
        if excluded.len() > 100
            || excluded.iter().any(|x| !text(x, 100))
            || !max_ethanol_ml.is_finite()
            || !(0.0..=100.0).contains(&max_ethanol_ml)
        {
            return Err(HostError::Invalid("guest constraints"));
        }
        let c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        if c.execute(
            "UPDATE accounts SET excluded=?2,max_ethanol=?3 WHERE id=?1 AND role='guest'",
            params![guest, serde_json::to_string(excluded)?, max_ethanol_ml],
        )? != 1
        {
            return Err(HostError::NotFound);
        }
        Ok(())
    }
    pub fn create_pair_invite(&self, admin: &str) -> Result<String> {
        let c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        let raw = token();
        c.execute(
            "INSERT INTO invites VALUES(?1,?2,0)",
            params![hash(&raw), (self.clock)() + 300],
        )?;
        Ok(raw)
    }
    pub fn request_pair(&self, invite: &str, name: &str, device: &str) -> Result<String> {
        if invite.len() != 64 || !text(name, 64) || !text(device, 100) {
            return Err(HostError::Invalid("pair request"));
        }
        let mut c = self.connect()?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.execute(
            "UPDATE invites SET used=1 WHERE token_hash=?1 AND used=0 AND expires>?2",
            params![hash(invite), (self.clock)()],
        )? != 1
        {
            return Err(HostError::Unauthorized);
        }
        let id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO pair_requests VALUES(?1,?2,?3,'pending',?4)",
            params![id, name, device, (self.clock)() + 300],
        )?;
        tx.commit()?;
        Ok(id)
    }
    pub fn approve_pair(&self, admin: &str, request: &str) -> Result<PairCredentials> {
        let mut c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        let exists:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM pair_requests WHERE id=?1 AND status='pending' AND expires>?2)",params![request,(self.clock)()],|r|r.get(0))?;
        if !exists {
            return Err(HostError::NotFound);
        }
        let secret = token();
        let ph = password_hash(&secret)?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        self.authenticate(&tx, admin, Some("admin"), false)?;
        let name: String = tx
            .query_row(
                "SELECT name FROM pair_requests WHERE id=?1 AND status='pending' AND expires>?2",
                params![request, (self.clock)()],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(HostError::NotFound)?;
        let id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO accounts(id,name,role,password_hash) VALUES(?1,?2,'guest',?3)",
            params![id, name, ph],
        )?;
        tx.execute(
            "UPDATE pair_requests SET status='approved' WHERE id=?1",
            [request],
        )?;
        tx.commit()?;
        Ok(PairCredentials {
            account_id: id,
            device_secret: secret,
        })
    }
    pub fn save_sku(&self, admin: &str, sku: &Sku) -> Result<()> {
        if !text(&sku.id, 100)
            || !text(&sku.ingredient_id, 100)
            || !text(&sku.label, 100)
            || !text(&sku.provenance, 500)
            || !sku.stock_ml.is_finite()
            || sku.stock_ml < 0.0
            || !sku.abv_fraction.is_finite()
            || !(0.0..=1.0).contains(&sku.abv_fraction)
            || !sku.maximum_dose_ml.is_finite()
            || sku.maximum_dose_ml <= 0.0
            || sku.maximum_dose_ml > 1000.0
            || sku.allergens.len() > 30
            || sku.allergens.iter().any(|s| !text(s, 100))
        {
            return Err(HostError::Invalid("SKU fields"));
        }
        let c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        c.execute("INSERT INTO sku VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET json=excluded.json,stock=excluded.stock",params![sku.id,serde_json::to_string(sku)?,sku.stock_ml])?;
        Ok(())
    }
    fn validate_spec(c: &Connection, spec: &ServingSpec, guest: Option<&Auth>) -> Result<Vec<Sku>> {
        spec.predicted_profile.validate()?;
        if !text(&spec.id, 100)
            || !text(&spec.recipe_revision_id, 100)
            || !text(&spec.name, 100)
            || !text(&spec.glass, 100)
            || !text(&spec.ice, 100)
            || !spec.source_recipe.is_object()
            || spec
                .source_recipe
                .get("source_id")
                .and_then(Value::as_str)
                .filter(|s| text(s, 100))
                .is_none()
            || spec.parts.is_empty()
            || spec.parts.len() > 30
            || spec.steps.is_empty()
            || spec.steps.len() > 30
            || spec.steps.iter().any(|x| !text(x, 1000))
            || !spec.capacity_ml.is_finite()
            || !(1.0..=2000.0).contains(&spec.capacity_ml)
            || !spec.max_ethanol_ml.is_finite()
            || !(0.0..=100.0).contains(&spec.max_ethanol_ml)
            || spec
                .dilution_ml
                .is_some_and(|d| !d.is_finite() || d < 0.0 || d > 1000.0)
            || spec.prediction_status != "heuristic_unvalidated"
        {
            return Err(HostError::Invalid("serving specification"));
        }
        if serde_json::to_vec(spec)?.len() > 65536 {
            return Err(HostError::Invalid("serving spec size"));
        }
        let mut skus = Vec::new();
        let mut seen = BTreeSet::new();
        let mut volume = 0.0;
        let mut ethanol = 0.0;
        for p in &spec.parts {
            if !seen.insert(&p.sku_id)
                || !p.quantity_ml.is_finite()
                || p.quantity_ml <= 0.0
                || !["mix", "top", "float"].contains(&p.stage.as_str())
            {
                return Err(HostError::Invalid("duplicate SKU, quantity or stage"));
            }
            let (raw, stock): (String, f64) = c
                .query_row("SELECT json,stock FROM sku WHERE id=?1", [&p.sku_id], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .optional()?
                .ok_or(HostError::Invalid("unknown SKU"))?;
            let mut sku: Sku = serde_json::from_str(&raw)?;
            sku.stock_ml = stock;
            if !sku.food_grade
                || !sku.allergens_reviewed
                || sku.ingredient_id != p.ingredient_id
                || p.quantity_ml > sku.maximum_dose_ml
                || p.quantity_ml > stock
                || (sku.carbonated && p.stage != "top")
            {
                return Err(HostError::Invalid(
                    "unreviewed, unavailable or unsafe ingredient",
                ));
            }
            if let Some(g) = guest {
                if g.excluded.contains(&sku.ingredient_id)
                    || sku.allergens.iter().any(|a| g.excluded.contains(a))
                {
                    return Err(HostError::Forbidden);
                }
            }
            volume += p.quantity_ml;
            ethanol += p.quantity_ml * sku.abv_fraction;
            skus.push(sku);
        }
        if volume + spec.dilution_ml.unwrap_or(0.0) > spec.capacity_ml
            || ethanol > spec.max_ethanol_ml
            || guest.is_some_and(|g| ethanol > g.max_ethanol)
        {
            return Err(HostError::Invalid("capacity or ethanol limit"));
        }
        Ok(skus)
    }
    /// This explicit admin operation is the only route to a guest-orderable spec.
    /// Source recipes and generated drafts do not implicitly become menu items.
    pub fn publish_serving_spec(&self, admin: &str, spec: &ServingSpec) -> Result<()> {
        let mut c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let auth = self.authenticate(&tx, admin, Some("admin"), false)?;
        Self::validate_spec(&tx, spec, None)?;
        tx.execute(
            "INSERT INTO specs(id,revision,json,approved_by,approved_at) VALUES(?1,?2,?3,?4,?5)",
            params![
                spec.id,
                spec.recipe_revision_id,
                serde_json::to_string(spec)?,
                auth.id,
                (self.clock)()
            ],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn unpublish(&self, admin: &str, spec: &str) -> Result<()> {
        let c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        if c.execute("UPDATE specs SET active=0 WHERE id=?1", [spec])? != 1 {
            return Err(HostError::NotFound);
        }
        Ok(())
    }
    pub fn catalog(&self, session: &str) -> Result<Vec<ServingSpec>> {
        let c = self.connect()?;
        self.auth(&c, session, None)?;
        let mut stmt = c.prepare("SELECT json FROM specs WHERE active=1 ORDER BY id LIMIT 1000")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|x| Ok(serde_json::from_str(&x?)?)).collect()
    }
    pub fn save_policy(&self, admin: &str, policy: &TicketPolicy) -> Result<()> {
        if !text(&policy.version, 100)
            || policy.timezone.parse::<Tz>().is_err()
            || policy.start_minute >= 1440
            || policy.end_minute >= 1440
            || policy.start_minute == policy.end_minute
            || policy.quota > 100
            || policy
                .date
                .as_ref()
                .is_some_and(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").is_err())
            || policy.effective_at < (self.clock)()
        {
            return Err(HostError::Invalid("ticket policy"));
        }
        let c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        c.execute(
            "INSERT INTO policies VALUES(?1,?2,?3)",
            params![
                policy.version,
                serde_json::to_string(policy)?,
                policy.effective_at
            ],
        )?;
        Ok(())
    }
    fn issue_due(&self, c: &Connection, guest: &str) -> Result<()> {
        let current = (self.clock)();
        let raw:Option<String>=c.query_row("SELECT json FROM policies WHERE effective<=?1 ORDER BY effective DESC,rowid DESC LIMIT 1",[current],|r|r.get(0)).optional()?;
        let Some(raw) = raw else { return Ok(()) };
        let p: TicketPolicy = serde_json::from_str(&raw)?;
        if !p.enabled {
            return Ok(());
        }
        if let Some(w) = policy_window(&p, current)? {
            c.execute("INSERT OR IGNORE INTO grants(guest,window_id,policy_version,service_date,quota,starts,expires) SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE NOT EXISTS(SELECT 1 FROM grants WHERE guest=?1 AND starts<?7 AND expires>?6)",params![guest,w.id,p.version,w.service_date,p.quota,w.starts,w.expires])?;
        }
        Ok(())
    }
    pub fn tickets(&self, session: &str) -> Result<Vec<Ticket>> {
        let mut c = self.connect()?;
        self.auth(&c, session, None)?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let auth = self.authenticate(&tx, session, None, false)?;
        self.issue_due(&tx, &auth.id)?;
        let result = {
            let mut stmt=tx.prepare("SELECT window_id,policy_version,quota,spent,starts,expires FROM grants WHERE guest=?1 ORDER BY starts DESC LIMIT 100")?;
            let values = stmt.query_map([&auth.id], |r| {
                Ok(Ticket {
                    window_id: r.get(0)?,
                    policy_version: r.get(1)?,
                    quota: r.get(2)?,
                    spent: r.get(3)?,
                    starts: r.get(4)?,
                    expires: r.get(5)?,
                })
            })?;
            values.collect::<std::result::Result<Vec<_>, _>>()?
        };
        tx.commit()?;
        Ok(result)
    }
    /// A host-clock snapshot for ticket presentation; order acceptance still revalidates atomically.
    pub fn ticket_status(&self, session: &str) -> Result<TicketAvailability> {
        let tickets = self.tickets(session)?;
        let server_now = (self.clock)();
        let c = self.connect()?;
        let raw:Option<String>=c.query_row("SELECT json FROM policies WHERE effective<=?1 ORDER BY effective DESC,rowid DESC LIMIT 1",[server_now],|r|r.get(0)).optional()?;
        let serving_enabled = raw
            .map(|s| serde_json::from_str::<TicketPolicy>(&s).map(|p| p.enabled))
            .transpose()?
            .unwrap_or(false);
        let available = if serving_enabled {
            tickets
                .iter()
                .filter(|t| t.starts <= server_now && server_now < t.expires)
                .map(|t| t.quota - t.spent)
                .sum()
        } else {
            0
        };
        Ok(TicketAvailability {
            server_now,
            available,
            serving_enabled,
            tickets,
        })
    }
    pub fn place_order(&self, session: &str, request: &OrderRequest) -> Result<Order> {
        request.target_profile.validate()?;
        if request.protocol_version != 1
            || Uuid::parse_str(&request.request_id).is_err()
            || request.units_count != 1
            || !text(&request.recipe_revision_id, 100)
            || !text(&request.serving_spec_id, 100)
            || request.guest_note.chars().count() > 300
            || request
                .guest_note
                .chars()
                .any(|c| c.is_control() || c == '<' || c == '>')
        {
            return Err(HostError::Invalid("order request"));
        }
        let request_hash = hash(&serde_json::to_string(request)?);
        let current = (self.clock)();
        let mut c = self.connect()?;
        self.auth(&c, session, Some("guest"))?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let auth = self.authenticate(&tx, session, Some("guest"), false)?;
        let prior: Option<(String, String)> = tx
            .query_row(
                "SELECT id,request_hash FROM orders WHERE guest=?1 AND request_id=?2",
                params![auth.id, request.request_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((id, h)) = prior {
            if h != request_hash {
                return Err(HostError::IdempotencyConflict);
            }
            let order = read_order(&tx, &id, &auth.id)?;
            tx.commit()?;
            return Ok(order);
        }
        let (raw,approved_by,approved_at):(String,String,i64)=tx.query_row("SELECT json,approved_by,approved_at FROM specs WHERE id=?1 AND revision=?2 AND active=1",params![request.serving_spec_id,request.recipe_revision_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?.ok_or(HostError::Invalid("not an approved current serving specification"))?;
        let spec: ServingSpec = serde_json::from_str(&raw)?;
        let skus = Self::validate_spec(&tx, &spec, Some(&auth))?;
        let active_policy:Option<String>=tx.query_row("SELECT json FROM policies WHERE effective<=?1 ORDER BY effective DESC,rowid DESC LIMIT 1",[current],|r|r.get(0)).optional()?;
        if !active_policy
            .map(|raw| serde_json::from_str::<TicketPolicy>(&raw).map(|p| p.enabled))
            .transpose()?
            .unwrap_or(false)
        {
            return Err(HostError::NoValidTicket);
        }
        self.issue_due(&tx, &auth.id)?;
        let (window,policy):(String,String)=tx.query_row("SELECT window_id,policy_version FROM grants WHERE guest=?1 AND starts<=?2 AND expires>?2 AND spent<quota ORDER BY expires LIMIT 1",params![auth.id,current],|r|Ok((r.get(0)?,r.get(1)?))).optional()?.ok_or(HostError::NoValidTicket)?;
        let id = Uuid::new_v4().to_string();
        let audit = Uuid::new_v4().to_string();
        let ethanol: f64 = spec
            .parts
            .iter()
            .zip(&skus)
            .map(|(p, s)| p.quantity_ml * s.abv_fraction)
            .sum();
        let volume: f64 = spec.parts.iter().map(|p| p.quantity_ml).sum();
        let snapshot = json!({"protocol_version":1,"guest":{"id":auth.id,"display_name":auth.name},"serving_spec":spec,"review":{"approved_by":approved_by,"approved_at":approved_at},"sku_snapshot":skus,"target_profile":request.target_profile,"prediction_status":"heuristic_unvalidated","guest_note":request.guest_note,"units_count":1,"received_at":current,"audit_id":audit,"physical":{"ingredient_volume_ml":volume,"ethanol_ml":ethanol,"served_abv_fraction":spec.dilution_ml.map(|d|ethanol/(volume+d)),"kcal":null}});
        if tx.execute("UPDATE grants SET spent=spent+1 WHERE guest=?1 AND window_id=?2 AND policy_version=?3 AND spent<quota",params![auth.id,window,policy])?!=1{return Err(HostError::NoValidTicket)}
        for p in &spec.parts {
            if tx.execute(
                "UPDATE sku SET stock=stock-?2 WHERE id=?1 AND stock>=?2",
                params![p.sku_id, p.quantity_ml],
            )? != 1
            {
                return Err(HostError::Conflict);
            }
        }
        tx.execute("INSERT INTO orders(id,guest,request_id,request_hash,snapshot,window_id,policy_version,created) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![id,auth.id,request.request_id,request_hash,serde_json::to_string(&snapshot)?,window,policy,current])?;
        push_event(
            &tx,
            "order.received",
            &id,
            1,
            &auth.id,
            json!({"order_id":id,"status":"received"}),
        )?;
        let order = read_order(&tx, &id, &auth.id)?;
        tx.commit()?;
        Ok(order)
    }
    pub fn own_orders(&self, session: &str) -> Result<Vec<Order>> {
        let c = self.connect()?;
        let auth = self.auth(&c, session, None)?;
        let mut s = c.prepare(
            "SELECT id FROM orders WHERE guest=?1 ORDER BY created DESC,rowid DESC LIMIT 100",
        )?;
        let ids = s
            .query_map([&auth.id], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ids.iter().map(|id| read_order(&c, id, &auth.id)).collect()
    }
    pub fn admin_orders(&self, session: &str) -> Result<Vec<Order>> {
        let c = self.connect()?;
        let auth = self.auth(&c, session, Some("admin"))?;
        let mut s =
            c.prepare("SELECT id FROM orders ORDER BY created DESC,rowid DESC LIMIT 100")?;
        let ids = s
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ids.iter().map(|id| read_order(&c, id, &auth.id)).collect()
    }
    pub fn order_by_request(&self, session: &str, request: &str) -> Result<Order> {
        let c = self.connect()?;
        let a = self.auth(&c, session, None)?;
        let id: String = c
            .query_row(
                "SELECT id FROM orders WHERE guest=?1 AND request_id=?2",
                params![a.id, request],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(HostError::NotFound)?;
        read_order(&c, &id, &a.id)
    }
    pub fn open_stamp(&self, session: &str, order: &str) -> Result<()> {
        let c = self.connect()?;
        let a = self.auth(&c, session, None)?;
        let owner: String = c
            .query_row("SELECT guest FROM orders WHERE id=?1", [order], |r| {
                r.get(0)
            })
            .optional()?
            .ok_or(HostError::NotFound)?;
        if a.role != "admin" && owner != a.id {
            return Err(HostError::Forbidden);
        }
        c.execute("INSERT INTO stamps VALUES(?1,?2,1) ON CONFLICT(account,order_id) DO UPDATE SET is_open=1",params![a.id,order])?;
        Ok(())
    }
    /// Rejection/cancellation may refund one ticket. A unique compensation record prevents a duplicate refund.
    pub fn transition(
        &self,
        admin: &str,
        order: &str,
        expected_version: u32,
        next: &str,
        refund: bool,
    ) -> Result<Order> {
        let mut c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let a = self.authenticate(&tx, admin, Some("admin"), false)?;
        let old = read_order(&tx, order, &a.id)?;
        if old.version != expected_version {
            return Err(HostError::Conflict);
        }
        let allowed = matches!(
            (old.status.as_str(), next),
            ("received", "accepted" | "rejected" | "cancelled")
                | ("accepted", "mixing" | "rejected" | "cancelled")
                | ("mixing", "ready")
                | ("ready", "completed")
        );
        if !allowed || (refund && !matches!(next, "rejected" | "cancelled")) {
            return Err(HostError::Invalid("order transition"));
        }
        if refund {
            tx.execute(
                "INSERT INTO refunds VALUES(?1,?2,?3)",
                params![order, (self.clock)(), a.id],
            )?;
            tx.execute("UPDATE grants SET spent=spent-1 WHERE guest=?1 AND (window_id,policy_version)=(SELECT window_id,policy_version FROM orders WHERE id=?2) AND spent>0",params![old.guest_id,order])?;
        }
        // Stock is not automatically restored: actual preparation/waste requires a separately audited inventory correction.
        tx.execute(
            "UPDATE orders SET status=?2,version=version+1 WHERE id=?1",
            params![order, next],
        )?;
        push_event(
            &tx,
            "order.transition",
            order,
            old.version + 1,
            &old.guest_id,
            json!({"order_id":order,"status":next,"ticket_refunded":refund}),
        )?;
        let result = read_order(&tx, order, &a.id)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn events(&self, session: &str, after_seq: i64) -> Result<Vec<Event>> {
        if after_seq < 0 {
            return Err(HostError::Invalid("event cursor"));
        }
        let c = self.connect()?;
        let a = self.auth(&c, session, None)?;
        let mut s=c.prepare("SELECT seq,event_id,host_id,type,entity,version,payload FROM outbox WHERE seq>?1 AND (guest=?2 OR ?3='admin') ORDER BY seq LIMIT 200")?;
        let raw = s.query_map(params![after_seq, a.id, a.role], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, u32>(5)?,
                r.get::<_, String>(6)?,
            ))
        })?;
        raw.map(|r| {
            let (seq, event_id, host_id, event_type, entity_id, entity_version, payload) = r?;
            Ok(Event {
                seq,
                event_id,
                host_id,
                event_type,
                entity_id,
                entity_version,
                payload: serde_json::from_str(&payload)?,
            })
        })
        .collect()
    }
    pub fn admin_accounts(&self, admin: &str) -> Result<Vec<AccountInfo>> {
        let c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        let mut s =
            c.prepare("SELECT id,name,role,disabled FROM accounts ORDER BY role,id LIMIT 1000")?;
        let rows = s.query_map([], |r| {
            Ok(AccountInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                role: r.get(2)?,
                disabled: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
    pub fn pending_pairs(&self, admin: &str) -> Result<Vec<PendingPair>> {
        let c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        let mut s=c.prepare("SELECT id,name,device,expires FROM pair_requests WHERE status='pending' AND expires>?1 LIMIT 100")?;
        let rows = s.query_map([(self.clock)()], |r| {
            Ok(PendingPair {
                id: r.get(0)?,
                name: r.get(1)?,
                device: r.get(2)?,
                expires_at: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
    pub fn admin_skus(&self, admin: &str) -> Result<Vec<Sku>> {
        let c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        let mut s = c.prepare("SELECT json,stock FROM sku ORDER BY id LIMIT 1000")?;
        let rows = s.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?;
        rows.map(|r| {
            let (raw, stock) = r?;
            let mut sku: Sku = serde_json::from_str(&raw)?;
            sku.stock_ml = stock;
            Ok(sku)
        })
        .collect()
    }
    pub fn admin_policies(&self, admin: &str) -> Result<Vec<TicketPolicy>> {
        let c = self.connect()?;
        self.auth(&c, admin, Some("admin"))?;
        let mut s =
            c.prepare("SELECT json FROM policies ORDER BY effective DESC,rowid DESC LIMIT 100")?;
        let rows = s.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
    }
}
fn read_order(c: &Connection, id: &str, viewer: &str) -> Result<Order> {
    let raw:(String,String,String,String,u32,i64,bool)=c.query_row("SELECT guest,request_id,snapshot,status,version,created,COALESCE((SELECT is_open FROM stamps WHERE account=?2 AND order_id=orders.id),0) FROM orders WHERE id=?1",params![id,viewer],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional()?.ok_or(HostError::NotFound)?;
    Ok(Order {
        id: id.into(),
        guest_id: raw.0,
        request_id: raw.1,
        snapshot: serde_json::from_str(&raw.2)?,
        status: raw.3,
        version: raw.4,
        created_at: raw.5,
        stamp_open: raw.6,
    })
}
fn push_event(
    c: &Connection,
    kind: &str,
    id: &str,
    version: u32,
    guest: &str,
    payload: Value,
) -> Result<()> {
    c.execute("INSERT INTO outbox(event_id,host_id,type,entity,version,guest,payload) VALUES(?1,(SELECT value FROM meta WHERE key='host_id'),?2,?3,?4,?5,?6)",params![Uuid::new_v4().to_string(),kind,id,version,guest,serde_json::to_string(&payload)?])?;
    Ok(())
}

/// Deterministic daily window. DST gaps advance to the first valid minute;
/// ambiguous starts choose the earlier instant and ends choose the later instant.
pub fn policy_window(policy: &TicketPolicy, at: i64) -> Result<Option<TicketWindow>> {
    let tz: Tz = policy
        .timezone
        .parse()
        .map_err(|_| HostError::Invalid("IANA timezone"))?;
    if policy.start_minute >= 1440
        || policy.end_minute >= 1440
        || policy.start_minute == policy.end_minute
    {
        return Err(HostError::Invalid("window minutes"));
    }
    let instant = Utc
        .timestamp_opt(at, 0)
        .single()
        .ok_or(HostError::Invalid("timestamp"))?;
    let today = instant.with_timezone(&tz).date_naive();
    for day in [today, today - ChronoDuration::days(1)] {
        if policy.date.as_ref().is_some_and(|d| d != &day.to_string()) {
            continue;
        }
        let end_day = if policy.end_minute <= policy.start_minute {
            day + ChronoDuration::days(1)
        } else {
            day
        };
        let resolve = |date: NaiveDate, minute: u32, is_end: bool| -> Result<i64> {
            let local = date
                .and_hms_opt(minute / 60, minute % 60, 0)
                .ok_or(HostError::Invalid("local time"))?;
            for adjustment in 0..=180 {
                match tz.from_local_datetime(&(local + ChronoDuration::minutes(adjustment))) {
                    LocalResult::Single(t) => return Ok(t.timestamp()),
                    LocalResult::Ambiguous(a, b) => {
                        return Ok(if is_end {
                            a.timestamp().max(b.timestamp())
                        } else {
                            a.timestamp().min(b.timestamp())
                        })
                    }
                    LocalResult::None => {}
                }
            }
            Err(HostError::Invalid("unresolvable local time"))
        };
        let starts = resolve(day, policy.start_minute, false)?;
        let expires = resolve(end_day, policy.end_minute, true)?;
        if starts <= at && at < expires && at >= policy.effective_at {
            return Ok(Some(TicketWindow {
                id: format!("{}:{}:{}", policy.timezone, day, policy.start_minute),
                service_date: day.to_string(),
                starts,
                expires,
            }));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests;
