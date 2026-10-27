import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { quantityText } from './domain';
import type { Ingredient, Recipe } from './types';

vi.mock('./bridge',()=>({native:false}));
import { RecipeDetails } from './RecipeWindow';

describe('source quantity display',()=>{
  it('preserves eighths and smaller finite fractions instead of rounding doses to hundredths',()=>{
    expect(quantityText(1/8,'shot')).toBe('0.125 shot');
    expect(quantityText(1/8,'tsp')).toBe('0.125 茶匙');
    expect(quantityText(1/128,'oz')).toBe('0.0078125 oz');
    expect(quantityText(0.000001,'ml')).toBe('0.000001 ml');
  });
  it('scales source values without floating point tails or invented unit conversion',()=>{
    expect(quantityText(.125,'shot',6)).toBe('0.75 shot');
    expect(quantityText(.1,'part',3)).toBe('0.3 part');
    expect(quantityText(1.5,'oz',2)).toBe('3 oz');
  });
  it('shows both range endpoints and scales both endpoints in the same source unit',()=>{
    expect(quantityText(null,'oz',1,[3,4])).toBe('3–4 oz');
    expect(quantityText(null,'oz',2,[8,10])).toBe('16–20 oz');
    expect(quantityText(null,'ml',3,[20,30])).toBe('60–90 ml');
    expect(quantityText(null,'shot',2,[.125,.375])).toBe('0.25–0.75 shot');
  });
  it('keeps unknown quantities unknown even when the unit or serving multiplier is known',()=>{
    expect(quantityText(null,'shot',8)).toBe('shot · 用量待确认');
    expect(quantityText(null,'unknown')).toContain('原始单位未注明');
    expect(quantityText(null,'to_top',8)).toBe('加满 · 用量待确认');
    expect(quantityText(null,'to_taste',8)).toContain('用量待确认');
  });
  it('does not substitute invalid ranges or non-finite values for a known amount',()=>{
    expect(quantityText(2,'oz',1,[3,4])).toBe('2 oz');
    for(const range of [[4,3],[-1,3],[1,Infinity]] as [number,number][]) expect(quantityText(null,'oz',1,range)).toContain('待确认');
    expect(quantityText(NaN,'ml')).toContain('待确认');
    expect(quantityText(null,'oz',NaN,[3,4])).toContain('待确认');
  });
});

describe('recipe detail quantity integration',()=>{
  it('renders a scaled range while retaining the original qualifier and source measure exactly once',()=>{
    const note='TheCocktailDB 原材料：Sugar syrup；原计量：2-3 cl dry。未指定单位/容量不推算。';
    const recipe:Recipe={id:'range-fixture',name_zh:'范围测试',name_en:'Range',variant:'test fixture',family:'sour',glass_template:'rocks',method:'build',preparation_review:'not_physically_tested',default_orderable:false,needs_serving_configuration:true,prediction_profile_id:'range-fixture',ingredients:[{ingredient_id:'sugar_syrup',quantity:null,quantity_range:[20,30],unit:'ml',optional:false,stage:'mix',quantity_note:note,allowed_alternatives:[]}],steps_zh:[],garnish_zh:'',notes_zh:'',source:{kind:'user_note',publisher:'Source',url:null,reference:'Original',checked_on:'2026-09-21',method_provenance:'test fixture'}};
    const ingredients=[{id:'sugar_syrup',name_zh:'糖浆',name_en:'Sugar syrup',role:'sweetener',potential_allergens:[],abv_fraction:null,kcal_per_100ml:null}] as Ingredient[];
    const before=JSON.stringify(recipe),noop=()=>{};
    const html=renderToStaticMarkup(createElement(RecipeDetails,{recipe,ingredients,pinned:false,servings:2,onServings:noop,onPin:noop,onClose:noop}));
    expect(html).toContain('<b>40–60 ml</b>');
    expect(html.split(note)).toHaveLength(2);
    expect(html).toContain('Original notes:');
    expect(JSON.stringify(recipe)).toBe(before);
  });
});
