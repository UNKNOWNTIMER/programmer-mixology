import { invoke } from '@tauri-apps/api/core';
import type { Catalog, Taste, UserState } from './types';
import { redistribute, validateTaste } from './domain';
import { normalizeSettings } from './user-settings';
import preparedIngredients from '../../../data/personal/zhenglin-soup/prepared-ingredients.json';
import dlcManifest from '../../../data/dlc/xiaodong/catalog.json';
export const native = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export async function loadCatalog(): Promise<Catalog> {
  if (native) return invoke<Catalog>('catalog');
  const [r,i,p,s] = await Promise.all(['recipes','ingredients','profiles.seed','sources'].map(async name => { const response = await fetch(`/seed/${name}.json`); if (!response.ok) throw new Error(`种子读取失败：${name}`); return response.json(); }));
  const dlc=dlcManifest as unknown as {group:NonNullable<Catalog['dlc_groups']>[number];recipes:Catalog['recipes'];ingredients:Catalog['ingredients'];profiles:Catalog['profiles']};
  return { schema_version: r.schema_version, recipes: [...r.recipes,...dlc.recipes], ingredients: [...i.ingredients,...preparedIngredients,...dlc.ingredients], profiles: [...p.profiles,...dlc.profiles], sources: [...s.sources,...dlc.recipes.map(recipe=>recipe.source)],dlc_groups:[dlc.group] };
}
export async function readState(): Promise<UserState | null> {
  const stored: UserState | null = native ? await invoke<UserState | null>('ui_state_get') : JSON.parse(localStorage.getItem('pixel-mix.ui-test.v1') || 'null');
  return stored ? { ...stored, settings: normalizeSettings(stored.settings) } : null;
}
export async function writeState(value: UserState): Promise<void> {
  validateTaste(value.target.taste_bps);
  if (native) await invoke('ui_state_set', { value }); else localStorage.setItem('pixel-mix.ui-test.v1',JSON.stringify(value));
}
export async function adjustTaste(anchor: Taste, axis: number, requested: number, locked: number[]): Promise<Taste> {
  return native ? invoke<Taste>('taste_adjust', { anchor, axis, requested, locked }) : redistribute(anchor,axis,requested,locked);
}
export function defaultState(catalog: Catalog): UserState {
  const selected = catalog.recipes.find(r => r.id === 'iba_negroni') || catalog.recipes[0];
  const profile = catalog.profiles.find(p => p.recipe_id === selected.id)!;
  return { version: 1, selected: selected.id, target: { taste_bps: [...profile.taste_preference_bps], sensory_0_10: [...profile.sensory_0_10] }, locked: [], favorites: [], reviews: [], inventory: [], excluded: [], inventoryOnly: false, settings: normalizeSettings(undefined), drafts: [] };
}
