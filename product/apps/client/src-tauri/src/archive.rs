//! Portable recipe data only. No accounts, bearer tokens, host tickets or menu approval.
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub const MAX_BYTES: usize = 524_288;
mod portrait;
const ICON_SEPARATOR: &[u8] = b"\nPIXELMIX-ARCHIVE/2\n";
const ICON_FOOTER: &[u8] = b"PMIX-END2";
const SCHEMA: &str = "pixelmix.recipe-archive";
// The suffix is independent of the versioned container schema. Existing saves
// remain readable, while every newly written archive uses TIMER's suffix.
const ARCHIVE_EXTENSION: &str = "timermix";
const SCOPE: &str = "personal_recipe_snapshot";
type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub recipe: Value,
    pub profile: Value,
    pub target: Value,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Body {
    schema: String,
    version: u32,
    archive_id: String,
    created_at: u64,
    scope: String,
    snapshot: Snapshot,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ArchiveFile {
    body: Body,
    sha256: String,
}
#[derive(Debug, Serialize)]
pub struct SavedArchive {
    pub archive_id: String,
    pub path: String,
    pub sha256: String,
    pub icon_association: Value,
}
#[derive(Default)]
pub struct ArchiveAccess {
    dropped: Mutex<HashMap<PathBuf, Instant>>,
}
impl ArchiveAccess {
    pub fn grant_drop(&self, paths: &[PathBuf]) {
        if paths.len() != 1 || local_archive_path(&paths[0]).is_err() {
            return;
        }
        if let Ok(mut map) = self.dropped.lock() {
            map.retain(|_, at| at.elapsed() < Duration::from_secs(60));
            if map.len() < 8 {
                map.insert(paths[0].clone(), Instant::now());
            }
        }
    }
    pub fn authorize(&self, path: &Path, data_dir: &Path) -> Result<()> {
        local_archive_path(path)?;
        let root = data_dir.join("recipe-archives");
        if let Some(parent) = path.parent().filter(|p| p.parent() == Some(root.as_path())) {
            if let Some(uuid) = parent
                .file_name()
                .and_then(|s| s.to_str())
                .and_then(|s| Uuid::parse_str(s).ok())
            {
                if own_archive(data_dir, &uuid.to_string())? == path {
                    return Ok(());
                }
            }
        }
        if path.parent() == Some(data_dir.join("recipe-archives").as_path())
            && path
                .file_stem()
                .and_then(|x| x.to_str())
                .is_some_and(|x| archive_filename_id(x).is_some())
        {
            return Ok(());
        }
        let mut map = self.dropped.lock().map_err(|_| "存档读取锁异常")?;
        if map
            .remove(path)
            .is_some_and(|at| at.elapsed() < Duration::from_secs(60))
        {
            Ok(())
        } else {
            Err("请把一个本地存档文件实际拖入应用；不能读取未授权路径".into())
        }
    }
}
fn object<'a>(value: &'a Value, allowed: &[&str]) -> Result<&'a Map<String, Value>> {
    let map = value.as_object().ok_or("存档对象结构无效")?;
    if map.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("存档含不支持的字段；不会恢复权限或执行内容".into());
    }
    Ok(map)
}
fn required(value: &Value, keys: &[&str]) -> Result<()> {
    if keys.iter().any(|key| value.get(key).is_none()) {
        return Err("存档缺少必需字段；未知值应明确保留null".into());
    }
    Ok(())
}
fn text(value: &Value, max: usize, empty: bool) -> Result<&str> {
    let value = value.as_str().ok_or("文字字段类型无效")?;
    if (!empty && value.trim().is_empty())
        || value.chars().count() > max
        || value.char_indices().any(|(at, c)| {
            // Preserve source Windows line endings verbatim; a bare CR stays invalid.
            c.is_control()
                && !matches!(c, '\n' | '\t')
                && !(c == '\r' && value.as_bytes().get(at + 1) == Some(&b'\n'))
                || matches!(c,'<'|'>'|'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}')
        })
    {
        return Err("文字包含超长内容、标记或控制字符".into());
    }
    Ok(value)
}
fn id(value: &Value) -> Result<&str> {
    let s = text(value, 180, false)?;
    if !s
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || b"_-.:".contains(&c))
    {
        return Err("ID字段无效".into());
    }
    Ok(s)
}
fn vector(value: &Value, n: usize, max: f64, integer: bool) -> Result<()> {
    let a = value.as_array().ok_or("向量不是数组")?;
    if a.len() != n
        || a.iter().any(|v| {
            v.as_f64()
                .is_none_or(|x| !x.is_finite() || x < 0. || x > max)
                || (integer && v.as_u64().is_none())
        })
    {
        return Err("向量范围或整数基点无效".into());
    }
    if integer && a.iter().map(|v| v.as_u64().unwrap()).sum::<u64>() != 10000 {
        return Err("五味必须合计10000整数基点".into());
    }
    Ok(())
}
fn boolean(value: &Value) -> Result<()> {
    if !value.is_boolean() {
        return Err("布尔字段无效".into());
    }
    Ok(())
}
fn strings(value: &Value, min: usize, max: usize, len: usize) -> Result<()> {
    let values = value.as_array().ok_or("文字列表无效")?;
    if values.len() < min || values.len() > max {
        return Err("列表长度无效".into());
    }
    for v in values {
        text(v, len, false)?;
    }
    Ok(())
}
pub fn validate(snapshot: &Snapshot) -> Result<()> {
    if serde_json::to_vec(snapshot)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_BYTES - 2048
    {
        return Err("存档超出512KiB上限".into());
    }
    let r = &snapshot.recipe;
    object(
        r,
        &[
            "id",
            "recipe_revision_id",
            "name_zh",
            "name_en",
            "variant",
            "family",
            "glass_template",
            "glass_template_provenance",
            "method",
            "ingredients",
            "steps_zh",
            "garnish_zh",
            "notes_zh",
            "source",
            "preparation_review",
            "default_orderable",
            "needs_serving_configuration",
            "actual_user_rating",
            "prediction_profile_id",
        ],
    )?;
    id(&r["id"])?;
    id(&r["recipe_revision_id"])?;
    for (key, max, empty) in [
        ("name_zh", 160, false),
        ("name_en", 160, true),
        ("variant", 300, true),
        ("family", 80, false),
        ("glass_template", 80, false),
        ("method", 80, false),
        ("garnish_zh", 2000, true),
        ("notes_zh", 8000, true),
        ("preparation_review", 160, false),
        ("prediction_profile_id", 180, false),
    ] {
        text(&r[key], max, empty)?;
    }
    if let Some(v) = r.get("glass_template_provenance") {
        text(v, 160, false)?;
    }
    if r.get("actual_user_rating").is_some_and(|v| !v.is_null()) {
        return Err("实饮评价不能随配方导入或冒充预测".into());
    }
    boolean(&r["default_orderable"])?;
    boolean(&r["needs_serving_configuration"])?;
    let parts = r["ingredients"].as_array().ok_or("缺少配料快照")?;
    if parts.is_empty() || parts.len() > 64 {
        return Err("配料数超出限制".into());
    }
    for p in parts {
        object(
            p,
            &[
                "ingredient_id",
                "quantity",
                "unit",
                "optional",
                "stage",
                "quantity_note",
                "allowed_alternatives",
                "quantity_range",
                "retained_ml",
            ],
        )?;
        required(p, &["quantity", "quantity_note"])?;
        id(&p["ingredient_id"])?;
        if !p["quantity"].is_null()
            && p["quantity"]
                .as_f64()
                .is_none_or(|v| !v.is_finite() || v <= 0. || v > 10000.)
        {
            return Err("配料剂量无效，未知量须保持null".into());
        }
        text(&p["unit"], 32, false)?;
        text(&p["stage"], 32, false)?;
        boolean(&p["optional"])?;
        if !p["quantity_note"].is_null() {
            text(&p["quantity_note"], 1000, true)?;
        }
        strings(&p["allowed_alternatives"], 0, 32, 180)?;
        if let Some(range) = p.get("quantity_range") {
            vector(range, 2, 10000., false)?;
            if range[0].as_f64().unwrap() > range[1].as_f64().unwrap() {
                return Err("剂量区间倒置".into());
            }
        }
        if let Some(retained) = p.get("retained_ml") {
            if !retained.is_null()
                && retained
                    .as_f64()
                    .is_none_or(|v| !v.is_finite() || !(0.0..=10000.0).contains(&v))
            {
                return Err("留存体积无效".into());
            }
        }
    }
    strings(&r["steps_zh"], 1, 64, 2000)?;
    let s = &r["source"];
    object(
        s,
        &[
            "recipe_id",
            "kind",
            "publisher",
            "url",
            "reference",
            "checked_on",
            "method_provenance",
        ],
    )?;
    required(s, &["url"])?;
    for (key, max) in [
        ("kind", 80),
        ("publisher", 500),
        ("reference", 4000),
        ("checked_on", 40),
        ("method_provenance", 160),
    ] {
        text(&s[key], max, false)?;
    }
    if let Some(v) = s.get("recipe_id") {
        id(v)?;
    }
    if !s["url"].is_null() {
        let raw = text(&s["url"], 2048, false)?;
        let url = url::Url::parse(raw).map_err(|_| "出处URL格式无效")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("出处只能是无凭据的HTTP(S)文本链接".into());
        }
    }
    let p = &snapshot.profile;
    object(
        p,
        &[
            "recipe_id",
            "taste_axes",
            "taste_intensity_0_10",
            "taste_preference_bps",
            "sensory_axes",
            "sensory_0_10",
            "status",
            "confidence",
            "origin",
            "measured",
            "source_recipe_does_not_supply_these_scores",
            "note_zh",
        ],
    )?;
    required(p, &["taste_intensity_0_10"])?;
    if id(&p["recipe_id"])? != id(&r["id"])? {
        return Err("预测与配方ID不一致".into());
    }
    vector(&p["taste_preference_bps"], 5, 10000., true)?;
    vector(&p["sensory_0_10"], 7, 10., false)?;
    if !p["taste_intensity_0_10"].is_null() {
        vector(&p["taste_intensity_0_10"], 5, 10., false)?;
    }
    boolean(&p["measured"])?;
    text(&p["status"], 100, false)?;
    text(&p["note_zh"], 8000, true)?;
    for (key, max) in [("confidence", 100), ("origin", 500)] {
        if let Some(v) = p.get(key) {
            text(v, max, false)?;
        }
    }
    if let Some(v) = p.get("source_recipe_does_not_supply_these_scores") {
        boolean(v)?;
    }
    for (key, expected) in [
        (
            "taste_axes",
            json!(["sweet", "sour", "bitter", "salty", "umami"]),
        ),
        (
            "sensory_axes",
            json!([
                "alcohol_heat",
                "aroma",
                "body",
                "carbonation",
                "cooling",
                "spiciness",
                "finish"
            ]),
        ),
    ] {
        if p.get(key).is_some_and(|v| v != &expected) {
            return Err("向量轴顺序不受支持".into());
        }
    }
    let t = &snapshot.target;
    object(t, &["taste_bps", "sensory_0_10"])?;
    vector(&t["taste_bps"], 5, 10000., true)?;
    vector(&t["sensory_0_10"], 7, 10., false)?;
    Ok(())
}
fn canonical(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|key| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap(),
                        canonical(&map[key])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        Value::Array(values) => format!(
            "[{}]",
            values.iter().map(canonical).collect::<Vec<_>>().join(",")
        ),
        _ => value.to_string(),
    }
}
fn digest(body: &Body) -> Result<String> {
    let value = serde_json::to_value(body).map_err(|e| e.to_string())?;
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical(&value).as_bytes())
    ))
}
fn build(snapshot: Snapshot) -> Result<ArchiveFile> {
    validate(&snapshot)?;
    let body = Body {
        schema: SCHEMA.into(),
        version: 1,
        archive_id: Uuid::new_v4().to_string(),
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs(),
        scope: SCOPE.into(),
        snapshot,
    };
    let sha256 = digest(&body)?;
    Ok(ArchiveFile { body, sha256 })
}
pub fn save(data_dir: &Path, snapshot: Snapshot) -> Result<SavedArchive> {
    let file = build(snapshot)?;
    let bytes = encode_with_icon(&file)?;
    let root = data_dir.join("recipe-archives");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    plain_cache_directory(&root)?;
    // Each export owns an immutable cache directory. OLE copies only the file,
    // whose friendly basename no longer needs to expose our internal UUID.
    let folder = root.join(&file.body.archive_id);
    std::fs::create_dir(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(format!(
        "{}.{ARCHIVE_EXTENSION}",
        filename_prefix(&file.body.snapshot.recipe)
    ));
    let mut writer = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writer
        .write_all(&bytes)
        .and_then(|_| writer.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(SavedArchive {
        archive_id: file.body.archive_id,
        path: path.to_string_lossy().into_owned(),
        sha256: file.sha256,
        icon_association: json!({"registered":false,"reason":"not_requested"}),
    })
}
// Legacy flat cache names. New exports keep this identity in the parent folder.
fn archive_filename_id(stem: &str) -> Option<Uuid> {
    Uuid::parse_str(stem).ok().or_else(|| {
        stem.rsplit_once("--")
            .and_then(|(_, suffix)| Uuid::parse_str(suffix).ok())
    })
}
fn filename_prefix(recipe: &Value) -> String {
    // Preserve both display names regardless of the current UI language. The
    // per-file icon handler and OLE drag paths use Unicode Windows APIs.
    let zh = filename_component(recipe["name_zh"].as_str().unwrap_or(""), 80, false);
    let en = filename_component(recipe["name_en"].as_str().unwrap_or(""), 80, true);
    let safe = match (zh.is_empty(), en.is_empty()) {
        (false, false) if zh != en => {
            // Share the filename budget, reserving room for both languages.
            let zh = filename_component(&zh, 80 - en.encode_utf16().count().min(40), false);
            let en = filename_component(&en, 80 - zh.encode_utf16().count(), true);
            format!("{zh}_{en}")
        }
        (false, _) => zh,
        (_, false) => en,
        _ => filename_component(recipe["id"].as_str().unwrap_or("cocktail"), 80, true),
    };
    let safe = if safe.is_empty() {
        "cocktail".into()
    } else {
        safe
    };
    let base = safe
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", "COM¹",
        "COM²", "COM³", "LPT¹", "LPT²", "LPT³",
    ];
    if reserved.contains(&base.as_str()) {
        format!("cocktail_{safe}")
    } else {
        safe
    }
}
fn filename_component(name: &str, max_units: usize, english: bool) -> String {
    let mut safe = String::new();
    let mut units = 0;
    let name = if english {
        name.to_lowercase()
    } else {
        name.to_owned()
    };
    for c in name.trim().chars() {
        let c = if c.is_control()
            || c.is_whitespace()
            || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            || (english && !c.is_alphanumeric())
        {
            '_'
        } else {
            c
        };
        if c == '_' && (safe.is_empty() || safe.ends_with('_')) {
            continue;
        }
        if units + c.len_utf16() > max_units {
            break;
        }
        units += c.len_utf16();
        safe.push(c);
    }
    safe.trim_matches(|c: char| c.is_whitespace() || matches!(c, '.' | '_'))
        .to_owned()
}
fn encode_with_icon(file: &ArchiveFile) -> Result<Vec<u8>> {
    let recipe = &file.body.snapshot.recipe;
    let mut bytes = portrait::ico(recipe, portrait::archive_sizes(recipe));
    bytes.extend_from_slice(ICON_SEPARATOR);
    let json = serde_json::to_vec(file).map_err(|e| e.to_string())?;
    bytes.extend_from_slice(&json);
    bytes.extend_from_slice(&(json.len() as u32).to_le_bytes());
    let checksum = Sha256::digest(&bytes);
    bytes.extend_from_slice(&checksum);
    bytes.extend_from_slice(ICON_FOOTER);
    if bytes.len() > MAX_BYTES {
        return Err("图标及配方存档超出512KiB上限".into());
    }
    Ok(bytes)
}
fn json_payload(bytes: &[u8]) -> Result<&[u8]> {
    if !bytes.starts_with(&[0, 0, 1, 0]) {
        return Ok(bytes);
    } // v1 plain JSON remains valid.
    let trailer = 4 + 32 + ICON_FOOTER.len();
    if bytes.len() < trailer + 6 + ICON_SEPARATOR.len() || !bytes.ends_with(ICON_FOOTER) {
        return Err("存档图标容器不完整".into());
    }
    let length_offset = bytes.len() - trailer;
    let json_length =
        u32::from_le_bytes(bytes[length_offset..length_offset + 4].try_into().unwrap()) as usize;
    let json_start = length_offset
        .checked_sub(json_length)
        .ok_or("存档数据边界无效")?;
    let icon_end = json_start
        .checked_sub(ICON_SEPARATOR.len())
        .ok_or("存档图标边界无效")?;
    if &bytes[icon_end..json_start] != ICON_SEPARATOR || !portrait::verify(&bytes[..icon_end]) {
        return Err("存档图标结构无效".into());
    }
    if Sha256::digest(&bytes[..length_offset + 4]).as_slice()
        != &bytes[length_offset + 4..length_offset + 36]
    {
        return Err("存档图标容器SHA-256校验失败".into());
    }
    Ok(&bytes[json_start..length_offset])
}
fn plain_cache_directory(path: &Path) -> Result<()> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("存档缓存目录不能是重解析点".into());
        }
    }
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("存档缓存必须为普通本机目录".into());
    }
    Ok(())
}
fn has_archive_extension(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|s| {
        s.eq_ignore_ascii_case(ARCHIVE_EXTENSION) || s.eq_ignore_ascii_case("pixelmix")
    })
}
pub fn own_archive(data_dir: &Path, archive_id: &str) -> Result<PathBuf> {
    let uuid = Uuid::parse_str(archive_id).map_err(|_| "存档ID无效")?;
    let folder = data_dir.join("recipe-archives");
    plain_cache_directory(&folder)?;
    let current = folder.join(uuid.to_string());
    match std::fs::symlink_metadata(&current) {
        Ok(_) => {
            plain_cache_directory(&current)?;
            let entries = std::fs::read_dir(&current)
                .map_err(|e| e.to_string())?
                .filter_map(std::result::Result::ok)
                .map(|entry| entry.path())
                .filter(|path| has_archive_extension(path))
                .take(2)
                .collect::<Vec<_>>();
            if entries.len() != 1 {
                return Err("存档缓存目录必须包含唯一一个酒谱存档".into());
            }
            let path = &entries[0];
            if read(path)?["archive_id"].as_str() != Some(archive_id) {
                return Err("存档ID与缓存目录不一致".into());
            }
            return Ok(path.clone());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let candidates = std::fs::read_dir(&folder)
        .map_err(|e| e.to_string())?
        .filter_map(std::result::Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            has_archive_extension(path)
                && path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .and_then(archive_filename_id)
                    == Some(uuid)
        })
        .take(2)
        .collect::<Vec<_>>();
    if candidates.len() != 1 {
        return Err("未找到唯一的本机导出存档".into());
    }
    let path = candidates.into_iter().next().unwrap();
    let parsed = read(&path)?;
    if parsed["archive_id"].as_str() != Some(archive_id) {
        return Err("存档ID与文件名称不一致".into());
    }
    Ok(path)
}
/// The native drag cursor uses the same portrait carried inside the file.
pub fn drag_icon(path: &Path) -> Result<Vec<u8>> {
    let decoded = read(path)?;
    Ok(portrait::ico(&decoded["snapshot"]["recipe"], &[64]))
}
fn local_archive_path(path: &Path) -> Result<()> {
    let text = path.to_str().ok_or("文件路径不是有效Unicode")?;
    if !path.is_absolute()
        || text.chars().any(char::is_control)
        || text.starts_with("\\\\")
        || text.starts_with("//")
        || text.contains("://")
        || text.get(2..).is_some_and(|s| s.contains(':'))
        || text.contains("/../")
        || text.contains("\\..\\")
    {
        return Err("只允许本机绝对文件路径，拒绝网络/设备/替代数据流路径".into());
    }
    if !has_archive_extension(path)
        && !path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("json"))
    {
        return Err("只能拖入.timermix酒谱存档".into());
    }
    Ok(())
}
pub fn read(path: &Path) -> Result<Value> {
    local_archive_path(path)?;
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("不能导入重解析点或符号链接".into());
        }
    }
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_BYTES as u64 {
        return Err("仅允许不超过512KiB的普通本地存档文件".into());
    }
    let resolved = path.canonicalize().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        let canonical = resolved.to_string_lossy();
        if canonical.starts_with("\\\\?\\UNC\\") {
            return Err("不读取网络共享存档".into());
        }
    }
    let mut bytes = Vec::new();
    File::open(&resolved)
        .map_err(|e| e.to_string())?
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    decode(&bytes)
}
pub fn decode(bytes: &[u8]) -> Result<Value> {
    if bytes.len() > MAX_BYTES {
        return Err("存档超出512KiB上限".into());
    }
    let strict: StrictValue =
        serde_json::from_slice(json_payload(bytes)?).map_err(|e| format!("存档JSON无效：{e}"))?;
    let archive: ArchiveFile =
        serde_json::from_value(strict.0).map_err(|e| format!("存档schema无效：{e}"))?;
    if archive.body.schema != SCHEMA
        || archive.body.version != 1
        || archive.body.scope != SCOPE
        || Uuid::parse_str(&archive.body.archive_id).is_err()
        || archive.body.created_at == 0
        || archive.body.created_at > 253_402_300_799
    {
        return Err("不支持此存档schema、版本或范围".into());
    }
    if archive.sha256.len() != 64 || archive.sha256 != digest(&archive.body)? {
        return Err("存档SHA-256校验失败，文件已损坏或被更改".into());
    }
    validate(&archive.body.snapshot)?;
    let original = archive.body.snapshot;
    let id = format!("archive-{}", archive.body.archive_id);
    let mut recipe = original.recipe.clone();
    let mut profile = original.profile.clone();
    recipe["id"] = json!(id);
    recipe["recipe_revision_id"] = json!(format!("archive-v1:{}", archive.sha256));
    recipe["default_orderable"] = json!(false);
    recipe["needs_serving_configuration"] = json!(true);
    recipe["actual_user_rating"] = Value::Null;
    recipe["preparation_review"] = json!("requires_bartender_review");
    recipe["prediction_profile_id"] = json!(id);
    recipe["source"] = json!({"kind":"imported_snapshot","publisher":"个人酒谱存档（原始出处见快照审计）","url":null,"reference":format!("{} / SHA-256 {}",archive.body.archive_id,archive.sha256),"checked_on":archive.body.created_at.to_string(),"method_provenance":"untrusted_archive_snapshot"});
    profile["recipe_id"] = json!(id);
    profile["measured"] = json!(false);
    profile["status"] = json!("imported_unvalidated");
    profile["note_zh"] = json!(
        "导入的个人预测快照，未核验实测声明；原始来源和预测保留在审计快照。不可作为客人菜单授权。"
    );
    Ok(
        json!({"archive_id":archive.body.archive_id,"sha256":archive.sha256,"target":original.target,"snapshot":original,"personal":{"recipe":recipe,"profile":profile,"created_at":archive.body.created_at,"audit":{"archive_schema":SCHEMA,"archive_version":1,"archive_sha256":archive.sha256,"original_snapshot":original}},"guest_orderable":false,"authority_restored":false}),
    )
}
// Reject duplicate object keys at every depth before typed/schema validation.
struct StrictValue(Value);
impl<'de> Deserialize<'de> for StrictValue {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = StrictValue;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("JSON without duplicate keys")
            }
            fn visit_bool<E: serde::de::Error>(
                self,
                v: bool,
            ) -> std::result::Result<Self::Value, E> {
                Ok(StrictValue(json!(v)))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> std::result::Result<Self::Value, E> {
                Ok(StrictValue(json!(v)))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> std::result::Result<Self::Value, E> {
                Ok(StrictValue(json!(v)))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> std::result::Result<Self::Value, E> {
                serde_json::Number::from_f64(v)
                    .map(|n| StrictValue(Value::Number(n)))
                    .ok_or_else(|| E::custom("non-finite number"))
            }
            fn visit_str<E: serde::de::Error>(
                self,
                v: &str,
            ) -> std::result::Result<Self::Value, E> {
                Ok(StrictValue(json!(v)))
            }
            fn visit_string<E: serde::de::Error>(
                self,
                v: String,
            ) -> std::result::Result<Self::Value, E> {
                Ok(StrictValue(Value::String(v)))
            }
            fn visit_unit<E: serde::de::Error>(self) -> std::result::Result<Self::Value, E> {
                Ok(StrictValue(Value::Null))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut values = vec![];
                while let Some(StrictValue(v)) = seq.next_element()? {
                    values.push(v)
                }
                Ok(StrictValue(Value::Array(values)))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut values = Map::new();
                let mut keys = HashSet::new();
                while let Some(key) = map.next_key::<String>()? {
                    if !keys.insert(key.clone()) {
                        return Err(serde::de::Error::custom("duplicate object key"));
                    }
                    let StrictValue(v) = map.next_value()?;
                    values.insert(key, v);
                }
                Ok(StrictValue(Value::Object(values)))
            }
        }
        d.deserialize_any(Visitor)
    }
}

#[cfg(windows)]
const ARCHIVE_PROGID: &str = "PixelMix.RecipeArchive.2";
#[cfg(windows)]
const LEGACY_ARCHIVE_PROGID: &str = "PixelMix.RecipeArchive.1";
#[cfg(windows)]
// Version the corrected COM contract, not the file format or ProgID. Explorer
// keeps live factories under old CLSIDs; changing their DLL path cannot replace
// an object already loaded. Leave prior CLSID registrations untouched.
const ICON_HANDLER_CLSID: &str = "{81AB84EC-130C-4A8F-84B1-A9C11F10BCCA}";
#[cfg(windows)]
const THUMBNAIL_HANDLER_CLSID: &str = "{34AC24F9-FF06-4610-A459-A49A6E30535D}";
#[cfg(windows)]
const ICON_HANDLER_BYTES: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/pixelmix-icon-handler.dll"));
#[cfg(windows)]
const ARCHIVE_ICON_BYTES: &[u8] = include_bytes!("../icons/icon.ico");

#[cfg(windows)]
fn stable_icon_path(local_data: &Path) -> Result<PathBuf> {
    use std::path::{Component, Prefix};
    // This icon is a per-user Shell resource, not part of a replaceable database,
    // preview directory or test fixture. A content filename also avoids stale icons
    // after a future logo update without overwriting an existing file.
    if !local_data.is_absolute()
        || !matches!(local_data.components().next(), Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_)))
        || local_data
            .components()
            .any(|part| matches!(part, Component::ParentDir))
        || local_data.to_string_lossy().chars().any(char::is_control)
    {
        return Err("LocalAppData不是有效的本机绝对目录，未注册文件图标".into());
    }
    Ok(local_data
        .join("local.pixelmix.workbench")
        .join("file-icons")
        .join(format!(
            "TIMER-{:x}.ico",
            Sha256::digest(ARCHIVE_ICON_BYTES)
        )))
}

#[cfg(windows)]
fn preserve_icon_owner(owners: &[Option<String>]) -> Result<()> {
    if owners.iter().flatten().any(|owner| {
        !owner.is_empty()
            && !owner.eq_ignore_ascii_case(ARCHIVE_PROGID)
            && !owner.eq_ignore_ascii_case(LEGACY_ARCHIVE_PROGID)
    }) {
        return Err(".timermix已有其他应用关联，保留现有关联".into());
    }
    Ok(())
}

#[cfg(windows)]
fn install_icon(icon: &Path) -> Result<bool> {
    std::fs::create_dir_all(icon.parent().ok_or("图标目录无效")?).map_err(|e| e.to_string())?;
    if icon.exists() {
        if std::fs::read(icon).map_err(|e| e.to_string())?.as_slice() != ARCHIVE_ICON_BYTES {
            return Err("专用图标文件已有不同内容，未覆盖".into());
        }
        Ok(false)
    } else {
        let mut out = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(icon)
            .map_err(|e| e.to_string())?;
        out.write_all(ARCHIVE_ICON_BYTES)
            .and_then(|_| out.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[cfg(windows)]
fn handler_path(local_data: &Path) -> Result<PathBuf> {
    // Reuse the strict LocalAppData validation before deriving another resource.
    let icon = stable_icon_path(local_data)?;
    Ok(icon
        .parent()
        .and_then(Path::parent)
        .ok_or("图标处理器目录无效")?
        .join("shell-extensions")
        .join(format!(
            "PixelMixIcon-{:x}.dll",
            Sha256::digest(ICON_HANDLER_BYTES)
        )))
}

#[cfg(windows)]
fn preserve_handler_owner(existing: Option<&str>, expected: &Path) -> Result<()> {
    if let Some(existing) = existing.filter(|value| !value.is_empty()) {
        let previous = Path::new(existing);
        let owned_name = previous
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.strip_prefix("PixelMixIcon-")
                    .and_then(|s| s.strip_suffix(".dll"))
                    .is_some_and(|hash| {
                        hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())
                    })
            });
        // Packaged launchers can redirect a logical LocalAppData file into
        // their package's LocalCache. Accept our earlier logical registration
        // and the same physical resource directory, never an arbitrary DLL.
        let same_directory = previous.parent() == expected.parent()
            || previous
                .canonicalize()
                .ok()
                .zip(expected.canonicalize().ok())
                .is_some_and(|(previous, expected)| previous.parent() == expected.parent());
        if !same_directory || !owned_name {
            return Err("专用COM标识已有其他组件；未覆盖图标处理器".into());
        }
    }
    Ok(())
}

#[cfg(windows)]
fn external_shell_resource_path(path: &Path) -> Result<PathBuf> {
    // GetFinalPathNameByHandle (used by std canonicalize on Windows) resolves
    // MSIX per-file redirection, which Resolve-Path/full-path string expansion
    // does not. Explorer may run outside that package's filesystem view.
    let physical = path
        .canonicalize()
        .map_err(|e| format!("无法解析Shell资源实际路径：{e}"))?;
    let text = physical.to_str().ok_or("Shell资源路径不是Unicode")?;
    let plain = text.strip_prefix(r"\\?\").unwrap_or(text);
    let path = PathBuf::from(plain);
    use std::path::{Component, Prefix};
    if !path.is_absolute()
        || !matches!(path.components().next(), Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_)))
        || plain.chars().any(char::is_control)
        || !path.is_file()
    {
        return Err("Shell资源必须解析为本机普通文件".into());
    }
    Ok(path)
}

#[cfg(windows)]
fn install_handler(path: &Path) -> Result<bool> {
    if path.exists() {
        if std::fs::read(path).map_err(|e| e.to_string())? != ICON_HANDLER_BYTES {
            return Err("图标处理器文件内容不同；未覆盖".into());
        }
        return Ok(false);
    }
    std::fs::create_dir_all(path.parent().ok_or("图标处理器目录无效")?)
        .map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(ICON_HANDLER_BYTES)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(windows)]
fn registry_string(root: &winreg::RegKey, path: &str, name: &str) -> Result<Option<String>> {
    match root.open_subkey(path).and_then(|key| key.get_value(name)) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法安全读取现有文件关联：{error}")),
    }
}

#[cfg(windows)]
fn set_registry_string(key: &winreg::RegKey, name: &str, value: &str) -> Result<bool> {
    if registry_string(key, "", name)?.as_deref() == Some(value) {
        return Ok(false);
    }
    key.set_value(name, &value).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(windows)]
fn shell_default_icon() -> Option<String> {
    use windows_sys::Win32::UI::Shell::{AssocQueryStringW, ASSOCF_NONE, ASSOCSTR_DEFAULTICON};
    let extension: Vec<u16> = ".timermix\0".encode_utf16().collect();
    let mut size = 0;
    unsafe {
        AssocQueryStringW(
            ASSOCF_NONE,
            ASSOCSTR_DEFAULTICON,
            extension.as_ptr(),
            std::ptr::null(),
            std::ptr::null_mut(),
            &mut size,
        );
    }
    if size == 0 || size > 32768 {
        return None;
    }
    let mut value = vec![0; size as usize];
    let result = unsafe {
        AssocQueryStringW(
            ASSOCF_NONE,
            ASSOCSTR_DEFAULTICON,
            extension.as_ptr(),
            std::ptr::null(),
            value.as_mut_ptr(),
            &mut size,
        )
    };
    (result >= 0).then(|| {
        String::from_utf16_lossy(
            &value[..value.iter().position(|c| *c == 0).unwrap_or(value.len())],
        )
    })
}

#[cfg(windows)]
pub fn register_icon(_data_dir: &Path) -> Result<Value> {
    use winreg::{
        enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER},
        RegKey,
    };
    static REGISTRATION: Mutex<()> = Mutex::new(());
    let _guard = REGISTRATION.lock().map_err(|_| "文件图标注册锁异常")?;
    let root = RegKey::predef(HKEY_CURRENT_USER);
    let effective = RegKey::predef(HKEY_CLASSES_ROOT);
    // Respect both the merged machine/user registration and Windows UserChoice.
    // Do not rewrite UserChoice or another application's file type.
    preserve_icon_owner(&[
        registry_string(&effective, ".timermix", "")?,
        registry_string(&root, "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.timermix\\UserChoice", "ProgId")?,
    ])?;
    let local_data =
        std::env::var_os("LOCALAPPDATA").ok_or("无法定位LocalAppData，未注册文件图标")?;
    let icon = stable_icon_path(Path::new(&local_data))?;
    let handler = handler_path(Path::new(&local_data))?;
    // Installation is content-addressed and refuses different existing bytes.
    // Resolve *files*, not just their parent: an MSIX view may merge a real
    // directory with redirected files from LocalCache.
    let mut changed = install_icon(&icon)?;
    changed |= install_handler(&handler)?;
    let external_icon = external_shell_resource_path(&icon)?;
    let external_handler = external_shell_resource_path(&handler)?;
    let handler_key = format!("CLSID\\{ICON_HANDLER_CLSID}\\InprocServer32");
    let thumbnail_key = format!("CLSID\\{THUMBNAIL_HANDLER_CLSID}\\InprocServer32");
    preserve_handler_owner(
        registry_string(&effective, &handler_key, "")?.as_deref(),
        &handler,
    )?;
    preserve_handler_owner(
        registry_string(&effective, &thumbnail_key, "")?.as_deref(),
        &handler,
    )?;
    // The file itself is a standard ICO plus a validated data trailer. %1 lets
    // Shell extract its unique portrait after copying/renaming the file anywhere.
    let icon_value = "%1".to_owned();
    let (classes, _) = root
        .create_subkey("Software\\Classes")
        .map_err(|e| e.to_string())?;
    let (ext, _) = classes
        .create_subkey(".timermix")
        .map_err(|e| e.to_string())?;
    changed |= set_registry_string(&ext, "", ARCHIVE_PROGID)?;
    changed |= set_registry_string(&ext, "Content Type", "application/vnd.timermix.recipe")?;
    let (prog, _) = classes
        .create_subkey(ARCHIVE_PROGID)
        .map_err(|e| e.to_string())?;
    changed |= set_registry_string(&prog, "", "TIMER 个人酒谱快照")?;
    let (default_icon, _) = prog
        .create_subkey("DefaultIcon")
        .map_err(|e| e.to_string())?;
    changed |= set_registry_string(&default_icon, "", &icon_value)?;
    let (com_server, _) = classes
        .create_subkey(&handler_key)
        .map_err(|e| e.to_string())?;
    changed |= set_registry_string(&com_server, "", &external_handler.to_string_lossy())?;
    changed |= set_registry_string(&com_server, "ThreadingModel", "Apartment")?;
    let (thumbnail_server, _) = classes
        .create_subkey(&thumbnail_key)
        .map_err(|e| e.to_string())?;
    changed |= set_registry_string(&thumbnail_server, "", &external_handler.to_string_lossy())?;
    changed |= set_registry_string(&thumbnail_server, "ThreadingModel", "Apartment")?;
    let (per_file_icon, _) = prog
        .create_subkey("shellex\\IconHandler")
        .map_err(|e| e.to_string())?;
    changed |= set_registry_string(&per_file_icon, "", ICON_HANDLER_CLSID)?;
    let (thumbnail, _) = prog
        .create_subkey("shellex\\{E357FCCD-A995-4576-B01F-234630154E96}")
        .map_err(|e| e.to_string())?;
    changed |= set_registry_string(&thumbnail, "", THUMBNAIL_HANDLER_CLSID)?;
    // Keep an already-registered version of our own file type compatible too:
    // existing Shell objects can still resolve through that ProgID even when
    // no UserChoice exists. Never rewrite UserChoice or another app's ProgID.
    let legacy_exists = registry_string(
        &effective,
        &format!("{LEGACY_ARCHIVE_PROGID}\\DefaultIcon"),
        "",
    )?
    .is_some();
    if legacy_exists || registry_string(
        &root,
        "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pixelmix\\UserChoice",
        "ProgId",
    )?
    .is_some_and(|owner| owner.eq_ignore_ascii_case(LEGACY_ARCHIVE_PROGID))
    {
        let (legacy_icon, _) = classes
            .create_subkey(format!("{LEGACY_ARCHIVE_PROGID}\\DefaultIcon"))
            .map_err(|e| e.to_string())?;
        changed |= set_registry_string(&legacy_icon, "", &icon_value)?;
        let (legacy_handler, _) = classes
            .create_subkey(format!("{LEGACY_ARCHIVE_PROGID}\\shellex\\IconHandler"))
            .map_err(|e| e.to_string())?;
        changed |= set_registry_string(&legacy_handler, "", ICON_HANDLER_CLSID)?;
        let (legacy_thumbnail, _) = classes
            .create_subkey(format!("{LEGACY_ARCHIVE_PROGID}\\shellex\\{{E357FCCD-A995-4576-B01F-234630154E96}}"))
            .map_err(|e| e.to_string())?;
        changed |= set_registry_string(&legacy_thumbnail, "", THUMBNAIL_HANDLER_CLSID)?;
    }
    if changed {
        // Complete Shell invalidation before the caller starts native OLE drag.
        // No cache deletion, Explorer restart, shell command, or elevation.
        unsafe {
            windows_sys::Win32::UI::Shell::SHChangeNotify(
                windows_sys::Win32::UI::Shell::SHCNE_ASSOCCHANGED as i32,
                windows_sys::Win32::UI::Shell::SHCNF_IDLIST
                    | windows_sys::Win32::UI::Shell::SHCNF_FLUSH,
                std::ptr::null(),
                std::ptr::null(),
            );
        }
    }
    let resolved = shell_default_icon();
    Ok(
        json!({"registered":true,"scope":"current_user_icon_only","extension":".timermix","progid":ARCHIVE_PROGID,"icon":icon_value,"fallback_icon":external_icon,"embedded_portraits":true,"handler_clsid":ICON_HANDLER_CLSID,"handler_path":external_handler,"logical_handler_path":handler,"resources_use_physical_paths":true,"handler_threading":"Apartment","thumbnail_handler":true,"thumbnail_clsid":THUMBNAIL_HANDLER_CLSID,"thumbnail_stream_initialization":true,"isolation_override":false,"changed":changed,"shell_icon_verified":resolved.as_deref().is_some_and(|value| value.eq_ignore_ascii_case(&icon_value)),"shell_icon":resolved,"open_command_registered":false}),
    )
}
#[cfg(not(windows))]
pub fn register_icon(_data_dir: &Path) -> Result<Value> {
    Ok(json!({"registered":false,"reason":"Windows图标关联仅在Windows可用"}))
}

#[cfg(test)]
mod tests;
