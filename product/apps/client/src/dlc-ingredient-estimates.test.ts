import { describe,it,expect } from 'vitest';
import catalog from '../../../data/dlc/xiaodong/catalog.json';
import seed from '../public/seed/ingredients.json';
import { DLC_INGREDIENT_ESTIMATE_IDS,DLC_INGREDIENT_ESTIMATE_METADATA,dlcIngredientEstimateBasis } from './dlc-ingredient-estimates';
import { ingredientEstimateBasis,INGREDIENT_ESTIMATE_IDS } from './estimate-ingredient-assumptions';
import { estimateDisplayDrink } from './assisted-estimates';
import { dlcRecipeId } from './dlc-art';
import type { Ingredient,Recipe } from './types';

const extra=catalog.ingredients as Ingredient[],ingredients=[...seed.ingredients as Ingredient[],...extra],recipes=catalog.recipes as unknown as Recipe[];
const find=(id:string)=>recipes.find(r=>r.id===id)!;
describe('explicit DLC display estimates',()=>{
 it('covers only the 48 DLC ingredient IDs and leaves all label data and the original 255-ID taxonomy intact',()=>{
  expect(extra).toHaveLength(48);expect(DLC_INGREDIENT_ESTIMATE_IDS).toEqual(extra.map(i=>i.id).sort());
  expect(INGREDIENT_ESTIMATE_IDS).toHaveLength(255);expect(INGREDIENT_ESTIMATE_IDS.some(id=>id.startsWith('dlc_'))).toBe(false);
  for(const i of extra){
   const b=ingredientEstimateBasis(i)!;expect(b,i.id).toBeDefined();expect(b.abvPercent.min).toBeGreaterThanOrEqual(0);expect(b.abvPercent.max).toBeLessThanOrEqual(100);
   const e=b.energyBasis==='mass'?b.nonAlcoholKcalPerGram!:b.nonAlcoholKcalPer100ml!;expect(Number.isFinite(e.min)&&Number.isFinite(e.max),i.id).toBe(true);expect(e.max).toBeGreaterThanOrEqual(e.min);
   for(const key of ['abv_fraction','kcal_per_100ml'] as const)expect(i[key],i.id).toBeNull();
   expect(catalog.ingredients.find(row=>row.id===i.id)!.density_g_per_ml,i.id).toBeNull();
  }
  expect(DLC_INGREDIENT_ESTIMATE_METADATA.measured).toBe(false);expect(Object.isFrozen(dlcIngredientEstimateBasis(extra[0].id))).toBe(true);
  expect(dlcIngredientEstimateBasis('dlc_xd_brand_invented')).toBeUndefined();expect(dlcIngredientEstimateBasis('__proto__')).toBeUndefined();
 });
 it('keeps unidentified mixtures broad rather than asserting a brand or alcohol-free label',()=>{
  for(const id of ['dlc_xd_telska_unresolved','dlc_xd_tequila_premix','dlc_xd_ume_su','dlc_xd_plum_tea_campari']){
   const b=dlcIngredientEstimateBasis(id)!;expect(b.kind).toBe('unresolved_mixture');expect(b.abvPercent).toEqual({min:0,max:80});expect(b.nonAlcoholKcalPer100ml!.max).toBeGreaterThanOrEqual(400);
  }
 });
 it('produces finite ordered display ranges for all 96 recipes without mutating source doses, labels, or permissions',()=>{
  const before=JSON.stringify({recipes,ingredients}),estimates=recipes.map(recipe=>({id:recipe.id,...estimateDisplayDrink(recipe,ingredients)}));
  expect(estimates.filter(e=>!e.servedVolumeMl||!e.abvPercent||!e.caloriesKcal).map(e=>({id:e.id,reasons:e.reasons}))).toEqual([]);
  for(const e of estimates){for(const r of [e.servedVolumeMl!,e.abvPercent!,e.caloriesKcal!]){expect(Number.isFinite(r.min)&&Number.isFinite(r.max),e.id).toBe(true);expect(r.min,e.id).toBeGreaterThanOrEqual(0);expect(r.max,e.id).toBeGreaterThanOrEqual(r.min);}expect(e.abvPercent!.max,e.id).toBeLessThanOrEqual(100);expect(e.assumptions.join(' ')).toContain('非标签实测');}
  expect(JSON.stringify({recipes,ingredients})).toBe(before);expect(recipes.every(r=>r.default_orderable===false)).toBe(true);
 });
 it('uses an explicit 2–6 ml edible yield per grape and still gives source mass/volume units precedence',()=>{
  const recipe=find('dlc_xd_enzoni'),estimate=estimateDisplayDrink(recipe,ingredients);
  expect(estimate.contributions.find(p=>p.ingredientId==='dlc_xd_green_grapes')!.volumeMl).toEqual({min:10,max:30});
  const ml={...recipe,ingredients:recipe.ingredients.map(p=>p.ingredient_id==='dlc_xd_green_grapes'?{...p,quantity:5,unit:'ml'}:p)};
  expect(estimateDisplayDrink(ml,ingredients).contributions.find(p=>p.ingredientId==='dlc_xd_green_grapes')!.volumeMl).toEqual({min:5,max:5});
 });
 it('estimates the exact editorial clarified latte after filtration, preserving source input volume and losing no authorship',()=>{
  const recipe=find('dlc_xd_clear_latte'),before=JSON.stringify(recipe),e=estimateDisplayDrink(recipe,ingredients,'en');
  expect(dlcRecipeId(recipe)).toBe(recipe.id);expect(e.baseVolumeMl).toBe(135);expect(e.servedVolumeMl).toEqual({min:67.5,max:121.5});
  expect(e.caloriesKcal!.max).toBeLessThan(e.contributions.reduce((s,p)=>s+p.caloriesKcal.max,0));
  expect(e.assumptions.join(' ')).toContain('50–90% liquid and ethanol recovery');expect(e.assumptions.join(' ')).toContain('25–100% of non-alcohol energy');expect(e.assumptions.join(' ')).not.toMatch(/[\u3400-\u9fff]/);
  expect(JSON.stringify(recipe)).toBe(before);
  const imported={...recipe,id:'personal_copied',source:{...recipe.source,kind:'imported_snapshot'}};
  expect(estimateDisplayDrink(imported,ingredients).servedVolumeMl).toEqual(e.servedVolumeMl);
  const edited={...recipe,ingredients:recipe.ingredients.map((p,index)=>index===0?{...p,quantity:31}:p)};
  expect(dlcRecipeId(edited)).toBeUndefined();expect(estimateDisplayDrink(edited,ingredients,'en').assumptions.join(' ')).not.toContain('Cold clarification scenario');
 });
});
