use super::*;
fn snapshot() -> Snapshot {
    let recipes: Value =
        serde_json::from_str(include_str!("../../../public/seed/recipes.json")).unwrap();
    let profiles: Value =
        serde_json::from_str(include_str!("../../../public/seed/profiles.seed.json")).unwrap();
    let mut recipe = recipes["recipes"][0].clone();
    recipe["recipe_revision_id"] = json!("TEST-source-revision");
    Snapshot {
        recipe,
        profile: profiles["profiles"][0].clone(),
        target: json!({"taste_bps":[2000,2000,2000,2000,2000],"sensory_0_10":[1,2,3,4,5,6,7]}),
    }
}
fn encoded(snapshot: Snapshot) -> Vec<u8> {
    serde_json::to_vec(&build(snapshot).unwrap()).unwrap()
}
#[test]
fn every_source_recipe_and_prior_supports_portable_snapshot() {
    let recipes: Value =
        serde_json::from_str(include_str!("../../../public/seed/recipes.json")).unwrap();
    let profiles: Value =
        serde_json::from_str(include_str!("../../../public/seed/profiles.seed.json")).unwrap();
    for raw in recipes["recipes"].as_array().unwrap() {
        let mut recipe = raw.clone();
        recipe["recipe_revision_id"] = json!("TEST-source-revision");
        let profile = profiles["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["recipe_id"] == recipe["id"])
            .unwrap()
            .clone();
        let s = Snapshot {
            recipe,
            profile,
            target: snapshot().target,
        };
        validate(&s).unwrap_or_else(|e| panic!("{}: {e}", raw["id"]));
        decode(&encoded(s)).unwrap();
    }
}
#[test]
fn source_prediction_target_and_unknown_quantities_survive_without_authority() {
    let mut s = snapshot();
    s.recipe["ingredients"][0]["quantity"] = Value::Null;
    s.recipe["default_orderable"] = json!(true);
    s.profile["measured"] = json!(true);
    let result = decode(&encoded(s.clone())).unwrap();
    assert_eq!(result["snapshot"]["recipe"], s.recipe);
    assert_eq!(result["snapshot"]["profile"], s.profile);
    assert_eq!(result["target"], s.target);
    assert_eq!(
        result["personal"]["recipe"]["source"]["kind"],
        "imported_snapshot"
    );
    assert_eq!(result["personal"]["recipe"]["default_orderable"], false);
    assert_eq!(result["personal"]["profile"]["measured"], false);
    assert_eq!(result["authority_restored"], false);
    assert_ne!(
        result["personal"]["recipe"]["recipe_revision_id"],
        s.recipe["recipe_revision_id"]
    );
}
#[test]
fn checksum_detects_mutation_and_reordered_keys_are_stable() {
    let bytes = encoded(snapshot());
    let mut v: Value = serde_json::from_slice(&bytes).unwrap();
    assert!(decode(&serde_json::to_vec_pretty(&v).unwrap()).is_ok());
    v["body"]["snapshot"]["recipe"]["name_zh"] = json!("changed");
    assert!(decode(&serde_json::to_vec(&v).unwrap())
        .unwrap_err()
        .contains("SHA-256"));
}
#[test]
fn unknown_version_and_privilege_fields_cannot_be_smuggled_even_with_recomputed_checksum() {
    let mut file = build(snapshot()).unwrap();
    file.body.version = 2;
    file.sha256 = digest(&file.body).unwrap();
    assert!(decode(&serde_json::to_vec(&file).unwrap()).is_err());
    for field in [
        "accounts",
        "ticket",
        "session",
        "serving_spec",
        "permission",
        "shell",
    ] {
        let mut file = build(snapshot()).unwrap();
        file.body.snapshot.recipe[field] = json!("admin");
        file.sha256 = digest(&file.body).unwrap();
        assert!(decode(&serde_json::to_vec(&file).unwrap()).is_err());
    }
}
#[test]
fn schema_rejects_duplicate_keys_nan_excess_size_and_trailing_content() {
    let bytes = encoded(snapshot());
    let text = String::from_utf8(bytes).unwrap();
    assert!(decode(
        text.replacen("\"version\":1", "\"version\":1,\"version\":1", 1)
            .as_bytes()
    )
    .is_err());
    assert!(decode(format!("{text}{{}}").as_bytes()).is_err());
    assert!(decode(&vec![b' '; MAX_BYTES + 1]).is_err());
    assert!(decode(b"{\"body\":NaN}").is_err());
}
#[test]
fn vectors_markup_url_and_missing_nullable_values_are_strict() {
    let original_note = "TheCocktailDB 原计量：Top up with\r\n未指定容量不推算。";
    let mut line_ending_snapshot = snapshot();
    line_ending_snapshot.recipe["ingredients"][0]["quantity_note"] = json!(original_note);
    let imported = decode(&encoded(line_ending_snapshot)).unwrap();
    assert_eq!(
        imported["snapshot"]["recipe"]["ingredients"][0]["quantity_note"],
        original_note
    );
    for invalid in [
        "bare\rcarriage return",
        "null\0control",
        "<script>",
        "bidi\u{202e}",
    ] {
        let mut s = snapshot();
        s.recipe["ingredients"][0]["quantity_note"] = json!(invalid);
        assert!(validate(&s).is_err());
    }
    let mut s = snapshot();
    s.target["taste_bps"] = json!([1999, 2000, 2000, 2000, 2000]);
    assert!(validate(&s).is_err());
    s = snapshot();
    s.profile["taste_preference_bps"] = json!([2000.0, 2000, 2000, 2000, 2000]);
    assert!(validate(&s).is_err());
    s = snapshot();
    s.recipe["source"]["url"] = json!("javascript:alert(1)");
    assert!(validate(&s).is_err());
    s = snapshot();
    s.recipe["name_zh"] = json!("<script>");
    assert!(validate(&s).is_err());
    s = snapshot();
    s.recipe["ingredients"][0]
        .as_object_mut()
        .unwrap()
        .remove("quantity");
    assert!(validate(&s).is_err());
}
#[test]
fn files_are_unique_source_preserved_and_never_overwritten() {
    let temp = tempfile::tempdir().unwrap();
    let s = snapshot();
    let a = save(temp.path(), s.clone()).unwrap();
    let first = std::fs::read(&a.path).unwrap();
    let b = save(temp.path(), s).unwrap();
    assert_ne!(a.path, b.path);
    assert_eq!(
        Path::new(&a.path).file_name(),
        Path::new(&b.path).file_name()
    );
    assert_eq!(
        Path::new(&a.path)
            .parent()
            .unwrap()
            .file_name()
            .unwrap()
            .to_str(),
        Some(a.archive_id.as_str())
    );
    read(Path::new(&a.path)).unwrap();
    assert_eq!(std::fs::read(&a.path).unwrap(), first);
    assert!(own_archive(temp.path(), "../../escape").is_err());
    assert!(own_archive(temp.path(), &a.archive_id).is_ok());
    assert_eq!(
        own_archive(temp.path(), &b.archive_id).unwrap(),
        PathBuf::from(&b.path)
    );
}
#[test]
fn external_reads_require_recent_one_file_native_drop_and_forbid_network_ads_devices() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("TEST-source.timermix");
    std::fs::write(&source, encoded(snapshot())).unwrap();
    let access = ArchiveAccess::default();
    let data = temp.path().join("application");
    assert!(access.authorize(&source, &data).is_err());
    access.grant_drop(&[source.clone()]);
    access.authorize(&source, &data).unwrap();
    assert!(access.authorize(&source, &data).is_err());
    for bad in [
        "relative.timermix",
        r"\\server\secret.timermix",
        r"\\?\C:\secret.timermix",
        r"C:\data\file.timermix:secret.json",
        r"C:\data\bad.exe",
    ] {
        assert!(local_archive_path(Path::new(bad)).is_err(), "{bad}");
    }
}
#[test]
fn icon_bytes_are_user_timer_and_no_registration_runs_during_unit_tests() {
    let bytes = include_bytes!("../../icons/icon.ico");
    assert_eq!(&bytes[..4], &[0, 0, 1, 0]);
    assert!(bytes.len() > 100);
    assert_eq!(
        format!("{:x}", Sha256::digest(bytes)),
        "ba90eb195d9005af213fc961ac0ccc7a9a8ab9b4bf1cea20199291960da9f4e6"
    );
    let count = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
    assert_eq!(count, 8);
    let sizes: Vec<_> = (0..count)
        .map(|i| {
            if bytes[6 + i * 16] == 0 {
                256
            } else {
                bytes[6 + i * 16] as u16
            }
        })
        .collect();
    // tauri-codegen consumes entry zero, independently of Windows' best-fit
    // resource lookup. A 16px first entry causes a blurred live taskbar icon.
    assert_eq!(sizes, [256, 16, 24, 32, 48, 64, 96, 128]);
}

#[cfg(windows)]
#[test]
fn icon_path_is_stable_per_user_and_independent_of_preview_or_test_databases() {
    let base = Path::new(r"C:\Users\TEST user\AppData\Local");
    let icon = stable_icon_path(base).unwrap();
    assert_eq!(icon, stable_icon_path(base).unwrap());
    assert!(icon.starts_with(base.join("local.pixelmix.workbench").join("file-icons")));
    assert_eq!(
        icon.file_name().unwrap(),
        "TIMER-ba90eb195d9005af213fc961ac0ccc7a9a8ab9b4bf1cea20199291960da9f4e6.ico"
    );
    assert_ne!(
        icon,
        stable_icon_path(Path::new(r"D:\Users\OTHER\AppData\Local")).unwrap()
    );
    for invalid in [
        "relative",
        r"\\server\shared",
        r"\\?\C:\data",
        r"C:\data\..\outside",
        "C:\\data\ninvalid",
    ] {
        assert!(stable_icon_path(Path::new(invalid)).is_err(), "{invalid}");
    }
}

#[cfg(windows)]
#[test]
fn icon_file_is_reused_without_modification_and_foreign_bytes_are_never_overwritten() {
    let temp = tempfile::tempdir().unwrap();
    let icon = stable_icon_path(temp.path()).unwrap();
    assert!(install_icon(&icon).unwrap());
    let first = std::fs::metadata(&icon).unwrap().modified().unwrap();
    assert!(!install_icon(&icon).unwrap());
    assert_eq!(std::fs::metadata(&icon).unwrap().modified().unwrap(), first);
    assert_eq!(std::fs::read(&icon).unwrap(), ARCHIVE_ICON_BYTES);
    std::fs::write(&icon, b"TEST unrelated content").unwrap();
    assert!(install_icon(&icon).is_err());
    assert_eq!(std::fs::read(&icon).unwrap(), b"TEST unrelated content");
}

#[cfg(windows)]
#[test]
fn handler_is_a_real_stable_dll_and_foreign_com_owner_is_preserved() {
    assert!(ICON_HANDLER_BYTES.starts_with(b"MZ"));
    let temp = tempfile::tempdir().unwrap();
    let path = handler_path(temp.path()).unwrap();
    assert!(install_handler(&path).unwrap());
    assert!(!install_handler(&path).unwrap());
    assert!(preserve_handler_owner(None, &path).is_ok());
    assert!(preserve_handler_owner(Some(&path.to_string_lossy()), &path).is_ok());
    let physical = external_shell_resource_path(&path).unwrap();
    assert!(!physical.to_string_lossy().starts_with(r"\\?\"));
    assert_eq!(std::fs::read(&physical).unwrap(), ICON_HANDLER_BYTES);
    assert!(preserve_handler_owner(Some(&physical.to_string_lossy()), &path).is_ok());
    assert!(preserve_handler_owner(Some(&path.to_string_lossy()), &physical).is_ok());
    assert!(external_shell_resource_path(&temp.path().join("missing.dll")).is_err());
    for foreign in [
        r"C:\OtherApp\Icon.dll",
        r"C:\Windows\System32\shell32.dll",
        "relative.dll",
    ] {
        assert!(preserve_handler_owner(Some(foreign), &path).is_err());
    }
    std::fs::write(&path, b"foreign bytes").unwrap();
    assert!(install_handler(&path).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"foreign bytes");
}

#[cfg(windows)]
#[test]
fn user_choice_and_machine_or_user_owners_are_preserved_without_registry_mutation() {
    assert!(preserve_icon_owner(&[None, None]).is_ok());
    assert!(preserve_icon_owner(&[
        Some(String::new()),
        Some(ARCHIVE_PROGID.to_ascii_lowercase())
    ])
    .is_ok());
    assert!(preserve_icon_owner(&[Some(ARCHIVE_PROGID.into()), None]).is_ok());
    assert!(preserve_icon_owner(&[Some(LEGACY_ARCHIVE_PROGID.into()), None]).is_ok());
    assert!(preserve_icon_owner(&[
        Some(ARCHIVE_PROGID.into()),
        Some(LEGACY_ARCHIVE_PROGID.into())
    ])
    .is_ok());
    for owners in [
        [Some("OtherApp.File".into()), None],
        [Some(ARCHIVE_PROGID.into()), Some("OtherApp.File".into())],
        [None, Some("Applications\\notepad.exe".into())],
    ] {
        assert!(preserve_icon_owner(&owners).is_err());
    }
}

#[test]
fn portrait_container_roundtrips_legacy_json_and_detects_all_component_corruption() {
    let file = build(snapshot()).unwrap();
    let bytes = encode_with_icon(&file).unwrap();
    assert!(bytes.starts_with(&[0, 0, 1, 0]));
    assert_eq!(
        decode(&bytes).unwrap(),
        decode(&serde_json::to_vec(&file).unwrap()).unwrap()
    );
    for location in [
        22usize,
        200,
        bytes.len() / 2,
        bytes.len() - 46,
        bytes.len() - 45,
        bytes.len() - 10,
        bytes.len() - 1,
    ] {
        let mut damaged = bytes.clone();
        damaged[location] ^= 0x40;
        assert!(decode(&damaged).is_err(), "corruption at {location}");
    }
    for length in [0usize, 4, 40, bytes.len() - 1] {
        assert!(decode(&bytes[..length]).is_err());
    }
    let mut appended = bytes.clone();
    appended.extend_from_slice(b"{}");
    assert!(decode(&appended).is_err());
    let mut bad_structure = bytes.clone();
    bad_structure[6 + 12] = 0;
    let end = bad_structure.len() - ICON_FOOTER.len() - 32;
    let hash = Sha256::digest(&bad_structure[..end]);
    bad_structure[end..end + 32].copy_from_slice(&hash);
    assert!(decode(&bad_structure).unwrap_err().contains("图标结构"));
}

#[test]
fn bilingual_names_are_safe_unique_authorizable_and_can_be_renamed_or_copied() {
    let temp = tempfile::tempdir().unwrap();
    let mut s = snapshot();
    s.recipe["name_zh"] = json!("干马天尼");
    s.recipe["name_en"] = json!("Dry Martini");
    let saved = save(temp.path(), s.clone()).unwrap();
    assert_eq!(
        Path::new(&saved.path)
            .file_name()
            .unwrap()
            .to_string_lossy(),
        "干马天尼_dry_martini.timermix"
    );
    let second = save(temp.path(), s.clone()).unwrap();
    assert_ne!(saved.path, second.path);
    assert_eq!(
        read(Path::new(&saved.path)).unwrap()["snapshot"]["recipe"],
        s.recipe
    );
    ArchiveAccess::default()
        .authorize(Path::new(&saved.path), temp.path())
        .unwrap();
    let copy = temp.path().join("重命名的存档.timermix");
    std::fs::copy(&saved.path, &copy).unwrap();
    assert_eq!(read(&copy).unwrap(), read(Path::new(&saved.path)).unwrap());
    for (zh, en, prefix) in [
        ("蓝色飓风", "Blue Hurricane", "蓝色飓风_blue_hurricane"),
        ("中文/酒", "A/B:C?D", "中文_酒_a_b_c_d"),
        ("", "CON", "cocktail_con"),
        ("", "LPT¹", "cocktail_lpt¹"),
        ("", "CON.txt", "con_txt"),
        ("椰林飘香", "Piña Colada", "椰林飘香_piña_colada"),
        ("蜂之膝", "Bee’s Knees", "蜂之膝_bee_s_knees"),
        ("老广场", "Vieux Carré", "老广场_vieux_carré"),
        (" 艾杰. ", " A.  J. ", "艾杰_a_j"),
        ("九周半", "9 1/2 Weeks", "九周半_9_1_2_weeks"),
        ("中文酒", "   ...   ", "中文酒"),
        ("   ...   ", "English", "english"),
        ("same", "Same", "same"),
    ] {
        s.recipe["name_zh"] = json!(zh);
        s.recipe["name_en"] = json!(en);
        assert_eq!(filename_prefix(&s.recipe), prefix);
    }
    assert_eq!(filename_prefix(&json!({"id":"source-id"})), "source_id");
    assert_eq!(filename_prefix(&json!({})), "cocktail");
    let long = filename_prefix(&json!({"name_zh":"酒🍸".repeat(100),"name_en":"A".repeat(100)}));
    assert!(long.encode_utf16().count() <= 81);
    assert!(
        long.ends_with(&"a".repeat(40)),
        "Both names must survive truncation"
    );
    let legacy = build(s).unwrap();
    let legacy_path = temp
        .path()
        .join("recipe-archives")
        .join(format!("{}.pixelmix", legacy.body.archive_id));
    std::fs::write(&legacy_path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    assert_eq!(
        own_archive(temp.path(), &legacy.body.archive_id).unwrap(),
        legacy_path
    );
    let legacy_named = legacy_path.with_file_name(format!(
        "旧格式 Old Name--{}.pixelmix",
        legacy.body.archive_id
    ));
    std::fs::rename(&legacy_path, &legacy_named).unwrap();
    assert_eq!(
        own_archive(temp.path(), &legacy.body.archive_id).unwrap(),
        legacy_named
    );
    ArchiveAccess::default()
        .authorize(&legacy_named, temp.path())
        .unwrap();
}

#[test]
fn new_suffix_and_legacy_cache_files_roundtrip_without_changing_snapshot_or_permissions() {
    let temp = tempfile::tempdir().unwrap();
    let saved = save(temp.path(), snapshot()).unwrap();
    let mut path = PathBuf::from(&saved.path);
    assert_eq!(path.extension().unwrap(), "timermix");
    let bytes = std::fs::read(&path).unwrap();
    let expected = read(&path).unwrap();
    let access = ArchiveAccess::default();
    for extension in ["TIMERMIX", "pixelmix", "PIXELMIX", "timermix"] {
        let renamed = path.with_extension(extension);
        std::fs::rename(&path, &renamed).unwrap();
        path = renamed;
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(read(&path).unwrap(), expected);
        assert_eq!(own_archive(temp.path(), &saved.archive_id).unwrap(), path);
        access.authorize(&path, temp.path()).unwrap();
        assert!(drag_icon(&path).unwrap().starts_with(&[0, 0, 1, 0]));
    }
    let external = temp.path().join("legacy.json");
    std::fs::write(&external, &bytes).unwrap();
    assert_eq!(read(&external).unwrap(), expected);
    assert!(access.authorize(&external, temp.path()).is_err());
    access.grant_drop(std::slice::from_ref(&external));
    access.authorize(&external, temp.path()).unwrap();
    assert!(access.authorize(&external, temp.path()).is_err());
    for extension in ["exe", "timermix.exe", "timermix ", "pixelmix.exe"] {
        assert!(local_archive_path(&path.with_extension(extension)).is_err());
    }
    let again = save(temp.path(), snapshot()).unwrap();
    assert_eq!(Path::new(&again.path).extension().unwrap(), "timermix");
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
}

#[test]
fn mixed_suffixes_cannot_ambiguously_authorize_legacy_flat_caches() {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().join("recipe-archives");
    std::fs::create_dir(&folder).unwrap();
    let file = build(snapshot()).unwrap();
    let old = folder.join(format!("{}.pixelmix", file.body.archive_id));
    let new = folder.join(format!("{}.timermix", file.body.archive_id));
    std::fs::write(&old, encode_with_icon(&file).unwrap()).unwrap();
    assert_eq!(
        own_archive(temp.path(), &file.body.archive_id).unwrap(),
        old
    );
    std::fs::copy(&old, &new).unwrap();
    assert!(own_archive(temp.path(), &file.body.archive_id).is_err());
    std::fs::remove_file(&old).unwrap();
    assert_eq!(
        own_archive(temp.path(), &file.body.archive_id).unwrap(),
        new
    );
}

#[test]
fn cache_identity_rejects_swapped_ambiguous_and_ungranted_nested_files() {
    let temp = tempfile::tempdir().unwrap();
    let a = save(temp.path(), snapshot()).unwrap();
    let b = save(temp.path(), snapshot()).unwrap();
    let a_path = Path::new(&a.path);
    let access = ArchiveAccess::default();
    assert_eq!(own_archive(temp.path(), &a.archive_id).unwrap(), a_path);
    access.authorize(a_path, temp.path()).unwrap();
    std::fs::copy(a_path, &b.path).unwrap();
    assert!(own_archive(temp.path(), &b.archive_id)
        .unwrap_err()
        .contains("ID与缓存目录"));
    assert!(access
        .authorize(Path::new(&b.path), temp.path())
        .unwrap_err()
        .contains("ID与缓存目录"));
    let extra = a_path.with_file_name("额外_other.pixelmix");
    std::fs::copy(a_path, &extra).unwrap();
    assert!(own_archive(temp.path(), &a.archive_id)
        .unwrap_err()
        .contains("唯一"));
    assert!(access.authorize(&extra, temp.path()).is_err());
    let ungranted = temp
        .path()
        .join("recipe-archives")
        .join("not-a-uuid")
        .join("配方_recipe.timermix");
    std::fs::create_dir_all(ungranted.parent().unwrap()).unwrap();
    std::fs::copy(a_path, &ungranted).unwrap();
    assert!(access.authorize(&ungranted, temp.path()).is_err());
    access.grant_drop(&[ungranted.clone()]);
    access.authorize(&ungranted, temp.path()).unwrap();
    assert!(access.authorize(&ungranted, temp.path()).is_err());
}

#[test]
fn all_300_recipe_portraits_are_unique_stable_and_fit_the_archive_budget() {
    let recipes: Value =
        serde_json::from_str(include_str!("../../../public/seed/recipes.json")).unwrap();
    let mut hashes = HashSet::new();
    let mut designs = HashSet::new();
    let output = std::env::var_os("PIXEL_MIX_PORTRAIT_CATALOG_OUTPUT").map(PathBuf::from);
    if let Some(output) = &output {
        assert!(output.is_absolute());
        std::fs::create_dir_all(output).unwrap();
    }
    let profiles: Value =
        serde_json::from_str(include_str!("../../../public/seed/profiles.seed.json")).unwrap();
    let mut manifest = vec![];
    let recipes = recipes["recipes"].as_array().unwrap();
    assert_eq!(recipes.len(), 300);
    for recipe in recipes {
        let (family, variant) = portrait::design(recipe);
        designs.insert((family, variant));
        let prefix = filename_prefix(recipe);
        assert!(!prefix.contains([' ', '<', '>', ':', '"', '/', '\\', '|', '?', '*']));
        assert!(prefix.ends_with(&filename_component(
            recipe["name_en"].as_str().unwrap(),
            80,
            true
        )));
        assert!(prefix.encode_utf16().count() <= 81);
        let icon = portrait::ico(recipe, &[16, 24, 32, 48, 64, 128]);
        assert!(portrait::verify(&icon), "{}", recipe["id"]);
        assert!(icon.len() < 110_000);
        assert!(
            hashes.insert(format!("{:x}", Sha256::digest(&icon))),
            "duplicate portrait {}",
            recipe["id"]
        );
        let mut renamed = recipe.clone();
        renamed["id"] = json!("archive-restored-id");
        renamed["default_orderable"] = json!(false);
        assert_eq!(icon, portrait::ico(&renamed, &[16, 24, 32, 48, 64, 128]));
        if let Some(output) = &output {
            let mut s = snapshot();
            s.recipe = recipe.clone();
            s.recipe["recipe_revision_id"] = json!("TEST-32-designs-source-revision");
            s.profile = profiles["profiles"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["recipe_id"] == recipe["id"])
                .unwrap()
                .clone();
            let saved = save(output, s).unwrap();
            manifest.push(json!({"id":recipe["id"],"name_en":recipe["name_en"],"design":format!("{family}-{}",variant+1),"path":saved.path,"icon_sha256":format!("{:x}",Sha256::digest(&icon))}));
        }
    }
    assert_eq!(
        designs.len(),
        32,
        "all 32 distinct glass designs are used by the 300 source recipes"
    );
    if let Some(output) = &output {
        std::fs::write(output.join("portrait-manifest.json"),serde_json::to_vec_pretty(&json!({"design_count":designs.len(),"recipe_count":recipes.len(),"recipes":manifest})).unwrap()).unwrap();
    }
}

#[cfg(windows)]
#[test]
fn windows_extracts_embedded_portrait_from_copied_timermix_without_sidecar_files() {
    use windows_sys::Win32::UI::Shell::ExtractIconExW;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn DestroyIcon(icon: *mut std::ffi::c_void) -> i32;
    }
    let temp = tempfile::tempdir().unwrap();
    let saved = save(temp.path(), snapshot()).unwrap();
    let copied = temp.path().join("中文路径 椰林飘香 Piña Colada.timermix");
    std::fs::copy(saved.path, &copied).unwrap();
    let path: Vec<u16> = copied
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let mut large = std::ptr::null_mut();
    let mut small = std::ptr::null_mut();
    let count = unsafe { ExtractIconExW(path.as_ptr(), 0, &mut large, &mut small, 1) };
    assert_eq!(count, 1);
    assert!(!large.is_null() && !small.is_null());
    unsafe {
        DestroyIcon(large);
        DestroyIcon(small);
    }
    assert!(read(&copied).is_ok());
    if let Some(output) = std::env::var_os("PIXEL_MIX_ICON_TEST_OUTPUT") {
        let output = PathBuf::from(output);
        assert!(output.is_absolute());
        std::fs::create_dir_all(&output).unwrap();
        let recipes: Value =
            serde_json::from_str(include_str!("../../../public/seed/recipes.json")).unwrap();
        let profiles: Value =
            serde_json::from_str(include_str!("../../../public/seed/profiles.seed.json")).unwrap();
        for recipe in recipes["recipes"].as_array().unwrap().iter().filter(|r| {
            [
                "iba_negroni",
                "iba_dry_martini",
                "iba_mojito",
                "iba_irish_coffee",
                "iba_pina_colada",
                "iba_espresso_martini",
                "iba_spritz",
                "iba_champagne_cocktail",
            ]
            .contains(&r["id"].as_str().unwrap())
        }) {
            let mut s = snapshot();
            s.recipe = recipe.clone();
            s.recipe["recipe_revision_id"] = json!("TEST-source-revision");
            s.profile = profiles["profiles"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["recipe_id"] == recipe["id"])
                .unwrap()
                .clone();
            save(&output, s).unwrap();
        }
    }
}
