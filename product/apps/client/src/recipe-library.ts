import { invoke } from '@tauri-apps/api/core';
import { native } from './bridge';
import { filterRecipes } from './domain';
import type { Catalog, Profile, Recipe, RecipeIngredient, Sensory, Taste, UserState } from './types';

export interface RecipeDraft {
  name_zh:string; name_en:string; family:string; glass_template:string; method:string;
  ingredients:RecipeIngredient[]; steps_zh:string[]; garnish_zh:string; notes_zh:string;
  source_url:string|null; taste_bps:Taste; sensory_0_10:Sensory;
}
export interface LibraryEntry { recipe:Recipe; profile:Profile; created_at:string; updated_at:string; import_provenance?:{archive_id:string;sha256:string;imported_at:string;original_snapshot:import('./archive-bridge').ArchiveSnapshot} }
export interface LibraryState { version:1; revision:number; custom:LibraryEntry[]; hidden:string[]; deleted:string[]; disabled_groups?:string[] }
export type LibraryAction = { action:'create'|'update'|'hide'|'show'|'delete'|'restore'; id?:string; draft?:RecipeDraft } | {action:'set_group_enabled';id:string;enabled:boolean};
export type LibraryScope = 'visible'|'custom'|'hidden'|'deleted';
export function emptyLibrary():LibraryState { return {version:1,revision:0,custom:[],hidden:[],deleted:[]}; }

export async function readLibrary():Promise<LibraryState> {
  return native ? invoke('recipe_library_get') : emptyLibrary();
}
export async function writeLibrary(state:LibraryState,action:LibraryAction):Promise<LibraryState> {
  if(!native)throw new Error('请在桌面应用中管理本机酒谱 / Library management requires the desktop app');
  return invoke('recipe_library_apply',{request:{expected_revision:state.revision,...action}});
}
export async function importLibraryArchive(state:LibraryState,path:string):Promise<{library:LibraryState;added_id:string}> {
  if(!native)throw new Error('请在桌面应用中导入酒谱 / Recipe import requires the desktop app');
  return invoke('recipe_library_import',{request:{expected_revision:state.revision,path}});
}
/** Keep the immutable source catalog intact; personal edits replace only their own overlay entry. */
export function combineCatalog(base:Catalog,library:LibraryState):Catalog {
  return {...base,recipes:[...base.recipes,...library.custom.map(e=>e.recipe)],profiles:[...base.profiles,...library.custom.map(e=>e.profile)],sources:[...base.sources,...library.custom.map(e=>e.recipe.source)]};
}
export function visibleCatalog(catalog:Catalog,library:LibraryState):Catalog {
  const blocked=new Set([...library.hidden,...library.deleted,...disabledDlcRecipeIds(catalog,library)]);
  return {...catalog,recipes:catalog.recipes.filter(r=>!blocked.has(r.id)),profiles:catalog.profiles.filter(p=>!blocked.has(p.recipe_id))};
}
export function disabledDlcRecipeIds(catalog:Catalog,library:LibraryState):string[] {
  const disabled=new Set(library.disabled_groups||[]);
  return (catalog.dlc_groups||[]).filter(group=>disabled.has(group.id)).flatMap(group=>group.recipe_ids);
}
/** Hidden/trash/custom management must stay reachable even with restrictive inventory settings. */
export function libraryRecipes(catalog:Catalog,library:LibraryState,scope:LibraryScope,search:string,state:UserState,favoritesOnly=false):Recipe[] {
  const hidden=new Set(library.hidden),deleted=new Set(library.deleted),custom=new Set([...library.custom.map(e=>e.recipe.id),...(catalog.dlc_groups||[]).flatMap(group=>group.recipe_ids)]),disabled=new Set(disabledDlcRecipeIds(catalog,library));
  const recipes=catalog.recipes.filter(r=>scope==='deleted'?deleted.has(r.id):scope==='hidden'?hidden.has(r.id)&&!deleted.has(r.id):scope==='custom'?custom.has(r.id)&&!deleted.has(r.id):!hidden.has(r.id)&&!deleted.has(r.id)&&!disabled.has(r.id));
  return filterRecipes({...catalog,recipes},search,scope==='visible'?state.inventory:[],scope==='visible'?state.excluded:[],scope==='visible'&&state.inventoryOnly).filter(r=>!favoritesOnly||state.favorites.includes(r.id));
}
export function reconcileSelection(state:UserState,available:Catalog):UserState {
  if(state.generatedTrials?.some(t=>t.recipe.id===state.selected)||available.recipes.some(r=>r.id===state.selected))return state;
  const selected=available.recipes[0]?.id||'';
  return selected===state.selected?state:{...state,selected};
}
export function recipeDraft(recipe:Recipe,profile?:Profile):RecipeDraft {
  return structuredClone({name_zh:recipe.name_zh,name_en:recipe.name_en,family:recipe.family,glass_template:recipe.glass_template,method:recipe.method,ingredients:recipe.ingredients,steps_zh:recipe.steps_zh,garnish_zh:recipe.garnish_zh,notes_zh:recipe.notes_zh,source_url:recipe.source.url,taste_bps:profile?.taste_preference_bps||[2000,2000,2000,2000,2000],sensory_0_10:profile?.sensory_0_10||[5,5,5,5,5,5,5]});
}
