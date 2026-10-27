//! Read-only bundled DLC. Source SQLite rows and the personal-library quota stay separate.
use crate::archive::{self, Snapshot};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::OnceLock;

const MANIFEST: &str = include_str!("../../../../data/dlc/xiaodong/catalog.json");
pub const GROUP_ID: &str = "xiaodong-notes-v1";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Group {
    pub id: String,
    pub name_zh: String,
    pub name_en: String,
    pub author: String,
    pub version: String,
    pub recipe_ids: Vec<String>,
    pub source_sha256: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub appendix: Vec<Appendix>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Appendix {
    pub title_zh: String,
    pub text_zh: String,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    recipes: Vec<Value>,
    profiles: Vec<Value>,
    ingredients: Vec<Value>,
    group: Group,
}

fn manifest() -> Result<&'static Manifest, String> {
    static PARSED: OnceLock<Result<Manifest, String>> = OnceLock::new();
    PARSED.get_or_init(|| {
        let value: Manifest = serde_json::from_str(MANIFEST).map_err(|e| format!("DLC目录无效：{e}"))?;
        if value.group.id != GROUP_ID || value.group.recipe_ids.is_empty()
            || value.group.source_sha256.len() != 64
            || !value.group.source_sha256.bytes().all(|c| c.is_ascii_hexdigit())
            || [&value.group.name_zh, &value.group.name_en, &value.group.author, &value.group.version]
                .iter().any(|v| v.trim().is_empty()) {
            return Err("DLC组信息无效".into());
        }
        let ids: HashSet<_> = value.recipes.iter().filter_map(|r| r["id"].as_str()).collect();
        let group_ids: HashSet<_> = value.group.recipe_ids.iter().map(String::as_str).collect();
        let profile_ids: HashSet<_> = value.profiles.iter().filter_map(|r| r["recipe_id"].as_str()).collect();
        if ids.len() != value.recipes.len() || ids != group_ids || ids != profile_ids
            || group_ids.len() != value.group.recipe_ids.len() || profile_ids.len() != value.profiles.len() {
            return Err("DLC配方、预测与组成员ID不一致".into());
        }
        for recipe in &value.recipes {
            let profile = value.profiles.iter().find(|p| p["recipe_id"] == recipe["id"]).unwrap();
            archive::validate(&Snapshot {
                recipe: recipe.clone(), profile: profile.clone(),
                target: json!({"taste_bps":profile["taste_preference_bps"],"sensory_0_10":profile["sensory_0_10"]}),
            }).map_err(|e| format!("DLC配方 {} 无效：{e}", recipe["id"]))?;
            if recipe["default_orderable"] != false || recipe["needs_serving_configuration"] != true
                || !recipe["actual_user_rating"].is_null() || profile["measured"] != false {
                return Err("DLC不能自带点单权限或实饮评价".into());
            }
        }
        Ok(value)
    }).as_ref().map_err(Clone::clone)
}

pub fn group_ids() -> Result<HashSet<String>, String> {
    Ok(HashSet::from([manifest()?.group.id.clone()]))
}

pub fn extend_catalog(mut catalog: Value) -> Result<Value, String> {
    let manifest = manifest()?;
    for (key, extras, id_key) in [
        ("ingredients", &manifest.ingredients, "id"),
        ("recipes", &manifest.recipes, "id"),
        ("profiles", &manifest.profiles, "recipe_id"),
    ] {
        let rows = catalog[key]
            .as_array_mut()
            .ok_or_else(|| format!("{key}目录无效"))?;
        let mut ids: HashSet<String> = rows
            .iter()
            .filter_map(|v| v[id_key].as_str().map(str::to_owned))
            .collect();
        for row in extras {
            let id = row[id_key]
                .as_str()
                .filter(|v| !v.is_empty())
                .ok_or("DLC项目缺少ID")?;
            if !ids.insert(id.into()) {
                return Err(format!("DLC与目录ID冲突：{id}"));
            }
            rows.push(row.clone());
        }
    }
    let ids: HashSet<_> = catalog["ingredients"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v["id"].as_str())
        .collect();
    for recipe in &manifest.recipes {
        for part in recipe["ingredients"].as_array().unwrap() {
            if !part["ingredient_id"]
                .as_str()
                .is_some_and(|id| ids.contains(id))
                || part["allowed_alternatives"].as_array().is_some_and(|alts| {
                    alts.iter()
                        .any(|v| !v.as_str().is_some_and(|id| ids.contains(id)))
                })
            {
                return Err(format!("DLC配方含未知原料：{}", recipe["id"]));
            }
        }
    }
    let sources = catalog["sources"].as_array_mut().ok_or("来源目录无效")?;
    sources.extend(
        manifest
            .recipes
            .iter()
            .map(|recipe| recipe["source"].clone()),
    );
    catalog["dlc_groups"] = json!([manifest.group]);
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pixelmix_catalog::Catalog;
    use sha2::{Digest, Sha256};

    #[test]
    fn bundled_dlc_is_valid_and_never_writes_original_tables_or_settings() {
        let dir = tempfile::tempdir().unwrap();
        let db = Catalog::open(dir.path().join("catalog.sqlite")).unwrap();
        let before = db.catalog_json().unwrap();
        let expanded =
            extend_catalog(crate::personal_ingredients::extend_catalog(before.clone()).unwrap())
                .unwrap();
        let manifest = manifest().unwrap();
        assert_eq!(before["recipes"].as_array().unwrap().len(), 300);
        assert_eq!(before["ingredients"].as_array().unwrap().len(), 255);
        assert_eq!(
            expanded["recipes"].as_array().unwrap().len(),
            300 + manifest.recipes.len()
        );
        assert_eq!(
            expanded["ingredients"].as_array().unwrap().len(),
            256 + manifest.ingredients.len()
        );
        assert_eq!(
            expanded["sources"].as_array().unwrap().len(),
            before["sources"].as_array().unwrap().len() + manifest.recipes.len()
        );
        assert_eq!(db.catalog_json().unwrap(), before);
        assert_eq!(expanded["dlc_groups"][0]["id"], GROUP_ID);
        assert_eq!(
            manifest.group.source_sha256.to_ascii_lowercase(),
            format!(
                "{:x}",
                Sha256::digest(include_bytes!("../../../../data/dlc/xiaodong/source.docx"))
            )
        );
        assert!(extend_catalog(expanded).is_err());
    }
}
