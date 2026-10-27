# Domain, catalog and rule-engine implementation

These Rust libraries are production-side logic and do not run the Python reference as an application backend. The unchanged handoff data and reference implementations remain outside `product/`.

## API contract

`pixelmix_domain` is pure code without database or network access:

- `TargetProfile { taste_bps: [u16; 5], sensory_0_10: [f64; 7] }`, with `validate()`.
- `redistribute_bps(anchor: [u16; 5], axis: usize, requested: i32, locked: &[usize]) -> Result<[u16; 5]>`. Use the gesture-start anchor for every move; the result always sums to 10000. Duplicate locks are deduplicated; selecting a locked axis returns an error.
- `allocate(total: u32, weights: &[u32]) -> Result<Vec<u32>>` uses exact integer largest remainders and fixed-axis tie order.
- `match_index(&TargetProfile, &Taste, &Sensory, weight) -> Result<MatchIndex>`; `match_partial` supports omitted sensory axes and missing taste predictions. `MatchIndex { index: Option<f64>, taste_distance: Option<f64>, sensory_distance: Option<f64>, coverage: f64, calibrated: false }` is descriptive distance, never a rating or probability.
- `estimate_abv(&[PhysicalComponent { consumed_ml: Option<f64>, abv_fraction: Option<f64> }], dilution_ml: Option<f64>) -> Result<Value>` preserves unknown retained volumes and dilution. It does not estimate nutrition.
- `render_glass(template, liquid) -> Result<String>` supports eight ASCII-only templates.

`pixelmix_catalog::Catalog` owns one SQLite connection. The Tauri caller should protect it with a mutex, and invoke potentially blocking backup/restore operations off the UI thread.

- `open(path) -> Result<Catalog>` configures WAL, full synchronization, foreign keys, schema version 1 and application ID `PMIX`; validates and transactionally imports 70 revisions only once.
- `catalog_json() -> Result<Value>` returns `{ schema_version, recipes, ingredients, profiles, sources, favorites, ratings, settings, seed_sha256, data_scope, license_notice }`. Each recipe retains every source fact and adds a deterministic `recipe_revision_id: "seed-<16 hex characters>"`.
- `recipe(id) -> Result<Value>` returns the complete recipe plus revision ID.
- `save_setting(key, &Value)` and `load_setting(key) -> Result<Option<Value>>`; `target` uses strict `TargetProfile`, and nested taste/sensory states are independently validated. Settings size is limited to 256 KiB and nesting to 24 levels.
- `set_favorite(recipe_id, enabled)` stores an independent local preference.
- `save_rating(RatingInput) -> Result<Value>`, where `RatingInput` is `{ recipe_id, recipe_revision_id, user_name, score: 1..5, note, tasted_at: Unix seconds, consent, confirmed_tasted }`. The caller must explicitly ask the user to confirm an actual tasting. Consent can be false; it is not fabricated or assumed. An immutable source snapshot is saved with the rating. Seed `actual_user_rating` remains null.
- `backup_to(new_path) -> Result<Value>` uses SQLite online backup and returns actual bytes and SHA-256; existing destinations are rejected.
- `restore_from(path)` validates the backup application/schema/integrity before applying SQLite online restore. The caller should retain a rollback backup before user-requested restore.

`pixelmix_recipe_engine` exposes `generate(&Value) -> Result<Value>` and `generate_typed(&GenerationRequest)`:

```json
{
  "taste_bps": [4000, 5000, 1000, 0, 0],
  "sensory_0_10": [5, 6, 4, 0, 1, 0, 5],
  "inventory": {},
  "excluded_ingredients": [],
  "max_ethanol_ml": 24,
  "maximum_pre_dilution_liquid_ml": 240
}
```

Empty inventory intentionally produces `no_feasible_candidate`. A confirmed inventory row requires actual SKU `abv_fraction`, `available_ml`, `food_grade: true`, `allergens_reviewed: true`; optional `sku_name` and `is_test_fixture` are preserved. Never supply example fixture values as user inventory.

The engine reads and versions `agent/rules.v1.json`, applies a fixed food ingredient whitelist, inventory/exclusion/volume/ethanol checks before ranking, and returns up to eight candidates. Sour and highball dosing comes from the versioned rules and cannot exceed the audited code envelope. The limited spirit-forward template is separately bounded in code. Carbonated mixers are always added after mixing. Unknown ABV is rejected for generation, while missing dilution/nutrition produces null served ABV/kcal. Generated output always has `requires_bartender_review` and `guest_orderable: false`. High salty/umami targets return `nearest_only` and preserve the request.

`apply_model_choice(&request, &choice, model_name) -> Result<Value>` independently regenerates candidates from the captured request, validates exactly `{ candidate_id, name_zh, name_en }`, and copies ingredient doses from its own deterministic candidate. Extra fields, forged candidate IDs, markup/control characters and excessive name lengths are rejected. This function performs no network calls and cannot grant serving approval, tickets, or permissions.

## Validation evidence

Tests are implemented for exact reference cases, 100000 deterministic random taste interactions, 2000 unchanged-Python golden comparisons, eight glass golden comparisons, missing-axis matching, unknown physical facts, seed schema and provenance constraints, SQLite persistence/backup/restore, and untrusted model selection. Suggested commands (the root agent records actual execution and results in `BUILD_REPORT.md`):

```powershell
. .\product\scripts\enter-build-env.ps1
cargo test --manifest-path product/Cargo.toml -p pixelmix-domain -p pixelmix-catalog -p pixelmix-recipe-engine
```

No local model execution or two-device LAN testing is claimed by these library tests. Mock model-choice input proves validation only.

Actual execution on 2026-09-21: root agent reported the initial 16 domain/catalog/engine unit tests passed. After strengthening restored-source verification, this agent ran `cargo test --manifest-path product/Cargo.toml -p pixelmix-catalog`: 5 tests passed, 0 failed, including a forged-backup-metadata test. No test data was written to the user's live application database.

This agent also ran `cargo run --release --manifest-path product/Cargo.toml -p pixelmix-domain --example ranking_bench` with the audited local Windows build environment. Ten warmups and 100 measured iterations produced:

| Dataset | P50 | P95 | Max |
| --- | ---: | ---: | ---: |
| Actual 70 supplied sensory priors | 0.0019 ms | 0.0019 ms | 0.0019 ms |
| Synthetic 10000 records repeating those 70 priors | 0.3804 ms | 0.4045 ms | 0.4864 ms |

This only measures optimized Rust preference matching and sorting. It does not measure UI rendering, IPC, SQLite, model inference, real-world sensory validity, or a collection of 10000 genuinely distinct recipes. The benchmark source is `crates/domain/examples/ranking_bench.rs`.

HostPanel TypeScript validation was attempted with `node product/apps/client/node_modules/typescript/bin/tsc -b product/apps/client/tsconfig.json --pretty false`. The first attempt found the existing `domain.test.ts:11` fixture assertion mismatch (`number[]` versus five-element tuple); the UI agent was notified. HostPanel itself produced no errors in that run. Final integrated verification belongs in the root build report.

After the UI fixture fix and addition of NetworkPanel, the same TypeScript build command was run again by this agent and exited successfully with no diagnostics. This proves typechecking, not remote-device GUI behavior.

## Independent host safety review and native panel

The initial host review confirmed that order acceptance uses an immediate SQLite transaction containing ticket debit, immutable server-built snapshot, stock deduction and outbox event; same request/different payload is rejected, repeated SKU lines are rejected before dose checks, and same-service-date policy grants have a unique constraint. Four findings were sent to the responsible agents:

1. Source snapshots initially accepted an arbitrary `source_id`. Root added the native publishing adapter's catalog/revision binding and overwrites source facts from the real catalog. Generated spec publication is withheld pending its separate reviewed provenance workflow.
2. Failed business transactions originally rolled back session rate counters. The LAN agent is correcting rate accounting outside the business transaction while keeping transaction-time authentication for revoke races.
3. Pair approval originally ran expensive password hashing before authentication. The LAN agent is changing the order to authenticate and inspect the pending request first.
4. Native administration needed authenticated account/pair/SKU/policy lists and a usable retained administrator account ID. The LAN agent added list APIs, and the native panel stores only the nonsecret account ID locally.

`apps/client/src/HostPanel.tsx` and `host-panel.css` provide real native `host_call` operations for administrator bootstrap/login/logout, guest creation/revocation, invitation/approval, constrained SKU JSON editing, explicit serving-spec approval, ticket policies, guest order submission and lookup, and immutable order viewing plus server-confirmed transitions. Sessions and device secrets are kept in component memory; passwords are not stored in browser storage. Pending order requests are persisted by account before submission so retries and app restarts retain the original UUID and payload. The submit button is protected against concurrent clicks. Browser-only preview explicitly disables host administration rather than simulating success. Local use is labeled separately from unverified remote-device operation.

`apps/client/src/NetworkPanel.tsx` is embedded under a separate network disclosure in HostPanel. Listening stays disabled until a signed-in local administrator supplies an explicit private/loopback address and checks the enable control. The panel displays the real returned public certificate identity and its fingerprint; guest connection requires separately entered fingerprint confirmation. Actual transport and certificate verification are delegated to the Rust native adapter. It supports one-time pairing requests, approved guest authentication, host menus/tickets/orders, disconnected-state errors, and immutable request persistence keyed by host ID and account ID. It does not change firewall settings, bypass TLS, or infer successful connectivity from an animation. Guest sessions and passwords are not persisted in WebView storage.

Further transport review found that reusing the persisted certificate after a bind-IP change needed SAN validation before listening. The LAN agent reports adding standard certificate IP validation and an explicit identity-address error, with corresponding tests. A new IP outside the certificate SAN requires explicit new identity/pairing; the client never disables certificate verification to make it work.

## Boundaries

This initial catalog is a personal local installation containing the 10 supplied private-note recipes in addition to the 60 referenced IBA revisions. It is not a public release dataset. A public distribution build must exclude the personal notes, their profiles/source ledger, and embedded private source bytes, and must complete source/license review. No license for IBA content, model weights, fonts, or future assets is asserted here.

Seed fact changes deliberately produce an explicit migration error instead of silently rewriting existing revision identities and attached tasting records. Serving specification approval and host order authority belong to the separate host implementation, not the source catalog.
