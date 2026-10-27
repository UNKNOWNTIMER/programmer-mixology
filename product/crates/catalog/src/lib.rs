//! SQLite catalog and local personal state. This is never a network server.
use pixelmix_domain::{validate_bps, validate_sensory, Sensory, TargetProfile, Taste};
use rusqlite::{params, Connection, DatabaseName, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
    time::Duration,
};

pub const SEED_RECIPES: &str = include_str!("../../../../data/recipes.json");
pub const SEED_INGREDIENTS: &str = include_str!("../../../../data/ingredients.json");
pub const SEED_PROFILES: &str = include_str!("../../../../data/profiles.seed.json");
pub const SEED_SOURCES: &str = include_str!("../../../../data/sources.json");
const SCHEMA: &str = include_str!("../../../../schemas/seed_catalog.schema.json");
pub const EXTENSION: &str = include_str!("../../../data/catalog/iba-completion-2026-09-21.json");
const EXTENSION_SCHEMA: &str = include_str!("../../../contracts/catalog-extension.schema.json");
const EXTENSION_KEY: &str = "catalog_pack:iba-completion-2026-09-21";
pub const COMMUNITY: &str = include_str!("../../../data/catalog/community-188-2026-09-21.json");
const COMMUNITY_SCHEMA: &str = include_str!("../../../contracts/catalog-community.schema.json");
const COMMUNITY_KEY: &str = "catalog_pack:community-188-2026-09-21";
const APP_ID: i64 = 0x504d4958;
pub type Result<T> = std::result::Result<T, CatalogError>;

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Domain(#[from] pixelmix_domain::DomainError),
}
fn invalid(message: impl Into<String>) -> CatalogError {
    CatalogError::Invalid(message.into())
}
pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn revision(recipe: &Value) -> String {
    format!("seed-{}", &sha256(recipe.to_string().as_bytes())[..16])
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RatingInput {
    pub recipe_id: String,
    pub recipe_revision_id: String,
    pub user_name: String,
    pub score: u8,
    pub note: String,
    pub tasted_at: i64,
    pub consent: bool,
    pub confirmed_tasted: bool,
}

pub struct Catalog {
    conn: Connection,
}

impl Catalog {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let mut catalog = Self {
            conn: Connection::open(path)?,
        };
        catalog.configure()?;
        catalog.migrate()?;
        catalog.import_seed()?;
        catalog.import_extension()?;
        catalog.import_community()?;
        Ok(catalog)
    }

    fn configure(&self) -> Result<()> {
        self.conn.busy_timeout(Duration::from_secs(5))?;
        self.conn.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        )?;
        Ok(())
    }

    fn migrate(&mut self) -> Result<()> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;
        let app: i64 = self
            .conn
            .query_row("PRAGMA application_id", [], |r| r.get(0))?;
        if version > 1 || (app != 0 && app != APP_ID) {
            return Err(invalid("Unsupported or foreign catalog database"));
        }
        let tx = self.conn.transaction()?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS recipes(id TEXT PRIMARY KEY, revision_id TEXT NOT NULL UNIQUE, json TEXT NOT NULL CHECK(json_valid(json)));
            CREATE TABLE IF NOT EXISTS ingredients(id TEXT PRIMARY KEY, json TEXT NOT NULL CHECK(json_valid(json)));
            CREATE TABLE IF NOT EXISTS profiles(recipe_id TEXT PRIMARY KEY REFERENCES recipes(id), json TEXT NOT NULL CHECK(json_valid(json)));
            CREATE TABLE IF NOT EXISTS sources(recipe_id TEXT PRIMARY KEY REFERENCES recipes(id), json TEXT NOT NULL CHECK(json_valid(json)));
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, json TEXT NOT NULL CHECK(json_valid(json)));
            CREATE TABLE IF NOT EXISTS favorites(recipe_id TEXT PRIMARY KEY REFERENCES recipes(id));
            CREATE TABLE IF NOT EXISTS ratings(id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL REFERENCES recipes(id), revision_id TEXT NOT NULL,
                score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5), tasted_at INTEGER NOT NULL, json TEXT NOT NULL CHECK(json_valid(json)), snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)));
            CREATE TRIGGER IF NOT EXISTS ratings_immutable BEFORE UPDATE ON ratings BEGIN SELECT RAISE(ABORT,'ratings_are_immutable'); END;
            PRAGMA user_version=1; PRAGMA application_id=1347242328;")?;
        tx.commit()?;
        Ok(())
    }

    fn import_seed(&mut self) -> Result<()> {
        let seed_hash = sha256(SEED_RECIPES.as_bytes());
        let existing: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM metadata WHERE key='seed_sha256'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(existing) = existing {
            if existing != seed_hash {
                return Err(invalid(
                    "Seed changed: an explicit revision migration is required",
                ));
            }
            return self.check_catalog_integrity();
        }
        let recipes: Value = serde_json::from_str(SEED_RECIPES)?;
        let ingredients: Value = serde_json::from_str(SEED_INGREDIENTS)?;
        let profiles: Value = serde_json::from_str(SEED_PROFILES)?;
        let sources: Value = serde_json::from_str(SEED_SOURCES)?;
        validate_seed(&recipes, &ingredients, &profiles, &sources)?;
        let tx = self.conn.transaction()?;
        for row in recipes["recipes"].as_array().unwrap() {
            tx.execute(
                "INSERT INTO recipes(id,revision_id,json) VALUES(?1,?2,?3)",
                params![row["id"].as_str(), revision(row), row.to_string()],
            )?;
        }
        for (table, key, document) in [
            ("ingredients", "id", &ingredients),
            ("profiles", "recipe_id", &profiles),
            ("sources", "recipe_id", &sources),
        ] {
            let array_key = table;
            for row in document[array_key].as_array().unwrap() {
                tx.execute(
                    &format!("INSERT INTO {table}({key},json) VALUES(?1,?2)"),
                    params![row[key].as_str(), row.to_string()],
                )?;
            }
        }
        tx.execute(
            "INSERT INTO metadata(key,value) VALUES('seed_sha256',?1)",
            [seed_hash],
        )?;
        tx.execute(
            "INSERT INTO metadata(key,value) VALUES('data_scope','personal_local_installation')",
            [],
        )?;
        tx.commit()?;
        self.check_catalog_integrity()
    }

    fn check_catalog_integrity(&self) -> Result<()> {
        Self::check_seed_records(&self.conn)
    }

    fn check_seed_records(conn: &Connection) -> Result<()> {
        let extended = extension_installed(conn)?;
        let community = pack_installed(conn, COMMUNITY_KEY, COMMUNITY)?;
        if community && !extended {
            return Err(invalid(
                "Community pack requires the previous immutable IBA pack",
            ));
        }
        let foreign_errors: i64 =
            conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })?;
        if foreign_errors != 0 {
            return Err(invalid("Catalog foreign key integrity failed"));
        }
        // Do not trust a caller-editable metadata hash in a restored SQLite file.
        for ((table, key), document) in [
            ("recipes", "id"),
            ("ingredients", "id"),
            ("profiles", "recipe_id"),
            ("sources", "recipe_id"),
        ]
        .into_iter()
        .zip(catalog_documents_with_community(extended, community)?)
        {
            let expected = document[table]
                .as_array()
                .ok_or_else(|| invalid("Invalid embedded seed"))?;
            let stored_count: i64 =
                conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))?;
            if stored_count != expected.len() as i64 {
                return Err(invalid(format!("Incomplete {table}")));
            }
            for row in expected {
                let stored: String = conn.query_row(
                    &format!("SELECT json FROM {table} WHERE {key}=?1"),
                    [row[key].as_str().unwrap()],
                    |r| r.get(0),
                )?;
                if serde_json::from_str::<Value>(&stored)? != *row {
                    return Err(invalid(format!(
                        "Source facts changed in {table}; explicit revision migration required"
                    )));
                }
                if table == "recipes" {
                    let stored_revision: String = conn.query_row(
                        "SELECT revision_id FROM recipes WHERE id=?1",
                        [row["id"].as_str().unwrap()],
                        |r| r.get(0),
                    )?;
                    if stored_revision != revision(row) {
                        return Err(invalid("Recipe revision hash mismatch"));
                    }
                }
            }
        }
        Ok(())
    }

    /// An immutable, separately hashed pack appends rows. Existing source revisions
    /// and personal records are never updated. Schema v1 tables remain compatible.
    fn import_extension(&mut self) -> Result<()> {
        self.import_pack(EXTENSION_KEY, EXTENSION, false)
    }

    fn import_community(&mut self) -> Result<()> {
        if !extension_installed(&self.conn)? {
            return Err(invalid("Community pack requires IBA pack"));
        }
        self.import_pack(COMMUNITY_KEY, COMMUNITY, true)
    }

    fn import_pack(&mut self, key: &str, contents: &str, community: bool) -> Result<()> {
        self.check_catalog_integrity()?;
        if pack_installed(&self.conn, key, contents)? {
            return Ok(());
        }
        let [recipes, ingredients, profiles, sources] =
            catalog_documents_with_community(true, community)?;
        validate_seed_with_schema(
            &recipes,
            &ingredients,
            &profiles,
            &sources,
            if community {
                COMMUNITY_SCHEMA
            } else {
                EXTENSION_SCHEMA
            },
        )?;
        let pack: Value = serde_json::from_str(contents)?;
        let tx = self.conn.transaction()?;
        for row in pack["recipes"]["recipes"]
            .as_array()
            .ok_or_else(|| invalid("Invalid recipe pack"))?
        {
            tx.execute(
                "INSERT INTO recipes(id,revision_id,json) VALUES(?1,?2,?3)",
                params![row["id"].as_str(), revision(row), row.to_string()],
            )?;
        }
        for (table, key) in [
            ("ingredients", "id"),
            ("profiles", "recipe_id"),
            ("sources", "recipe_id"),
        ] {
            for row in pack[table][table]
                .as_array()
                .ok_or_else(|| invalid("Invalid catalog pack"))?
            {
                tx.execute(
                    &format!("INSERT INTO {table}({key},json) VALUES(?1,?2)"),
                    params![row[key].as_str(), row.to_string()],
                )?;
            }
        }
        tx.execute(
            "INSERT INTO metadata(key,value) VALUES(?1,?2)",
            params![key, sha256(contents.as_bytes())],
        )?;
        // Validate while still in the transaction so a failed insert or verification
        // rolls the complete append back, including its metadata marker.
        Self::check_seed_records(&tx)?;
        tx.commit()?;
        Ok(())
    }

    fn json_rows(&self, table: &str, order: &str) -> Result<Vec<Value>> {
        // Both identifiers are private static call-site constants, never user input.
        let mut query = self
            .conn
            .prepare(&format!("SELECT json FROM {table} ORDER BY {order}"))?;
        let rows = query.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
    }

    pub fn catalog_json(&self) -> Result<Value> {
        let mut recipes = self.json_rows("recipes", "id")?;
        for recipe in &mut recipes {
            recipe["recipe_revision_id"] = json!(revision(recipe));
        }
        let mut settings = BTreeMap::<String, Value>::new();
        let mut query = self
            .conn
            .prepare("SELECT key,json FROM settings ORDER BY key")?;
        for row in query.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (key, text) = row?;
            settings.insert(key, serde_json::from_str(&text)?);
        }
        let mut query = self
            .conn
            .prepare("SELECT recipe_id FROM favorites ORDER BY recipe_id")?;
        let favorites = query
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(
            json!({"schema_version":"0.1.0","recipe_count":recipes.len(),"base_recipe_count":70,
            "catalog_packs":self.installed_packs()?,
            "recipes":recipes,"ingredients":self.json_rows("ingredients","id")?,
            "profiles":self.json_rows("profiles","recipe_id")?,"sources":self.json_rows("sources","recipe_id")?,
            "favorites":favorites,"ratings":self.json_rows("ratings","tasted_at DESC,id")?,"settings":settings,
            "seed_sha256":sha256(SEED_RECIPES.as_bytes()),"data_scope":"personal_local_installation",
            "license_notice":"包含10份个人笔记，仅供本机私人交付。IBA配方事实有来源，引用不等于已获商业许可。"}),
        )
    }

    pub fn recipe(&self, id: &str) -> Result<Value> {
        let text: String = self
            .conn
            .query_row("SELECT json FROM recipes WHERE id=?1", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| invalid("Unknown recipe ID"))?;
        let mut result: Value = serde_json::from_str(&text)?;
        result["recipe_revision_id"] = json!(revision(&result));
        Ok(result)
    }

    pub fn save_setting(&self, key: &str, value: &Value) -> Result<()> {
        if key.is_empty()
            || key.len() > 64
            || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        {
            return Err(invalid("Invalid settings key"));
        }
        if value.to_string().len() > 262_144 {
            return Err(invalid("Settings exceed 256 KiB"));
        }
        if key == "target" {
            serde_json::from_value::<TargetProfile>(value.clone())?.validate()?;
        }
        validate_settings_tree(value, 0)?;
        self.conn.execute("INSERT INTO settings(key,json) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET json=excluded.json",params![key,value.to_string()])?;
        Ok(())
    }
    pub fn load_setting(&self, key: &str) -> Result<Option<Value>> {
        let value: Option<String> = self
            .conn
            .query_row("SELECT json FROM settings WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .optional()?;
        value
            .map(|s| serde_json::from_str(&s).map_err(CatalogError::from))
            .transpose()
    }
    pub fn set_favorite(&self, id: &str, enabled: bool) -> Result<()> {
        self.recipe(id)?;
        if enabled {
            self.conn.execute(
                "INSERT OR IGNORE INTO favorites(recipe_id) VALUES(?1)",
                [id],
            )?;
        } else {
            self.conn
                .execute("DELETE FROM favorites WHERE recipe_id=?1", [id])?;
        }
        Ok(())
    }
    pub fn save_rating(&self, input: RatingInput) -> Result<Value> {
        if !input.confirmed_tasted
            || !(1..=5).contains(&input.score)
            || input.user_name.trim().is_empty()
            || input.user_name.chars().count() > 64
            || input.note.chars().count() > 2000
            || input.tasted_at <= 0
        {
            return Err(invalid("Rating requires an actual tasting confirmation, name, 1–5 score, valid time, and bounded text"));
        }
        let snapshot = self.recipe(&input.recipe_id)?;
        if snapshot["recipe_revision_id"].as_str() != Some(input.recipe_revision_id.as_str()) {
            return Err(invalid("Rating recipe revision mismatch"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let mut rating = serde_json::to_value(&input)?;
        rating["id"] = json!(id);
        rating["kind"] = json!("actual_user_tasting");
        self.conn.execute("INSERT INTO ratings(id,recipe_id,revision_id,score,tasted_at,json,snapshot_json) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![id,input.recipe_id,input.recipe_revision_id,input.score,input.tasted_at,rating.to_string(),snapshot.to_string()])?;
        Ok(rating)
    }

    /// SQLite online backup includes WAL-committed records and does not copy a torn file.
    pub fn backup_to(&self, path: impl AsRef<Path>) -> Result<Value> {
        let path = path.as_ref();
        if path.exists() {
            return Err(invalid(
                "Backup destination already exists; choose a new file",
            ));
        }
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        self.conn.backup(DatabaseName::Main, path, None)?;
        let bytes = std::fs::read(path)?;
        Ok(
            json!({"path":path.to_string_lossy(),"sha256":sha256(&bytes),"bytes":bytes.len(),"status":"backed_up"}),
        )
    }

    pub fn restore_from(&mut self, path: impl AsRef<Path>) -> Result<()> {
        let source = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let integrity: String = source.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        let app_id: i64 = source.query_row("PRAGMA application_id", [], |r| r.get(0))?;
        let version: i64 = source.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if integrity != "ok" || app_id != APP_ID || version != 1 {
            return Err(invalid(
                "Backup integrity, application ID, or schema version mismatch",
            ));
        }
        let hash: String = source.query_row(
            "SELECT value FROM metadata WHERE key='seed_sha256'",
            [],
            |r| r.get(0),
        )?;
        if hash != sha256(SEED_RECIPES.as_bytes()) {
            return Err(invalid("Backup catalog revision is incompatible"));
        }
        Self::check_seed_records(&source)?;
        // Validate personal inputs before replacing the live database.
        let mut query = source.prepare("SELECT json FROM settings")?;
        for row in query.query_map([], |r| r.get::<_, String>(0))? {
            validate_settings_tree(&serde_json::from_str(&row?)?, 0)?;
        }
        drop(query);
        let backup = rusqlite::backup::Backup::new(&source, &mut self.conn)?;
        backup.run_to_completion(64, Duration::from_millis(5), None)?;
        drop(backup);
        self.configure()?;
        // Old, valid 70-recipe backups remain restorable. Reapply the immutable
        // append after restoration without changing their preferences or reviews.
        self.import_extension()?;
        self.import_community()
    }

    fn installed_packs(&self) -> Result<Vec<Value>> {
        let mut packs = Vec::new();
        for (key, contents, id, added) in [
            (EXTENSION_KEY, EXTENSION, "iba-completion-2026-09-21", 42),
            (COMMUNITY_KEY, COMMUNITY, "community-188-2026-09-21", 188),
        ] {
            if pack_installed(&self.conn, key, contents)? {
                packs.push(
                    json!({"id":id,"sha256":sha256(contents.as_bytes()),"added_recipes":added}),
                );
            }
        }
        Ok(packs)
    }
}

fn extension_installed(conn: &Connection) -> Result<bool> {
    pack_installed(conn, EXTENSION_KEY, EXTENSION)
}

fn pack_installed(conn: &Connection, key: &str, contents: &str) -> Result<bool> {
    let marker: Option<String> = conn
        .query_row("SELECT value FROM metadata WHERE key=?1", [key], |r| {
            r.get(0)
        })
        .optional()?;
    match marker {
        None => Ok(false),
        Some(value) if value == sha256(contents.as_bytes()) => Ok(true),
        Some(_) => Err(invalid(
            "Catalog extension changed: explicit revision migration required",
        )),
    }
}

fn catalog_documents_with_community(extended: bool, community: bool) -> Result<[Value; 4]> {
    let mut documents = catalog_documents(extended)?;
    if community {
        if !extended {
            return Err(invalid("Community pack requires IBA pack"));
        }
        let pack: Value = serde_json::from_str(COMMUNITY)?;
        for (document, table) in
            documents
                .iter_mut()
                .zip(["recipes", "ingredients", "profiles", "sources"])
        {
            document[table]
                .as_array_mut()
                .ok_or_else(|| invalid("Invalid base catalog"))?
                .extend(
                    pack[table][table]
                        .as_array()
                        .ok_or_else(|| invalid("Invalid community pack"))?
                        .iter()
                        .cloned(),
                );
        }
        documents[0]["recipe_count"] = json!(documents[0]["recipes"].as_array().unwrap().len());
    }
    Ok(documents)
}

fn catalog_documents(extended: bool) -> Result<[Value; 4]> {
    let mut documents: [Value; 4] = [
        serde_json::from_str(SEED_RECIPES)?,
        serde_json::from_str(SEED_INGREDIENTS)?,
        serde_json::from_str(SEED_PROFILES)?,
        serde_json::from_str(SEED_SOURCES)?,
    ];
    if extended {
        let pack: Value = serde_json::from_str(EXTENSION)?;
        for (document, table) in
            documents
                .iter_mut()
                .zip(["recipes", "ingredients", "profiles", "sources"])
        {
            document[table]
                .as_array_mut()
                .ok_or_else(|| invalid("Invalid base catalog"))?
                .extend(
                    pack[table][table]
                        .as_array()
                        .ok_or_else(|| invalid("Invalid catalog pack"))?
                        .iter()
                        .cloned(),
                );
        }
        documents[0]["recipe_count"] = json!(documents[0]["recipes"].as_array().unwrap().len());
    }
    Ok(documents)
}

fn validate_settings_tree(value: &Value, depth: usize) -> Result<()> {
    if depth > 24 {
        return Err(invalid("Settings nesting limit exceeded"));
    }
    if let Some(object) = value.as_object() {
        for (key, value) in object {
            if key == "taste_bps" || key == "taste" {
                let taste: Taste = serde_json::from_value(value.clone())?;
                validate_bps(&taste)?;
            }
            if key == "sensory_0_10" || key == "sensory" {
                let sensory: Sensory = serde_json::from_value(value.clone())?;
                validate_sensory(&sensory)?;
            }
            validate_settings_tree(value, depth + 1)?;
        }
    } else if let Some(array) = value.as_array() {
        for item in array {
            validate_settings_tree(item, depth + 1)?;
        }
    }
    Ok(())
}

/// Draft 2020-12 schema validation plus relational and provenance constraints.
pub fn validate_seed(
    recipes: &Value,
    ingredients: &Value,
    profiles: &Value,
    sources: &Value,
) -> Result<()> {
    validate_seed_with_schema(recipes, ingredients, profiles, sources, SCHEMA)
}

fn validate_seed_with_schema(
    recipes: &Value,
    ingredients: &Value,
    profiles: &Value,
    sources: &Value,
    schema: &str,
) -> Result<()> {
    let schema: Value = serde_json::from_str(schema)?;
    let validator = jsonschema::JSONSchema::options()
        .with_draft(jsonschema::Draft::Draft202012)
        .compile(&schema)
        .map_err(|e| invalid(e.to_string()))?;
    if let Err(errors) = validator.validate(recipes) {
        return Err(invalid(
            errors
                .take(8)
                .map(|e| format!("{}: {}", e.instance_path, e))
                .collect::<Vec<_>>()
                .join("; "),
        ));
    }
    let rows = recipes["recipes"]
        .as_array()
        .ok_or_else(|| invalid("Recipe array required"))?;
    if recipes["recipe_count"].as_u64() != Some(rows.len() as u64) {
        return Err(invalid("Recipe count mismatch"));
    }
    let ingredient_rows = ingredients["ingredients"]
        .as_array()
        .ok_or_else(|| invalid("Ingredient array required"))?;
    let ids: HashSet<_> = ingredient_rows
        .iter()
        .filter_map(|r| r["id"].as_str())
        .collect();
    if ids.len() != ingredient_rows.len() {
        return Err(invalid("Duplicate or invalid ingredient ID"));
    }
    let recipe_ids: HashSet<_> = rows.iter().filter_map(|r| r["id"].as_str()).collect();
    if recipe_ids.len() != rows.len() {
        return Err(invalid("Duplicate recipe ID"));
    }
    for recipe in rows {
        for ingredient in recipe["ingredients"].as_array().unwrap() {
            if !ids.contains(ingredient["ingredient_id"].as_str().unwrap()) {
                return Err(invalid("Unknown ingredient reference"));
            }
            if let Some(range) = ingredient["quantity_range"].as_array() {
                if range[0].as_f64() > range[1].as_f64() {
                    return Err(invalid("Reversed quantity range"));
                }
            }
        }
        let source = &recipe["source"];
        if source["kind"] == "official_recipe"
            && !source["url"]
                .as_str()
                .is_some_and(|u| u.starts_with("https://iba-world.com/"))
        {
            return Err(invalid("Official seed source URL missing"));
        }
        if source["kind"] == "community_recipe" {
            let id = recipe["id"]
                .as_str()
                .unwrap_or("")
                .strip_prefix("cdb_")
                .unwrap_or("");
            if id.is_empty()
                || !id.bytes().all(|c| c.is_ascii_digit())
                || source["publisher"] != "TheCocktailDB"
                || source["url"] != format!("https://www.thecocktaildb.com/drink/{id}")
            {
                return Err(invalid(
                    "Community recipe must match its canonical publisher and source ID",
                ));
            }
        }
    }
    for (document, array_name) in [(profiles, "profiles"), (sources, "sources")] {
        let records = document[array_name]
            .as_array()
            .ok_or_else(|| invalid(format!("{array_name} array required")))?;
        let references: HashSet<_> = records
            .iter()
            .filter_map(|r| r["recipe_id"].as_str())
            .collect();
        if references != recipe_ids || records.len() != rows.len() {
            return Err(invalid(format!(
                "{array_name} must reference every recipe exactly once"
            )));
        }
    }
    for profile in profiles["profiles"].as_array().unwrap() {
        let taste: Taste = serde_json::from_value(profile["taste_preference_bps"].clone())?;
        let sensory: Sensory = serde_json::from_value(profile["sensory_0_10"].clone())?;
        validate_bps(&taste)?;
        validate_sensory(&sensory)?;
        if profile["measured"] != false || profile["status"] != "heuristic_unvalidated" {
            return Err(invalid("Seed prior may not masquerade as measured data"));
        }
    }
    for row in sources["sources"].as_array().unwrap() {
        let recipe = rows.iter().find(|r| r["id"] == row["recipe_id"]).unwrap();
        let mut source = row.clone();
        source.as_object_mut().unwrap().remove("recipe_id");
        if source != recipe["source"] {
            return Err(invalid("Source ledger differs from recipe provenance"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imports_300_with_unknown_facts_and_reopens() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("catalog.sqlite");
        let c = Catalog::open(&path).unwrap();
        let data = c.catalog_json().unwrap();
        assert_eq!(data["recipes"].as_array().unwrap().len(), 300);
        let pack: Value = serde_json::from_str(COMMUNITY).unwrap();
        assert_eq!(
            data["ingredients"].as_array().unwrap().len(),
            149 + pack["ingredients"]["ingredients"].as_array().unwrap().len()
        );
        assert!(data["ratings"].as_array().unwrap().is_empty());
        assert!(data["recipes"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["actual_user_rating"].is_null() && r["default_orderable"] == false));
        assert!(data["ingredients"]
            .as_array()
            .unwrap()
            .iter()
            .all(|i| i["abv_fraction"].is_null() && i["kcal_per_100ml"].is_null()));
        drop(c);
        assert_eq!(
            Catalog::open(path).unwrap().catalog_json().unwrap()["recipes"],
            data["recipes"]
        );
    }
    #[test]
    fn preferences_favorites_and_real_rating_persist() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("catalog.sqlite");
        let c = Catalog::open(&path).unwrap();
        c.set_favorite("iba_alexander", true).unwrap();
        c.save_setting(
            "target",
            &json!({"taste_bps":[2000,2000,2000,2000,2000],"sensory_0_10":[5,5,5,5,5,5,5]}),
        )
        .unwrap();
        assert!(c
            .save_setting(
                "target",
                &json!({"taste_bps":[1,2,3,4,5],"sensory_0_10":[5,5,5,5,5,5,5]})
            )
            .is_err());
        let recipe = c.recipe("iba_alexander").unwrap();
        let mut input = RatingInput {
            recipe_id: "iba_alexander".into(),
            recipe_revision_id: recipe["recipe_revision_id"].as_str().unwrap().into(),
            user_name: "local test".into(),
            score: 4,
            note: "test fixture only".into(),
            tasted_at: 1,
            consent: false,
            confirmed_tasted: false,
        };
        assert!(c.save_rating(input.clone()).is_err());
        input.confirmed_tasted = true;
        c.save_rating(input.clone()).unwrap();
        input.recipe_revision_id = "other".into();
        assert!(c.save_rating(input).is_err());
        drop(c);
        let data = Catalog::open(&path).unwrap().catalog_json().unwrap();
        assert_eq!(data["favorites"], json!(["iba_alexander"]));
        assert_eq!(data["ratings"].as_array().unwrap().len(), 1);
        assert!(data["recipes"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["actual_user_rating"].is_null()));
    }
    #[test]
    fn backup_restores_committed_state_and_rejects_foreign_database() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = Catalog::open(dir.path().join("catalog.sqlite")).unwrap();
        c.set_favorite("iba_alexander", true).unwrap();
        let backup = dir.path().join("backup.sqlite");
        let receipt = c.backup_to(&backup).unwrap();
        assert_eq!(receipt["sha256"].as_str().unwrap().len(), 64);
        c.set_favorite("iba_alexander", false).unwrap();
        c.restore_from(&backup).unwrap();
        assert_eq!(
            c.catalog_json().unwrap()["favorites"],
            json!(["iba_alexander"])
        );
        let foreign = dir.path().join("foreign.sqlite");
        drop(Connection::open(&foreign).unwrap());
        assert!(c.restore_from(foreign).is_err());
        assert!(c.backup_to(backup).is_err());
    }
    #[test]
    fn strict_schema_rejects_extra_fields_and_unknown_ingredients() {
        let mut recipes: Value = serde_json::from_str(SEED_RECIPES).unwrap();
        let ingredients = serde_json::from_str(SEED_INGREDIENTS).unwrap();
        let profiles = serde_json::from_str(SEED_PROFILES).unwrap();
        let sources = serde_json::from_str(SEED_SOURCES).unwrap();
        recipes["recipes"][0]["model_command"] = json!("execute");
        assert!(validate_seed(&recipes, &ingredients, &profiles, &sources).is_err());
        recipes["recipes"][0]
            .as_object_mut()
            .unwrap()
            .remove("model_command");
        recipes["recipes"][0]["ingredients"][0]["ingredient_id"] = json!("unknown");
        assert!(validate_seed(&recipes, &ingredients, &profiles, &sources).is_err());
    }
    #[test]
    fn forged_backup_metadata_does_not_override_source_facts() {
        let dir = tempfile::tempdir().unwrap();
        let mut catalog = Catalog::open(dir.path().join("catalog.sqlite")).unwrap();
        let backup = dir.path().join("backup.sqlite");
        catalog.backup_to(&backup).unwrap();
        let altered = Connection::open(&backup).unwrap();
        altered.execute("UPDATE recipes SET json=json_set(json,'$.ingredients[0].quantity',9999) WHERE id='iba_alexander'",[]).unwrap();
        drop(altered);
        assert!(catalog.restore_from(&backup).is_err());
        assert_eq!(
            catalog.recipe("iba_alexander").unwrap()["ingredients"][0]["quantity"],
            30
        );
    }

    fn original_seventy(path: &Path) -> Catalog {
        let mut c = Catalog {
            conn: Connection::open(path).unwrap(),
        };
        c.configure().unwrap();
        c.migrate().unwrap();
        c.import_seed().unwrap();
        assert_eq!(
            c.conn
                .query_row("SELECT COUNT(*) FROM recipes", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            70
        );
        c
    }

    #[test]
    fn upgrade_from_original_70_preserves_revisions_reviews_and_personal_state() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("original.sqlite");
        let old = original_seventy(&path);
        old.set_favorite("iba_negroni", true).unwrap();
        old.save_setting("ui_state",&json!({"target":{"taste_bps":[3000,2000,3000,1000,1000],"sensory_0_10":[1,2,3,4,5,6,7]}})).unwrap();
        let before = old.recipe("iba_negroni").unwrap();
        let rating = old
            .save_rating(RatingInput {
                recipe_id: "iba_negroni".into(),
                recipe_revision_id: before["recipe_revision_id"].as_str().unwrap().into(),
                user_name: "migration fixture".into(),
                score: 4,
                note: "fixture".into(),
                tasted_at: 1,
                consent: false,
                confirmed_tasted: true,
            })
            .unwrap();
        let snapshot: String = old
            .conn
            .query_row("SELECT snapshot_json FROM ratings", [], |r| r.get(0))
            .unwrap();
        drop(old);
        let upgraded = Catalog::open(&path).unwrap();
        assert_eq!(upgraded.recipe("iba_negroni").unwrap(), before);
        let data = upgraded.catalog_json().unwrap();
        assert_eq!(data["recipe_count"], 300);
        assert_eq!(data["favorites"], json!(["iba_negroni"]));
        assert_eq!(data["ratings"], json!([rating]));
        assert_eq!(
            data["settings"]["ui_state"]["target"]["taste_bps"],
            json!([3000, 2000, 3000, 1000, 1000])
        );
        assert_eq!(
            upgraded
                .conn
                .query_row("SELECT snapshot_json FROM ratings", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            snapshot
        );
        drop(upgraded);
        assert_eq!(
            Catalog::open(&path).unwrap().catalog_json().unwrap()["recipes"],
            data["recipes"]
        );
    }

    #[test]
    fn original_70_backup_restores_and_reapplies_extension() {
        let dir = tempfile::tempdir().unwrap();
        let old = original_seventy(&dir.path().join("original.sqlite"));
        old.set_favorite("iba_negroni", true).unwrap();
        let backup = dir.path().join("v0.1-backup.sqlite");
        old.backup_to(&backup).unwrap();
        let mut current = Catalog::open(dir.path().join("current.sqlite")).unwrap();
        current.set_favorite("iba_zombie", true).unwrap();
        current.restore_from(&backup).unwrap();
        let data = current.catalog_json().unwrap();
        assert_eq!(data["recipe_count"], 300);
        assert_eq!(data["favorites"], json!(["iba_negroni"]));
        assert!(current.recipe("iba_zombie").is_ok());
    }

    #[test]
    fn interrupted_append_rolls_back_all_rows_and_marker_then_retries() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = original_seventy(&dir.path().join("original.sqlite"));
        c.conn.execute_batch("CREATE TRIGGER fail_extension BEFORE INSERT ON ingredients WHEN NEW.id='falernum' BEGIN SELECT RAISE(ABORT,'injected_failure'); END;").unwrap();
        assert!(c.import_extension().is_err());
        assert!(!extension_installed(&c.conn).unwrap());
        c.check_catalog_integrity().unwrap();
        assert_eq!(
            c.conn
                .query_row("SELECT COUNT(*) FROM recipes", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            70
        );
        c.conn.execute_batch("DROP TRIGGER fail_extension").unwrap();
        c.import_extension().unwrap();
        c.import_extension().unwrap();
        assert_eq!(c.catalog_json().unwrap()["recipe_count"], 112);
    }

    #[test]
    fn extension_tampering_and_conflicting_rows_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("catalog.sqlite");
        let c = Catalog::open(&path).unwrap();
        c.conn.execute("UPDATE sources SET json=json_set(json,'$.url','https://example.invalid') WHERE recipe_id='iba_zombie'",[]).unwrap();
        drop(c);
        assert!(Catalog::open(&path).is_err());
        let mut old = original_seventy(&dir.path().join("conflict.sqlite"));
        old.conn
            .execute(
                "INSERT INTO ingredients(id,json) VALUES('falernum','{}')",
                [],
            )
            .unwrap();
        assert!(old.import_extension().is_err());
        assert!(!extension_installed(&old.conn).unwrap());
    }

    #[test]
    fn browser_pack_matches_native_and_ambiguous_source_units_remain_unknown() {
        let documents = catalog_documents_with_community(true, true).unwrap();
        validate_seed_with_schema(
            &documents[0],
            &documents[1],
            &documents[2],
            &documents[3],
            COMMUNITY_SCHEMA,
        )
        .unwrap();
        for (document, table, text) in [
            (
                &documents[0],
                "recipes",
                include_str!("../../../apps/client/public/seed/recipes.json"),
            ),
            (
                &documents[1],
                "ingredients",
                include_str!("../../../apps/client/public/seed/ingredients.json"),
            ),
            (
                &documents[2],
                "profiles",
                include_str!("../../../apps/client/public/seed/profiles.seed.json"),
            ),
            (
                &documents[3],
                "sources",
                include_str!("../../../apps/client/public/seed/sources.json"),
            ),
        ] {
            assert_eq!(
                document[table],
                serde_json::from_str::<Value>(text).unwrap()[table]
            );
        }
        let recipes = documents[0]["recipes"].as_array().unwrap();
        let tiki = recipes.iter().find(|r| r["id"] == "iba_iba_tiki").unwrap();
        assert!(tiki["ingredients"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|i| i["unit"] == "unknown")
            .all(|i| i["quantity"].is_null()));
        let maine = recipes
            .iter()
            .find(|r| r["id"] == "iba_remember_the_maine")
            .unwrap();
        let rinse = maine["ingredients"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["stage"] == "rinse")
            .unwrap();
        assert_eq!(rinse["quantity"], 7.5);
        assert!(rinse["retained_ml"].is_null());
        let side = recipes
            .iter()
            .find(|r| r["id"] == "iba_porn_star_martini")
            .unwrap();
        assert!(side["ingredients"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["stage"] == "side" && i["quantity"] == 50));
    }

    #[test]
    fn community_upgrade_and_112_backup_preserve_all_previous_revisions_and_review_snapshots() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old112.sqlite");
        let mut old = original_seventy(&path);
        old.import_extension().unwrap();
        let before = old.catalog_json().unwrap();
        old.set_favorite("iba_zombie", true).unwrap();
        old.save_setting("catalog_upgrade_fixture", &json!({"selected":"iba_zombie"}))
            .unwrap();
        let reviewed = old.recipe("iba_zombie").unwrap();
        old.save_rating(RatingInput {
            recipe_id: "iba_zombie".into(),
            recipe_revision_id: reviewed["recipe_revision_id"].as_str().unwrap().into(),
            user_name: "migration test fixture".into(),
            score: 3,
            note: "fixture only".into(),
            tasted_at: 1,
            consent: false,
            confirmed_tasted: true,
        })
        .unwrap();
        let review: String = old
            .conn
            .query_row("SELECT snapshot_json FROM ratings", [], |r| r.get(0))
            .unwrap();
        let backup = dir.path().join("112-backup.sqlite");
        old.backup_to(&backup).unwrap();
        drop(old);
        let mut current = Catalog::open(&path).unwrap();
        assert_eq!(current.catalog_json().unwrap()["recipe_count"], 300);
        for recipe in before["recipes"].as_array().unwrap() {
            assert_eq!(
                current.recipe(recipe["id"].as_str().unwrap()).unwrap(),
                *recipe
            );
        }
        current.set_favorite("cdb_15200", true).unwrap();
        current.restore_from(&backup).unwrap();
        let data = current.catalog_json().unwrap();
        assert_eq!(data["recipe_count"], 300);
        assert_eq!(data["favorites"], json!(["iba_zombie"]));
        assert_eq!(
            data["settings"]["catalog_upgrade_fixture"]["selected"],
            "iba_zombie"
        );
        assert_eq!(
            current
                .conn
                .query_row("SELECT snapshot_json FROM ratings", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            review
        );
        current.import_community().unwrap();
        assert_eq!(current.catalog_json().unwrap()["recipe_count"], 300);
    }

    #[test]
    fn interrupted_community_append_rolls_back_then_retries_without_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = original_seventy(&dir.path().join("old.sqlite"));
        c.import_extension().unwrap();
        let before = c.catalog_json().unwrap();
        c.conn.execute_batch("CREATE TRIGGER fail_community BEFORE INSERT ON profiles WHEN NEW.recipe_id='cdb_15200' BEGIN SELECT RAISE(ABORT,'injected_community_failure'); END;").unwrap();
        assert!(c.import_community().is_err());
        assert!(!pack_installed(&c.conn, COMMUNITY_KEY, COMMUNITY).unwrap());
        assert_eq!(c.catalog_json().unwrap(), before);
        c.check_catalog_integrity().unwrap();
        c.conn.execute_batch("DROP TRIGGER fail_community").unwrap();
        c.import_community().unwrap();
        c.import_community().unwrap();
        assert_eq!(c.catalog_json().unwrap()["recipe_count"], 300);
    }

    #[test]
    fn community_forged_source_or_marker_is_rejected() {
        let mut documents = catalog_documents_with_community(true, true).unwrap();
        documents[0]["recipes"][112]["source"]["url"] =
            json!("https://www.thecocktaildb.com.evil.invalid/drink/15200");
        assert!(validate_seed_with_schema(
            &documents[0],
            &documents[1],
            &documents[2],
            &documents[3],
            COMMUNITY_SCHEMA
        )
        .is_err());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("catalog.sqlite");
        let c = Catalog::open(&path).unwrap();
        c.conn
            .execute(
                "UPDATE metadata SET value='forged' WHERE key=?1",
                [COMMUNITY_KEY],
            )
            .unwrap();
        drop(c);
        assert!(Catalog::open(&path).is_err());
    }
}
