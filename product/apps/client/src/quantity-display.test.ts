import {describe,it,expect} from 'vitest';
import {displayQuantity} from './quantity-display';
import type {Ingredient,RecipeIngredient} from './types';
import recipes from '../public/seed/recipes.json';
import ingredients from '../public/seed/ingredients.json';
const gin=ingredients.ingredients.find(i=>i.id==='gin') as Ingredient;
const part=(quantity:number|null,unit:string):RecipeIngredient=>({ingredient_id:'gin',quantity,unit,optional:false,stage:'mix',quantity_note:null,allowed_alternatives:[]});
describe('metric recipe display',()=>{
 it('converts known liquid ounces with a visible U.S. convention while keeping source untouched',()=>{const p=part(1.5,'oz'),before=JSON.stringify(p),value=displayQuantity(p,gin);expect(value.text).toBe('≈44.36 ml');expect(value.ml).toBeCloseTo(44.36029434375);expect(value.note).toContain('美制');expect(JSON.stringify(p)).toBe(before);});
 it('keeps mass separate from volume and uncertain solid ounces unconverted',()=>{expect(displayQuantity(part(2,'oz_weight'),gin).text).toBe('56.7 g');expect(displayQuantity(part(2,'oz_weight'),gin).ml).toBeNull();const ice=ingredients.ingredients.find(i=>i.id==='cdb_chocolate_ice_cream') as Ingredient;expect(displayQuantity(part(2,'oz'),ice).text).toBe('2 oz');});
 it('converts exact metric prefixes and assumed measuring spoon/cup capacities',()=>{expect(displayQuantity(part(2,'cl'),gin).text).toBe('20 ml');expect(displayQuantity(part(.2,'kg')).text).toBe('200 g');expect(displayQuantity(part(1,'tsp'),gin).text).toBe('≈4.93 ml');expect(displayQuantity(part(1,'tbsp'),gin).text).toBe('≈14.79 ml');expect(displayQuantity(part(1,'cup'),gin).text).toBe('≈236.59 ml');});
 it('scales both ends of ranges without inventing a single dose or shot capacity',()=>{const p={...part(null,'oz'),quantity_range:[3,4] as [number,number]};expect(displayQuantity(p,gin,2).text).toBe('≈177.44–236.59 ml');expect(displayQuantity(p,gin).ml).toBeNull();for(const unit of ['shot','dash','barspoon','part']){expect(displayQuantity(part(1,unit),gin).text).not.toContain('ml');expect(displayQuantity(part(null,unit),gin).ml).toBeNull();}});
 it('supports readable English unknown quantities and never rounds a small known amount to zero',()=>{expect(displayQuantity(part(null,'to_top'),gin,1,'en').text).toBe('Top up · amount unspecified');expect(displayQuantity(part(.000001,'oz'),gin).text).not.toBe('≈0 ml');});
 it('formats all catalog rows without changing the catalog and converts over 300 non-metric rows',()=>{const before=JSON.stringify(recipes);let count=0;for(const r of recipes.recipes)for(const p of r.ingredients){const d=displayQuantity(p as RecipeIngredient,ingredients.ingredients.find(i=>i.id===p.ingredient_id) as Ingredient);expect(d.text.length).toBeGreaterThan(0);if(d.converted)count++;}expect(count).toBeGreaterThan(300);expect(JSON.stringify(recipes)).toBe(before);});
});
