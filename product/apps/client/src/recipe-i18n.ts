import recipeEnglish from './recipe-english.json';
import type { Ingredient, Recipe } from './types';
import { translate, type Language } from './i18n';
interface EnglishRecipe {signature:string;source_url:string|null;steps:string[];garnish:string;notes:string;ingredient_notes:(string|null)[];variant:string;translation_basis:string}
/** Content guard prevents a built-in translation being applied to a changed/imported recipe with the same ID. */
export function recipeTranslationSignature(recipe:Recipe):string {
  const data=JSON.stringify([recipe.name_en,recipe.steps_zh,recipe.garnish_zh,recipe.notes_zh,recipe.ingredients.map(p=>[p.ingredient_id,p.quantity,p.quantity_range||null,p.unit,p.optional,p.stage,p.quantity_note,p.allowed_alternatives])]);
  let hash=2166136261;for(let i=0;i<data.length;i++)hash=Math.imul(hash^data.charCodeAt(i),16777619)>>>0;
  return `${data.length}:${hash.toString(16).padStart(8,'0')}`;
}
/** Display-only copy; identifiers, dose values, source and review state stay untouched. */
export function localizedRecipe(recipe:Recipe,language:Language):Recipe {
  if(language==='zh')return recipe;
  const entry=(recipeEnglish as Record<string,EnglishRecipe>)[recipe.id];
  if(!entry||entry.source_url!==recipe.source.url||entry.signature!==recipeTranslationSignature(recipe))return recipe;
  return {...recipe,variant:entry.variant,steps_zh:[...entry.steps],garnish_zh:entry.garnish,notes_zh:entry.notes,ingredients:recipe.ingredients.map((part,i)=>({...part,quantity_note:entry.ingredient_notes[i]}))};
}
export function ingredientName(ingredient:Ingredient|undefined,language:Language,fallback=''):string{return ingredient?(language==='en'?ingredient.name_en:ingredient.name_zh):fallback;}
export function methodName(method:string,language:Language):string {const names:Record<string,string>={shake:'摇和',stir:'搅拌',build:'直调',blend:'搅打'};return translate(names[method]||method,language);}
export function recipeName(recipe:Recipe,language:Language):string{return language==='en'?recipe.name_en:recipe.name_zh;}
