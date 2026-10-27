use super::*;
use crate::archive::{self, portrait, Snapshot};
use serde_json::json;
use sha2::{Digest, Sha256};

fn recipe() -> Value {
    let source: Value =
        serde_json::from_str(include_str!("../../../../../public/seed/recipes.json")).unwrap();
    let mut recipe = source["recipes"][0].clone();
    recipe["id"] = json!("personal_091378fa-99fd-408e-ae46-6c4d9a824f19");
    recipe["name_en"] = json!("Zhenglin Soup");
    recipe["name_zh"] = json!("政霖汤");
    recipe["variant"] = json!("个人酒谱 V1.0 · 未实饮验证");
    recipe["family"] = json!("sour");
    recipe["glass_template"] = json!("coupe");
    recipe["method"] = json!("shake");
    recipe["recipe_revision_id"] = json!("personal-revision:zhenglin-icon-test");
    recipe["default_orderable"] = json!(false);
    recipe["needs_serving_configuration"] = json!(true);
    recipe["prediction_profile_id"] = recipe["id"].clone();
    recipe["garnish_zh"] = json!("柠檬皮轨道；可选香草星云泡沫");
    recipe["steps_zh"] = json!([
        "主酒五项材料加冰摇和12–15秒，双重过滤入预冷碟形杯。",
        "可选15ml打发后星云泡沫铺成弧带；点2–3滴黑加仑，以柠檬皮装饰。"
    ]);
    recipe["source"] = json!({"kind":"personal_recipe","publisher":"用户","url":null,"reference":"文件.txt","checked_on":"2026-09-22","method_provenance":"user_defined"});
    recipe["ingredients"]=json!(
        [("gin",45.),("cassis",15.),("cointreau",10.),("lemon",22.5),("simple_syrup",7.5)]
            .iter().map(|(id,quantity)|json!({"ingredient_id":id,"quantity":quantity,"unit":"ml","optional":false,"stage":"mix","quantity_note":null,"allowed_alternatives":[]})).collect::<Vec<_>>()
    );
    recipe["ingredients"].as_array_mut().unwrap().extend([
        json!({"ingredient_id":"cdb_ice","quantity":null,"quantity_range":[150,200],"unit":"g","optional":false,"stage":"mix","quantity_note":"摇和后滤掉","allowed_alternatives":[]}),
        json!({"ingredient_id":"user_zhenglin_nebula_foam","quantity":15,"unit":"ml","optional":true,"stage":"garnish","quantity_note":"打发后体积","allowed_alternatives":[]}),
        json!({"ingredient_id":"cdb_lemon_peel","quantity":1,"unit":"piece","optional":false,"stage":"garnish","quantity_note":null,"allowed_alternatives":[]}),
        json!({"ingredient_id":"cassis","quantity":null,"quantity_range":[2,3],"unit":"drop","optional":true,"stage":"garnish","quantity_note":null,"allowed_alternatives":[]}),
    ]);
    recipe
}

fn snapshot(recipe: Value) -> Snapshot {
    let profiles: Value = serde_json::from_str(include_str!(
        "../../../../../public/seed/profiles.seed.json"
    ))
    .unwrap();
    let mut profile = profiles["profiles"][0].clone();
    profile["recipe_id"] = recipe["id"].clone();
    Snapshot {
        recipe,
        profile,
        target: json!({"taste_bps":[2000,2000,2000,2000,2000],"sensory_0_10":[5,5,5,5,5,5,5]}),
    }
}

#[test]
fn zhenglin_identifies_content_and_survives_personal_ids_and_archived_copies() {
    let recipe = recipe();
    let before = portrait::ico(&recipe, portrait::archive_sizes(&recipe));
    let mut copied = recipe.clone();
    copied["id"] = json!("personal_a8be0fbc-570b-42a5-88a0-c9fe7abc5110");
    copied["recipe_revision_id"] = json!("different-revision");
    copied["name_en"] = json!("  ZHENGLIN SOUP  ");
    copied["notes_zh"] = json!("归档后重新导入");
    copied["ingredients"][0]["quantity"] = json!(45);
    copied["ingredients"].as_array_mut().unwrap().reverse();
    assert!(appearance(&copied).is_some());
    assert_eq!(
        before,
        portrait::ico(&copied, portrait::archive_sizes(&copied))
    );
    let temp = tempfile::tempdir().unwrap();
    let saved = archive::save(temp.path(), snapshot(recipe.clone())).unwrap();
    let imported = archive::read(std::path::Path::new(&saved.path)).unwrap();
    let restored = &imported["snapshot"]["recipe"];
    assert_eq!(
        before,
        portrait::ico(restored, portrait::archive_sizes(restored))
    );
}

#[test]
fn zhenglin_rejects_names_altered_core_or_additional_liquid_instead_of_using_an_id() {
    let original = recipe();
    for (field, value) in [
        ("name_en", "Bramble"),
        ("glass_template", "rocks"),
        ("method", "build"),
    ] {
        let mut altered = original.clone();
        altered[field] = json!(value);
        assert!(appearance(&altered).is_none());
    }
    for index in 0..5 {
        let mut altered = original.clone();
        altered["ingredients"][index]["quantity"] = json!(12.);
        assert!(appearance(&altered).is_none());
        let mut altered = original.clone();
        altered["ingredients"][index]["optional"] = json!(true);
        assert!(appearance(&altered).is_none());
    }
    let mut altered = original.clone();
    altered["ingredients"]
        .as_array_mut()
        .unwrap()
        .push(original["ingredients"][0].clone());
    assert!(appearance(&altered).is_none());
    let mut altered = original.clone();
    altered["ingredients"].as_array_mut().unwrap().push(
        json!({"ingredient_id":"vodka","quantity":10,"unit":"ml","optional":false,"stage":"mix"}),
    );
    assert!(appearance(&altered).is_none());
    altered["ingredients"]
        .as_array_mut()
        .unwrap()
        .last_mut()
        .unwrap()["stage"] = json!("float");
    assert!(appearance(&altered).is_none());
    let mut other = original.clone();
    other["name_en"] = json!("Other Drink");
    assert_ne!(
        portrait::ico(&original, &[32]),
        portrait::ico(&other, &[32])
    );
}

#[test]
fn optional_foam_and_peel_control_only_their_literal_artwork_at_every_size() {
    let full = recipe();
    let mut bare = full.clone();
    bare["ingredients"]
        .as_array_mut()
        .unwrap()
        .retain(|p| p["stage"] == "mix");
    let mut no_foam = full.clone();
    no_foam["ingredients"]
        .as_array_mut()
        .unwrap()
        .retain(|p| p["ingredient_id"] != "user_zhenglin_nebula_foam");
    let mut no_peel = full.clone();
    no_peel["ingredients"]
        .as_array_mut()
        .unwrap()
        .retain(|p| p["ingredient_id"] != "cdb_lemon_peel");
    for n in [16, 24, 32, 48, 64, 128, 256] {
        let all = pixels(appearance(&full).unwrap(), n);
        let plain = pixels(appearance(&bare).unwrap(), n);
        assert!(
            all.iter()
                .filter(|&&p| p == BERRY || p == BERRY_LIGHT || p == BERRY_DEEP)
                .count()
                >= 5
        );
        assert!(
            all.iter().filter(|&&p| p == FOAM).count() >= 2,
            "foam unreadable at {n}"
        );
        assert!(
            all.iter()
                .filter(|&&p| p == GOLD || p == GOLD_LIGHT)
                .count()
                >= 5,
            "peel unreadable at {n}"
        );
        assert!(!plain
            .iter()
            .any(|&p| p == FOAM || p == GOLD || p == GOLD_LIGHT));
        assert!(!pixels(appearance(&no_foam).unwrap(), n).contains(&FOAM));
        assert!(!pixels(appearance(&no_peel).unwrap(), n).contains(&GOLD));
        assert_ne!(all, plain);
    }
}

#[test]
fn zhenglin_archive_embeds_256_frame_and_optional_preview_files_are_real_production_pixels() {
    let recipe = recipe();
    let sizes = portrait::archive_sizes(&recipe);
    assert_eq!(sizes, &[16, 24, 32, 48, 64, 128, 256]);
    let icon = portrait::ico(&recipe, sizes);
    assert!(portrait::verify(&icon));
    let temporary = tempfile::tempdir().unwrap();
    let evidence = std::env::var_os("PIXEL_MIX_ZHENGLIN_ICON_OUTPUT").map(std::path::PathBuf::from);
    let output = evidence.as_deref().unwrap_or(temporary.path());
    assert!(output.is_absolute());
    std::fs::create_dir_all(output).unwrap();
    let saved = archive::save(output, snapshot(recipe.clone())).unwrap();
    let file = std::fs::read(&saved.path).unwrap();
    assert!(file.starts_with(&icon));
    assert!(file.len() < archive::MAX_BYTES);
    assert_eq!(
        archive::read(std::path::Path::new(&saved.path)).unwrap()["snapshot"]["recipe"],
        recipe
    );
    if evidence.is_some() {
        std::fs::write(output.join("zhenglin-soup.ico"), &icon).unwrap();
        for size in [16, 32, 48, 64, 256] {
            let rgba: Vec<_> = pixels(appearance(&recipe).unwrap(), size)
                .into_iter()
                .flatten()
                .collect();
            std::fs::write(output.join(format!("zhenglin-soup-{size}.rgba")), rgba).unwrap();
        }
        let mut no_foam = recipe.clone();
        no_foam["ingredients"]
            .as_array_mut()
            .unwrap()
            .retain(|p| p["ingredient_id"] != "user_zhenglin_nebula_foam");
        let mut no_peel = recipe.clone();
        no_peel["ingredients"]
            .as_array_mut()
            .unwrap()
            .retain(|p| p["ingredient_id"] != "cdb_lemon_peel");
        std::fs::write(
            output.join("zhenglin-soup-no-foam.ico"),
            portrait::ico(&no_foam, sizes),
        )
        .unwrap();
        std::fs::write(
            output.join("zhenglin-soup-no-peel.ico"),
            portrait::ico(&no_peel, sizes),
        )
        .unwrap();
        std::fs::write(output.join("portrait.json"),serde_json::to_vec_pretty(&json!({"recipe":recipe,"archive":saved.path,"ico_bytes":icon.len(),"archive_bytes":file.len(),"ico_sha256":format!("{:x}",Sha256::digest(&icon)),"sizes":sizes,"art_source":"native pixel code; artistic illustration from user file; not measured colour or foam yield"})).unwrap()).unwrap();
    }
}

#[test]
fn all_300_preexisting_icons_keep_their_exact_pre_change_byte_fingerprint() {
    let data: Value =
        serde_json::from_str(include_str!("../../../../../public/seed/recipes.json")).unwrap();
    let mut rows = vec![];
    for recipe in data["recipes"].as_array().unwrap() {
        assert!(appearance(recipe).is_none());
        assert_eq!(portrait::archive_sizes(recipe), &[16, 24, 32, 48, 64, 128]);
        rows.push((
            recipe["id"].as_str().unwrap(),
            format!(
                "{}:{:x}\n",
                recipe["id"].as_str().unwrap(),
                Sha256::digest(portrait::ico(recipe, portrait::archive_sizes(recipe)))
            ),
        ));
    }
    assert_eq!(rows.len(), 300);
    rows.sort_by_key(|row| row.0);
    let fingerprints: String = rows.into_iter().map(|row| row.1).collect();
    // Captured with the previous, unchanged production generator before this feature.
    assert_eq!(
        format!("{:x}", Sha256::digest(fingerprints.as_bytes())),
        "8559407ccfe8d2f46f12c061c508bfa0df39d0dfbfdb3e2b1169f78ea1523cab"
    );
}
