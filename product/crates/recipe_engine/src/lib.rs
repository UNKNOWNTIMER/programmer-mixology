//! Versioned, constraint-first cocktail candidate generation.
//! The model may name/select one bounded candidate; it cannot author quantities.
use pixelmix_domain::{allocate, match_index, Sensory, TargetProfile, Taste};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};

pub const RULES_JSON: &str = include_str!("../../../../agent/rules.v1.json");
const BASES: [&str; 7] = [
    "gin",
    "vodka",
    "white_rum",
    "tequila",
    "bourbon",
    "scotch",
    "blended_scotch",
];
const CARBONATED: [&str; 4] = ["soda", "ginger_beer", "ginger_ale", "cola"];
const OTHER: [&str; 4] = ["lemon", "lime", "simple_syrup", "amaretto"];
pub type Result<T> = std::result::Result<T, EngineError>;
#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Domain(#[from] pixelmix_domain::DomainError),
}
fn invalid(message: impl Into<String>) -> EngineError {
    EngineError::Invalid(message.into())
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InventoryItem {
    pub abv_fraction: f64,
    pub available_ml: f64,
    pub food_grade: bool,
    pub allergens_reviewed: bool,
    #[serde(default)]
    pub is_test_fixture: bool,
    #[serde(default)]
    pub sku_name: Option<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GenerationRequest {
    pub taste_bps: Taste,
    pub sensory_0_10: Sensory,
    pub inventory: BTreeMap<String, InventoryItem>,
    #[serde(default)]
    pub excluded_ingredients: Vec<String>,
    #[serde(default = "default_ethanol")]
    pub max_ethanol_ml: f64,
    #[serde(default = "default_capacity")]
    pub maximum_pre_dilution_liquid_ml: f64,
    #[serde(default, rename = "_notice_zh")]
    pub notice: Option<String>,
}
fn default_ethanol() -> f64 {
    24.0
}
fn default_capacity() -> f64 {
    240.0
}

impl GenerationRequest {
    pub fn validate(&self) -> Result<()> {
        TargetProfile {
            taste_bps: self.taste_bps,
            sensory_0_10: self.sensory_0_10,
        }
        .validate()?;
        if !self.max_ethanol_ml.is_finite() || !(0.0..=100.0).contains(&self.max_ethanol_ml) {
            return Err(invalid("Invalid administrator operational ethanol ceiling"));
        }
        if !self.maximum_pre_dilution_liquid_ml.is_finite()
            || self.maximum_pre_dilution_liquid_ml <= 0.0
            || self.maximum_pre_dilution_liquid_ml > 2000.0
        {
            return Err(invalid("Invalid glass liquid capacity"));
        }
        if self.inventory.len() > 512 || self.excluded_ingredients.len() > 512 {
            return Err(invalid("Inventory limit exceeded"));
        }
        for (id, item) in &self.inventory {
            if !(BASES.contains(&id.as_str())
                || CARBONATED.contains(&id.as_str())
                || OTHER.contains(&id.as_str()))
            {
                return Err(invalid(format!(
                    "Ingredient {id} is outside the reviewed generation whitelist"
                )));
            }
            if !item.food_grade || !item.allergens_reviewed {
                return Err(invalid(format!(
                    "Ingredient {id} requires food-grade and allergen review"
                )));
            }
            if !item.abv_fraction.is_finite()
                || !(0.0..=1.0).contains(&item.abv_fraction)
                || !item.available_ml.is_finite()
                || item.available_ml < 0.0
                || item.available_ml > 1_000_000.0
            {
                return Err(invalid(format!(
                    "Ingredient {id} requires confirmed ABV and finite stock"
                )));
            }
            if item
                .sku_name
                .as_ref()
                .is_some_and(|name| name.chars().count() > 120)
            {
                return Err(invalid("SKU name too long"));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
struct Dosing {
    sour_base_ml: Vec<u32>,
    sour_citrus_ml: Vec<u32>,
    sour_simple_syrup_ml: Vec<u32>,
    highball_base_ml: Vec<u32>,
    highball_mixer_ml: Vec<u32>,
}
#[derive(Debug, Clone, Deserialize)]
struct Rules {
    version: String,
    reference_dosing: Dosing,
}

fn rules() -> Result<Rules> {
    let rules: Rules = serde_json::from_str(RULES_JSON)?;
    // Versioned file may only narrow the audited physical envelopes, not silently widen them.
    for (values, min, max) in [
        (&rules.reference_dosing.sour_base_ml, 30, 60),
        (&rules.reference_dosing.sour_citrus_ml, 10, 30),
        (&rules.reference_dosing.sour_simple_syrup_ml, 5, 25),
        (&rules.reference_dosing.highball_base_ml, 15, 45),
        (&rules.reference_dosing.highball_mixer_ml, 60, 180),
    ] {
        if values.is_empty() || values.len() > 8 || values.iter().any(|v| *v < min || *v > max) {
            return Err(invalid("Rules dosing outside audited envelope"));
        }
    }
    Ok(rules)
}

struct Generator<'a> {
    request: &'a GenerationRequest,
    target: TargetProfile,
    forbidden: HashSet<&'a str>,
    candidates: Vec<Value>,
}
impl Generator<'_> {
    fn offer(
        &mut self,
        family: &str,
        parts: Vec<(&str, u32, &str)>,
        taste_weights: [u32; 5],
        sensory: Sensory,
        steps: &[&str],
        anchors: &[&str],
    ) -> Result<()> {
        if parts.iter().any(|(id, q, _)| {
            self.forbidden.contains(*id)
                || self
                    .request
                    .inventory
                    .get(*id)
                    .is_none_or(|i| (*q as f64) > i.available_ml)
        }) {
            return Ok(());
        }
        let volume = parts.iter().map(|(_, q, _)| *q as f64).sum::<f64>();
        if volume > self.request.maximum_pre_dilution_liquid_ml {
            return Ok(());
        }
        let ethanol = parts
            .iter()
            .map(|(id, q, _)| *q as f64 * self.request.inventory[*id].abv_fraction)
            .sum::<f64>();
        if ethanol > self.request.max_ethanol_ml {
            return Ok(());
        }
        if parts
            .iter()
            .any(|(id, _, stage)| CARBONATED.contains(id) && *stage != "top")
        {
            return Ok(());
        }
        let taste: Taste = allocate(10_000, &taste_weights)?
            .into_iter()
            .map(|x| x as u16)
            .collect::<Vec<_>>()
            .try_into()
            .map_err(|_| invalid("Internal taste dimensions"))?;
        let preference = match_index(&self.target, &taste, &sensory, 0.6)?;
        let canonical = serde_json::to_vec(&parts)?;
        let hash = format!("{:x}", Sha256::digest(canonical));
        let candidate_id = &hash[..12];
        self.candidates.push(json!({"candidate_id":candidate_id,"family":family,
            "ingredients":parts.iter().map(|(id,q,stage)|json!({"ingredient_id":id,"quantity":q,"unit":"ml","stage":stage,"optional":false})).collect::<Vec<_>>(),
            "steps_zh":steps,"anchor_recipe_ids":anchors,"predicted":{"taste_bps":taste,"sensory_0_10":sensory,"status":"heuristic_unvalidated"},
            "preference_match":preference,"ethanol_ml":ethanol,"served_abv_fraction":null,"served_kcal":null,
            "physical_note":"尚未配置融冰稀释与营养标签，因此不显示成杯酒精度及热量。",
            "review_status":"requires_bartender_review","guest_orderable":false,
            "contains_test_fixture":parts.iter().any(|(id,_,_)|self.request.inventory[*id].is_test_fixture)}));
        Ok(())
    }
}

pub fn generate(request: &Value) -> Result<Value> {
    let request: GenerationRequest = serde_json::from_value(request.clone())?;
    generate_typed(&request)
}

pub fn generate_typed(request: &GenerationRequest) -> Result<Value> {
    request.validate()?;
    let rules = rules()?;
    let doses = &rules.reference_dosing;
    let target = TargetProfile {
        taste_bps: request.taste_bps,
        sensory_0_10: request.sensory_0_10,
    };
    let mut generator = Generator {
        request,
        target: target.clone(),
        forbidden: request
            .excluded_ingredients
            .iter()
            .map(String::as_str)
            .collect(),
        candidates: vec![],
    };
    for base in BASES {
        if !request.inventory.contains_key(base) {
            continue;
        }
        for q in &doses.sour_base_ml {
            for acid in ["lemon", "lime"] {
                for aq in &doses.sour_citrus_ml {
                    for sq in &doses.sour_simple_syrup_ml {
                        // Integer scaling of [3+sq/5,3+aq/5,0.5,0,0].
                        generator.offer(
                            "sour",
                            vec![
                                (base, *q, "mix"),
                                (acid, *aq, "mix"),
                                ("simple_syrup", *sq, "mix"),
                            ],
                            [30 + sq * 2, 30 + aq * 2, 5, 0, 0],
                            [(*q as f64 / 10.0).min(8.0), 6.0, 4.0, 0.0, 1.0, 0.0, 5.0],
                            &["将三种材料与冰摇和。", "滤入预冷杯中；按实际杯量确认稀释。"],
                            &["iba_whiskey_sour", "iba_daiquiri"],
                        )?;
                    }
                }
            }
        }
        for q in &doses.highball_base_ml {
            for mixer in CARBONATED {
                for mq in &doses.highball_mixer_ml {
                    for aq in [0, 10, 15] {
                        let mut parts = vec![(base, *q, "mix")];
                        if aq > 0 {
                            parts.push(("lime", aq, "mix"));
                        }
                        parts.push((mixer, *mq, "top"));
                        // Integer scaling of [0.5 or 5,aq/3,0.5,0,0].
                        generator.offer(
                            "highball",
                            parts,
                            [if mixer == "soda" { 3 } else { 30 }, aq * 2, 3, 0, 0],
                            [
                                (*q as f64 / (*mq as f64 / 10.0)).max(1.0),
                                5.0,
                                3.0,
                                7.0,
                                2.0,
                                if mixer.starts_with("ginger") {
                                    4.0
                                } else {
                                    0.0
                                },
                                4.0,
                            ],
                            &[
                                "高球杯装冰，加入非气泡材料。",
                                "加入气泡饮料后轻轻拌匀，不放进摇壶。",
                            ],
                            &["iba_moscow_mule", "iba_cuba_libre"],
                        )?;
                    }
                }
            }
        }
        if ["scotch", "blended_scotch", "bourbon"].contains(&base) {
            for q in [45, 60] {
                for mq in [10, 15] {
                    generator.offer(
                        "spirit_forward",
                        vec![(base, q, "mix"), ("amaretto", mq, "mix")],
                        [15 + mq, 0, 5, 0, 0],
                        [7.0, 7.0, 5.0, 0.0, 1.0, 0.0, 7.0],
                        &["两种酒加冰搅拌。", "滤入装新冰块的古典杯。"],
                        &["note_godfather"],
                    )?;
                }
            }
        }
    }
    generator.candidates.sort_by(|a, b| {
        let a_score = a["preference_match"]["index"].as_f64().unwrap_or(0.0);
        let b_score = b["preference_match"]["index"].as_f64().unwrap_or(0.0);
        b_score
            .total_cmp(&a_score)
            .then(a["candidate_id"].as_str().cmp(&b["candidate_id"].as_str()))
    });
    let count = generator.candidates.len();
    generator.candidates.truncate(8);
    let rules_hash = format!("{:x}", Sha256::digest(RULES_JSON.as_bytes()));
    if generator.candidates.is_empty() {
        return Ok(
            json!({"status":"no_feasible_candidate","reason":"库存、排除项或操作上限下没有候选。","target":target,"candidates":[],"candidate_count":0,"model_used":false,"rules_version":rules.version,"rules_sha256":rules_hash}),
        );
    }
    let mut chosen = generator.candidates[0].clone();
    let id = chosen["candidate_id"].as_str().unwrap().to_owned();
    chosen["name_zh"] = json!(format!("像素试调·{}", &id[..4]));
    chosen["name_en"] = json!(format!("Pixel Trial {}", id[..4].to_uppercase()));
    let infeasible = request.taste_bps[3] > 1500 || request.taste_bps[4] > 1500;
    Ok(
        json!({"status":if infeasible{"nearest_only"}else{"experimental_candidate"},"target":target,
        "reason":if infeasible{"当前规则库未覆盖咸鲜结构，不能实现当前目标。"}else{"有限模板约束内的候选；未证明新颖或好喝。"},
        "chosen":chosen,"candidates":generator.candidates,"candidate_count":count,"model_used":false,
        "rules_version":rules.version,"rules_sha256":rules_hash,"physical_validation_required":true}),
    )
}

/// Rebuild deterministic candidates from the captured request before accepting a model choice.
pub fn apply_model_choice(request: &Value, choice: &Value, model_name: &str) -> Result<Value> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Choice {
        candidate_id: String,
        name_zh: String,
        name_en: String,
    }
    let choice: Choice = serde_json::from_value(choice.clone())?;
    for (name, max) in [(&choice.name_zh, 24), (&choice.name_en, 80)] {
        if name.trim().is_empty()
            || name.chars().count() > max
            || name.chars().any(|c| c.is_control() || c == '<' || c == '>')
        {
            return Err(invalid("Untrusted model name rejected"));
        }
    }
    if model_name.chars().count() > 160 || model_name.chars().any(char::is_control) {
        return Err(invalid("Invalid model name"));
    }
    let mut result = generate(request)?;
    let mut selected = result["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["candidate_id"].as_str() == Some(choice.candidate_id.as_str()))
        .cloned()
        .ok_or_else(|| invalid("Untrusted model candidate rejected"))?;
    selected["name_zh"] = json!(choice.name_zh);
    selected["name_en"] = json!(choice.name_en);
    result["chosen"] = selected;
    result["model_used"] = json!(true);
    result["model_name"] = json!(model_name);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Value {
        serde_json::from_str(include_str!("../../../../data/example_agent_request.json")).unwrap()
    }
    #[test]
    fn deterministic_candidates_respect_hard_rules() {
        let request = fixture();
        let result = generate(&request).unwrap();
        assert_eq!(result, generate(&request).unwrap());
        assert!(result["candidate_count"].as_u64().unwrap() > 0);
        assert_eq!(result["model_used"], false);
        for candidate in result["candidates"].as_array().unwrap() {
            assert_eq!(candidate["guest_orderable"], false);
            assert!(candidate["served_abv_fraction"].is_null());
            assert!(candidate["served_kcal"].is_null());
            assert!(candidate["ethanol_ml"].as_f64().unwrap() <= 24.0);
            assert_eq!(
                candidate["predicted"]["taste_bps"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|n| n.as_u64().unwrap())
                    .sum::<u64>(),
                10_000
            );
            for ingredient in candidate["ingredients"].as_array().unwrap() {
                let id = ingredient["ingredient_id"].as_str().unwrap();
                let stock = &request["inventory"][id];
                assert!(!stock.is_null());
                assert!(
                    ingredient["quantity"].as_f64().unwrap()
                        <= stock["available_ml"].as_f64().unwrap()
                );
                if CARBONATED.contains(&id) {
                    assert_eq!(ingredient["stage"], "top");
                }
            }
        }
    }
    #[test]
    fn infeasible_and_missing_inventory_do_not_fake_success() {
        let mut request = fixture();
        request["taste_bps"] = json!([0, 0, 0, 0, 10000]);
        assert_eq!(generate(&request).unwrap()["status"], "nearest_only");
        request["excluded_ingredients"] = json!(BASES);
        assert_eq!(
            generate(&request).unwrap()["status"],
            "no_feasible_candidate"
        );
        request["inventory"] = json!({});
        assert_eq!(
            generate(&request).unwrap()["status"],
            "no_feasible_candidate"
        );
    }
    #[test]
    fn unknown_sku_abv_allergen_and_unapproved_ids_are_rejected() {
        for (key, value) in [
            ("abv_fraction", Value::Null),
            ("allergens_reviewed", json!(false)),
            ("food_grade", json!(false)),
            ("available_ml", json!(-1)),
        ] {
            let mut request = fixture();
            request["inventory"]["gin"][key] = value;
            assert!(generate(&request).is_err());
        }
        let mut request = fixture();
        request["inventory"]["unapproved_concentrate"] = request["inventory"]["gin"].clone();
        assert!(generate(&request).is_err());
        let mut request = fixture();
        request["max_ethanol_ml"] = json!(true);
        assert!(generate(&request).is_err());
    }
    #[test]
    fn input_cap_supports_larger_catalog_without_expanding_generation_whitelist() {
        let mut request = fixture();
        request["excluded_ingredients"] = json!(vec!["gin"; 512]);
        assert!(generate(&request).is_ok());
        request["excluded_ingredients"] = json!(vec!["gin"; 513]);
        assert!(generate(&request)
            .unwrap_err()
            .to_string()
            .contains("Inventory limit"));
        request["excluded_ingredients"] = json!([]);
        request["inventory"]["catalog_only_new_ingredient"] = request["inventory"]["gin"].clone();
        assert!(generate(&request)
            .unwrap_err()
            .to_string()
            .contains("reviewed generation whitelist"));
    }
    #[test]
    fn model_cannot_author_doses_or_markup_or_grant_guest_permission() {
        let request = fixture();
        let result = generate(&request).unwrap();
        let mut choice = json!({"candidate_id":result["candidates"][0]["candidate_id"],"name_zh":"测试命名","name_en":"Test name"});
        let selected = apply_model_choice(&request, &choice, "mock-fixture").unwrap();
        assert_eq!(
            selected["chosen"]["ingredients"],
            result["candidates"][0]["ingredients"]
        );
        assert_eq!(selected["chosen"]["guest_orderable"], false);
        choice["quantity"] = json!(1000);
        assert!(apply_model_choice(&request, &choice, "mock").is_err());
        choice.as_object_mut().unwrap().remove("quantity");
        choice["name_zh"] = json!("<script>");
        assert!(apply_model_choice(&request, &choice, "mock").is_err());
        choice["name_zh"] = json!("名字");
        choice["candidate_id"] = json!("forged");
        assert!(apply_model_choice(&request, &choice, "mock").is_err());
    }
    #[test]
    fn capacity_and_ethanol_limits_are_applied_before_ranking() {
        let mut request = fixture();
        request["max_ethanol_ml"] = json!(0);
        assert_eq!(generate(&request).unwrap()["candidate_count"], 0);
        request["max_ethanol_ml"] = json!(24);
        request["maximum_pre_dilution_liquid_ml"] = json!(20);
        assert_eq!(generate(&request).unwrap()["candidate_count"], 0);
    }
}
