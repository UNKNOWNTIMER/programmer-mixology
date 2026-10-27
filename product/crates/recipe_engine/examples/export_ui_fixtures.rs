//! Export actual Rust engine outputs for the TypeScript UI contract tests.
//! `model_selected` exercises the deterministic choice validator, never a model.
use serde_json::{json, Value};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let destination = std::env::args().nth(1).ok_or("output JSON path required")?;
    let fixture: Value = serde_json::from_str(include_str!("../../../../data/example_agent_request.json"))?;
    let mut outputs = serde_json::Map::new();
    for (name, ids) in [
        ("sour", vec!["gin", "lemon", "simple_syrup"]),
        ("highball", vec!["gin", "soda", "lime"]),
        ("spirit_forward", vec!["scotch", "amaretto"]),
    ] {
        let mut request = fixture.clone();
        request["inventory"] = json!({});
        for id in ids {
            request["inventory"][id] = json!({"abv_fraction": if id == "gin" || id == "scotch" {0.4} else if id == "amaretto" {0.28} else {0.0},
                "available_ml":500.0,"food_grade":true,"allergens_reviewed":true,"is_test_fixture":true,"sku_name":"UI contract fixture, not user stock"});
        }
        let result = pixelmix_recipe_engine::generate(&request)?;
        assert!(result["chosen"].is_object());
        assert_eq!(result["chosen"]["family"], name);
        outputs.insert(name.into(), result.clone());
        if name == "sour" {
            let choice = json!({"candidate_id":result["candidates"][0]["candidate_id"],"name_zh":"契约测试试调","name_en":"Contract Test Trial"});
            outputs.insert("model_selected".into(), pixelmix_recipe_engine::apply_model_choice(&request, &choice, "contract-fixture-no-model-run")?);
            request["taste_bps"] = json!([0,0,0,0,10000]);
            outputs.insert("nearest_only".into(), pixelmix_recipe_engine::generate(&request)?);
            request["inventory"] = json!({});
            outputs.insert("no_feasible_candidate".into(), pixelmix_recipe_engine::generate(&request)?);
        }
    }
    std::fs::write(destination, format!("{}\n", serde_json::to_string_pretty(&outputs)?))?;
    Ok(())
}
