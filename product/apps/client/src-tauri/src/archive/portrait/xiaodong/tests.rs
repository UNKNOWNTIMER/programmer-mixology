use super::*;
use crate::archive::{self, portrait, Snapshot};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

fn catalog() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../../../data/dlc/xiaodong/catalog.json"
    ))
    .unwrap()
}

#[test]
fn all_notebook_profiles_identify_contents_and_survive_archive_personal_ids() {
    let data = catalog();
    let recipes = data["recipes"].as_array().unwrap();
    assert_eq!(recipes.len(), 96);
    assert_eq!(profiles().len(), 96);
    for recipe in recipes {
        let art = appearance(recipe).unwrap_or_else(|| panic!("unmatched {}", recipe["id"]));
        assert_eq!(art.recipe_id, recipe["id"].as_str().unwrap());
        let mut copy = recipe.clone();
        copy["id"] = json!("personal_imported_random_id");
        copy["source"]["kind"] = json!("imported_snapshot");
        copy["recipe_revision_id"] = json!("another-revision");
        copy["notes_zh"] = json!("用户重新导入并修改备注");
        copy["name_en"] = json!(format!(
            "  {}  ",
            recipe["name_en"].as_str().unwrap().to_uppercase()
        ));
        copy["ingredients"].as_array_mut().unwrap().reverse();
        assert_eq!(appearance(&copy).unwrap().recipe_id, art.recipe_id);
        assert_eq!(
            portrait::ico(recipe, &[16, 64]),
            portrait::ico(&copy, &[16, 64])
        );
        let mut changed = recipe.clone();
        changed["ingredients"][0]["quantity"] = json!(123.456);
        assert!(appearance(&changed).is_none());
        let mut changed = recipe.clone();
        changed["garnish_zh"] = json!("另一种装饰");
        assert!(appearance(&changed).is_none());
        let mut changed = recipe.clone();
        changed["steps_zh"] = json!(["另一种制作方式"]);
        assert!(appearance(&changed).is_none());
    }
}

#[test]
fn every_notebook_drink_has_a_distinct_small_and_large_readable_native_portrait() {
    let data = catalog();
    let recipes = data["recipes"].as_array().unwrap();
    for size in [16, 32, 64] {
        let mut fingerprints = HashSet::new();
        for recipe in recipes {
            let art = appearance(recipe).unwrap();
            let image = pixels(art, recipe["glass_template"].as_str().unwrap(), size);
            assert_eq!(image.len(), size * size);
            assert!(image.iter().filter(|p| p[3] != 0).count() > size * size / 2);
            assert!(
                image.iter().collect::<HashSet<_>>().len() >= 6,
                "too few colours: {} {size}",
                recipe["id"]
            );
            let bytes = image.into_iter().flatten().collect::<Vec<_>>();
            assert!(
                fingerprints.insert(format!("{:x}", Sha256::digest(bytes))),
                "duplicate portrait {} at {size}",
                recipe["id"]
            );
        }
        assert_eq!(fingerprints.len(), 96);
    }
}

#[test]
fn all_notebook_archives_keep_embedded_frames_and_contents_through_real_save_read() {
    let data = catalog();
    let temp = tempfile::tempdir().unwrap();
    let evidence = std::env::var_os("PIXEL_MIX_DLC_ART_OUTPUT").map(std::path::PathBuf::from);
    let output = evidence.as_deref().unwrap_or(temp.path());
    assert!(output.is_absolute());
    std::fs::create_dir_all(output).unwrap();
    let mut rows = vec![];
    for recipe in data["recipes"].as_array().unwrap() {
        let sizes = portrait::archive_sizes(recipe);
        assert_eq!(sizes, &[16, 24, 32, 48, 64, 128, 256]);
        let icon = portrait::ico(recipe, sizes);
        assert!(portrait::verify(&icon));
        let profile = data["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["recipe_id"] == recipe["id"])
            .unwrap()
            .clone();
        let snapshot = Snapshot {
            recipe: recipe.clone(),
            profile,
            target: json!({"taste_bps":[2000,2000,2000,2000,2000],"sensory_0_10":[5,5,5,5,5,5,5]}),
        };
        let saved = archive::save(output, snapshot)
            .unwrap_or_else(|error| panic!("{}: {error}", recipe["id"]));
        let file = std::fs::read(&saved.path).unwrap();
        assert!(file.starts_with(&icon));
        assert!(file.len() < archive::MAX_BYTES);
        let restored = archive::read(std::path::Path::new(&saved.path)).unwrap();
        assert_eq!(&restored["snapshot"]["recipe"], recipe);
        assert!(appearance(&restored["snapshot"]["recipe"]).is_some());
        if evidence.is_some() {
            let id = recipe["id"].as_str().unwrap();
            let ico = output.join(format!("{id}.ico"));
            std::fs::write(&ico, &icon).unwrap();
            rows.push(json!({"recipe_id":id,"name_zh":recipe["name_zh"],"name_en":recipe["name_en"],"glass":recipe["glass_template"],"archive":saved.path,"ico":ico,"sizes":sizes,"ico_bytes":icon.len(),"archive_bytes":file.len(),"ico_sha256":format!("{:x}",Sha256::digest(&icon))}));
        }
    }
    if evidence.is_some() {
        std::fs::write(output.join("native-art-manifest.json"),serde_json::to_vec_pretty(&json!({"scope":"Production recipe-content renderer and real archive save/read; not Explorer or physical OLE evidence","count":rows.len(),"rows":rows})).unwrap()).unwrap();
    }
}
