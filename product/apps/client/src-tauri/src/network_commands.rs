use pixelmix_lan_host::{
    transport::{GuestClient, NetworkConfig, PairingIdentity, TlsHost},
    HostStore,
};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex};

#[derive(Default)]
pub struct NetworkController {
    host: Mutex<Option<TlsHost>>,
    guest: Mutex<Option<GuestClient>>,
}
impl NetworkController {
    pub fn host_status(&self) -> Value {
        let slot = self.host.lock().unwrap_or_else(|e| e.into_inner());
        match slot.as_ref() {
            Some(h) => json!({"running":true,"identity":h.identity}),
            None => json!({"running":false}),
        }
    }
    pub fn start_host(
        &self,
        data_dir: PathBuf,
        session: String,
        address: String,
        explicitly_enabled: bool,
    ) -> Result<Value, String> {
        let mut slot = self.host.lock().map_err(|e| e.to_string())?;
        if slot.is_some() {
            return Err("主机服务已运行，请先停止后更换配置".into());
        }
        let store = HostStore::open(data_dir.join("host.sqlite")).map_err(|e| e.to_string())?;
        let config = NetworkConfig {
            explicitly_enabled,
            bind_address: address.parse().map_err(|_| "请输入明确的私有网卡IP:端口")?,
            identity_directory: data_dir.join("host-identity"),
        };
        let host = TlsHost::start(store, &session, config).map_err(|e| e.to_string())?;
        let identity = serde_json::to_value(&host.identity).map_err(|e| e.to_string())?;
        *slot = Some(host);
        Ok(identity)
    }
    pub fn stop_host(&self, data_dir: PathBuf, session: String) -> Result<(), String> {
        HostStore::open(data_dir.join("host.sqlite"))
            .map_err(|e| e.to_string())?
            .admin_accounts(&session)
            .map_err(|e| e.to_string())?;
        if let Some(mut host) = self.host.lock().map_err(|e| e.to_string())?.take() {
            host.stop()
        };
        Ok(())
    }
    pub fn guest_call(&self, operation: String, p: Value) -> Result<Value, String> {
        if p.to_string().len() > 131_072 {
            return Err("客户端请求超出限制".into());
        }
        let text = |field: &str| {
            p.get(field)
                .and_then(Value::as_str)
                .ok_or_else(|| format!("缺少字段 {field}"))
        };
        let mut slot = self.guest.lock().map_err(|e| e.to_string())?;
        match operation.as_str() {
            "connect" => {
                *slot = None;
                let identity: PairingIdentity =
                    serde_json::from_value(p["identity"].clone()).map_err(|e| e.to_string())?;
                let client = GuestClient::connect(identity, text("confirmed_fingerprint")?)
                    .map_err(|e| e.to_string())?;
                *slot = Some(client);
                Ok(json!({"connected":true,"certificate_pinned":true}))
            }
            "disconnect" => {
                *slot = None;
                Ok(Value::Null)
            }
            _ => {
                let client = slot.as_mut().ok_or("尚未确认并连接主机身份")?;
                match operation.as_str() {
                    "login" => serde_json::to_value(
                        client
                            .login(text("account")?, text("password")?)
                            .map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string()),
                    "request_pair" => client
                        .request_pair(text("invite")?, text("name")?, text("device")?)
                        .map_err(|e| e.to_string()),
                    "catalog" => serde_json::to_value(client.catalog().map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string()),
                    "ticket_status" => {
                        serde_json::to_value(client.ticket_status().map_err(|e| e.to_string())?)
                            .map_err(|e| e.to_string())
                    }
                    "tickets" => serde_json::to_value(client.tickets().map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string()),
                    "orders" => serde_json::to_value(client.orders().map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string()),
                    "place_order" => serde_json::to_value(
                        client
                            .submit(&serde_json::from_value(p).map_err(|e| e.to_string())?)
                            .map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string()),
                    "by_request" => serde_json::to_value(
                        client
                            .by_request(text("request_id")?)
                            .map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string()),
                    "events" => serde_json::to_value(
                        client
                            .events(p["after_seq"].as_i64().unwrap_or(0))
                            .map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string()),
                    _ => Err("未知的客人操作".into()),
                }
            }
        }
    }
}
