import { describe, it, expect } from 'vitest';
import fixture from '../../../data/personal/zhenglin-soup/recipe.json';
import prepared from '../../../data/personal/zhenglin-soup/prepared-ingredients.json';
import seed from '../public/seed/recipes.json';
import ingredientsSeed from '../public/seed/ingredients.json';
import type { Recipe, Ingredient } from './types';
import { estimateDisplayDrink } from './assisted-estimates';
import { compositionFacts } from './glass-art';
import { hasZhenglinDocument, zhenglinQuote, ZHENGLIN_SOURCE_SHA256 } from './zhenglin-soup';

const recipe={...seed.recipes[0],...fixture.draft,id:'personal-test-zhenglin'} as unknown as Recipe;
const ingredients=[...ingredientsSeed.ingredients,...prepared] as Ingredient[];
describe('user-provided Zhenglin Soup source, quote and main-drink estimates',()=>{
  it('preserves the exact single-glass formula and keeps the foam batch separate',()=>{
    expect(fixture.source.sha256).toBe(ZHENGLIN_SOURCE_SHA256);
    expect(recipe.ingredients.filter(p=>p.stage==='mix'&&p.unit==='ml').map(p=>[p.ingredient_id,p.quantity])).toEqual([['gin',45],['cassis',15],['cointreau',10],['lemon',22.5],['simple_syrup',7.5]]);
    expect(fixture.draft.taste_bps.reduce((a,b)=>a+b,0)).toBe(10000);
    expect(recipe.ingredients.find(p=>p.ingredient_id==='user_zhenglin_nebula_foam')).toMatchObject({quantity:15,unit:'ml',stage:'garnish',optional:true});
    expect(fixture.foam_batch).toMatchObject({aquafaba_ml:30,simple_syrup_ml:10,yield_servings:null});
    expect(recipe.ingredients.some(p=>p.ingredient_id==='aquafaba')).toBe(false);
    expect(compositionFacts(recipe,ingredients)).toMatchObject({knownMl:100,incomplete:false});
    expect(fixture.source.external_references_verified).toBe(false);
  });
  it('uses the original unique quote across library and reimported IDs',()=>{
    for(const id of ['personal-test','imported-test'])for(const language of ['zh','en'] as const)
      expect(zhenglinQuote({...recipe,id},language)).toBe(fixture.quote[language]);
    expect(zhenglinQuote({...recipe,name_en:'Another drink'},'zh')).toBeUndefined();
  });
  it('calculates 125–135 ml and 24.55 ml ethanol using declared source assumptions without mutating doses or labels',()=>{
    const before=JSON.stringify({recipe,ingredients}),estimate=estimateDisplayDrink(recipe,ingredients);
    expect(estimate.mainDrinkOnly).toBe(true);expect(estimate.baseVolumeMl).toBe(100);expect(estimate.servedVolumeMl).toEqual({min:125,max:135});
    expect(estimate.abvPercent!.min).toBeCloseTo(24.55/135*100,8);expect(estimate.abvPercent!.max).toBeCloseTo(24.55/125*100,8);
    expect(estimate.caloriesKcal!.min).toBeGreaterThan(24.55*.789*7);expect(estimate.caloriesKcal!.max).toBeLessThan(300);
    expect(estimate.contributions.some(p=>p.ingredientId==='user_zhenglin_nebula_foam')).toBe(false);
    expect(estimate.assumptions.join('\n')).toContain('泡沫');expect(JSON.stringify({recipe,ingredients})).toBe(before);
  });
  it('prefers an actual bottle label and stops applying source assumptions when its exact formula or source changes',()=>{
    const actual=ingredients.map(i=>i.id==='gin'?{...i,abv_fraction:.47}:i),estimate=estimateDisplayDrink(recipe,actual);
    expect(estimate.abvPercent!.max).toBeCloseTo((45*.47+15*.17+10*.4)/125*100,8);
    expect(hasZhenglinDocument({...recipe,notes_zh:''})).toBe(false);
    const changed={...recipe,ingredients:recipe.ingredients.map((p,i)=>i===0?{...p,quantity:50}:p)};
    expect(estimateDisplayDrink(changed,ingredients).mainDrinkOnly).toBeUndefined();
    const invalid=ingredients.map(i=>i.id==='gin'?{...i,abv_fraction:2}:i);
    expect(estimateDisplayDrink(recipe,invalid).abvPercent).toBeNull();
  });
  it('keeps optional whipped foam outside the main estimate when a personal edit uses float instead of garnish',()=>{
    const floated={...recipe,ingredients:recipe.ingredients.map(p=>p.ingredient_id==='user_zhenglin_nebula_foam'?{...p,stage:'float'}:p)};
    expect(estimateDisplayDrink(floated,ingredients)).toEqual(estimateDisplayDrink(recipe,ingredients));
    expect(compositionFacts(floated,ingredients)).toEqual(compositionFacts(recipe,ingredients));
  });
});
