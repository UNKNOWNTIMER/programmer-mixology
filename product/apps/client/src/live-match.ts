import { filterRecipes, matchIndex } from './domain';
import type { Catalog, Target, UserState } from './types';
/** Match locally without overwriting the independent target or invoking inference. */
export function matchTarget(state:UserState,target:Target,catalog:Catalog|null):UserState {
  if(!catalog)return {...state,target};
  const profiles=new Map(catalog.profiles.map(p=>[p.recipe_id,p]));
  const candidates=filterRecipes(catalog,'',state.inventory,state.excluded,state.inventoryOnly);
  let selected=state.selected,best=-Infinity;
  for(const recipe of candidates){
    const score=matchIndex(target,profiles.get(recipe.id));
    if(score!==null&&(score>best||(score===best&&recipe.id===state.selected))){best=score;selected=recipe.id;}
  }
  return {...state,target,selected};
}
