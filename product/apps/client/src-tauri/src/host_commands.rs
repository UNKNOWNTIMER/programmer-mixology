//! Native adapter only. Authentication/roles remain enforced by HostStore.
use pixelmix_lan_host::HostStore;
use serde_json::{json, Value};
use std::path::PathBuf;

fn string<'a>(payload: &'a Value, field: &str) -> Result<&'a str, String> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing string: {field}"))
}
fn encode(value: impl serde::Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

pub fn dispatch(
    path: PathBuf,
    operation: String,
    session: Option<String>,
    p: Value,
) -> Result<Value, String> {
    if p.to_string().len() > 131_072 || session.as_ref().is_some_and(|s| s.len() > 256) {
        return Err("Host request exceeds limits".into());
    }
    let catalog_path = path.with_file_name("pixelmix.sqlite");
    let store = HostStore::open(&path).map_err(|e| e.to_string())?;
    let auth = session.as_deref().unwrap_or("");
    match operation.as_str() {
        "status" => Ok(
            json!({"initialized":store.is_initialized().map_err(|e|e.to_string())?,"host_id":store.host_id().map_err(|e|e.to_string())?,"transport":"local_native","network_status_command":"network_host_status"}),
        ),
        "bootstrap" => encode(
            store
                .bootstrap_admin(string(&p, "password")?)
                .map_err(|e| e.to_string())?,
        ),
        "login" => encode(
            store
                .login(string(&p, "account")?, string(&p, "password")?)
                .map_err(|e| e.to_string())?,
        ),
        "logout" => {
            store.logout(auth).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "create_guest" => encode(
            store
                .create_guest(auth, string(&p, "display")?, string(&p, "password")?)
                .map_err(|e| e.to_string())?,
        ),
        "revoke_guest" => {
            store
                .revoke_guest(auth, string(&p, "guest_id")?)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "set_guest_constraints" => {
            let excluded: Vec<String> =
                serde_json::from_value(p["excluded"].clone()).map_err(|e| e.to_string())?;
            store
                .set_guest_constraints(
                    auth,
                    string(&p, "guest_id")?,
                    &excluded,
                    p["max_ethanol_ml"].as_f64().ok_or("乙醇操作上限必填")?,
                )
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "invite" => encode(store.create_pair_invite(auth).map_err(|e| e.to_string())?),
        "request_pair" => encode(
            store
                .request_pair(
                    string(&p, "invite")?,
                    string(&p, "name")?,
                    string(&p, "device")?,
                )
                .map_err(|e| e.to_string())?,
        ),
        "approve_pair" => encode(
            store
                .approve_pair(auth, string(&p, "request_id")?)
                .map_err(|e| e.to_string())?,
        ),
        "save_sku" => {
            let sku: pixelmix_lan_host::Sku =
                serde_json::from_value(p).map_err(|e| e.to_string())?;
            let catalog = pixelmix_catalog::Catalog::open(catalog_path)
                .map_err(|e| e.to_string())?
                .catalog_json()
                .map_err(|e| e.to_string())?;
            if !catalog["ingredients"]
                .as_array()
                .ok_or("Ingredient catalog unavailable")?
                .iter()
                .any(|i| i["id"].as_str() == Some(&sku.ingredient_id))
            {
                return Err("Ingredient is outside the source catalog".into());
            }
            store.save_sku(auth, &sku).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "publish_spec" => {
            let mut spec: pixelmix_lan_host::ServingSpec =
                serde_json::from_value(p).map_err(|e| e.to_string())?;
            if spec.generated {
                return Err("Generated drafts require a separate provenance and serving review workflow; publishing is disabled in this build".into());
            }
            let source_id = string(&spec.source_recipe, "source_id")?.to_owned();
            let mut source = pixelmix_catalog::Catalog::open(catalog_path)
                .map_err(|e| e.to_string())?
                .recipe(&source_id)
                .map_err(|e| e.to_string())?;
            if source["recipe_revision_id"].as_str() != Some(spec.recipe_revision_id.as_str()) {
                return Err(
                    "Serving revision does not match the authoritative source catalog".into(),
                );
            }
            source["source_id"] = json!(source_id);
            spec.source_recipe = source;
            store
                .publish_serving_spec(auth, &spec)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "unpublish" => {
            store
                .unpublish(auth, string(&p, "spec_id")?)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "save_policy" => {
            let policy = serde_json::from_value(p).map_err(|e| e.to_string())?;
            store
                .save_policy(auth, &policy)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "catalog" => encode(store.catalog(auth).map_err(|e| e.to_string())?),
        "tickets" => encode(store.tickets(auth).map_err(|e| e.to_string())?),
        "ticket_status" => encode(store.ticket_status(auth).map_err(|e| e.to_string())?),
        "orders" => encode(store.own_orders(auth).map_err(|e| e.to_string())?),
        "admin_orders" => encode(store.admin_orders(auth).map_err(|e| e.to_string())?),
        "admin_accounts" => encode(store.admin_accounts(auth).map_err(|e| e.to_string())?),
        "admin_skus" => encode(store.admin_skus(auth).map_err(|e| e.to_string())?),
        "admin_policies" => encode(store.admin_policies(auth).map_err(|e| e.to_string())?),
        "pending_pairs" => encode(store.pending_pairs(auth).map_err(|e| e.to_string())?),
        "backup_host" => {
            store.admin_accounts(auth).map_err(|e| e.to_string())?;
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_millis();
            let folder = path
                .parent()
                .ok_or("Host data directory missing")?
                .join("backups")
                .join(format!("host-{stamp}"));
            std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            let backup = folder.join("host.sqlite");
            let info = store.backup_to(&backup).map_err(|e| e.to_string())?;
            Ok(
                json!({"scope":"host_ledger_only","path":backup,"verified":info,"includes":["accounts","sku_inventory","reviewed_menu","ticket_policies","tickets","immutable_orders","outbox"],"excludes":["personal_catalog","ratings","personal_settings","tls_identity"],"restore":"offline_verify_and_copy_to_new_file_only"}),
            )
        }
        "place_order" => {
            let order = serde_json::from_value(p).map_err(|e| e.to_string())?;
            encode(store.place_order(auth, &order).map_err(|e| e.to_string())?)
        }
        "by_request" => encode(
            store
                .order_by_request(auth, string(&p, "request_id")?)
                .map_err(|e| e.to_string())?,
        ),
        "open_stamp" => {
            store
                .open_stamp(auth, string(&p, "order_id")?)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "transition" => encode(
            store
                .transition(
                    auth,
                    string(&p, "order_id")?,
                    p["expected_version"]
                        .as_u64()
                        .and_then(|v| u32::try_from(v).ok())
                        .ok_or("Expected version required")?,
                    string(&p, "next")?,
                    p["refund"].as_bool().unwrap_or(false),
                )
                .map_err(|e| e.to_string())?,
        ),
        "events" => encode(
            store
                .events(auth, p["after_seq"].as_i64().unwrap_or(0))
                .map_err(|e| e.to_string())?,
        ),
        _ => Err("Unknown host operation".into()),
    }
}
