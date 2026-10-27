import { describe,expect,it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecipeEditor } from './RecipeEditor';
import { I18nProvider } from './i18n';
import { blankRecipeDraft, emptyRecipeIngredient, initialRecipeDraft, prepareRecipeDraft, recipeDraftErrors, withCurrentTaste, withTastePercent } from './recipe-editor-state';
import type { Ingredient, Target } from './types';
import type { RecipeDraft } from './recipe-library';
import { recipeDraft } from './recipe-library';
import sourceRecipes from '../public/seed/recipes.json';
import sourceIngredients from '../public/seed/ingredients.json';
import type { Recipe } from './types';
const ingredients:Ingredient[]=[{id:'gin',name_zh:'金酒',name_en:'Gin',role:'base',potential_allergens:[],abv_fraction:.4,kcal_per_100ml:null}];
const target:Target={taste_bps:[5000,2000,1000,1000,1000],sensory_0_10:[0,1,2,3,4,5,6]};
const valid=():RecipeDraft=>({...blankRecipeDraft(),name_en:'Night cup',ingredients:[{...emptyRecipeIngredient(),ingredient_id:'gin',quantity:30}],steps_zh:['Stir with ice.']});
describe('personal recipe editor state and bilingual presentation',()=>{
 it('starts neutral and applies the workbench target only by explicit copying',()=>{
   const blank=initialRecipeDraft();expect(blank.taste_bps).toEqual([2000,2000,2000,2000,2000]);expect(blank.sensory_0_10).toEqual([5,5,5,5,5,5,5]);const next=withCurrentTaste(blank,target);expect(next.taste_bps).toEqual(target.taste_bps);expect(next.sensory_0_10).toEqual(target.sensory_0_10);expect(next.taste_bps).not.toBe(target.taste_bps);expect(blank.taste_bps).not.toEqual(next.taste_bps);
 });
 it('deep copies source drafts without losing unknown doses ranges notes or alternative IDs',()=>{
   const source=valid();source.ingredients[0]={...source.ingredients[0],quantity:null,quantity_range:[.1,.4],unit:'dash',quantity_note:'Private measure',allowed_alternatives:['vodka']};const before=JSON.stringify(source),copy=initialRecipeDraft(source);
   expect(copy).toEqual(source);copy.ingredients[0].allowed_alternatives.push('rum');copy.taste_bps[0]=100;expect(JSON.stringify(source)).toBe(before);
   const prepared=prepareRecipeDraft(source,' First step.\r\n\nSecond step. ');expect(prepared.steps_zh).toEqual(['First step.','Second step.']);expect(prepared.ingredients).toEqual(source.ingredients);expect(prepared.ingredients).not.toBe(source.ingredients);
 });
 it('keeps five integer taste weights conserving 10000 and does not alter sensory values',()=>{
   let draft=valid();for(let i=0;i<300;i++){draft=withTastePercent(draft,i%5,(i*31)%101);expect(draft.taste_bps.reduce((sum,n)=>sum+n,0)).toBe(10000);expect(draft.taste_bps.every(Number.isInteger)).toBe(true);expect(draft.sensory_0_10).toEqual([5,5,5,5,5,5,5]);}
 });
 it('rejects invalid names quantities unknown ingredients taste and executable source URLs',()=>{
   expect(recipeDraftErrors(valid(),ingredients)).toEqual([]);expect(recipeDraftErrors(blankRecipeDraft(),ingredients).length).toBeGreaterThan(1);
   for(const quantity of [-1,0,Infinity,NaN,10001])expect(recipeDraftErrors({...valid(),ingredients:[{...valid().ingredients[0],quantity}]},ingredients)).toContain('剂量必须大于0且不超过10000，范围从小到大。');
   expect(recipeDraftErrors({...valid(),source_url:'javascript:alert(1)'},ingredients)).toContain('来源网址须为不含账号密码的HTTP或HTTPS地址。');expect(recipeDraftErrors({...valid(),source_url:'https://user:secret@example.com'},ingredients)).toHaveLength(1);
   expect(recipeDraftErrors({...valid(),ingredients:[{...valid().ingredients[0],ingredient_id:'not-catalog'}]},ingredients)).toContain('请选择目录中的有效原料。');expect(recipeDraftErrors({...valid(),taste_bps:[1,2,3,4,5]},ingredients)).toContain('五味必须合计100%。');
 });
 it('accepts an explicitly unknown dose without fabricating a volume',()=>{
   const draft=valid();draft.ingredients[0].quantity=null;draft.ingredients[0].unit='to_taste';expect(recipeDraftErrors(draft,ingredients)).toEqual([]);expect(prepareRecipeDraft(draft,'Stir.').ingredients[0].quantity).toBeNull();
 });
 it('renders Chinese by default and a complete English editor with all catalog options',()=>{
   const props={ingredients,initial:valid(),initialTarget:target,onSave:async()=>{},onCancel:()=>{}};
   const zh=renderToStaticMarkup(<RecipeEditor {...props}/>);expect(zh).toContain('使用当前味觉');expect(zh).toContain('金酒');expect(zh).not.toContain('未验证先验');
   const en=renderToStaticMarkup(<I18nProvider language="en"><RecipeEditor {...props}/></I18nProvider>);expect(en).toContain('Use current taste');expect(en).toContain('Gin');expect(en).toContain('Save custom recipe');expect(en).not.toMatch(/[\u3400-\u9fff]/);
 });
 it('accepts copied source recipe drafts without changing original quantities or source records',()=>{
   const records=sourceRecipes.recipes as unknown as Recipe[],directory=sourceIngredients.ingredients as Ingredient[],before=JSON.stringify(sourceRecipes);
   for(const recipe of records){const draft=recipeDraft(recipe);expect(recipeDraftErrors(draft,directory),recipe.id).toEqual([]);expect(prepareRecipeDraft(draft,draft.steps_zh.join('\n')).ingredients,recipe.id).toEqual(recipe.ingredients);}
   expect(JSON.stringify(sourceRecipes)).toBe(before);
 });
});
