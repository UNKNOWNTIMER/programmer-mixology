//! Personal library overlay. Immutable source tables and previous snapshots are never rewritten.
use crate::archive::{self, Snapshot};
use chrono::{DateTime, SecondsFormat, Utc};
use pixelmix_catalog::Catalog;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use uuid::Uuid;

const SETTING: &str = "recipe_library";
const MAX_CUSTOM: usize = 100;
const MAX_BYTES: usize = 262_144;
const MAX_REVISION: u64 = 9_007_199_254_740_991;
type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CustomRecipe {
    pub recipe: Value,
    pub profile: Value,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import_provenance: Option<ImportProvenance>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ImportProvenance {
    pub archive_id: String,
    pub sha256: String,
    pub imported_at: String,
    pub original_snapshot: Snapshot,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct LibraryState {
    pub version: u32,
    pub revision: u64,
    pub custom: Vec<CustomRecipe>,
    pub hidden: Vec<String>,
    pub deleted: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_groups: Vec<String>,
}
impl Default for LibraryState {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            custom: vec![],
            hidden: vec![],
            deleted: vec![],
            disabled_groups: vec![],
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecipeIngredient {
    pub ingredient_id: String,
    pub quantity: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quantity_range: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retained_ml: Option<f64>,
    pub unit: String,
    pub optional: bool,
    pub stage: String,
    pub quantity_note: Option<String>,
    pub allowed_alternatives: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecipeDraft {
    pub name_zh: String,
    pub name_en: String,
    pub family: String,
    pub glass_template: String,
    pub method: String,
    pub ingredients: Vec<RecipeIngredient>,
    pub steps_zh: Vec<String>,
    pub garnish_zh: String,
    pub notes_zh: String,
    pub source_url: Option<String>,
    pub taste_bps: [u16; 5],
    pub sensory_0_10: [f64; 7],
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Create,
    Update,
    Hide,
    Show,
    Delete,
    Restore,
    SetGroupEnabled,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LibraryRequest {
    pub expected_revision: u64,
    pub action: Action,
    pub id: Option<String>,
    pub draft: Option<RecipeDraft>,
    pub enabled: Option<bool>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportRequest {
    pub expected_revision: u64,
    pub path: String,
}
#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub library: LibraryState,
    pub added_id: String,
}

struct Context {
    base_ids: HashSet<String>,
    ingredient_ids: HashSet<String>,
    group_ids: HashSet<String>,
}
impl Context {
    fn load(db: &Catalog) -> Result<Self> {
        let data = crate::dlc::extend_catalog(crate::personal_ingredients::extend_catalog(
            db.catalog_json().map_err(|e| e.to_string())?,
        )?)?;
        let ids = |key: &str| -> Result<HashSet<String>> {
            data[key]
                .as_array()
                .ok_or("源酒谱目录结构无效")?
                .iter()
                .map(|v| {
                    v["id"]
                        .as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| "源酒谱目录ID无效".into())
                })
                .collect()
        };
        Ok(Self {
            base_ids: ids("recipes")?,
            ingredient_ids: ids("ingredients")?,
            group_ids: crate::dlc::group_ids()?,
        })
    }
}

pub fn command_allowed(label: &str, command: &str) -> bool {
    !matches!(
        command,
        "recipe_library_get" | "recipe_library_apply" | "recipe_library_import"
    ) || label == "main"
}

fn bounded_text(value: &str, maximum: usize, empty: bool, multiline: bool) -> Result<()> {
    if (!empty && value.trim().is_empty())
        || value.chars().count() > maximum
        || value.chars().any(|c| {
            matches!(c, '<' | '>' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
                || c.is_control() && !(multiline && matches!(c, '\n' | '\t' | '\r'))
        })
    {
        return Err("酒谱文字为空、超长或含不支持的控制/标记字符".into());
    }
    Ok(())
}
fn one_of(value: &str, values: &[&str], label: &str) -> Result<()> {
    if values.contains(&value) {
        Ok(())
    } else {
        Err(format!("不支持的{label}：{value}"))
    }
}
fn validate_draft(d: &RecipeDraft, context: &Context) -> Result<()> {
    bounded_text(&d.name_zh, 160, true, false)?;
    bounded_text(&d.name_en, 160, true, false)?;
    if d.name_zh.trim().is_empty() && d.name_en.trim().is_empty() {
        return Err("请至少填写一个酒名".into());
    }
    bounded_text(&d.garnish_zh, 2000, true, true)?;
    bounded_text(&d.notes_zh, 8000, true, true)?;
    one_of(
        &d.family,
        &[
            "sour",
            "spirit_forward",
            "highball",
            "spritz",
            "creamy",
            "coffee",
            "sparkling",
            "tiki",
            "hot",
            "savory",
            "sourless_shaken",
            "tropical",
            "wine",
            "custom",
        ],
        "酒谱类型",
    )?;
    one_of(
        &d.glass_template,
        &[
            "highball",
            "rocks",
            "martini",
            "coupe",
            "flute",
            "hurricane",
            "mug",
            "goblet",
        ],
        "杯型",
    )?;
    one_of(
        &d.method,
        &[
            "shake",
            "stir",
            "build",
            "blend",
            "throw",
            "layer",
            "muddle",
            "muddle_build",
            "shake_float",
            "shake_top",
            "build_float",
            "stir_gently",
            "stir_rinse",
            "swizzle",
            "heat",
        ],
        "调制方法",
    )?;
    if d.taste_bps.iter().map(|&v| u32::from(v)).sum::<u32>() != 10_000 {
        return Err("五味必须合计10000整数基点".into());
    }
    if d.sensory_0_10
        .iter()
        .any(|v| !v.is_finite() || !(0.0..=10.0).contains(v))
    {
        return Err("七维数值必须为0至10的有限数值".into());
    }
    if d.ingredients.is_empty() || d.ingredients.len() > 64 {
        return Err("配料必须为1至64项".into());
    }
    let positive = |v: f64| v.is_finite() && v > 0.0 && v <= 10_000.0;
    for p in &d.ingredients {
        if !context.ingredient_ids.contains(&p.ingredient_id) {
            return Err(format!("未知原料ID：{}", p.ingredient_id));
        }
        if p.quantity.is_some_and(|v| !positive(v)) {
            return Err("配料剂量必须大于0且不超过10000；未知量请保留null".into());
        }
        if let Some(q) = p.quantity_range {
            if p.quantity.is_some() || !positive(q[0]) || !positive(q[1]) || q[0] > q[1] {
                return Err("剂量范围必须递增且大于0，不能同时提供单值剂量".into());
            }
        }
        if p.retained_ml
            .is_some_and(|v| !v.is_finite() || !(0.0..=10_000.0).contains(&v))
        {
            return Err("留存体积必须为0至10000毫升；未知量请保留null".into());
        }
        one_of(
            &p.unit,
            &[
                "ml",
                "cl",
                "dl",
                "l",
                "g",
                "kg",
                "mg",
                "oz",
                "fl oz",
                "us_fl_oz",
                "imperial_fl_oz",
                "oz_weight",
                "lb",
                "tsp",
                "tbsp",
                "cup",
                "dash",
                "drop",
                "piece",
                "whole",
                "leaf",
                "slice",
                "sprig",
                "cube",
                "barspoon",
                "shot",
                "part",
                "glass",
                "jigger",
                "serving",
                "pinch",
                "bottle",
                "scoop",
                "few_drops",
                "few_dashes",
                "to_top",
                "top_up",
                "splash",
                "rinse",
                "garnish",
                "to_taste",
                "unknown",
            ],
            "剂量单位",
        )?;
        one_of(
            &p.stage,
            &["mix", "top", "float", "rinse", "garnish", "finish", "side"],
            "配料阶段",
        )?;
        if let Some(note) = &p.quantity_note {
            bounded_text(note, 1000, true, true)?;
        }
        let alternatives: HashSet<_> = p.allowed_alternatives.iter().collect();
        if p.allowed_alternatives.len() > 32
            || alternatives.len() != p.allowed_alternatives.len()
            || p.allowed_alternatives
                .iter()
                .any(|id| !context.ingredient_ids.contains(id) || id == &p.ingredient_id)
        {
            return Err("替代原料必须为不重复的已知原料ID，且不能包含原料自身".into());
        }
    }
    if d.steps_zh.is_empty() || d.steps_zh.len() > 64 {
        return Err("调制步骤必须为1至64项".into());
    }
    for step in &d.steps_zh {
        bounded_text(step, 2000, false, true)?;
    }
    if let Some(raw) = &d.source_url {
        bounded_text(raw, 2048, false, false)?;
        let url = url::Url::parse(raw).map_err(|_| "出处URL格式无效")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("出处只能是无凭据的HTTP(S)文本链接".into());
        }
    }
    Ok(())
}

fn custom_id(value: &str) -> bool {
    value
        .strip_prefix("personal_")
        .and_then(|v| Uuid::parse_str(v).ok())
        .is_some_and(|uuid| value == format!("personal_{uuid}"))
}
fn snapshot(entry: &CustomRecipe) -> Snapshot {
    Snapshot {
        recipe: entry.recipe.clone(),
        profile: entry.profile.clone(),
        target: json!({
            "taste_bps":entry.profile["taste_preference_bps"], "sensory_0_10":entry.profile["sensory_0_10"]
        }),
    }
}
fn draft_from_entry(entry: &CustomRecipe) -> Result<RecipeDraft> {
    let recipe = &entry.recipe;
    serde_json::from_value(json!({
        "name_zh":recipe["name_zh"],"name_en":recipe["name_en"],"family":recipe["family"],
        "glass_template":recipe["glass_template"],"method":recipe["method"],"ingredients":recipe["ingredients"],
        "steps_zh":recipe["steps_zh"],"garnish_zh":recipe["garnish_zh"],"notes_zh":recipe["notes_zh"],
        "source_url":recipe["source"]["url"],"taste_bps":entry.profile["taste_preference_bps"],"sensory_0_10":entry.profile["sensory_0_10"]
    })).map_err(|e| format!("个人酒谱结构无效：{e}"))
}
fn check_size(state: &LibraryState) -> Result<Value> {
    if state.custom.len() > MAX_CUSTOM {
        return Err("个人酒谱最多100杯（包含回收站）；本次未保存".into());
    }
    let value = serde_json::to_value(state).map_err(|e| e.to_string())?;
    if serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > MAX_BYTES {
        return Err("个人酒谱库超过256 KiB；请缩短文字或减少配方，本次未保存".into());
    }
    Ok(value)
}
fn validate_state(state: &LibraryState, context: &Context) -> Result<()> {
    check_size(state)?;
    if state.version != 1 || state.revision > MAX_REVISION {
        return Err("不支持的酒谱库版本或修订号".into());
    }
    let mut known = context.base_ids.clone();
    for entry in &state.custom {
        let id = entry.recipe["id"].as_str().ok_or("个人酒谱缺少ID")?;
        if !custom_id(id) || !known.insert(id.into()) {
            return Err("个人酒谱ID无效或重复".into());
        }
        let created =
            DateTime::parse_from_rfc3339(&entry.created_at).map_err(|_| "个人酒谱创建时间无效")?;
        let updated =
            DateTime::parse_from_rfc3339(&entry.updated_at).map_err(|_| "个人酒谱更新时间无效")?;
        if updated < created {
            return Err("个人酒谱更新时间不能早于创建时间".into());
        }
        archive::validate(&snapshot(entry))?;
        if let Some(provenance) = &entry.import_provenance {
            if Uuid::parse_str(&provenance.archive_id).is_err()
                || provenance.sha256.len() != 64
                || !provenance.sha256.bytes().all(|v| v.is_ascii_hexdigit())
                || DateTime::parse_from_rfc3339(&provenance.imported_at).is_err()
            {
                return Err("导入存档出处无效".into());
            }
            archive::validate(&provenance.original_snapshot)?;
        }
        let imported_source = entry.import_provenance.is_some()
            && entry.recipe["source"]["kind"] == "imported_snapshot";
        let imported_profile = entry.import_provenance.is_some()
            && entry.profile["status"] == "imported_unvalidated"
            && entry.profile["origin"] == "archive_import";
        let user_profile = entry.profile["status"] == "heuristic_unvalidated"
            && entry.profile["origin"] == "user_defined";
        if (entry.recipe["source"]["kind"] != "personal_recipe" && !imported_source)
            || entry.recipe["default_orderable"] != false
            || entry.recipe["needs_serving_configuration"] != true
            || !entry.recipe["actual_user_rating"].is_null()
            || entry.recipe["prediction_profile_id"] != id
            || entry.profile["measured"] != false
            || !(imported_profile || user_profile)
            || !entry.profile["taste_intensity_0_10"].is_null()
        {
            return Err("个人酒谱不能恢复点单权限、实饮评价或实测标记".into());
        }
        let draft = draft_from_entry(entry)?;
        bounded_text(&draft.name_zh, 160, false, false)?;
        bounded_text(&draft.name_en, 160, false, false)?;
        validate_draft(&draft, context)?;
    }
    let mut hidden = HashSet::new();
    let mut disabled = HashSet::new();
    for id in &state.disabled_groups {
        if !context.group_ids.contains(id) || !disabled.insert(id) {
            return Err("停用列表含未知或重复DLC组".into());
        }
    }
    for id in &state.hidden {
        if !known.contains(id) || !hidden.insert(id) {
            return Err("隐藏列表含未知或重复酒谱ID".into());
        }
    }
    let mut deleted = HashSet::new();
    for id in &state.deleted {
        if !known.contains(id) || hidden.contains(id) || !deleted.insert(id) {
            return Err("回收站含未知、重复或同时隐藏的酒谱ID".into());
        }
    }
    Ok(())
}
fn load(db: &Catalog, context: &Context) -> Result<LibraryState> {
    let state = match db.load_setting(SETTING).map_err(|e| e.to_string())? {
        Some(value) => {
            serde_json::from_value(value).map_err(|e| format!("个人酒谱库结构损坏，未覆盖：{e}"))?
        }
        None => LibraryState::default(),
    };
    validate_state(&state, context)?;
    Ok(state)
}
pub fn get(db: &Catalog) -> Result<LibraryState> {
    load(db, &Context::load(db)?)
}

fn create_entry(id: &str, mut draft: RecipeDraft, created_at: Option<&str>) -> CustomRecipe {
    draft.name_zh = draft.name_zh.trim().to_owned();
    draft.name_en = draft.name_en.trim().to_owned();
    if draft.name_zh.is_empty() {
        draft.name_zh.clone_from(&draft.name_en);
    }
    if draft.name_en.is_empty() {
        draft.name_en.clone_from(&draft.name_zh);
    }
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    // A backwards clock adjustment must not corrupt an otherwise valid saved entry.
    let updated_at = created_at
        .filter(|created| *created > now.as_str())
        .unwrap_or(&now)
        .to_owned();
    let recipe = json!({
        "id":id,"recipe_revision_id":format!("personal-revision:{}",Uuid::new_v4()),
        "name_zh":draft.name_zh,"name_en":draft.name_en,"variant":"个人酒谱","family":draft.family,
        "glass_template":draft.glass_template,"glass_template_provenance":"user_defined","method":draft.method,
        "ingredients":draft.ingredients,"steps_zh":draft.steps_zh,"garnish_zh":draft.garnish_zh,"notes_zh":draft.notes_zh,
        "source":{"kind":"personal_recipe","publisher":"个人酒谱","url":draft.source_url,
            "reference":"用户创建的个人配方","checked_on":&updated_at[..10],"method_provenance":"user_defined"},
        "preparation_review":"not_physically_tested","default_orderable":false,"needs_serving_configuration":true,
        "actual_user_rating":null,"prediction_profile_id":id
    });
    let profile = json!({"recipe_id":id,"taste_axes":["sweet","sour","bitter","salty","umami"],
        "taste_preference_bps":draft.taste_bps,"sensory_axes":["alcohol_heat","aroma","body","carbonation","cooling","spiciness","finish"],
        "sensory_0_10":draft.sensory_0_10,"taste_intensity_0_10":null,"status":"heuristic_unvalidated",
        "origin":"user_defined","measured":false,"source_recipe_does_not_supply_these_scores":true,
        "note_zh":"用户定义的味觉与感官坐标，尚未实饮验证。"});
    CustomRecipe {
        recipe,
        profile,
        created_at: created_at.unwrap_or(&now).into(),
        updated_at,
        import_provenance: None,
    }
}

/// Caller holds AppState.catalog's Mutex across load, revision validation and the
/// single atomic SQLite settings write. Validation errors never write a partial overlay.
pub fn apply(db: &Catalog, request: LibraryRequest) -> Result<LibraryState> {
    let context = Context::load(db)?;
    let mut state = load(db, &context)?;
    if request.expected_revision != state.revision || request.expected_revision > MAX_REVISION {
        return Err("酒谱库已被其他操作更新，请刷新后重试；本次未保存".into());
    }
    if state.revision == MAX_REVISION {
        return Err("酒谱库修订号已达上限，本次未保存".into());
    }
    let id = request.id.as_deref();
    if !matches!(request.action, Action::SetGroupEnabled) && request.enabled.is_some() {
        return Err("只有DLC开关操作可附带enabled".into());
    }
    match request.action {
        Action::Create => {
            if id.is_some() {
                return Err("新增酒谱不能指定ID".into());
            }
            let draft = request.draft.ok_or("新增酒谱需要draft")?;
            validate_draft(&draft, &context)?;
            if state.custom.len() >= MAX_CUSTOM {
                return Err("个人酒谱最多100杯（包含回收站）；本次未保存".into());
            }
            let new_id = format!("personal_{}", Uuid::new_v4());
            state.custom.push(create_entry(&new_id, draft, None));
        }
        Action::Update => {
            let id = id.ok_or("修改酒谱需要ID")?;
            if state.deleted.iter().any(|v| v == id) {
                return Err("请先从回收站恢复酒谱再修改".into());
            }
            let index = state
                .custom
                .iter()
                .position(|entry| entry.recipe["id"] == id)
                .ok_or("只能修改已有个人酒谱，原始酒谱不可改写")?;
            let draft = request.draft.ok_or("修改酒谱需要draft")?;
            validate_draft(&draft, &context)?;
            let provenance = state.custom[index].import_provenance.clone();
            let source = provenance
                .as_ref()
                .map(|_| state.custom[index].recipe["source"].clone());
            state.custom[index] = create_entry(id, draft, Some(&state.custom[index].created_at));
            state.custom[index].import_provenance = provenance;
            if let Some(mut source) = source {
                source["kind"] = json!("imported_snapshot");
                source["method_provenance"] = json!("user_defined");
                // The user may edit the reference URL, but imported authorship
                // remains available when this edited drink is exported again.
                source["url"] = state.custom[index].recipe["source"]["url"].clone();
                state.custom[index].recipe["source"] = source;
            }
        }
        Action::SetGroupEnabled => {
            if request.draft.is_some() {
                return Err("DLC开关不能附带draft".into());
            }
            let id = id.ok_or("DLC开关需要组ID")?;
            if !context.group_ids.contains(id) {
                return Err("未知DLC组ID".into());
            }
            let enabled = request.enabled.ok_or("DLC开关需要enabled")?;
            state.disabled_groups.retain(|v| v != id);
            if !enabled {
                state.disabled_groups.push(id.into());
            }
        }
        action => {
            if request.draft.is_some() {
                return Err("隐藏、删除或恢复不能附带draft".into());
            }
            let id = id.ok_or("酒谱操作需要ID")?;
            if !context.base_ids.contains(id)
                && !state.custom.iter().any(|entry| entry.recipe["id"] == id)
            {
                return Err("未知酒谱ID".into());
            }
            match action {
                Action::Delete => {
                    state.hidden.retain(|v| v != id);
                    if !state.deleted.iter().any(|v| v == id) {
                        state.deleted.push(id.into());
                    }
                }
                Action::Restore => {
                    state.deleted.retain(|v| v != id);
                }
                Action::Hide | Action::Show => {
                    if state.deleted.iter().any(|v| v == id) {
                        return Err("请先从回收站恢复酒谱".into());
                    }
                    if matches!(action, Action::Hide) {
                        if !state.hidden.iter().any(|v| v == id) {
                            state.hidden.push(id.into());
                        }
                    } else {
                        state.hidden.retain(|v| v != id);
                    }
                }
                Action::Create | Action::Update | Action::SetGroupEnabled => unreachable!(),
            }
        }
    }
    state.revision += 1;
    validate_state(&state, &context)?;
    let value = check_size(&state)?;
    db.save_setting(SETTING, &value)
        .map_err(|e| format!("酒谱库保存失败：{e}"))?;
    Ok(state)
}

/// Used before consuming a one-shot native drop grant. The final write checks
/// the revision again after file reading, so concurrent changes cannot be lost.
pub fn check_revision(db: &Catalog, expected_revision: u64) -> Result<()> {
    let state = get(db)?;
    if state.revision != expected_revision || expected_revision >= MAX_REVISION {
        return Err("酒谱库已被其他操作更新，请刷新后重试；本次未保存".into());
    }
    Ok(())
}

/// Only call with the result of archive::read on an authorized native file path.
/// The frontend never supplies trusted snapshots or replacement library state.
pub fn import_validated_archive(
    db: &Catalog,
    expected_revision: u64,
    decoded: Value,
) -> Result<ImportResult> {
    let context = Context::load(db)?;
    let mut state = load(db, &context)?;
    if state.revision != expected_revision || expected_revision >= MAX_REVISION {
        return Err("酒谱库已被其他操作更新，请刷新后重试；本次未保存".into());
    }
    let original: Snapshot = serde_json::from_value(decoded["snapshot"].clone())
        .map_err(|e| format!("存档快照无效：{e}"))?;
    archive::validate(&original)?;
    let source_entry = CustomRecipe {
        recipe: original.recipe.clone(),
        profile: original.profile.clone(),
        created_at: String::new(),
        updated_at: String::new(),
        import_provenance: None,
    };
    let draft = draft_from_entry(&source_entry)?;
    validate_draft(&draft, &context)?;
    let added_id = format!("personal_{}", Uuid::new_v4());
    let mut entry = create_entry(&added_id, draft, None);
    // Preserve the author's recipe prose and quantities exactly, including
    // omitted optional fields, while retaining the new personal identity.
    for key in ["ingredients", "steps_zh", "garnish_zh", "notes_zh"] {
        entry.recipe[key] = original.recipe[key].clone();
    }
    entry.recipe["source"] = original.recipe["source"].clone();
    entry.recipe["source"]["kind"] = json!("imported_snapshot");
    entry.profile = original.profile.clone();
    entry.profile["recipe_id"] = json!(added_id);
    entry.profile["measured"] = json!(false);
    entry.profile["status"] = json!("imported_unvalidated");
    entry.profile["origin"] = json!("archive_import");
    entry.profile["taste_intensity_0_10"] = Value::Null;
    let imported_at = entry.created_at.clone();
    entry.import_provenance = Some(ImportProvenance {
        archive_id: decoded["archive_id"].as_str().ok_or("存档缺少ID")?.into(),
        sha256: decoded["sha256"].as_str().ok_or("存档缺少校验值")?.into(),
        imported_at,
        original_snapshot: original,
    });
    state.custom.push(entry);
    state.revision += 1;
    validate_state(&state, &context)?;
    db.save_setting(SETTING, &check_size(&state)?)
        .map_err(|e| format!("酒谱库保存失败：{e}"))?;
    Ok(ImportResult {
        library: state,
        added_id,
    })
}

#[cfg(test)]
mod tests;
