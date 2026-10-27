# Bilingual display resources — 2026-09-21

Production resources live in `product/apps/client/src/`:

- `i18n-messages.json`: explicit Chinese UI phrase → English display dictionary. It is read only; it does not rewrite source data or user state.
- `i18n.tsx`: React context, phrase translation and a React element text boundary. No DOM text replacement, MutationObserver translation or network translation is used. Element values, event handlers and business properties are preserved. `pre`, `code` and `data-i18n="verbatim"` subtrees retain original content. Dynamic UI fragments are indexed by their first character and cached (up to 2048 entries) to avoid repeated full-dictionary scans during slider animation.
- `recipe-english.json` / `recipe-i18n.ts`: display-only English records for all 300 built-in recipes. The helper matches recipe ID, original source URL and a signature of original name, preparation, notes and complete ingredient facts. Changed, imported or unknown content retains its original language. Names, doses, source objects, review status and orderability are never changed by the helper.
- `recipe-quotes.en.json`: 300 original English quotations, distinct from the Chinese quotations. They use the drink's English name and its first two required ingredient names as imagery; they are not attributed to historical people. The generated strings are unique across the 300 built-ins.

The TSV/TXT files here are retained authoring evidence, not runtime data. The authoritative final display resources are the JSON files listed above. Later copy edits may be present in JSON beyond these initial authoring sheets.

## Preparation provenance

112 IBA / notebook recipes: English display is an editorial translation of the existing offline Chinese paraphrase. No external recipe facts or quantities were added.

188 TheCocktailDB recipes: English preparation text is taken from the already retained `product/data/catalog/community-source-records-2026-09-21.json` records. Source links and source review flags remain unchanged. Existing editorial corrections are retained for Amaretto Tea (heat-resistant vessel review), Brigadier (warm mug), Texas Sling (tulip glass and whipped cream), Radler (large batch vessel), Pink Moon (unidentified flowers/leaves are not treated as edible garnish), and Tomato Tang (the quantities form a batch). English source notes retain the other known vessel, unit and serving-count discrepancies. This work does not resolve any outstanding third-party data licensing review.

All garnish strings and notes have English display text. Ingredient quantity notes retain source measure strings and unspecified-unit caveats. Unit conversion is handled separately by `quantity-display.ts`; translated notes are never substituted for physical ServingSpec approval.

## Language boundaries

Chinese remains the default. English names are selected from the catalog's existing `name_en`. The main app persists `settings.language`; owned native recipe/glass windows receive the same language in their payload. Original account names, private notes, order snapshot JSON, model audit JSON and imported free text are not silently rewritten or represented as translated content.

## Validation

2026-09-21: `pnpm --dir product/apps/client test` passed 130 tests, including 8 bilingual tests. `pnpm --dir product/apps/client exec tsc -b` passed. The bilingual tests verify 300 complete guarded display records, all 300 unique English quotations, original data immutability, preservation of private/raw content, and English rendering of the trial component. Native and visual verification are performed by the main task and recorded in `product/BUILD_REPORT.md`.
