use super::*;
use std::sync::{Arc, Barrier, Mutex};

fn draft() -> RecipeDraft {
    RecipeDraft {
        name_zh: "我的试调".into(),
        name_en: "My trial".into(),
        family: "sour".into(),
        glass_template: "coupe".into(),
        method: "shake".into(),
        ingredients: vec![RecipeIngredient {
            ingredient_id: "gin".into(),
            quantity: Some(30.),
            quantity_range: None,
            retained_ml: None,
            unit: "ml".into(),
            optional: false,
            stage: "mix".into(),
            quantity_note: None,
            allowed_alternatives: vec![],
        }],
        steps_zh: vec!["加冰摇匀，滤入杯中。".into()],
        garnish_zh: String::new(),
        notes_zh: String::new(),
        source_url: None,
        taste_bps: [2000; 5],
        sensory_0_10: [5.; 7],
    }
}
fn request(
    revision: u64,
    action: Action,
    id: Option<&str>,
    draft: Option<RecipeDraft>,
) -> LibraryRequest {
    LibraryRequest {
        expected_revision: revision,
        action,
        id: id.map(str::to_owned),
        draft,
        enabled: None,
    }
}
fn create(db: &Catalog, revision: u64) -> LibraryState {
    apply(db, request(revision, Action::Create, None, Some(draft()))).unwrap()
}
fn unchanged_sources(db: &Catalog) -> Value {
    let mut value = db.catalog_json().unwrap();
    value["settings"].as_object_mut().unwrap().remove(SETTING);
    value
}

#[test]
fn empty_state_does_not_create_a_setting_or_change_sources() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    let before = db.catalog_json().unwrap();
    assert_eq!(get(&db).unwrap(), LibraryState::default());
    assert_eq!(db.load_setting(SETTING).unwrap(), None);
    assert_eq!(db.catalog_json().unwrap(), before);
}

#[test]
fn create_survives_reopen_and_is_archive_compatible_without_authority() {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("catalog.sqlite");
    let db = Catalog::open(&file).unwrap();
    let before = unchanged_sources(&db);
    let state = create(&db, 0);
    assert_eq!(state.revision, 1);
    let entry = &state.custom[0];
    assert!(custom_id(entry.recipe["id"].as_str().unwrap()));
    assert_eq!(entry.recipe["source"]["kind"], "personal_recipe");
    assert_eq!(entry.recipe["default_orderable"], false);
    assert_eq!(entry.recipe["needs_serving_configuration"], true);
    assert_eq!(entry.profile["status"], "heuristic_unvalidated");
    assert_eq!(entry.profile["origin"], "user_defined");
    assert_eq!(entry.profile["measured"], false);
    assert!(entry.profile["taste_intensity_0_10"].is_null());
    assert!(DateTime::parse_from_rfc3339(&entry.created_at).is_ok());
    let saved = archive::save(temp.path(), snapshot(entry)).unwrap();
    let imported = archive::read(std::path::Path::new(&saved.path)).unwrap();
    assert_eq!(imported["snapshot"]["recipe"], entry.recipe);
    assert_eq!(imported["authority_restored"], false);
    assert_eq!(imported["guest_orderable"], false);
    assert_eq!(unchanged_sources(&db), before);
    drop(db);
    let reopened = Catalog::open(&file).unwrap();
    assert_eq!(get(&reopened).unwrap(), state);
    assert_eq!(unchanged_sources(&reopened), before);
}

#[test]
fn updates_create_new_revisions_and_leave_old_archive_and_source_snapshots_immutable() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    db.save_setting("ui_state", &json!({"target":{"taste_bps":[10000,0,0,0,0],"sensory_0_10":[1,2,3,4,5,6,7]},"reviews":[{"kind":"actual_tasting","score":4}]})).unwrap();
    let before = unchanged_sources(&db);
    let old = create(&db, 0);
    let previous = old.custom[0].clone();
    let saved = archive::save(temp.path(), snapshot(&previous)).unwrap();
    let bytes = std::fs::read(&saved.path).unwrap();
    let id = previous.recipe["id"].as_str().unwrap();
    let mut changed = draft();
    changed.name_zh = "改过的试调".into();
    changed.ingredients[0].quantity = Some(45.);
    changed.source_url = Some("https://example.com/reference".into());
    changed.taste_bps = [4000, 3000, 2000, 500, 500];
    let updated = apply(&db, request(1, Action::Update, Some(id), Some(changed))).unwrap();
    assert_eq!(updated.revision, 2);
    assert_eq!(updated.custom[0].recipe["id"], previous.recipe["id"]);
    assert_ne!(
        updated.custom[0].recipe["recipe_revision_id"],
        previous.recipe["recipe_revision_id"]
    );
    assert_eq!(updated.custom[0].created_at, previous.created_at);
    assert_eq!(
        updated.custom[0].profile["taste_preference_bps"],
        json!([4000, 3000, 2000, 500, 500])
    );
    assert_eq!(old.custom[0], previous);
    assert_eq!(std::fs::read(&saved.path).unwrap(), bytes);
    assert_eq!(
        archive::read(std::path::Path::new(&saved.path)).unwrap()["snapshot"]["recipe"],
        previous.recipe
    );
    assert_eq!(unchanged_sources(&db), before);
    let error = apply(
        &db,
        request(2, Action::Update, Some("iba_dry_martini"), Some(draft())),
    )
    .unwrap_err();
    assert!(error.contains("原始酒谱不可改写"));
    assert_eq!(get(&db).unwrap(), updated);
}

#[test]
fn hide_show_and_trash_restore_work_for_source_and_custom_without_destroying_records() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    let before = unchanged_sources(&db);
    let original = create(&db, 0);
    let custom_id = original.custom[0].recipe["id"].as_str().unwrap().to_owned();
    let mut state = original.clone();
    for id in ["iba_dry_martini", custom_id.as_str()] {
        state = apply(&db, request(state.revision, Action::Hide, Some(id), None)).unwrap();
        assert!(state.hidden.contains(&id.into()));
        assert!(!state.deleted.contains(&id.into()));
        state = apply(&db, request(state.revision, Action::Show, Some(id), None)).unwrap();
        assert!(!state.hidden.contains(&id.into()));
        state = apply(&db, request(state.revision, Action::Hide, Some(id), None)).unwrap();
        state = apply(&db, request(state.revision, Action::Delete, Some(id), None)).unwrap();
        assert!(!state.hidden.contains(&id.into()));
        assert!(state.deleted.contains(&id.into()));
        for action in [Action::Hide, Action::Show] {
            assert!(apply(&db, request(state.revision, action, Some(id), None))
                .unwrap_err()
                .contains("恢复"));
        }
        assert_eq!(get(&db).unwrap(), state);
        state = apply(
            &db,
            request(state.revision, Action::Restore, Some(id), None),
        )
        .unwrap();
        assert!(!state.deleted.contains(&id.into()));
        assert!(!state.hidden.contains(&id.into()));
        assert_eq!(state.custom, original.custom);
    }
    assert_eq!(unchanged_sources(&db), before);
}

#[test]
fn validation_rejects_bad_drafts_and_never_creates_a_partial_setting() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    let mut invalid = vec![];
    for name in ["<script>", "bad\u{202e}text", "name\nline"] {
        let mut d = draft();
        d.name_zh = name.into();
        invalid.push(d);
    }
    for name in ["", "   "] {
        let mut d = draft();
        d.name_zh = name.into();
        d.name_en = name.into();
        invalid.push(d);
    }
    let mut d = draft();
    d.name_en = "a".repeat(161);
    invalid.push(d);
    let mut d = draft();
    d.notes_zh = "a".repeat(8001);
    invalid.push(d);
    let mut d = draft();
    d.family = "unknown".into();
    invalid.push(d);
    let mut d = draft();
    d.glass_template = "script".into();
    invalid.push(d);
    let mut d = draft();
    d.method = "execute".into();
    invalid.push(d);
    let mut d = draft();
    d.ingredients.clear();
    invalid.push(d);
    let mut d = draft();
    d.ingredients[0].ingredient_id = "unreviewed".into();
    invalid.push(d);
    for quantity in [0., -1., f64::NAN, f64::INFINITY, 10001.] {
        let mut d = draft();
        d.ingredients[0].quantity = Some(quantity);
        invalid.push(d);
    }
    for retained in [-1., f64::NAN, f64::INFINITY, 10001.] {
        let mut d = draft();
        d.ingredients[0].retained_ml = Some(retained);
        invalid.push(d);
    }
    for interval in [[0., 1.], [3., 2.], [1., 10001.], [f64::NAN, 3.]] {
        let mut d = draft();
        d.ingredients[0].quantity = None;
        d.ingredients[0].quantity_range = Some(interval);
        invalid.push(d);
    }
    let mut d = draft();
    d.ingredients[0].quantity_range = Some([1., 3.]);
    invalid.push(d);
    let mut d = draft();
    d.ingredients[0].unit = "execute".into();
    invalid.push(d);
    let mut d = draft();
    d.ingredients[0].stage = "authority".into();
    invalid.push(d);
    for alternatives in [vec!["missing"], vec!["gin"], vec!["vodka", "vodka"]] {
        let mut d = draft();
        d.ingredients[0].allowed_alternatives =
            alternatives.into_iter().map(str::to_owned).collect();
        invalid.push(d);
    }
    let mut d = draft();
    d.steps_zh.clear();
    invalid.push(d);
    let mut d = draft();
    d.steps_zh = vec![" ".into()];
    invalid.push(d);
    let mut d = draft();
    d.taste_bps = [1999; 5];
    invalid.push(d);
    for value in [-1., 10.01, f64::NAN, f64::INFINITY] {
        let mut d = draft();
        d.sensory_0_10[0] = value;
        invalid.push(d);
    }
    for url in [
        "file:///C:/private",
        "javascript:alert(1)",
        "https://user:password@example.com",
        "not a url",
        "https://",
    ] {
        let mut d = draft();
        d.source_url = Some(url.into());
        invalid.push(d);
    }
    let before = db.catalog_json().unwrap();
    for bad in invalid {
        assert!(apply(&db, request(0, Action::Create, None, Some(bad))).is_err());
        assert_eq!(db.load_setting(SETTING).unwrap(), None);
    }
    assert_eq!(db.catalog_json().unwrap(), before);
}

#[test]
fn unknown_amounts_ranges_and_optional_ingredients_remain_unfabricated() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    let mut d = draft();
    d.ingredients[0].quantity = None;
    d.ingredients[0].quantity_range = Some([25., 35.]);
    d.ingredients[0].quantity_note = Some("原配方给出范围".into());
    d.ingredients.push(RecipeIngredient {
        ingredient_id: "soda".into(),
        quantity: None,
        quantity_range: None,
        retained_ml: Some(0.5),
        unit: "to_top".into(),
        optional: true,
        stage: "top".into(),
        quantity_note: None,
        allowed_alternatives: vec!["water".into()],
    });
    let input = serde_json::to_value(&d.ingredients).unwrap();
    let state = apply(&db, request(0, Action::Create, None, Some(d))).unwrap();
    assert_eq!(state.custom[0].recipe["ingredients"], input);
    archive::validate(&snapshot(&state.custom[0])).unwrap();
}

#[test]
fn revision_mismatch_and_unknown_action_shapes_do_not_mutate_saved_state() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    let state = create(&db, 0);
    let original = db.load_setting(SETTING).unwrap();
    assert!(
        apply(&db, request(0, Action::Hide, Some("iba_dry_martini"), None))
            .unwrap_err()
            .contains("刷新")
    );
    for q in [
        request(1, Action::Create, Some("forced"), Some(draft())),
        request(1, Action::Create, None, None),
        request(1, Action::Hide, None, None),
        request(1, Action::Hide, Some("not_exists"), None),
        request(1, Action::Delete, Some("iba_dry_martini"), Some(draft())),
    ] {
        assert!(apply(&db, q).is_err());
        assert_eq!(db.load_setting(SETTING).unwrap(), original);
    }
    for value in [
        json!({"expected_revision":1,"action":"publish","id":"iba_dry_martini"}),
        json!({"expected_revision":1,"action":"hide","id":"iba_dry_martini","session":"forged"}),
        json!({"expected_revision":1.5,"action":"hide","id":"iba_dry_martini"}),
    ] {
        assert!(serde_json::from_value::<LibraryRequest>(value).is_err());
    }
    let mut authority_draft = serde_json::to_value(draft()).unwrap();
    authority_draft["default_orderable"] = json!(true);
    assert!(serde_json::from_value::<RecipeDraft>(authority_draft).is_err());
    assert_eq!(get(&db).unwrap(), state);
}

#[test]
fn concurrent_requests_under_app_mutex_have_one_winner_without_lost_updates() {
    let temp = tempfile::tempdir().unwrap();
    let db = Arc::new(Mutex::new(
        Catalog::open(temp.path().join("catalog.sqlite")).unwrap(),
    ));
    let barrier = Arc::new(Barrier::new(2));
    let mut handles = vec![];
    for id in ["iba_dry_martini", "iba_negroni"] {
        let (db, barrier) = (Arc::clone(&db), Arc::clone(&barrier));
        handles.push(std::thread::spawn(move || {
            barrier.wait();
            let guard = db.lock().unwrap();
            apply(&guard, request(0, Action::Hide, Some(id), None))
        }));
    }
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|r| r.as_ref().is_err_and(|e| e.contains("刷新")))
            .count(),
        1
    );
    let state = get(&db.lock().unwrap()).unwrap();
    assert_eq!(state.revision, 1);
    assert_eq!(state.hidden.len(), 1);
}

#[test]
fn backup_and_restore_include_library_and_tombstones_without_touching_original_tables() {
    let temp = tempfile::tempdir().unwrap();
    let db_path = temp.path().join("catalog.sqlite");
    let mut db = Catalog::open(&db_path).unwrap();
    let before = unchanged_sources(&db);
    let created = create(&db, 0);
    let id = created.custom[0].recipe["id"].as_str().unwrap();
    apply(&db, request(1, Action::Hide, Some("iba_negroni"), None)).unwrap();
    let backed_up = apply(&db, request(2, Action::Delete, Some(id), None)).unwrap();
    let backup = temp.path().join("backup.sqlite");
    db.backup_to(&backup).unwrap();
    apply(&db, request(3, Action::Restore, Some(id), None)).unwrap();
    create(&db, 4);
    assert_ne!(get(&db).unwrap(), backed_up);
    db.restore_from(&backup).unwrap();
    assert_eq!(get(&db).unwrap(), backed_up);
    assert_eq!(unchanged_sources(&db), before);
    drop(db);
    assert_eq!(get(&Catalog::open(&db_path).unwrap()).unwrap(), backed_up);
}

#[test]
fn custom_count_includes_trash_and_full_state_byte_limit_is_atomic() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    let mut state = LibraryState::default();
    for _ in 0..100 {
        state = create(&db, state.revision);
    }
    let id = state.custom[0].recipe["id"].as_str().unwrap().to_owned();
    state = apply(
        &db,
        request(state.revision, Action::Delete, Some(&id), None),
    )
    .unwrap();
    assert!(apply(
        &db,
        request(state.revision, Action::Create, None, Some(draft()))
    )
    .unwrap_err()
    .contains("100"));
    assert_eq!(get(&db).unwrap(), state);
    let second = Catalog::open(temp.path().join("large.sqlite")).unwrap();
    let mut large = draft();
    large.steps_zh = vec!["长".repeat(1900); 48];
    let before = second.catalog_json().unwrap();
    assert!(
        apply(&second, request(0, Action::Create, None, Some(large)))
            .err()
            .expect("oversized library must fail")
            .contains("256 KiB")
    );
    assert_eq!(second.catalog_json().unwrap(), before);
}

#[test]
fn corrupted_persisted_library_is_refused_without_resetting_it_or_restoring_authority() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    let state = create(&db, 0);
    let mut corrupt = serde_json::to_value(state).unwrap();
    corrupt["custom"][0]["recipe"]["default_orderable"] = json!(true);
    db.save_setting(SETTING, &corrupt).unwrap();
    assert!(get(&db).unwrap_err().contains("不能恢复"));
    assert!(apply(&db, request(1, Action::Hide, Some("iba_negroni"), None)).is_err());
    assert_eq!(db.load_setting(SETTING).unwrap(), Some(corrupt));
}

#[test]
fn corrupted_loaded_ids_counts_metadata_and_tombstones_are_rejected_without_overwrite() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    let valid = serde_json::to_value(create(&db, 0)).unwrap();
    let mut cases = vec![];
    let mut value = valid.clone();
    value["custom"][0]["recipe"]["id"] = json!("iba_dry_martini");
    cases.push(value);
    let mut value = valid.clone();
    value["custom"]
        .as_array_mut()
        .unwrap()
        .push(valid["custom"][0].clone());
    cases.push(value);
    let mut value = valid.clone();
    value["custom"] = json!(vec![valid["custom"][0].clone(); 101]);
    cases.push(value);
    let mut value = valid.clone();
    value["hidden"] = json!(["missing"]);
    cases.push(value);
    let mut value = valid.clone();
    value["hidden"] = json!(["iba_dry_martini"]);
    value["deleted"] = value["hidden"].clone();
    cases.push(value);
    let mut value = valid.clone();
    value["custom"][0]["profile"]["origin"] = json!("measured");
    cases.push(value);
    let mut value = valid.clone();
    value["custom"][0]["recipe"]["source"]["url"] = json!("javascript:alert(1)");
    cases.push(value);
    let mut value = valid.clone();
    value["custom"][0]["updated_at"] = json!("2020-01-01T00:00:00Z");
    cases.push(value);
    let mut value = valid.clone();
    value["custom"][0]["recipe"]["name_en"] = json!("");
    cases.push(value);
    let mut value = valid.clone();
    value["revision"] = json!(MAX_REVISION + 1);
    cases.push(value);
    let mut value = valid;
    value["version"] = json!(2);
    cases.push(value);
    for corrupt in cases {
        db.save_setting(SETTING, &corrupt).unwrap();
        assert!(get(&db).is_err());
        assert!(apply(&db, request(1, Action::Hide, Some("iba_negroni"), None)).is_err());
        assert_eq!(db.load_setting(SETTING).unwrap(), Some(corrupt));
    }
}

#[test]
fn a_single_name_is_copied_to_both_languages_on_create_and_update() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    let mut d = draft();
    d.name_zh = "  只有中文  ".into();
    d.name_en = " ".into();
    let created = apply(&db, request(0, Action::Create, None, Some(d))).unwrap();
    assert_eq!(created.custom[0].recipe["name_zh"], "只有中文");
    assert_eq!(created.custom[0].recipe["name_en"], "只有中文");
    let id = created.custom[0].recipe["id"].as_str().unwrap();
    let mut d = draft();
    d.name_zh = String::new();
    d.name_en = "  English only  ".into();
    let updated = apply(&db, request(1, Action::Update, Some(id), Some(d))).unwrap();
    assert_eq!(updated.custom[0].recipe["name_zh"], "English only");
    assert_eq!(updated.custom[0].recipe["name_en"], "English only");
    assert_eq!(get(&db).unwrap(), updated);
}

#[test]
fn all_300_source_recipes_can_be_cloned_without_losing_quantities_or_provenance() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    let before = db.catalog_json().unwrap();
    let context = Context::load(&db).unwrap();
    let recipes = before["recipes"].as_array().unwrap();
    let profiles = before["profiles"].as_array().unwrap();
    assert_eq!(recipes.len(), 300);
    for recipe in recipes {
        let profile = profiles
            .iter()
            .find(|v| v["recipe_id"] == recipe["id"])
            .unwrap();
        let original = CustomRecipe {
            recipe: recipe.clone(),
            profile: profile.clone(),
            created_at: String::new(),
            updated_at: String::new(),
            import_provenance: None,
        };
        let draft = draft_from_entry(&original).unwrap_or_else(|e| panic!("{}: {e}", recipe["id"]));
        validate_draft(&draft, &context).unwrap_or_else(|e| panic!("{}: {e}", recipe["id"]));
        let entry = create_entry(&format!("personal_{}", Uuid::new_v4()), draft, None);
        let state = LibraryState {
            revision: 1,
            custom: vec![entry.clone()],
            ..LibraryState::default()
        };
        validate_state(&state, &context).unwrap_or_else(|e| panic!("{}: {e}", recipe["id"]));
        let original_parts: Vec<RecipeIngredient> =
            serde_json::from_value(recipe["ingredients"].clone()).unwrap();
        assert_eq!(
            entry.recipe["ingredients"],
            serde_json::to_value(original_parts).unwrap()
        );
        assert_eq!(entry.recipe["steps_zh"], recipe["steps_zh"]);
        assert_eq!(entry.recipe["source"]["url"], recipe["source"]["url"]);
        assert_eq!(
            entry.profile["taste_preference_bps"],
            profile["taste_preference_bps"]
        );
        assert_eq!(
            serde_json::from_value::<[f64; 7]>(entry.profile["sensory_0_10"].clone()).unwrap(),
            serde_json::from_value::<[f64; 7]>(profile["sensory_0_10"].clone()).unwrap()
        );
    }
    assert_eq!(db.catalog_json().unwrap(), before);
    assert!(db.load_setting(SETTING).unwrap().is_none());
}

#[test]
fn all_auxiliary_and_unknown_windows_are_denied_both_library_commands() {
    for command in [
        "recipe_library_get",
        "recipe_library_apply",
        "recipe_library_import",
    ] {
        assert!(command_allowed("main", command));
        for label in [
            "recipe-details",
            "glass-details",
            "taste-preview",
            "unknown",
            "",
        ] {
            assert!(!command_allowed(label, command));
        }
    }
    assert!(command_allowed("taste-preview", "taste_window_payload"));
}

#[test]
fn dlc_is_enabled_without_writing_old_library_and_toggle_preserves_personal_data() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("catalog.sqlite");
    let db = Catalog::open(&path).unwrap();
    let empty = serde_json::to_value(get(&db).unwrap()).unwrap();
    assert!(empty.get("disabled_groups").is_none());
    assert!(db.load_setting(SETTING).unwrap().is_none());
    let personal = create(&db, 0);
    let before = unchanged_sources(&db);
    let catalog = crate::dlc::extend_catalog(
        crate::personal_ingredients::extend_catalog(db.catalog_json().unwrap()).unwrap(),
    )
    .unwrap();
    let member = catalog["dlc_groups"][0]["recipe_ids"][0].as_str().unwrap();
    let toggle = |revision, enabled| LibraryRequest {
        expected_revision: revision,
        action: Action::SetGroupEnabled,
        id: Some(crate::dlc::GROUP_ID.into()),
        draft: None,
        enabled: Some(enabled),
    };
    let disabled = apply(&db, toggle(1, false)).unwrap();
    assert_eq!(disabled.disabled_groups, [crate::dlc::GROUP_ID]);
    assert_eq!(disabled.custom, personal.custom);
    assert!(disabled.hidden.is_empty() && disabled.deleted.is_empty());
    assert_eq!(unchanged_sources(&db), before);
    // Group exclusion does not invalidate saved member visibility preferences.
    let hidden = apply(&db, request(2, Action::Hide, Some(member), None)).unwrap();
    assert_eq!(hidden.hidden, [member]);
    drop(db);
    let db = Catalog::open(&path).unwrap();
    assert_eq!(get(&db).unwrap(), hidden);
    let enabled = apply(&db, toggle(3, true)).unwrap();
    assert!(enabled.disabled_groups.is_empty());
    assert!(serde_json::to_value(&enabled)
        .unwrap()
        .get("disabled_groups")
        .is_none());
    assert_eq!(enabled.hidden, hidden.hidden);
    assert_eq!(enabled.custom, personal.custom);
    assert_eq!(unchanged_sources(&db), before);
}

#[test]
fn invalid_group_actions_and_corrupt_group_states_are_rejected_without_writes() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    let baseline = create(&db, 0);
    for invalid in [
        LibraryRequest {
            expected_revision: 1,
            action: Action::SetGroupEnabled,
            id: Some("missing".into()),
            draft: None,
            enabled: Some(false),
        },
        LibraryRequest {
            expected_revision: 1,
            action: Action::SetGroupEnabled,
            id: Some(crate::dlc::GROUP_ID.into()),
            draft: None,
            enabled: None,
        },
        LibraryRequest {
            expected_revision: 1,
            action: Action::SetGroupEnabled,
            id: Some(crate::dlc::GROUP_ID.into()),
            draft: Some(draft()),
            enabled: Some(false),
        },
        LibraryRequest {
            expected_revision: 1,
            action: Action::Create,
            id: None,
            draft: Some(draft()),
            enabled: Some(false),
        },
    ] {
        assert!(apply(&db, invalid).is_err());
        assert_eq!(get(&db).unwrap(), baseline);
    }
    let context = Context::load(&db).unwrap();
    for groups in [
        vec!["unknown".into()],
        vec![crate::dlc::GROUP_ID.into(), crate::dlc::GROUP_ID.into()],
    ] {
        let mut corrupt = baseline.clone();
        corrupt.disabled_groups = groups;
        assert!(validate_state(&corrupt, &context).is_err());
    }
}

#[test]
fn every_bundled_dlc_recipe_is_editable_as_a_personal_draft_without_source_changes() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    let before = db.catalog_json().unwrap();
    let context = Context::load(&db).unwrap();
    let catalog = crate::dlc::extend_catalog(
        crate::personal_ingredients::extend_catalog(before.clone()).unwrap(),
    )
    .unwrap();
    for id in catalog["dlc_groups"][0]["recipe_ids"].as_array().unwrap() {
        let recipe = catalog["recipes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| &v["id"] == id)
            .unwrap();
        let profile = catalog["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| &v["recipe_id"] == id)
            .unwrap();
        let source = CustomRecipe {
            recipe: recipe.clone(),
            profile: profile.clone(),
            created_at: String::new(),
            updated_at: String::new(),
            import_provenance: None,
        };
        let draft = draft_from_entry(&source).unwrap_or_else(|e| panic!("{id}: {e}"));
        validate_draft(&draft, &context).unwrap_or_else(|e| panic!("{id}: {e}"));
    }
    assert_eq!(db.catalog_json().unwrap(), before);
    assert!(db.load_setting(SETTING).unwrap().is_none());
    assert!(serde_json::from_value::<ImportRequest>(
        json!({"expected_revision":0,"path":"valid.pixelmix","snapshot":{}})
    )
    .is_err());
}

fn exported_dlc(db: &Catalog, folder: &std::path::Path) -> (Snapshot, Value) {
    let catalog = crate::dlc::extend_catalog(
        crate::personal_ingredients::extend_catalog(db.catalog_json().unwrap()).unwrap(),
    )
    .unwrap();
    let id = &catalog["dlc_groups"][0]["recipe_ids"][0];
    let recipe = catalog["recipes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| &v["id"] == id)
        .unwrap()
        .clone();
    let profile = catalog["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| &v["recipe_id"] == id)
        .unwrap()
        .clone();
    let mut source = Snapshot {
        recipe,
        profile,
        target: json!({"taste_bps":[10000,0,0,0,0],"sensory_0_10":[10,9,8,7,6,5,4]}),
    };
    // Even hostile permission/measurement claims in an otherwise valid archive
    // must never be granted by importing it into the personal library.
    source.recipe["default_orderable"] = json!(true);
    source.recipe["needs_serving_configuration"] = json!(false);
    source.recipe["actual_user_rating"] = Value::Null;
    source.profile["measured"] = json!(true);
    let exported = archive::save(folder, source.clone()).unwrap();
    let decoded = archive::read(std::path::Path::new(&exported.path)).unwrap();
    (source, decoded)
}

#[test]
fn repeated_archive_imports_create_independent_personal_copies_with_original_prediction_and_authorship(
) {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("catalog.sqlite");
    let db = Catalog::open(&path).unwrap();
    db.save_setting("ui_state", &json!({"selected":"unchanged","archiveQueue":[{"private":"unchanged"}],"reviews":[],"target":{"taste_bps":[2000,2000,2000,2000,2000]}})).unwrap();
    let (original, decoded) = exported_dlc(&db, temp.path());
    let before = unchanged_sources(&db);
    let first = import_validated_archive(&db, 0, decoded.clone()).unwrap();
    let second = import_validated_archive(&db, 1, decoded.clone()).unwrap();
    assert_ne!(first.added_id, second.added_id);
    assert_eq!(second.library.custom.len(), 2);
    assert_eq!(first.library.custom[0], second.library.custom[0]);
    let entry = &second.library.custom[1];
    assert_eq!(entry.recipe["default_orderable"], false);
    assert_eq!(entry.recipe["needs_serving_configuration"], true);
    assert_eq!(entry.recipe["source"]["kind"], "imported_snapshot");
    for key in [
        "publisher",
        "url",
        "reference",
        "checked_on",
        "method_provenance",
    ] {
        assert_eq!(entry.recipe["source"][key], original.recipe["source"][key]);
    }
    for key in ["ingredients", "steps_zh", "garnish_zh", "notes_zh"] {
        assert_eq!(entry.recipe[key], original.recipe[key]);
    }
    for key in ["taste_preference_bps", "sensory_0_10", "note_zh"] {
        assert_eq!(entry.profile[key], original.profile[key]);
    }
    assert_ne!(
        entry.profile["taste_preference_bps"],
        original.target["taste_bps"]
    );
    assert_eq!(entry.profile["measured"], false);
    assert_eq!(entry.profile["status"], "imported_unvalidated");
    assert_eq!(
        entry.import_provenance.as_ref().unwrap().original_snapshot,
        original
    );
    assert_eq!(
        entry.import_provenance.as_ref().unwrap().sha256,
        decoded["sha256"].as_str().unwrap()
    );
    let reexport = archive::save(temp.path(), snapshot(entry)).unwrap();
    let reimport = archive::read(std::path::Path::new(&reexport.path)).unwrap();
    assert_eq!(
        reimport["snapshot"]["recipe"]["source"],
        entry.recipe["source"]
    );
    let third = import_validated_archive(&db, 2, reimport).unwrap();
    assert_eq!(
        third.library.custom[2].recipe["source"]["publisher"],
        original.recipe["source"]["publisher"]
    );
    assert_eq!(unchanged_sources(&db), before);
    drop(db);
    let db = Catalog::open(&path).unwrap();
    assert_eq!(get(&db).unwrap(), third.library);
    let old_entry = &third.library.custom[0];
    let mut d = draft_from_entry(old_entry).unwrap();
    d.name_zh = "本机修改副本".into();
    let updated = apply(
        &db,
        request(3, Action::Update, Some(&first.added_id), Some(d)),
    )
    .unwrap();
    assert_eq!(
        updated.custom[0].import_provenance,
        old_entry.import_provenance
    );
    assert_eq!(
        updated.custom[0].recipe["source"]["publisher"],
        original.recipe["source"]["publisher"]
    );
    assert_eq!(updated.custom[0].profile["origin"], "user_defined");
}

#[test]
fn archive_import_stale_unknown_ingredients_and_invalid_snapshot_do_not_mutate_library() {
    let temp = tempfile::tempdir().unwrap();
    let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
    let (_, decoded) = exported_dlc(&db, temp.path());
    let baseline = import_validated_archive(&db, 0, decoded.clone())
        .unwrap()
        .library;
    assert!(import_validated_archive(&db, 0, decoded.clone()).is_err());
    assert!(check_revision(&db, 0).is_err());
    for path in ["unknown_ingredient", "bad_sum", "bad_provenance"] {
        let mut invalid = decoded.clone();
        match path {
            "unknown_ingredient" => {
                invalid["snapshot"]["recipe"]["ingredients"][0]["ingredient_id"] =
                    json!("not_in_whitelist")
            }
            "bad_sum" => {
                invalid["snapshot"]["profile"]["taste_preference_bps"] = json!([0, 0, 0, 0, 0])
            }
            _ => invalid["archive_id"] = json!("not-a-uuid"),
        }
        assert!(import_validated_archive(&db, 1, invalid).is_err(), "{path}");
        assert_eq!(get(&db).unwrap(), baseline);
    }
    let mut full = baseline.clone();
    for _ in 1..MAX_CUSTOM {
        full.custom.push(create_entry(
            &format!("personal_{}", Uuid::new_v4()),
            draft(),
            None,
        ));
    }
    // A full personal library cannot silently accept a DLC archive by evicting
    // an existing personal record or dropping its original provenance.
    db.save_setting(SETTING, &check_size(&full).unwrap())
        .unwrap();
    assert!(import_validated_archive(&db, 1, decoded).is_err());
    assert_eq!(get(&db).unwrap(), full);
}
