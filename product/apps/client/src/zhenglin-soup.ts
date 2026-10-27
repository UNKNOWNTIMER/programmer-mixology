import type { Recipe } from './types';
import { isZhenglinSoup } from './glass-appearance';

export const ZHENGLIN_SOURCE_SHA256='a7779e4a7fbd8ac69b0daee3f9d445ad360a8317ba1fe909fac668bbe2dde90b';
export const ZHENGLIN_QUOTE={zh:'从宏观宇宙到微观尽头，我们不过一瞬。',en:'From the vast cosmos to the smallest depths, we are only an instant.'};
/** Source-specific calculation assumptions are separate from actual SKU labels. */
export function hasZhenglinDocument(recipe:Recipe):boolean {
  return isZhenglinSoup(recipe)&&recipe.notes_zh.includes(ZHENGLIN_SOURCE_SHA256);
}
export function zhenglinQuote(recipe:Recipe,language:'zh'|'en'):string|undefined {
  return isZhenglinSoup(recipe)?ZHENGLIN_QUOTE[language]:undefined;
}
