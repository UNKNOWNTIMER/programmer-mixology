import type { Recipe } from './types';
import { dlcGlassAppearance } from './dlc-art';

export type GlassGarnish = 'citrus' | 'twist' | 'olive' | 'cherry' | 'herb' | 'sprig' | 'dust' | 'beans' | 'pineapple' | 'berry' | 'passion' | 'cucumber' | 'chili' | 'celery' | 'kiwi' | 'ginger' | 'carrot' | 'grape';
export type GlassPalette = 'clear' | 'gold' | 'amber' | 'ruby' | 'rose' | 'violet' | 'blue' | 'green' | 'cream' | 'coffee' | 'cassis';
export interface GlassAppearance {
  seed: number;
  ice: 'none' | 'cubes' | 'large' | 'crushed';
  foam: 'none' | 'fine' | 'cream';
  garnishes: GlassGarnish[];
  rim: boolean;
  bubbles: boolean;
  hot: boolean;
  palette: GlassPalette;
  /** A recipe-content identity, independent of local-library and imported snapshot IDs. */
  design?: 'zhenglin_nebula' | 'xiaodong_notes';
  nebulaSwirl?: boolean;
  variant?: number;
  layers?: GlassPalette[];
  gradient?: boolean;
}

const ZHENGLIN_CORE:Readonly<Record<string,number>>={gin:45,cassis:15,cointreau:10,lemon:22.5,simple_syrup:7.5};
/** Recognises the user's V1 recipe, never a name-only or arbitrary-ID shortcut. */
export function isZhenglinSoup(recipe:Recipe):boolean {
  if(recipe.name_en.trim().replace(/\s+/g,' ').toLowerCase()!=='zhenglin soup'||recipe.glass_template!=='coupe'||recipe.method!=='shake')return false;
  const core=recipe.ingredients.filter(part=>part.stage==='mix'&&Object.hasOwn(ZHENGLIN_CORE,part.ingredient_id));
  if(core.length!==5||new Set(core.map(part=>part.ingredient_id)).size!==5||core.some(part=>part.unit!=='ml'||part.quantity!==ZHENGLIN_CORE[part.ingredient_id]||part.quantity_range||part.optional))return false;
  return recipe.ingredients.every(part=>{
    if(core.includes(part)||part.stage==='garnish'||part.stage==='side')return true;
    if(part.ingredient_id==='cdb_ice'&&part.stage==='mix'&&part.unit==='g')return true;
    return part.ingredient_id==='user_zhenglin_nebula_foam'&&part.stage==='float'&&part.unit==='ml'&&part.quantity===15&&!part.quantity_range&&part.optional;
  });
}

/** The seed changes surface engraving/texture only. It never invents ingredients or garnish. */
export function glassSeed(value: string): number {
  let seed = 2166136261;
  for (let n = 0; n < value.length; n++) seed = Math.imul(seed ^ value.charCodeAt(n), 16777619);
  return seed >>> 0;
}

/** Editorial colours, not a measured optical/nutrition model or a recipe layer diagram. */
export const GLASS_PALETTES: Record<GlassPalette, { liquid: string; light: string; shadow: string }> = {
  clear: { liquid: '#a4b9ac', light: '#d6d9bc', shadow: '#607b77' },
  gold: { liquid: '#c5b56c', light: '#e2d397', shadow: '#938159' },
  amber: { liquid: '#c29863', light: '#e0ba81', shadow: '#886746' },
  ruby: { liquid: '#c47a70', light: '#dea898', shadow: '#865d59' },
  rose: { liquid: '#c99597', light: '#e4b9ae', shadow: '#906d7b' },
  violet: { liquid: '#a49dc0', light: '#c5bada', shadow: '#756c91' },
  blue: { liquid: '#78abb8', light: '#b1d5d4', shadow: '#567d92' },
  green: { liquid: '#99b584', light: '#c1d2a2', shadow: '#688671' },
  cream: { liquid: '#c5bca4', light: '#e0d7be', shadow: '#8c897c' },
  coffee: { liquid: '#ae9076', light: '#d6b99b', shadow: '#79685b' },
  cassis: { liquid: '#b4638f', light: '#d39bb7', shadow: '#744458' },
};

function paletteFor(ids: string): GlassPalette {
  if (/coffee|espresso|kahlua|tia_maria|chocolate|creme_cacao_brown|cdb_creme_de_cacao/.test(ids)) return 'coffee';
  if (/cream|milk|egg_yolk|advocaat/.test(ids)) return 'cream';
  if (/blue_curacao|hpnotiq/.test(ids)) return 'blue';
  if (/creme_violette/.test(ids)) return 'violet';
  if (/creme_menthe_green|midori|melon_liqueur|pisang_ambon/.test(ids)) return 'green';
  if (/campari|red_wine|ruby_port|cassis|tomato|dubonnet|pomegranate|cherry_heering|sloe_gin|cdb_port/.test(ids)) return 'ruby';
  if (/cranberry|grenadine|raspberry|strawberr|blackberr/.test(ids)) return 'rose';
  if (/cola|sarsaparilla|bourbon|whisk|scotch|cognac|brandy|aged_rum|dark_rum|sweet_vermouth|tawny_port/.test(ids)) return 'amber';
  if (/orange_juice|pineapple|passion|peach|aperol|yellow_chartreuse|apple_juice|champagne|prosecco|sparkling_wine|white_wine|cdb_beer/.test(ids)) return 'gold';
  return 'clear';
}

/** Conservative serving cues: ice in the shaker is not ice in the finished glass. */
export function describeGlass(recipe: Recipe): GlassAppearance {
  if(isZhenglinSoup(recipe))return {
    design:'zhenglin_nebula',seed:glassSeed('zhenglin-soup-v1'),palette:'cassis',ice:'none',rim:false,bubbles:false,hot:false,
    // Optional garnish is depicted when present in the recipe, never inferred from its name.
    foam:recipe.ingredients.some(part=>part.ingredient_id==='user_zhenglin_nebula_foam'&&['float','garnish'].includes(part.stage)&&(part.quantity??part.quantity_range?.[0]??0)>0)?'fine':'none',
    garnishes:recipe.ingredients.some(part=>part.ingredient_id==='cdb_lemon_peel'&&part.stage==='garnish'&&(part.quantity??part.quantity_range?.[0]??0)>0)?['twist']:[],
    nebulaSwirl:recipe.ingredients.some(part=>part.ingredient_id==='cassis'&&part.stage==='garnish'&&(part.quantity??part.quantity_range?.[0]??0)>0),
  };
  const dlc = dlcGlassAppearance(recipe);
  if(dlc)return dlc;
  const steps = recipe.steps_zh.join('；');
  const ids = recipe.ingredients.filter(i => i.stage !== 'garnish' && i.stage !== 'rinse').map(i => i.ingredient_id).join(' ');
  const noServingIce = /不带冰|不加冰.{0,5}(?:供应|饮用|盛)|无冰/.test(steps);
  const servingIce = !noServingIce && (
    /(?:滤入|倒入|注入|倒在|盛入)[^，。；]{0,12}(?:新冰|碎冰|装冰|冰块|块冰|冰上)/.test(steps) ||
    /(?:高球|古典|柯林(?:斯)?|飓风|鸡尾酒|球形|铜|高|大)杯[^，。；]{0,10}(?:装|放|加|盛)[^，。；]{0,5}冰/.test(steps) ||
    /(?:^|[，。；])(?:先在|在|将|另在)?(?:杯中|杯内|杯底|杯)[^，。；]{0,12}(?:装|放|加|盛)[^，。；]{0,5}冰/.test(steps) ||
    /(?:装(?:有|满)?|盛(?:有|满)?|放有)[^，。；]{0,4}冰(?![^，。；]{0,8}(?:调酒|搅拌|混合)杯)[^，。；]{0,8}杯/.test(steps) ||
    /新冰|补(?:碎|方|新)?冰|连冰|冰一起|加方冰|倒在[^，。；]{0,5}冰上/.test(steps) ||
    (!/滤入|过滤|滤出|摇酒器|调酒杯|雪克|摇壶|搅拌杯|混合杯/.test(steps) && /(?:放|加|填入|配合|装)[^，。；]{0,10}冰(?!凉|冷|镇|淇淋)/.test(steps)) ||
    (recipe.method === 'blend' && /(?:加|与|放入|半勺|杯).{0,3}冰/.test(steps))
  );
  const ice = !servingIce ? 'none' : /碎冰/.test(steps) || recipe.method === 'blend' ? 'crushed' : /大(?:块|颗)?冰/.test(steps) ? 'large' : 'cubes';

  // Do not turn source placeholders such as “未指定” or juice instructions into decoration.
  let garnish = recipe.garnish_zh || '';
  if (/未明确.{0,5}装饰|补少量.*汁|未另指定|未指定具体/.test(garnish)) garnish = '';
  garnish = garnish.split(/也可|或|；可|，可另/)[0];
  if (/挤.*皮油/.test(garnish) && !/装饰|放入|加入/.test(garnish)) garnish = garnish.replace(/[^，；。]*挤[^，；。]*皮油[^，；。]*/g, '');
  const garnishes: GlassGarnish[] = [];
  const add = (kind: GlassGarnish, pattern: RegExp) => { if (pattern.test(garnish)) garnishes.push(kind); };
  add('twist', /柠檬皮|橙皮|青柠皮/);
  // “柠檬糖杯口” is a prepared rim, not a slice of lemon.
  if (!/柠檬糖杯口|糖口/.test(garnish)) add('citrus', /(?:柠檬|青柠|橙|葡萄柚|柑橘)(?!皮|汁)[^，；。]{0,2}(?:角|片|轮|圆片)|半片橙|(?:柠檬|青柠|橙子)(?:与|，|$)|橙与/);
  add('olive', /橄榄/);
  add('cherry', /樱桃/);
  add('herb', /薄荷|罗勒/);
  add('sprig', /迷迭香|薰衣草/);
  add('dust', /肉豆蔻|可可|咖啡粉|巧克力碎|巧克力粉/);
  add('beans', /咖啡豆/);
  add('pineapple', /菠萝/);
  add('berry', /草莓|黑莓|蓝莓|覆盆子|浆果|蔓越莓/);
  add('passion', /百香果/);
  add('cucumber', /黄瓜/);
  add('chili', /辣椒/);
  add('celery', /芹菜/);
  add('kiwi', /奇异果/);
  add('ginger', /姜/);
  add('carrot', /胡萝卜/);
  add('grape', /葡萄(?!柚)/);
  const whipped = /打发奶油|奶盖/.test(garnish + steps) || recipe.ingredients.some(i => i.stage === 'float' && /cream/.test(i.ingredient_id));
  const foam = whipped ? 'cream' : /泡沫/.test(steps) || (recipe.method === 'shake' && /egg_white|cdb_egg(?: |$)|espresso/.test(ids)) ? 'fine' : 'none';
  return {
    seed: glassSeed(recipe.id), ice, foam, garnishes: garnishes.slice(0, 3),
    rim: /盐边|盐杯口|糖边|糖口|糖杯口|做的杯口|糖处理杯口/.test(garnish + steps),
    bubbles: /soda|tonic|ginger_beer|ginger_ale|champagne|prosecco|sparkling|cdb_beer|sprite|7_up|lemonade|sarsaparilla/.test(ids),
    hot: /热咖啡|热水|趁热|缓慢加热|耐热杯|热巧克力/.test(steps),
    palette: paletteFor(ids),
  };
}
