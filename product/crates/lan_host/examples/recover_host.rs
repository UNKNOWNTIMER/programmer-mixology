//! Offline recovery to a NEW file only. Does not restore TLS identity or personal catalog.
use pixelmix_lan_host::HostStore;
use rusqlite::{backup::Backup, Connection, OpenFlags};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 5
        || args[0] != "--source"
        || args[2] != "--destination"
        || args[4] != "--application-stopped"
    {
        return Err("Usage: recover_host --source ABSOLUTE_BACKUP.sqlite --destination NEW_ABSOLUTE_FILE.sqlite --application-stopped".into());
    }
    let source = PathBuf::from(&args[1]);
    let destination = PathBuf::from(&args[3]);
    let after = recover(&source, &destination)?;
    println!(
        "{}",
        serde_json::json!({"status":"verified_new_copy","scope":"host_ledger_only","destination":destination,"verified":after,"sessions_revoked":true,"original_untouched":true,"tls_identity_restored":false})
    );
    Ok(())
}
fn recover(
    source: &Path,
    destination: &Path,
) -> Result<pixelmix_lan_host::BackupInfo, Box<dyn std::error::Error>> {
    if !source.is_absolute()
        || !destination.is_absolute()
        || destination.extension().and_then(|s| s.to_str()) != Some("sqlite")
        || destination
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Absolute source and NEW .sqlite destination are required".into());
    }
    let before = HostStore::verify_backup(&source)?;
    let origin = Connection::open_with_flags(
        &source,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    drop(
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)?,
    );
    let mut copy = Connection::open(&destination)?;
    {
        let backup = Backup::new(&origin, &mut copy)?;
        backup.run_to_completion(128, Duration::from_millis(10), None)?;
    }
    copy.execute_batch("BEGIN IMMEDIATE;DELETE FROM sessions;DELETE FROM invites;DELETE FROM pair_requests;COMMIT;")?;
    drop(copy);
    let after = HostStore::verify_backup(&destination)?;
    if before.host_id != after.host_id
        || before.committed_orders != after.committed_orders
        || before.outbox_events != after.outbox_events
    {
        return Err("Recovery reopen verification failed; original preserved".into());
    }
    Ok(after)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verified_new_copy_revokes_sessions_and_preserves_original() {
        let dir = tempfile::tempdir().unwrap();
        let store = HostStore::open(dir.path().join("original.sqlite")).unwrap();
        let account = store.bootstrap_admin("TEST recovery password").unwrap();
        let session = store.login(&account, "TEST recovery password").unwrap();
        let backups = dir.path().join("backups");
        std::fs::create_dir(&backups).unwrap();
        let source = backups.join("host.sqlite");
        store.backup_to(&source).unwrap();
        let target = dir.path().join("recovered.sqlite");
        let info = recover(&source, &target).unwrap();
        assert_eq!(info.host_id, store.host_id().unwrap());
        let recovered = HostStore::open(&target).unwrap();
        assert!(recovered.admin_accounts(&session.token).is_err());
        assert!(recovered.login(&account, "TEST recovery password").is_ok());
        assert!(store.admin_accounts(&session.token).is_ok());
        let original = std::fs::read(&source).unwrap();
        assert!(recover(&source, &source).is_err());
        assert_eq!(std::fs::read(&source).unwrap(), original);
        assert!(recover(&source, &target).is_err());
    }
    #[test]
    fn foreign_and_relative_sources_are_rejected_without_creating_destination() {
        let dir = tempfile::tempdir().unwrap();
        let foreign = dir.path().join("foreign.sqlite");
        Connection::open(&foreign)
            .unwrap()
            .execute_batch("CREATE TABLE unrelated(value TEXT)")
            .unwrap();
        let target = dir.path().join("new.sqlite");
        assert!(recover(&foreign, &target).is_err());
        assert!(!target.exists());
        assert!(recover(Path::new("relative.sqlite"), &target).is_err());
        assert!(!target.exists());
    }
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1)
    }
}
