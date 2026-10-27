import type { Catalog, Ingredient, Profile, Recipe, Target, Taste } from './types';
export const TASTE_LABELS = ['甜', '酸', '苦', '咸', '鲜'];
export const TASTE_EN = ['SWEET', 'SOUR', 'BITTER', 'SALTY', 'UMAMI'];
export const SENSORY_LABELS = ['酒精感', '香气', '酒体', '气泡', '清凉感', '辣感', '味韵'];
export const GLASS_LABELS: Record<string,string> = { highball: '高球杯', rocks: '古典杯', martini: '马天尼杯', coupe: '碟形香槟杯', flute: '笛形杯', hurricane: '飓风杯', mug: '马克杯', goblet: '高脚杯' };
export const METHOD_LABELS: Record<string,string> = { shake: '摇和', stir: '搅拌', build: '直调', blend: '搅打',shake_top:'摇和后补足',shake_float:'摇和后漂浮',muddle:'捣压',muddle_build:'捣压后直调',layer:'分层' };
export const FAMILY_LABELS: Record<string,string> = { sour: '酸型', spirit_forward: '烈酒型', highball: '长饮', spritz: '气泡', creamy: '奶油', sparkling: '起泡', tiki: '热带', coffee: '咖啡' };
export function validateTaste(value: number[]): asserts value is Taste {
  if (value.length !== 5 || value.some(v => !Number.isInteger(v) || v < 0) || value.reduce((a,b) => a+b,0) !== 10000) throw new Error('五味必须为合计 10000 的非负整数基点');
}
// Browser test-mode parity implementation. Production gestures are verified by the Rust command.
export function redistribute(anchor: Taste, axis: number, requested: number, locked: number[]): Taste {
  validateTaste(anchor);
  if (!Number.isInteger(axis) || axis < 0 || axis > 4 || locked.some(i => !Number.isInteger(i) || i < 0 || i > 4)) throw new Error('无效的味觉轴');
  if (locked.includes(axis)) throw new Error('当前味觉轴已锁定');
  if (!Number.isInteger(requested)) throw new Error('目标必须为整数基点');
  const locks = [...new Set(locked)];
  const budget = 10000 - locks.reduce((s,i) => s + anchor[i],0);
  const others = [0,1,2,3,4].filter(i => i !== axis && !locks.includes(i));
  const value = others.length ? Math.min(budget, Math.max(0, requested)) : budget;
  const rest = budget-value;
  const sum = others.reduce((s,i) => s+anchor[i],0);
  const denominator = sum || others.length || 1;
  const entries = others.map(i => { const numerator = rest*(sum ? anchor[i] : 1); return { i, amount: Math.floor(numerator/denominator), remainder: numerator%denominator }; });
  const out: Taste = [...anchor]; out[axis] = value;
  let remainder = rest-entries.reduce((s,e) => s+e.amount,0);
  entries.sort((a,b) => b.remainder-a.remainder || a.i-b.i);
  for (const e of entries) { out[e.i] = e.amount+(remainder > 0 ? 1 : 0); remainder--; }
  validateTaste(out); return out;
}
export function matchIndex(target: Target, profile: Profile | undefined): number | null {
  if (!profile || profile.taste_preference_bps?.length !== 5 || profile.sensory_0_10?.length !== 7) return null;
  const taste = target.taste_bps.reduce((s,v,i) => s+Math.abs(v-profile.taste_preference_bps[i]),0)/20000;
  const sensory = target.sensory_0_10.reduce((s,v,i) => s+Math.abs(v-profile.sensory_0_10[i]),0)/70;
  return Math.round(Math.max(0,Math.min(100,100*(1-0.6*taste-0.4*sensory)))*10)/10;
}
export function filterRecipes(catalog: Catalog, search: string, inventory: string[], excluded: string[], inventoryOnly: boolean): Recipe[] {
  const query = search.trim().toLocaleLowerCase();
  const names = new Map(catalog.ingredients.map(i => [i.id,`${i.name_zh} ${i.name_en}`]));
  return catalog.recipes.filter(recipe => !recipe.ingredients.some(i => excluded.includes(i.ingredient_id)) && (!inventoryOnly || recipe.ingredients.every(i => i.optional || inventory.includes(i.ingredient_id))) && (!query || `${recipe.name_zh} ${recipe.name_en} ${recipe.family} ${FAMILY_LABELS[recipe.family] || ''} ${recipe.ingredients.map(i => names.get(i.ingredient_id)).join(' ')}`.toLocaleLowerCase().includes(query)));
}
export function quantityText(quantity: number | null, unit: string, servings = 1, quantityRange?: readonly [number, number]): string {
  const label=({tsp:'茶匙',tbsp:'汤匙',drop:'滴',piece:'个',dash:'dash',barspoon:'吧匙'} as Record<string,string>)[unit]||unit;
  // Keep small source fractions, removing only binary arithmetic noise (e.g. 0.1 * 3).
  // A range stays a range; neither its midpoint nor a unit conversion is implied.
  const scaled=(value:number)=>String(Number((value*servings).toPrecision(15)));
  const valid=(value:number)=>Number.isFinite(value)&&value>=0;
  if (Number.isFinite(servings)&&servings>0) {
    if (quantity!==null&&valid(quantity)) return `${scaled(quantity)} ${label}`;
    if (quantityRange?.length===2&&quantityRange.every(valid)&&quantityRange[0]<=quantityRange[1]) return `${scaled(quantityRange[0])}–${scaled(quantityRange[1])} ${label}`;
  }
  return ({ top_up: '加满 · 用量待确认', to_top: '加满 · 用量待确认', splash: '少量 · 用量待确认', rinse: '洗杯 · 留存量待确认', garnish: '装饰 · 用量待确认', to_taste:'按原谱酌量 · 用量待确认', unknown: '原始单位未注明 · 用量待确认' } as Record<string,string>)[unit] || `${label} · 用量待确认`;
}
export function requiredMissing(recipe: Recipe, inventory: string[]) { return recipe.ingredients.filter(i => !i.optional && !inventory.includes(i.ingredient_id)); }
export function ingredientName(ingredients: Ingredient[], id: string) { return ingredients.find(i => i.id === id)?.name_zh || id; }
export function safeSourceUrl(url: string | null) { if (!url) return null; try { const parsed = new URL(url); return parsed.protocol === 'https:' && ['iba-world.com', 'www.thecocktaildb.com'].includes(parsed.hostname) && !parsed.username && !parsed.password && (!parsed.port || parsed.port === '443') ? parsed.href : null; } catch { return null; } }

