use super::*;
use std::{
    sync::{Arc, Barrier},
    thread,
};
const CLOCK: i64 = 1_800_000_000;
fn fixed_clock() -> i64 {
    CLOCK
}
struct Fixture {
    _dir: tempfile::TempDir,
    store: HostStore,
    admin: String,
    guest: String,
    guest_id: String,
}
fn profile() -> TargetProfile {
    TargetProfile {
        taste_bps: [4000, 4000, 2000, 0, 0],
        sensory_0_10: [5.0; 7],
    }
}
fn spec() -> ServingSpec {
    ServingSpec {
        id: "spec-1".into(),
        recipe_revision_id: "recipe-1@r1".into(),
        name: "测试审核酒谱".into(),
        source_recipe: json!({"source_id":"private-test-source","revision":"r1","steps":["来源步骤"]}),
        parts: vec![ServingPart {
            sku_id: "gin-1".into(),
            ingredient_id: "gin".into(),
            quantity_ml: 45.0,
            stage: "mix".into(),
        }],
        steps: vec!["加冰搅拌；滤入杯中。".into()],
        glass: "rocks".into(),
        ice: "cube".into(),
        dilution_ml: None,
        capacity_ml: 240.0,
        max_ethanol_ml: 24.0,
        predicted_profile: profile(),
        prediction_status: "heuristic_unvalidated".into(),
        generated: false,
        rules_version: None,
        model_version: None,
    }
}
fn request() -> OrderRequest {
    OrderRequest {
        protocol_version: 1,
        request_id: Uuid::new_v4().to_string(),
        recipe_revision_id: "recipe-1@r1".into(),
        serving_spec_id: "spec-1".into(),
        target_profile: profile(),
        units_count: 1,
        guest_note: "少冰".into(),
    }
}
fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let mut store = HostStore::open(dir.path().join("host.sqlite")).unwrap();
    store.clock = fixed_clock;
    let aid = store.bootstrap_admin("correct-admin-password").unwrap();
    let admin = store.login(&aid, "correct-admin-password").unwrap().token;
    let gid = store
        .create_guest(&admin, "客人一", "correct-guest-password")
        .unwrap();
    let guest = store.login(&gid, "correct-guest-password").unwrap().token;
    store
        .save_sku(
            &admin,
            &Sku {
                id: "gin-1".into(),
                ingredient_id: "gin".into(),
                label: "测试标签".into(),
                provenance: "test-only-confirmed-label".into(),
                stock_ml: 1000.0,
                abv_fraction: 0.4,
                maximum_dose_ml: 60.0,
                food_grade: true,
                allergens_reviewed: true,
                allergens: vec![],
                carbonated: false,
            },
        )
        .unwrap();
    store.publish_serving_spec(&admin, &spec()).unwrap();
    store
        .save_policy(
            &admin,
            &TicketPolicy {
                version: "policy-1".into(),
                timezone: "UTC".into(),
                start_minute: 0,
                end_minute: 1439,
                quota: 1,
                enabled: true,
                date: None,
                effective_at: CLOCK,
            },
        )
        .unwrap();
    Fixture {
        _dir: dir,
        store,
        admin,
        guest,
        guest_id: gid,
    }
}
#[test]
fn last_ticket_is_atomic_across_twenty_threads() {
    let f = fixture();
    let barrier = Arc::new(Barrier::new(20));
    let joins: Vec<_> = (0..20)
        .map(|_| {
            let s = f.store.clone();
            let session = f.guest.clone();
            let b = barrier.clone();
            thread::spawn(move || {
                b.wait();
                s.place_order(&session, &request())
            })
        })
        .collect();
    let mut successes = 0;
    for j in joins {
        match j.join().unwrap() {
            Ok(_) => successes += 1,
            Err(HostError::NoValidTicket) => {}
            Err(e) => panic!("unexpected: {e}"),
        }
    }
    assert_eq!(successes, 1);
    assert_eq!(f.store.tickets(&f.guest).unwrap()[0].spent, 1);
    assert_eq!(f.store.events(&f.admin, 0).unwrap().len(), 1);
}
#[test]
fn ack_lost_retry_survives_reopen_without_second_debit() {
    let f = fixture();
    let req = request();
    let order = f.store.place_order(&f.guest, &req).unwrap();
    let mut reopened = HostStore::open(&f.store.path).unwrap();
    reopened.clock = fixed_clock;
    let retried = reopened.place_order(&f.guest, &req).unwrap();
    assert_eq!(order.id, retried.id);
    assert_eq!(reopened.events(&f.admin, 0).unwrap().len(), 1);
    assert_eq!(reopened.tickets(&f.guest).unwrap()[0].spent, 1);
}
#[test]
fn altered_payload_with_same_request_id_is_conflict() {
    let f = fixture();
    let mut req = request();
    f.store.place_order(&f.guest, &req).unwrap();
    req.guest_note = "new note".into();
    assert!(matches!(
        f.store.place_order(&f.guest, &req),
        Err(HostError::IdempotencyConflict)
    ));
}
#[test]
fn request_hash_is_independent_of_later_menu_changes() {
    let f = fixture();
    let req = request();
    let first = f.store.place_order(&f.guest, &req).unwrap();
    f.store.unpublish(&f.admin, "spec-1").unwrap();
    let second = f.store.place_order(&f.guest, &req).unwrap();
    assert_eq!(first.id, second.id);
}
#[test]
fn outbox_failure_rolls_back_ticket_order_and_stock() {
    let f = fixture();
    f.store.connect().unwrap().execute_batch("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'injected failure before commit'); END;").unwrap();
    assert!(f.store.place_order(&f.guest, &request()).is_err());
    let c = f.store.connect().unwrap();
    assert_eq!(
        c.query_row("SELECT count(*) FROM orders", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        c.query_row("SELECT stock FROM sku", [], |r| r.get::<_, f64>(0))
            .unwrap(),
        1000.0
    );
    assert_eq!(f.store.tickets(&f.guest).unwrap()[0].spent, 0);
}
#[test]
fn no_unreviewed_recipe_can_be_ordered() {
    let f = fixture();
    let mut r = request();
    r.serving_spec_id = "generated-unreviewed-candidate".into();
    assert!(matches!(
        f.store.place_order(&f.guest, &r),
        Err(HostError::Invalid(_))
    ));
    assert_eq!(f.store.tickets(&f.guest).unwrap()[0].spent, 0);
}
#[test]
fn snapshots_are_immutable_in_memory_and_at_database_boundary() {
    let f = fixture();
    let mut req = request();
    let saved = f.store.place_order(&f.guest, &req).unwrap();
    req.target_profile.taste_bps = [10000, 0, 0, 0, 0];
    assert_ne!(
        saved.snapshot["target_profile"],
        serde_json::to_value(req.target_profile).unwrap()
    );
    assert!(f
        .store
        .connect()
        .unwrap()
        .execute("UPDATE orders SET snapshot='{}' WHERE id=?1", [saved.id])
        .is_err());
}
#[test]
fn guest_cannot_read_others_or_escalate_admin() {
    let f = fixture();
    let order = f.store.place_order(&f.guest, &request()).unwrap();
    let other = f
        .store
        .create_guest(&f.admin, "客人二", "another-guest-password")
        .unwrap();
    let session = f
        .store
        .login(&other, "another-guest-password")
        .unwrap()
        .token;
    assert!(f.store.own_orders(&session).unwrap().is_empty());
    assert!(f.store.events(&session, 0).unwrap().is_empty());
    assert!(matches!(
        f.store.open_stamp(&session, &order.id),
        Err(HostError::Forbidden)
    ));
    assert!(matches!(
        f.store.admin_orders(&session),
        Err(HostError::Forbidden)
    ));
    assert!(matches!(
        f.store.publish_serving_spec(&session, &spec()),
        Err(HostError::Forbidden)
    ));
}
#[test]
fn stamp_view_does_not_accept_order_or_change_tickets() {
    let f = fixture();
    let order = f.store.place_order(&f.guest, &request()).unwrap();
    f.store.open_stamp(&f.admin, &order.id).unwrap();
    let read = f.store.admin_orders(&f.admin).unwrap().remove(0);
    assert!(read.stamp_open);
    assert_eq!(read.status, "received");
    assert_eq!(read.version, 1);
    assert_eq!(f.store.events(&f.admin, 0).unwrap().len(), 1);
    assert_eq!(f.store.tickets(&f.guest).unwrap()[0].spent, 1);
}
#[test]
fn transition_conflict_and_exactly_one_refund() {
    let f = fixture();
    let order = f.store.place_order(&f.guest, &request()).unwrap();
    let updated = f
        .store
        .transition(&f.admin, &order.id, 1, "rejected", true)
        .unwrap();
    assert_eq!(updated.version, 2);
    assert!(matches!(
        f.store.transition(&f.admin, &order.id, 1, "rejected", true),
        Err(HostError::Conflict)
    ));
    assert_eq!(f.store.tickets(&f.guest).unwrap()[0].spent, 0);
    assert_eq!(f.store.events(&f.admin, 0).unwrap().len(), 2);
}
#[test]
fn invalid_transition_does_not_mutate_order() {
    let f = fixture();
    let order = f.store.place_order(&f.guest, &request()).unwrap();
    assert!(f
        .store
        .transition(&f.admin, &order.id, 1, "completed", false)
        .is_err());
    assert_eq!(f.store.own_orders(&f.guest).unwrap()[0].status, "received");
}
#[test]
fn fresh_policy_version_does_not_double_issue_same_day() {
    let f = fixture();
    assert_eq!(f.store.tickets(&f.guest).unwrap()[0].quota, 1);
    f.store
        .save_policy(
            &f.admin,
            &TicketPolicy {
                version: "policy-2".into(),
                timezone: "UTC".into(),
                start_minute: 0,
                end_minute: 1439,
                quota: 50,
                enabled: true,
                date: None,
                effective_at: CLOCK,
            },
        )
        .unwrap();
    let tickets = f.store.tickets(&f.guest).unwrap();
    assert_eq!(tickets.len(), 1);
    assert_eq!(tickets[0].quota, 1);
}
#[test]
fn pairing_requires_one_time_invite_and_admin_approval() {
    let f = fixture();
    let invite = f.store.create_pair_invite(&f.admin).unwrap();
    let pending = f.store.request_pair(&invite, "新客人", "测试设备").unwrap();
    assert!(matches!(
        f.store.request_pair(&invite, "another", "device"),
        Err(HostError::Unauthorized)
    ));
    assert!(matches!(
        f.store.approve_pair(&f.guest, &pending),
        Err(HostError::Forbidden)
    ));
    let credential = f.store.approve_pair(&f.admin, &pending).unwrap();
    assert_eq!(
        f.store
            .login(&credential.account_id, &credential.device_secret)
            .unwrap()
            .role,
        "guest"
    );
    assert!(matches!(
        f.store.approve_pair(&f.admin, &pending),
        Err(HostError::NotFound)
    ));
}
#[test]
fn revoke_device_invalidates_current_session() {
    let f = fixture();
    f.store.revoke_guest(&f.admin, &f.guest_id).unwrap();
    assert!(matches!(
        f.store.tickets(&f.guest),
        Err(HostError::Unauthorized)
    ));
    assert!(matches!(
        f.store.login(&f.guest_id, "correct-guest-password"),
        Err(HostError::Unauthorized)
    ));
}
#[test]
fn session_expiry_and_login_rate_limit() {
    let mut f = fixture();
    f.store.clock = || CLOCK + 901;
    assert!(matches!(
        f.store.tickets(&f.guest),
        Err(HostError::Unauthorized)
    ));
    for _ in 0..5 {
        assert!(matches!(
            f.store.login(&f.guest_id, "wrong-password"),
            Err(HostError::Unauthorized)
        ));
    }
    assert!(matches!(
        f.store.login(&f.guest_id, "correct-guest-password"),
        Err(HostError::RateLimited)
    ));
}
#[test]
fn active_session_has_a_bounded_request_rate() {
    let f = fixture();
    for _ in 0..120 {
        f.store.own_orders(&f.guest).unwrap();
    }
    assert!(matches!(
        f.store.own_orders(&f.guest),
        Err(HostError::RateLimited)
    ));
}
#[test]
fn business_failures_cannot_roll_back_request_rate_limit() {
    let f = fixture();
    let mut req = request();
    req.serving_spec_id = "unreviewed".into();
    for _ in 0..120 {
        assert!(matches!(
            f.store.place_order(&f.guest, &req),
            Err(HostError::Invalid(_))
        ));
    }
    assert!(matches!(
        f.store.place_order(&f.guest, &req),
        Err(HostError::RateLimited)
    ));
}
#[test]
fn pausing_service_rejects_unspent_existing_tickets() {
    let f = fixture();
    assert_eq!(f.store.tickets(&f.guest).unwrap()[0].spent, 0);
    f.store
        .save_policy(
            &f.admin,
            &TicketPolicy {
                version: "paused".into(),
                timezone: "UTC".into(),
                start_minute: 0,
                end_minute: 1439,
                quota: 0,
                enabled: false,
                date: None,
                effective_at: CLOCK,
            },
        )
        .unwrap();
    assert!(matches!(
        f.store.place_order(&f.guest, &request()),
        Err(HostError::NoValidTicket)
    ));
}
#[test]
fn management_lists_require_admin_and_preserve_actual_inventory() {
    let f = fixture();
    assert_eq!(f.store.admin_accounts(&f.admin).unwrap().len(), 2);
    assert_eq!(f.store.admin_skus(&f.admin).unwrap()[0].stock_ml, 1000.0);
    f.store.place_order(&f.guest, &request()).unwrap();
    assert_eq!(f.store.admin_skus(&f.admin).unwrap()[0].stock_ml, 955.0);
    assert_eq!(f.store.admin_policies(&f.admin).unwrap().len(), 1);
    assert!(matches!(
        f.store.pending_pairs(&f.guest),
        Err(HostError::Forbidden)
    ));
}
#[test]
fn missing_or_forged_tokens_are_rejected() {
    let f = fixture();
    assert!(matches!(
        f.store.own_orders(""),
        Err(HostError::Unauthorized)
    ));
    assert!(matches!(
        f.store.own_orders(&"0".repeat(64)),
        Err(HostError::Unauthorized)
    ));
}
#[test]
fn exclusions_and_ethanol_ceiling_are_host_authoritative() {
    let f = fixture();
    f.store
        .set_guest_constraints(&f.admin, &f.guest_id, &["gin".into()], 24.0)
        .unwrap();
    assert!(matches!(
        f.store.place_order(&f.guest, &request()),
        Err(HostError::Forbidden)
    ));
    f.store
        .set_guest_constraints(&f.admin, &f.guest_id, &[], 0.0)
        .unwrap();
    assert!(matches!(
        f.store.place_order(&f.guest, &request()),
        Err(HostError::Invalid(_))
    ));
    assert_eq!(f.store.tickets(&f.guest).unwrap()[0].spent, 0);
}
#[test]
fn excess_quantity_unsupported_protocol_and_markup_are_rejected() {
    let f = fixture();
    let mut r = request();
    r.units_count = 2;
    assert!(f.store.place_order(&f.guest, &r).is_err());
    r.units_count = 1;
    r.protocol_version = 2;
    assert!(f.store.place_order(&f.guest, &r).is_err());
    r.protocol_version = 1;
    r.guest_note = "<script>alert(1)</script>".into();
    assert!(f.store.place_order(&f.guest, &r).is_err());
    r.guest_note = "".into();
    r.target_profile.taste_bps = [0; 5];
    assert!(f.store.place_order(&f.guest, &r).is_err());
}
#[test]
fn precise_physical_numbers_do_not_fabricate_unknown_nutrition_or_dilution() {
    let f = fixture();
    let o = f.store.place_order(&f.guest, &request()).unwrap();
    assert_eq!(o.snapshot["physical"]["ethanol_ml"], 18.0);
    assert!(o.snapshot["physical"]["served_abv_fraction"].is_null());
    assert!(o.snapshot["physical"]["kcal"].is_null());
    assert!(o.snapshot["serving_spec"]["source_recipe"]["source_id"].is_string());
}
#[test]
fn credentials_are_hashed_in_sqlite() {
    let f = fixture();
    let c = f.store.connect().unwrap();
    let ph: String = c
        .query_row(
            "SELECT password_hash FROM accounts WHERE id=?1",
            [&f.guest_id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(ph.starts_with("$argon2id$"));
    let raw: String = c
        .query_row(
            "SELECT token_hash FROM sessions WHERE account_id=?1",
            [&f.guest_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_ne!(raw, f.guest);
    assert_eq!(raw, hash(&f.guest));
}
fn p(tz: &str, start: u32, end: u32) -> TicketPolicy {
    TicketPolicy {
        version: "test".into(),
        timezone: tz.into(),
        start_minute: start,
        end_minute: end,
        quota: 1,
        enabled: true,
        date: None,
        effective_at: 0,
    }
}
fn at(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s).unwrap().timestamp()
}
#[test]
fn cross_midnight_window_has_stable_identity() {
    let policy = p("Asia/Shanghai", 22 * 60, 2 * 60);
    let one = policy_window(&policy, at("2026-09-20T23:30:00+08:00"))
        .unwrap()
        .unwrap();
    let two = policy_window(&policy, at("2026-09-21T01:30:00+08:00"))
        .unwrap()
        .unwrap();
    assert_eq!(one.id, two.id);
    assert_eq!(one.expires - one.starts, 4 * 3600);
    assert!(policy_window(&policy, at("2026-09-21T02:00:00+08:00"))
        .unwrap()
        .is_none());
}
#[test]
fn dst_repeated_hour_has_one_window() {
    let policy = p("America/New_York", 60, 120);
    let one = policy_window(&policy, at("2026-11-01T01:30:00-04:00"))
        .unwrap()
        .unwrap();
    let two = policy_window(&policy, at("2026-11-01T01:30:00-05:00"))
        .unwrap()
        .unwrap();
    assert_eq!(one.id, two.id);
    assert_eq!(one.expires - one.starts, 7200);
}
#[test]
fn dst_missing_start_moves_to_first_valid_minute() {
    let policy = p("America/New_York", 150, 240);
    let w = policy_window(&policy, at("2026-03-08T03:15:00-04:00"))
        .unwrap()
        .unwrap();
    assert_eq!(w.starts, at("2026-03-08T03:00:00-04:00"));
    assert_eq!(w.expires - w.starts, 3600);
}
#[test]
fn dates_limits_and_sensory_nan_are_rejected() {
    let mut target = profile();
    target.sensory_0_10[0] = f64::NAN;
    assert!(target.validate().is_err());
    assert!(policy_window(&p("not-a-zone", 0, 20), CLOCK).is_err());
    assert!(policy_window(&p("UTC", 0, 1440), CLOCK).is_err());
    let mut policy = p("UTC", 0, 1439);
    policy.date = Some("2020-01-01".into());
    assert!(policy_window(&policy, CLOCK).unwrap().is_none());
}
#[test]
fn timezone_policy_change_cannot_issue_an_overlapping_second_window() {
    let f = fixture();
    // Simulates a previously valid calendar window from another host timezone.
    let c = f.store.connect().unwrap();
    c.execute("INSERT INTO grants(guest,window_id,policy_version,service_date,quota,starts,expires) VALUES(?1,'prior-zone','prior-policy','different-service-date',1,?2,?3)",params![f.guest_id,CLOCK-3600,CLOCK+3600]).unwrap();
    let grants = f.store.tickets(&f.guest).unwrap();
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].window_id, "prior-zone");
}
#[test]
fn committed_wal_order_and_outbox_survive_online_backup() {
    let f = fixture();
    let req = request();
    let original = f.store.place_order(&f.guest, &req).unwrap();
    let backup_dir = f._dir.path().join("backups");
    std::fs::create_dir_all(&backup_dir).unwrap();
    let path = backup_dir.join("host.sqlite");
    let info = f.store.backup_to(&path).unwrap();
    assert_eq!(info.committed_orders, 1);
    assert_eq!(info.outbox_events, 1);
    let verified = HostStore::verify_backup(&path).unwrap();
    assert_eq!(info.host_id, verified.host_id);
    let mut recovered = HostStore::open(&path).unwrap();
    recovered.clock = fixed_clock;
    assert_eq!(
        recovered
            .order_by_request(&f.guest, &req.request_id)
            .unwrap()
            .id,
        original.id
    );
    assert_eq!(recovered.tickets(&f.guest).unwrap()[0].spent, 1);
}
#[test]
fn backup_rejects_escape_overwrite_foreign_schema_and_foreign_db() {
    let f = fixture();
    assert!(matches!(
        f.store.backup_to(f._dir.path().join("escape.sqlite")),
        Err(HostError::Invalid(_))
    ));
    let path = f._dir.path().join("backups/host.sqlite");
    f.store.backup_to(&path).unwrap();
    assert!(f.store.backup_to(&path).is_err());
    let foreign = f._dir.path().join("foreign.sqlite");
    let c = Connection::open(&foreign).unwrap();
    c.execute_batch("CREATE TABLE other(value TEXT);").unwrap();
    assert!(HostStore::verify_backup(&foreign).is_err());
    assert!(HostStore::open(&foreign).is_err());
    c.pragma_update(None, "application_id", APPLICATION_ID)
        .unwrap();
    c.pragma_update(None, "user_version", 1).unwrap();
    assert!(HostStore::verify_backup(&foreign).is_err());
}
#[test]
fn native_admin_token_is_not_accepted_by_guest_network_adapter() {
    let f = fixture();
    assert!(matches!(
        f.store.authorize_guest_transport(&f.admin),
        Err(HostError::Forbidden)
    ));
    assert!(f.store.authorize_guest_transport(&f.guest).is_ok());
}
#[test]
fn ticket_display_uses_host_time_and_paused_policy_not_guest_clock() {
    let f = fixture();
    let ready = f.store.ticket_status(&f.guest).unwrap();
    assert_eq!(ready.server_now, CLOCK);
    assert_eq!(ready.available, 1);
    assert!(ready.serving_enabled);
    f.store.place_order(&f.guest, &request()).unwrap();
    assert_eq!(f.store.ticket_status(&f.guest).unwrap().available, 0);
    f.store
        .save_policy(
            &f.admin,
            &TicketPolicy {
                version: "dock-paused".into(),
                timezone: "UTC".into(),
                start_minute: 0,
                end_minute: 1439,
                quota: 10,
                enabled: false,
                date: None,
                effective_at: CLOCK,
            },
        )
        .unwrap();
    let paused = f.store.ticket_status(&f.guest).unwrap();
    assert!(!paused.serving_enabled);
    assert_eq!(paused.available, 0);
}

#[cfg(windows)]
fn start_tls(f: &Fixture) -> transport::TlsHost {
    transport::TlsHost::start(
        f.store.clone(),
        &f.admin,
        transport::NetworkConfig {
            explicitly_enabled: true,
            bind_address: "127.0.0.1:0".parse().unwrap(),
            identity_directory: f._dir.path().join("identity"),
        },
    )
    .unwrap()
}
#[test]
fn networking_is_disabled_without_explicit_opt_in() {
    let f = fixture();
    let cfg = transport::NetworkConfig {
        explicitly_enabled: false,
        bind_address: "127.0.0.1:0".parse().unwrap(),
        identity_directory: f._dir.path().join("not-created"),
    };
    assert!(matches!(
        transport::TlsHost::start(f.store.clone(), &f.admin, cfg),
        Err(transport::TransportError::Disabled)
    ));
    assert!(!f._dir.path().join("not-created").exists());
}
#[cfg(windows)]
#[test]
fn real_loopback_tls_guest_order_retry_and_session_protection() {
    let f = fixture();
    let mut server = start_tls(&f);
    let mut guest = transport::GuestClient::connect(
        server.identity.clone(),
        &server.identity.certificate_sha256,
    )
    .unwrap();
    assert!(matches!(
        guest.catalog(),
        Err(transport::TransportError::Rejected(401, _))
    ));
    assert_eq!(
        guest
            .login(&f.guest_id, "correct-guest-password")
            .unwrap()
            .role,
        "guest"
    );
    assert_eq!(guest.catalog().unwrap().len(), 1);
    assert_eq!(guest.tickets().unwrap()[0].quota, 1);
    let req = request();
    let first = guest.submit(&req).unwrap();
    let retried = guest.submit(&req).unwrap();
    assert_eq!(first.id, retried.id);
    assert_eq!(guest.by_request(&req.request_id).unwrap().id, first.id);
    assert_eq!(guest.orders().unwrap().len(), 1);
    assert_eq!(guest.events(0).unwrap().len(), 1);
    assert_eq!(guest.tickets().unwrap()[0].spent, 1);
    let mut conflict = req;
    conflict.guest_note = "changed".into();
    assert!(
        matches!(guest.submit(&conflict),Err(transport::TransportError::Rejected(409,ref code))if code=="IDEMPOTENCY_CONFLICT")
    );
    server.stop();
}
#[cfg(windows)]
#[test]
fn certificate_pin_change_is_rejected_and_private_key_is_dpapi_encrypted() {
    let f = fixture();
    let server = start_tls(&f);
    assert!(matches!(
        transport::GuestClient::connect(server.identity.clone(), &"0".repeat(64)),
        Err(transport::TransportError::Fingerprint)
    ));
    let key = std::fs::read(f._dir.path().join("identity/host-key.dpapi")).unwrap();
    assert!(!String::from_utf8_lossy(&key).contains("PRIVATE KEY"));
    let other = fixture();
    let other_server = start_tls(&other);
    let mut forged = server.identity.clone();
    forged.certificate_pem = other_server.identity.certificate_pem.clone();
    forged.certificate_sha256 = other_server.identity.certificate_sha256.clone();
    let confirm = forged.certificate_sha256.clone();
    assert!(matches!(
        transport::GuestClient::connect(forged, &confirm),
        Err(transport::TransportError::Network)
    ));
}
#[cfg(windows)]
#[test]
fn tls_identity_persists_after_stop_and_restart() {
    let f = fixture();
    let mut first = start_tls(&f);
    let fingerprint = first.identity.certificate_sha256.clone();
    first.stop();
    let second = start_tls(&f);
    assert_eq!(fingerprint, second.identity.certificate_sha256);
    assert!(transport::GuestClient::connect(second.identity.clone(), &fingerprint).is_ok());
}
#[cfg(windows)]
#[test]
fn reusing_identity_at_different_ip_fails_before_listener_bind() {
    let f = fixture();
    let mut first = start_tls(&f);
    first.stop();
    let changed = transport::NetworkConfig {
        explicitly_enabled: true,
        bind_address: "192.168.250.250:8443".parse().unwrap(),
        identity_directory: f._dir.path().join("identity"),
    };
    assert!(matches!(
        transport::TlsHost::start(f.store.clone(), &f.admin, changed),
        Err(transport::TransportError::IdentityAddress)
    ));
}
#[cfg(windows)]
#[test]
fn tls_pair_invite_requires_local_admin_approval() {
    let f = fixture();
    let server = start_tls(&f);
    let guest = transport::GuestClient::connect(
        server.identity.clone(),
        &server.identity.certificate_sha256,
    )
    .unwrap();
    let invite = f.store.create_pair_invite(&f.admin).unwrap();
    let pending = guest
        .request_pair(&invite, "远端客人", "loopback-contract-client")
        .unwrap();
    assert_eq!(pending["status"], "pending_admin_approval");
    assert!(matches!(
        guest.request_pair(&invite, "other", "device"),
        Err(transport::TransportError::Rejected(401, _))
    ));
    let req = pending["request_id"].as_str().unwrap();
    assert_eq!(f.store.pending_pairs(&f.admin).unwrap().len(), 1);
    let cred = f.store.approve_pair(&f.admin, req).unwrap();
    let mut second = transport::GuestClient::connect(
        server.identity.clone(),
        &server.identity.certificate_sha256,
    )
    .unwrap();
    second.login(&cred.account_id, &cred.device_secret).unwrap();
    assert!(second.catalog().is_ok());
}
