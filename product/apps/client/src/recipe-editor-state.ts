import type { RecipeDraft } from './recipe-library';
import type { Ingredient, RecipeIngredient, Target } from './types';
import { redistribute, validateTaste } from './domain';

export function blankRecipeDraft():RecipeDraft {
  return {name_zh:'',name_en:'',family:'sour',glass_template:'coupe',method:'shake',ingredients:[],steps_zh:[],garnish_zh:'',notes_zh:'',source_url:null,taste_bps:[2000,2000,2000,2000,2000],sensory_0_10:[5,5,5,5,5,5,5]};
}
export function initialRecipeDraft(initial?:RecipeDraft):RecipeDraft{return initial?structuredClone(initial):blankRecipeDraft();}
export function emptyRecipeIngredient():RecipeIngredient{return {ingredient_id:'',quantity:null,unit:'ml',stage:'mix',optional:false,quantity_note:null,allowed_alternatives:[]};}
export function withCurrentTaste(draft:RecipeDraft,target:Target):RecipeDraft {
  validateTaste(target.taste_bps);
  if(target.sensory_0_10.length!==7||target.sensory_0_10.some(n=>!Number.isFinite(n)||n<0||n>10))throw Error('七维必须在0到10之间。');
  return {...draft,taste_bps:[...target.taste_bps],sensory_0_10:[...target.sensory_0_10]};
}
export function withTastePercent(draft:RecipeDraft,axis:number,percent:number):RecipeDraft {
  return Number.isFinite(percent)?{...draft,taste_bps:redistribute(draft.taste_bps,axis,Math.round(percent)*100,[])}:draft;
}
export function prepareRecipeDraft(draft:RecipeDraft,stepsText:string):RecipeDraft {
  return {...structuredClone(draft),name_zh:draft.name_zh.trim(),name_en:draft.name_en.trim(),steps_zh:stepsText.split(/\r?\n/).map(step=>step.trim()).filter(Boolean),source_url:draft.source_url?.trim()||null};
}
export function recipeDraftErrors(draft:RecipeDraft,ingredients:Ingredient[]):string[] {
  const errors:string[]=[],known=new Set(ingredients.map(i=>i.id));
  if(!draft.name_zh.trim()&&!draft.name_en.trim())errors.push('请至少填写一个中文或英文酒名。');
  if(draft.name_zh.length>160||draft.name_en.length>160)errors.push('酒名不能超过160个字符。');
  if(draft.ingredients.length<1||draft.ingredients.length>32)errors.push('请添加1到32项配料。');
  if(draft.ingredients.some(part=>!known.has(part.ingredient_id)))errors.push('请选择目录中的有效原料。');
  if(draft.ingredients.some(part=>part.quantity!==null&&(!Number.isFinite(part.quantity)||part.quantity<=0||part.quantity>10000)||part.quantity_range&&(!part.quantity_range.every(n=>Number.isFinite(n)&&n>0&&n<=10000)||part.quantity_range[0]>part.quantity_range[1]||part.quantity!==null)))errors.push('剂量必须大于0且不超过10000，范围从小到大。');
  if(draft.ingredients.some(part=>!part.unit.trim()||!part.stage.trim()))errors.push('请填写配料单位与制作阶段。');
  if(draft.steps_zh.length<1||draft.steps_zh.length>40||draft.steps_zh.some(step=>!step.trim()||step.length>2000))errors.push('请填写1到40个步骤，每行一步且每步不超过2000字。');
  try{validateTaste(draft.taste_bps);}catch{errors.push('五味必须合计100%。');}
  if(draft.sensory_0_10.length!==7||draft.sensory_0_10.some(n=>!Number.isFinite(n)||n<0||n>10))errors.push('七维必须在0到10之间。');
  if(draft.source_url){try{const url=new URL(draft.source_url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error();}catch{errors.push('来源网址须为不含账号密码的HTTP或HTTPS地址。');}}
  return errors;
}
