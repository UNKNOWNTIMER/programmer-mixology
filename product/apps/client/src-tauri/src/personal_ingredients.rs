//! Bundled definitions needed by explicitly requested personal recipes. Source
//! SQLite ingredient rows remain immutable; no brand labels/nutrition are inferred.
use serde_json::Value;

const DEFINITIONS: &str = include_str!("../../../../data/personal/zhenglin-soup/prepared-ingredients.json");

pub fn extend_catalog(mut catalog: Value) -> Result<Value, String> {
    let extra: Vec<Value> = serde_json::from_str(DEFINITIONS).map_err(|e| e.to_string())?;
    let ingredients = catalog["ingredients"].as_array_mut().ok_or("原料目录无效")?;
    for definition in extra {
        if ingredients.iter().any(|row| row["id"] == definition["id"]) {
            return Err("个人预制原料与来源目录ID冲突".into());
        }
        ingredients.push(definition);
    }
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recipe_library::{self, Action, LibraryRequest, RecipeDraft};
    use pixelmix_catalog::Catalog;
    use serde_json::json;
    use sha2::{Digest, Sha256};

    #[test]
    fn prepared_foam_is_declared_without_changing_seed_labels_or_database() {
        let temp = tempfile::tempdir().unwrap();
        let db = Catalog::open(temp.path().join("catalog.sqlite")).unwrap();
        let before = db.catalog_json().unwrap();
        let catalog = extend_catalog(before.clone()).unwrap();
        assert_eq!(catalog["recipes"], before["recipes"]);
        assert_eq!(catalog["ingredients"].as_array().unwrap().len(), 256);
        for ingredient in before["ingredients"].as_array().unwrap() {
            assert!(catalog["ingredients"].as_array().unwrap().contains(ingredient));
        }
        let foam = catalog["ingredients"].as_array().unwrap().last().unwrap();
        assert_eq!(foam["id"], "user_zhenglin_nebula_foam");
        assert_eq!(foam["potential_allergens"], json!(["chickpea"]));
        for key in ["abv_fraction", "kcal_per_100ml", "density_g_per_ml"] {
            assert!(foam[key].is_null());
        }
        assert_eq!(db.catalog_json().unwrap(), before);
        assert!(extend_catalog(catalog).is_err());
    }

    #[test]
    fn actual_zhenglin_draft_reopens_with_provenance_and_optional_foam_without_mutating_seed() {
        let document: Value = serde_json::from_str(include_str!(
            "../../../../data/personal/zhenglin-soup/recipe.json"
        ))
        .unwrap();
        let source_sha = format!(
            "{:x}",
            Sha256::digest(include_bytes!(
                "../../../../data/personal/zhenglin-soup/source.txt"
            ))
        );
        assert_eq!(document["source"]["sha256"], source_sha);
        assert_eq!(document["source"]["external_references_verified"], false);
        let draft: RecipeDraft = serde_json::from_value(document["draft"].clone()).unwrap();
        let expected_parts = serde_json::to_value(&draft.ingredients).unwrap();
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("catalog.sqlite");

        let (source_catalog, saved) = {
            let db = Catalog::open(&file).unwrap();
            let source_catalog = db.catalog_json().unwrap();
            assert_eq!(source_catalog["recipes"].as_array().unwrap().len(), 300);
            assert_eq!(source_catalog["ingredients"].as_array().unwrap().len(), 255);
            assert_eq!(recipe_library::get(&db).unwrap().revision, 0);
            let saved = recipe_library::apply(
                &db,
                LibraryRequest {
                    expected_revision: 0,
                    action: Action::Create,
                    id: None,
                    draft: Some(draft),
                    enabled: None,
                },
            )
            .unwrap();
            assert_eq!(saved.revision, 1);
            assert_eq!(saved.custom.len(), 1);
            let mut expected_catalog = source_catalog.clone();
            expected_catalog["settings"]["recipe_library"] = serde_json::to_value(&saved).unwrap();
            assert!(db.catalog_json().unwrap() == expected_catalog, "Only the personal recipe_library setting may change");
            (source_catalog, saved)
        }; // Drop the SQLite connection before reopening the file.

        let reopened = Catalog::open(&file).unwrap();
        let restored = recipe_library::get(&reopened).unwrap();
        assert_eq!(restored, saved);
        let entry = &restored.custom[0];
        let recipe = &entry.recipe;
        assert!(recipe["id"].as_str().unwrap().starts_with("personal_"));
        assert_eq!(recipe["name_zh"], "政霖汤");
        assert_eq!(recipe["name_en"], "Zhenglin Soup");
        assert_eq!(recipe["ingredients"], expected_parts);
        let parts = recipe["ingredients"].as_array().unwrap();
        assert_eq!(parts.len(), 9);
        let foam = parts
            .iter()
            .find(|part| part["ingredient_id"] == "user_zhenglin_nebula_foam")
            .unwrap();
        assert_eq!(foam["quantity"], 15.0);
        assert_eq!(foam["unit"], "ml");
        assert_eq!(foam["stage"], "garnish");
        assert_eq!(foam["optional"], true);
        assert!(foam["quantity_note"].as_str().unwrap().contains("非15 ml液体"));
        // Personal-library provenance retains the source checksum in the supplied
        // notes; no unresolved external citation is promoted to verified metadata.
        assert_eq!(recipe["notes_zh"], document["draft"]["notes_zh"]);
        assert!(recipe["notes_zh"].as_str().unwrap().contains(&source_sha));
        assert_eq!(recipe["steps_zh"], document["draft"]["steps_zh"]);
        assert_eq!(recipe["source"]["kind"], "personal_recipe");
        assert!(recipe["source"]["url"].is_null());
        assert_eq!(recipe["default_orderable"], false);
        assert_eq!(recipe["needs_serving_configuration"], true);
        assert!(recipe["actual_user_rating"].is_null());
        assert_eq!(entry.profile["measured"], false);
        assert_eq!(entry.profile["origin"], "user_defined");
        assert_eq!(entry.profile["taste_preference_bps"], document["draft"]["taste_bps"]);

        let mut expected_catalog = source_catalog.clone();
        expected_catalog["settings"]["recipe_library"] = serde_json::to_value(&saved).unwrap();
        assert!(reopened.catalog_json().unwrap() == expected_catalog, "Reopening must preserve all source rows and unrelated settings");
        let visible_catalog = extend_catalog(reopened.catalog_json().unwrap()).unwrap();
        assert_eq!(visible_catalog["recipes"].as_array().unwrap().len(), 300);
        assert_eq!(visible_catalog["ingredients"].as_array().unwrap().len(), 256);
        assert_eq!(visible_catalog["recipes"], source_catalog["recipes"]);
        assert_eq!(reopened.catalog_json().unwrap()["ingredients"].as_array().unwrap().len(), 255);
    }
}
