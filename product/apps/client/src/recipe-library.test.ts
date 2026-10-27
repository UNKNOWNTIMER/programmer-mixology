import { describe, expect, it } from 'vitest';
import recipes from '../public/seed/recipes.json';
import profiles from '../public/seed/profiles.seed.json';
import ingredients from '../public/seed/ingredients.json';
import sources from '../public/seed/sources.json';
import { defaultState } from './bridge';
import { matchTarget } from './live-match';
import { combineCatalog, emptyLibrary, libraryRecipes, recipeDraft, reconcileSelection, visibleCatalog } from './recipe-library';
import type { Catalog } from './types';

const base={schema_version:recipes.schema_version,recipes:recipes.recipes,profiles:profiles.profiles,ingredients:ingredients.ingredients,sources:sources.sources} as unknown as Catalog;
describe('personal library selection and immutable snapshots',()=>{
  it('hides and deletes recipes from matching and the shared random/preset candidate catalog',()=>{
    const library={...emptyLibrary(),hidden:[base.recipes[0].id],deleted:[base.recipes[1].id]};
    const available=visibleCatalog(base,library),state=defaultState(base);
    expect(available.recipes).toHaveLength(298);
    expect(available.profiles).toHaveLength(298);
    for(const id of [...library.hidden,...library.deleted]){
      const p=base.profiles.find(p=>p.recipe_id===id)!;
      expect(available.recipes.some(r=>r.id===id)).toBe(false);
      expect(matchTarget({...state,selected:id},{taste_bps:p.taste_preference_bps,sensory_0_10:p.sensory_0_10},available).selected).not.toBe(id);
    }
  });
  it('keeps recovery lists accessible despite inventory exclusions',()=>{
    const library={...emptyLibrary(),hidden:[base.recipes[0].id],deleted:[base.recipes[1].id]};
    const state={...defaultState(base),inventoryOnly:true,inventory:[],excluded:base.ingredients.map(i=>i.id)};
    expect(libraryRecipes(base,library,'visible','',state)).toHaveLength(0);
    expect(libraryRecipes(base,library,'hidden','',state).map(r=>r.id)).toEqual(library.hidden);
    expect(libraryRecipes(base,library,'deleted','',state).map(r=>r.id)).toEqual(library.deleted);
  });
  it('repairs removed selection and handles all-hidden without changing target, reviews or stored snapshots',()=>{
    const state=defaultState(base),snapshot=structuredClone(base.recipes[0]);
    state.drafts=[{id:'snapshot',created_at:'2026-09-22',recipe:snapshot,target:structuredClone(state.target)}];
    const library={...emptyLibrary(),hidden:base.recipes.map(r=>r.id)};
    const available=visibleCatalog(base,library),next=reconcileSelection(state,available);
    expect(next.selected).toBe('');
    expect(next.target).toBe(state.target);expect(next.reviews).toBe(state.reviews);expect(next.drafts).toBe(state.drafts);
    expect(snapshot).toEqual(base.recipes[0]);
    expect(reconcileSelection(next,base).selected).toBe(base.recipes[0].id);
  });
  it('retains independently loaded archive/trial selection when all catalog recipes are hidden',()=>{
    const state=defaultState(base),recipe={...structuredClone(base.recipes[0]),id:'archive_sample'};
    state.selected=recipe.id;state.generatedTrials=[{recipe,profile:structuredClone(base.profiles[0]),created_at:'2026-09-22',audit:{}}];
    expect(reconcileSelection(state,visibleCatalog(base,{...emptyLibrary(),hidden:base.recipes.map(r=>r.id)}))).toBe(state);
  });
  it('custom edits merge by independent identity; old exported/draft copies stay unchanged',()=>{
    const library=emptyLibrary(),recipe={...structuredClone(base.recipes[0]),id:'personal_sample',recipe_revision_id:'v1'},profile={...structuredClone(base.profiles[0]),recipe_id:'personal_sample'};
    library.custom.push({recipe,profile,created_at:'2026-09-22',updated_at:'2026-09-22'});
    const oldSnapshot=structuredClone(recipe),sourceBefore=JSON.stringify(base);
    const updated=structuredClone(library);updated.custom[0].recipe.name_zh='自己的配方';updated.custom[0].recipe.recipe_revision_id='v2';
    const combined=combineCatalog(base,updated);
    expect(combined.recipes).toHaveLength(301);expect(combined.profiles).toHaveLength(301);
    expect(combined.recipes.at(-1)?.recipe_revision_id).toBe('v2');expect(oldSnapshot.recipe_revision_id).toBe('v1');
    expect(JSON.stringify(base)).toBe(sourceBefore);
  });
  it('copying into the editor preserves source quantities and does not alias source data',()=>{
    const recipe=base.recipes.find(r=>r.ingredients.some(i=>i.quantity_range))||base.recipes[0];
    const before=structuredClone(recipe),draft=recipeDraft(recipe,base.profiles.find(p=>p.recipe_id===recipe.id));
    expect(draft.ingredients).toEqual(recipe.ingredients);
    draft.ingredients[0].quantity=999;draft.steps_zh[0]='changed';
    expect(recipe).toEqual(before);
  });
  it('defaults DLC to enabled and excludes a disabled group from all workbench candidates while keeping management reachable',()=>{
    const ids=base.recipes.slice(0,3).map(r=>r.id),catalog={...base,dlc_groups:[{id:'notes',name_zh:'笔记',name_en:'Notes',author:'小董',version:'1.0',recipe_ids:ids,source_sha256:'source'}]},state=defaultState(catalog);
    expect(visibleCatalog(catalog,emptyLibrary()).recipes).toHaveLength(300);
    const library={...emptyLibrary(),disabled_groups:['notes']},before=structuredClone(catalog),available=visibleCatalog(catalog,library);
    expect(available.recipes).toHaveLength(297);expect(available.profiles).toHaveLength(297);
    expect(libraryRecipes(catalog,library,'visible','',state).some(r=>ids.includes(r.id))).toBe(false);
    expect(libraryRecipes(catalog,library,'custom','',state).map(r=>r.id)).toEqual(ids);
    for(const id of ids){const p=catalog.profiles.find(p=>p.recipe_id===id)!;expect(matchTarget({...state,selected:id},{taste_bps:p.taste_preference_bps,sensory_0_10:p.sensory_0_10},available).selected).not.toBe(id);}
    const next=reconcileSelection({...state,selected:ids[0]},available);expect(ids).not.toContain(next.selected);expect(next.target).toEqual(state.target);
    expect(catalog).toEqual(before);expect(visibleCatalog(catalog,{...library,disabled_groups:[]}).recipes).toHaveLength(300);
  });
  it('DLC enable toggles preserve individual hidden/deleted flags and independently imported copies',()=>{
    const source=base.recipes[0],copy={...structuredClone(source),id:'personal_copy'},library={...emptyLibrary(),disabled_groups:['notes'],hidden:[base.recipes[1].id],deleted:[base.recipes[2].id],custom:[{recipe:copy,profile:{...base.profiles[0],recipe_id:copy.id},created_at:'date',updated_at:'date'}]};
    const catalog=combineCatalog({...base,dlc_groups:[{id:'notes',name_zh:'笔记',name_en:'Notes',author:'小董',version:'1.0',recipe_ids:base.recipes.slice(0,3).map(r=>r.id),source_sha256:'source'}]},library);
    expect(visibleCatalog(catalog,library).recipes.some(r=>r.id===copy.id)).toBe(true);
    const enabled=visibleCatalog(catalog,{...library,disabled_groups:[]});expect(enabled.recipes.some(r=>r.id===source.id)).toBe(true);
    expect(enabled.recipes.some(r=>library.hidden.includes(r.id)||library.deleted.includes(r.id))).toBe(false);
  });
});
