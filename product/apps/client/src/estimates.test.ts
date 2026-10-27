import { describe,it,expect } from 'vitest';
import { estimateDrink,formatEstimate } from './estimates';
import type { Recipe,Ingredient } from './types';
import recipes from '../public/seed/recipes.json';
import ingredients from '../public/seed/ingredients.json';
const seed=ingredients.ingredients as Ingredient[];
const negroni=recipes.recipes.find(r=>r.id==='iba_negroni') as unknown as Recipe;
describe('separate editorial drink estimates',()=>{
  it('estimates a full known-ml recipe with explicit bounds and does not mutate facts',()=>{
    const before=JSON.stringify({negroni,seed}),e=estimateDrink(negroni,seed);expect(e.baseVolumeMl).toBe(90);expect(e.abvPercent!.min).toBeLessThan(e.abvPercent!.max);expect(e.caloriesKcal!.min).toBeGreaterThan(0);expect(e.assumptions.join(' ')).toContain('编辑假设');expect(e.sources).toHaveLength(4);expect(JSON.stringify({negroni,seed})).toBe(before);expect(seed.every(i=>i.kcal_per_100ml===null)).toBe(true);
  });
  it('uses ethanol density and energy once, without adding it twice to total label calories',()=>{
    const r={...negroni,ingredients:[{...negroni.ingredients[0],quantity:100}]};
    const e=estimateDrink(r,[{...seed.find(i=>i.id===r.ingredients[0].ingredient_id)!,abv_fraction:.4,kcal_per_100ml:230}],{dilutionFraction:{min:0,max:0}});expect(e.abvPercent).toEqual({min:40,max:40});expect(e.caloriesKcal).toEqual({min:230,max:230});
    const noLabel=estimateDrink(r,seed,{dilutionFraction:{min:0,max:0},ingredientOverrides:{[r.ingredients[0].ingredient_id]:{abvPercent:{min:40,max:40}}}});expect(noLabel.caloriesKcal!.min).toBeCloseTo(40*.789*7);
  });
  it('refuses to silently convert dashes or unknown top-ups',()=>{
    for(const part of [{quantity:2,unit:'dash',stage:'mix'},{quantity:null,unit:'ml',stage:'top'},{quantity:2,unit:'g',stage:'mix'},{quantity:5,unit:'ml',stage:'rinse'}]){
      const r={...negroni,ingredients:[...negroni.ingredients,{...negroni.ingredients[0],...part}]};const e=estimateDrink(r,seed);expect(e.abvPercent).toBeNull();expect(e.caloriesKcal).toBeNull();expect(e.reasons.length).toBeGreaterThan(0);
    }
  });
  it('does not claim unknown ingredient or incomplete nutritional basis is zero',()=>{
    const r={...negroni,ingredients:[{...negroni.ingredients[0],ingredient_id:'unreviewed',quantity:50}]};const e=estimateDrink(r,seed);expect(e.abvPercent).toBeNull();expect(e.caloriesKcal).toBeNull();expect(e.reasons.join()).toContain('缺少');
  });
  it('honors explicit estimate overrides without modifying dose or recipe',()=>{
    const r={...negroni,ingredients:[{...negroni.ingredients[0],quantity:60}]},id=r.ingredients[0].ingredient_id;
    const e=estimateDrink(r,seed,{dilutionFraction:{min:.2,max:.5},ingredientOverrides:{[id]:{abvPercent:{min:40,max:40},kcalPer100ml:{min:200,max:240}}}});expect(e.servedVolumeMl).toEqual({min:72,max:90});expect(e.abvPercent!.min).toBeCloseTo(24/90*100);expect(e.abvPercent!.max).toBeCloseTo(24/72*100);expect(e.caloriesKcal).toEqual({min:120,max:144});expect(r.ingredients[0].quantity).toBe(60);
  });
  it('rejects invalid options rather than clamping them into plausible data',()=>{
    expect(estimateDrink(negroni,seed,{dilutionFraction:{min:1,max:0}}).abvPercent).toBeNull();
    expect(estimateDrink(negroni,seed,{ingredientOverrides:{gin:{abvPercent:{min:NaN,max:101}}}}).abvPercent).toBeNull();
  });
  it('marks every numeric formatted value approximate and estimated, keeping unknown visible',()=>{
    expect(formatEstimate({min:18.23,max:25.32},'%')).toBe('≈18.2–25.3% · 估');expect(formatEstimate({min:100,max:100},'kcal')).toBe('≈100 kcal · 估');expect(formatEstimate(null,'%')).toBe('无法估');
  });
  it('uses the documented volume convention without converting unknown shots or masses',()=>{
    const recipe={...negroni,ingredients:[{...negroni.ingredients[0],quantity:2,unit:'oz'}]},before=JSON.stringify(recipe);
    const e=estimateDrink(recipe,seed,{language:'en'});expect(e.baseVolumeMl).toBeCloseTo(59.147059125);expect(e.assumptions.join(' ')).toContain('U.S. customary');expect(e.assumptions.join(' ')).not.toMatch(/[\u3400-\u9fff]/);expect(JSON.stringify(recipe)).toBe(before);
    expect(estimateDrink({...recipe,ingredients:[{...recipe.ingredients[0],unit:'shot'}]},seed).baseVolumeMl).toBeNull();
  });
});
