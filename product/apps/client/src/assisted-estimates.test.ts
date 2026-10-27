import { describe,it,expect } from 'vitest';
import { estimateDisplayDrink } from './assisted-estimates';
import { formatEstimate } from './estimates';
import type { Ingredient,Recipe } from './types';
import recipeData from '../public/seed/recipes.json';
import ingredientData from '../public/seed/ingredients.json';
const recipes=recipeData.recipes as unknown as Recipe[],ingredients=ingredientData.ingredients as Ingredient[];
const find=(id:string)=>recipes.find(r=>r.id===id)!;
describe('AI-assisted display estimates with deterministic physical calculation',()=>{
 it('fills all 300 built-ins with finite bounded estimates while preserving source data',()=>{
  const before=JSON.stringify({recipes,ingredients});
  const audit=recipes.map(recipe=>({id:recipe.id,name:recipe.name_en,...estimateDisplayDrink(recipe,ingredients)}));
  const missing=audit.filter(e=>!e.servedVolumeMl||!e.abvPercent||!e.caloriesKcal);
  expect(missing.map(e=>({id:e.id,reasons:e.reasons}))).toEqual([]);
  for(const e of audit){
   for(const range of [e.servedVolumeMl!,e.abvPercent!,e.caloriesKcal!]){expect(Number.isFinite(range.min)&&Number.isFinite(range.max),e.id).toBe(true);expect(range.min,e.id).toBeGreaterThanOrEqual(0);expect(range.max,e.id).toBeGreaterThanOrEqual(range.min);}
   expect(e.abvPercent!.max,e.id).toBeLessThanOrEqual(100);expect(e.servedVolumeMl!.max,e.id).toBeLessThan(1500);
   expect(formatEstimate(e.caloriesKcal,'kcal')).toContain('· 估');expect(e.assumptions[0]).toContain('AI 辅助估算');
  }
  expect(JSON.stringify({recipes,ingredients})).toBe(before);
 });
 it('keeps rinse retention and solid sugar separate from source doses',()=>{
  const recipe=find('iba_sazerac'),e=estimateDisplayDrink(recipe,ingredients);
  const absinthe=e.contributions.find(p=>p.ingredientId==='absinthe')!;
  expect(absinthe.volumeMl.max).toBeLessThan(recipe.ingredients.find(p=>p.ingredient_id==='absinthe')!.quantity!);
  const sugar=e.contributions.find(p=>p.ingredientId==='sugar_cube')!;expect(sugar.caloriesKcal.min).toBeGreaterThan(0);
  expect(e.caloriesKcal!.min).toBeGreaterThan(sugar.caloriesKcal.min);
 });
 it('handles explicit ice once, independently of the amount of unmelted ice listed',()=>{
  const recipe=find('cdb_17268'),changed={...recipe,ingredients:recipe.ingredients.map(p=>p.ingredient_id==='cdb_ice'?{...p,quantity:100,unit:'cube'}:p)};
  const a=estimateDisplayDrink(recipe,ingredients),b=estimateDisplayDrink(changed,ingredients);
  expect(b.servedVolumeMl).toEqual(a.servedVolumeMl);expect(b.caloriesKcal).toEqual(a.caloriesKcal);
 });
 it('calculates per-serving figures for batch recipes without changing serving instructions',()=>{
  for(const [id,min,max]of [['cdb_13020',6,8],['cdb_12944',5,6],['cdb_12726',2,2]] as const){
   const e=estimateDisplayDrink(find(id),ingredients);expect(e.portions).toEqual({min,max});expect(e.servedVolumeMl!.max).toBeLessThan(350);expect(e.caloriesKcal!.max).toBeCloseTo(e.contributions.reduce((sum,p)=>sum+p.caloriesKcal.max,0)/min);
  }
 });
 it('uses actual label total calories once and source volume before any category assumption',()=>{
  const recipe={...find('iba_negroni'),method:'stir',ingredients:[{...find('iba_negroni').ingredients[0],quantity:100}]};
  const seed=ingredients.map(i=>i.id==='gin'?{...i,abv_fraction:.4,kcal_per_100ml:230}:i),e=estimateDisplayDrink(recipe,seed);
  expect(e.caloriesKcal!.min).toBeCloseTo(230);expect(e.caloriesKcal!.max).toBeCloseTo(230);expect(e.abvPercent!.min).toBeCloseTo(40/1.3);expect(e.abvPercent!.max).toBeCloseTo(40/1.1);
 });
 it('refuses unknown ingredients and invalid input instead of inventing a complete total',()=>{
  const recipe=find('iba_negroni');
  const unknown={...recipe,ingredients:[...recipe.ingredients,{...recipe.ingredients[0],ingredient_id:'private_unknown'}]};
  expect(estimateDisplayDrink(unknown,ingredients).caloriesKcal).toBeNull();
  expect(estimateDisplayDrink(unknown,[...ingredients,{...ingredients[0],id:'private_unknown',role:'spirit'}]).caloriesKcal).toBeNull();
  for(const label of [{abv_fraction:1.2},{abv_fraction:NaN},{kcal_per_100ml:-1},{kcal_per_100ml:Infinity}]){
    const e=estimateDisplayDrink(recipe,ingredients.map(i=>i.id==='gin'?{...i,...label}:i));expect(e.caloriesKcal).toBeNull();expect(e.abvPercent).toBeNull();
  }
  for(const quantity of [NaN,-1,Infinity]){const broken={...recipe,ingredients:recipe.ingredients.map((p,i)=>i===0?{...p,quantity}:p)};expect(estimateDisplayDrink(broken,ingredients).caloriesKcal).toBeNull();}
 });
 it('preserves shared part ratios when the overall serving scale is uncertain',()=>{
  const source=find('iba_negroni'),recipe={...source,method:'layer',ingredients:source.ingredients.slice(0,2).map(p=>({...p,unit:'part',quantity:1}))};
  const seed=ingredients.map(i=>i.id===recipe.ingredients[0].ingredient_id?{...i,abv_fraction:.4}:i.id===recipe.ingredients[1].ingredient_id?{...i,abv_fraction:0}:i);
  const e=estimateDisplayDrink(recipe,seed);expect(e.abvPercent!.min).toBeCloseTo(20/1.05);expect(e.abvPercent!.max).toBeCloseTo(20);
 });
 it('does not apply fixed batch assumptions to an edited recipe sharing a built-in ID',()=>{
  const source=find('cdb_13020'),changed={...source,ingredients:source.ingredients.map((p,i)=>i===0?{...p,quantity:.2}:p)};
  expect(estimateDisplayDrink(changed,ingredients).portions).toEqual({min:1,max:1});
 });
 it('uses explicit mass and ml before any whole-fruit or scoop assumptions',()=>{
  const source=find('iba_negroni'),part=source.ingredients[0];
  const fruit=estimateDisplayDrink({...source,ingredients:[{...part,ingredient_id:'lime_fruit',quantity:50,unit:'g'}]},ingredients);
  expect(fruit.contributions[0].volumeMl.max).toBeLessThan(60);expect(fruit.caloriesKcal!.max).toBeCloseTo(50*1.2);
  const dessert=estimateDisplayDrink({...source,ingredients:[{...part,ingredient_id:'cdb_vanilla_ice_cream',quantity:100,unit:'ml'}]},ingredients);
  expect(dessert.contributions[0].volumeMl).toEqual({min:100,max:100});
  expect(estimateDisplayDrink({...source,ingredients:[{...part,ingredient_id:'lime_fruit',quantity:50,unit:'invalid_unit'}]},ingredients).servedVolumeMl).toBeNull();
 });
 it('does not use source uncertainty as evidence of zero alcohol or zero food energy',()=>{
  for(const id of ['cdb_11666','iba_bloody_mary','cdb_13499']){const e=estimateDisplayDrink(find(id),ingredients);expect(e.abvPercent!.max).toBeGreaterThan(0);expect(e.caloriesKcal!.min).toBeGreaterThan(0);}
  const e=estimateDisplayDrink(find('cdb_12560'),ingredients);expect(e.abvPercent!.max).toBeLessThan(.000001);
 });
 it('keeps English estimates localized and deterministic',()=>{
  const recipe=find('cdb_11666'),a=estimateDisplayDrink(recipe,ingredients,'en'),b=estimateDisplayDrink(recipe,ingredients,'en');expect(a).toEqual(b);expect(a.assumptions.join(' ')).not.toMatch(/[\u3400-\u9fff]/);
 });
});
