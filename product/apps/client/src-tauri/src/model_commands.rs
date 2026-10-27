use pixelmix_inference::{CandidateSummary, LocalModelConfig, ManagedModel};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

#[derive(Default)]
pub struct ModelController {
    model: Mutex<Option<Arc<ManagedModel>>>,
    lifecycle: Mutex<()>,
    starting: AtomicBool,
    cancel_start: Arc<AtomicBool>,
}
impl ModelController {
    pub fn status(&self) -> Value {
        let slot = self.model.lock().unwrap_or_else(|e| e.into_inner());
        slot.as_ref()
            .map(|m| serde_json::to_value(m.status()).unwrap_or(json!({"running":false})))
            .unwrap_or(json!({"running":false,"starting":self.starting.load(Ordering::SeqCst)}))
    }
    pub fn start(&self, config: LocalModelConfig) -> Result<Value, String> {
        {
            let _lifecycle = self.lifecycle.lock().map_err(|e| e.to_string())?;
            if self.starting.load(Ordering::SeqCst) {
                return Err("模型正在启动".into());
            }
            if self
                .model
                .lock()
                .map_err(|e| e.to_string())?
                .as_ref()
                .is_some_and(|m| m.status().running)
            {
                return Err("模型已经运行，请先停止".into());
            }
            self.starting.store(true, Ordering::SeqCst);
            self.cancel_start.store(false, Ordering::SeqCst);
        }
        let result = (|| {
            let model = ManagedModel::start_cancellable(config, Arc::clone(&self.cancel_start))
                .map_err(|e| e.to_string())?;
            let _lifecycle = self.lifecycle.lock().map_err(|e| e.to_string())?;
            let mut slot = self.model.lock().map_err(|e| e.to_string())?;
            if self.cancel_start.load(Ordering::SeqCst) {
                model.stop();
                return Err("模型启动已取消".into());
            }
            let status = serde_json::to_value(model.status()).map_err(|e| e.to_string())?;
            *slot = Some(Arc::new(model));
            Ok(status)
        })();
        self.starting.store(false, Ordering::SeqCst);
        result
    }
    pub fn stop(&self) {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        self.cancel_start.store(true, Ordering::SeqCst);
        if let Ok(mut model) = self.model.lock() {
            if let Some(model) = model.take() {
                model.stop();
            }
        }
    }
    pub fn generate(&self, request: Value, use_model: bool) -> Result<Value, String> {
        let mut result = pixelmix_recipe_engine::generate(&request).map_err(|e| e.to_string())?;
        if !use_model {
            return Ok(result);
        }
        let candidates = result["candidates"]
            .as_array()
            .ok_or("规则引擎未返回候选列表")?;
        if candidates.is_empty() {
            return Ok(result);
        }
        let summaries: Vec<CandidateSummary> = candidates
            .iter()
            .map(|c| CandidateSummary {
                candidate_id: c["candidate_id"].as_str().unwrap_or_default().into(),
                family: c["family"].as_str().unwrap_or_default().into(),
                ingredient_ids: c["ingredients"]
                    .as_array()
                    .map(|rows| {
                        rows.iter()
                            .filter_map(|i| i["ingredient_id"].as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default(),
            })
            .collect();
        let model = self.model.lock().map_err(|e| e.to_string())?.clone();
        let outcome = match model {
            Some(model) => model.choose_or_fallback(&summaries),
            None => pixelmix_inference::rule_fallback(
                &summaries,
                Some("本地模型未启动，已使用规则候选。".into()),
            ),
        }
        .map_err(|e| e.to_string())?;
        if outcome.model_used {
            result = pixelmix_recipe_engine::apply_model_choice(
                &request,
                &serde_json::to_value(&outcome.choice).map_err(|e| e.to_string())?,
                outcome.model_id.as_deref().unwrap_or("local"),
            )
            .map_err(|e| e.to_string())?;
        }
        result["model_audit"] = serde_json::to_value(&outcome).map_err(|e| e.to_string())?;
        result["model_fallback_reason"] = json!(outcome.fallback_reason);
        result["fallback_reason"] = json!(outcome.fallback_reason);
        Ok(result)
    }
}
impl Drop for ModelController {
    fn drop(&mut self) {
        self.stop()
    }
}
