export type Taste = [number, number, number, number, number];
export type Sensory = [number, number, number, number, number, number, number];
export interface Target { taste_bps: Taste; sensory_0_10: Sensory }
export interface RecipeIngredient { ingredient_id: string; quantity: number | null; quantity_range?: [number, number]; unit: string; optional: boolean; stage: string; quantity_note: string | null; allowed_alternatives: string[] }
export interface Source { recipe_id?: string; kind: string; publisher: string; url: string | null; reference: string; checked_on: string; method_provenance: string }
export interface Recipe { id: string; recipe_revision_id?: string; name_zh: string; name_en: string; variant: string; family: string; glass_template: string; method: string; ingredients: RecipeIngredient[]; steps_zh: string[]; garnish_zh: string; notes_zh: string; source: Source; preparation_review: string; default_orderable: boolean; needs_serving_configuration: boolean; prediction_profile_id: string }
export interface Ingredient { id: string; name_zh: string; name_en: string; role: string; potential_allergens: string[]; abv_fraction: number | null; kcal_per_100ml: number | null }
export interface Profile { recipe_id: string; taste_preference_bps: Taste; sensory_0_10: Sensory; taste_intensity_0_10: Taste|null; status: string; measured: boolean; note_zh: string }
export interface DlcGroup { id:string; name_zh:string; name_en:string; author:string; version:string; recipe_ids:string[]; source_sha256:string; appendix?:{title_zh:string;text_zh:string}[] }
export interface Catalog { schema_version: string; recipes: Recipe[]; ingredients: Ingredient[]; profiles: Profile[]; sources: Source[]; seed_sha256?: string; dlc_groups?:DlcGroup[] }
export interface Review { id: string; recipe_id: string; recipe_revision_id: string; user_name: string; score: number; note: string; tasted_at: string; consent: boolean; snapshot: Recipe }
export interface GeneratedTrial { recipe:Recipe;profile:Profile;created_at:string;audit:Record<string,unknown> }
export interface ArchiveQueueEntry { id:string; archiveId:string; sha256:string; importedAt:string; personal:GeneratedTrial; target:Target }
export interface UserState { archiveQueue?:ArchiveQueueEntry[]; generatedTrials?:GeneratedTrial[]; trialInventory?: Record<string,import('./TrialPanel').StockSku>; version: 1; selected: string; target: Target; locked: number[]; favorites: string[]; reviews: Review[]; inventory: string[]; excluded: string[]; inventoryOnly: boolean; settings: { reducedMotion: boolean; fontScale: number; aiMode?:boolean; startupAnimation?:boolean; language?:'zh'|'en' }; drafts: { id: string; created_at: string; recipe: Recipe; target: Target }[] }


