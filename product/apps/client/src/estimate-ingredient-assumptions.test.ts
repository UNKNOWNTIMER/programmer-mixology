import { describe,it,expect } from 'vitest';
import ingredients from '../public/seed/ingredients.json';
import type { Ingredient } from './types';
import { ingredientEstimateBasis,INGREDIENT_ESTIMATE_IDS,INGREDIENT_ESTIMATE_METADATA } from './estimate-ingredient-assumptions';

const seed=ingredients.ingredients as Ingredient[];
const lookup=(id:string)=>ingredientEstimateBasis(seed.find(i=>i.id===id)!);
describe('explicit ingredient estimate taxonomy',()=>{
  it('covers every one of the 255 current ingredient IDs exactly and leaves source labels untouched',()=>{
    const before=JSON.stringify(seed);
    expect(seed).toHaveLength(255);
    expect(INGREDIENT_ESTIMATE_IDS).toEqual(seed.map(i=>i.id).sort());
    for(const i of seed){const basis=ingredientEstimateBasis(i)!;expect(basis).toBeDefined();expect(basis.abvPercent.min).toBeGreaterThanOrEqual(0);expect(basis.abvPercent.max).toBeLessThanOrEqual(100);expect(basis.abvPercent.max).toBeGreaterThanOrEqual(basis.abvPercent.min);const energy=basis.energyBasis==='mass'?basis.nonAlcoholKcalPerGram:basis.nonAlcoholKcalPer100ml;expect(energy).toBeDefined();expect(Number.isFinite(energy!.min)&&Number.isFinite(energy!.max)).toBe(true);expect(energy!.min).toBeGreaterThanOrEqual(0);expect(energy!.max).toBeGreaterThanOrEqual(energy!.min);}
    expect(JSON.stringify(seed)).toBe(before);expect(ingredients.ingredients.every(i=>i.abv_fraction===null&&i.kcal_per_100ml===null&&i.density_g_per_ml===null)).toBe(true);
  });
  it('does not infer an unknown modifier from its convincing name, role, or object-prototype ID',()=>{
    for(const id of ['unknown_vodka','cdb_unreviewed_gin','constructor','__proto__','GIN'])expect(ingredientEstimateBasis({...seed[0],id,name_en:'Vodka Gin Cream',role:'spirit'})).toBeUndefined();
  });
  it('keeps high-strength spirits and ambiguous alcoholic cordials distinct',()=>{
    expect(lookup('cdb_151_proof_rum')!.abvPercent.min).toBeGreaterThan(70);expect(lookup('jamaican_overproof_white_rum')!.abvPercent.min).toBeGreaterThan(50);expect(lookup('green_chartreuse')!.abvPercent.min).toBeGreaterThanOrEqual(50);
    for(const id of ['falernum','elderflower_cordial','chamomile_cordial','ginger_beer','apple_cider']){expect(lookup(id)!.abvPercent.min).toBe(0);expect(lookup(id)!.abvPercent.max).toBeGreaterThan(0);}
  });
  it('uses gram-based solid energy without silently assigning density or liquid calories',()=>{
    for(const id of ['sugar','raw_honey','cdb_egg','cdb_whipped_cream','lime_fruit','cdb_oreo_cookie']){const basis=lookup(id)!;expect(basis.energyBasis).toBe('mass');expect(basis.nonAlcoholKcalPer100ml).toBeUndefined();expect(basis.nonAlcoholKcalPerGram).toBeDefined();}
    expect(lookup('cdb_vanilla_ice_cream')!.energyBasis).toBe('volume');expect(lookup('lemon')!.kind).toBe('acid');expect(lookup('orange_flower_water')!.kind).toBe('floral_water');
    expect(lookup('cdb_cream')!.kind).toBe('cream');expect(lookup('cdb_milk')!.kind).toBe('milk');expect(lookup('cdb_cream')!.nonAlcoholKcalPer100ml!.max).toBeGreaterThan(lookup('cdb_milk')!.nonAlcoholKcalPer100ml!.max);
  });
  it('marks all bounds as versioned editorial AI-assisted assumptions and protects shared data from mutation',()=>{
    expect(INGREDIENT_ESTIMATE_METADATA.measured).toBe(false);expect(INGREDIENT_ESTIMATE_METADATA.author).toBe('AI-assisted / Codex');expect(INGREDIENT_ESTIMATE_METADATA.limitation).toContain('not measured');expect(INGREDIENT_ESTIMATE_METADATA.sources.every(s=>s.url.startsWith('https://'))).toBe(true);
    expect(Object.isFrozen(lookup('gin'))).toBe(true);expect(Object.isFrozen(lookup('gin')!.abvPercent)).toBe(true);expect(Object.isFrozen(INGREDIENT_ESTIMATE_IDS)).toBe(true);
  });
});
