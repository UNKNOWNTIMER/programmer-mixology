import type { Ingredient, Recipe } from './types';
import { displayQuantity, UNIT_SOURCE } from './quantity-display';

export interface EstimateRange { min:number; max:number }
export interface IngredientEstimateOverride { abvPercent?:EstimateRange; kcalPer100ml?:EstimateRange }
export interface EstimateOptions {
  language?:'zh'|'en';
  /** Extra water / listed liquid volume; an estimate assumption, never a serving instruction. */
  dilutionFraction?:EstimateRange;
  ingredientOverrides?:Record<string,IngredientEstimateOverride>;
}
export const ESTIMATE_SOURCES=[
  {label:'CDC / NIOSH：乙醇在 20°C 的密度 0.789 g/ml',url:'https://www.cdc.gov/niosh/docs/2003-154/pdfs/1400.pdf'},
  {label:'欧盟委员会 JRC：乙醇 7 kcal/g',url:'https://knowledge4policy.ec.europa.eu/health-promotion-knowledge-gateway/alcoholic-beverages_en'},
  {label:'NIAAA：类别常见示例，烈酒 40%、利口酒 24%、加强葡萄酒 17%、葡萄酒 12%',url:'https://www.niaaa.nih.gov/alcohols-effects-health/what-standard-drink'},
] as const;
const range=(min:number,max:number):EstimateRange=>({min,max});
const valid=(r:EstimateRange|undefined,ceiling=Infinity)=>!!r&&Number.isFinite(r.min)&&Number.isFinite(r.max)&&r.min>=0&&r.min<=r.max&&r.max<=ceiling;
interface CategoryAssumption { name:string; abv:EstimateRange; nonAlcoholKcal:EstimateRange }
// These broad bounds are editorial assumptions; the sources do not certify the bounds or a SKU.
const CATEGORIES:Record<string,CategoryAssumption>={
  spirit:{name:'普通烈酒',abv:range(35,50),nonAlcoholKcal:range(0,20)},
  liqueur:{name:'利口酒',abv:range(15,40),nonAlcoholKcal:range(60,180)},
  bitter_liqueur:{name:'苦味利口酒',abv:range(15,40),nonAlcoholKcal:range(40,160)},
  bitters:{name:'浓缩苦精',abv:range(30,50),nonAlcoholKcal:range(0,100)},
  fortified_wine:{name:'加强葡萄酒',abv:range(14,22),nonAlcoholKcal:range(0,80)},
  aperitif_wine:{name:'开胃葡萄酒',abv:range(14,20),nonAlcoholKcal:range(20,100)},
  wine:{name:'葡萄酒',abv:range(9,16),nonAlcoholKcal:range(0,40)},
  sparkling_wine:{name:'起泡葡萄酒',abv:range(9,14),nonAlcoholKcal:range(0,35)},
  acid:{name:'柑橘汁',abv:range(0,0),nonAlcoholKcal:range(15,40)},
  juice:{name:'果蔬汁',abv:range(0,0),nonAlcoholKcal:range(15,75)},
  fruit:{name:'液态果泥',abv:range(0,0),nonAlcoholKcal:range(20,100)},
  carbonated:{name:'含糖汽水',abv:range(0,0),nonAlcoholKcal:range(20,60)},
  sweetener:{name:'液态糖浆',abv:range(0,0),nonAlcoholKcal:range(180,350)},
  cream:{name:'奶油或椰奶油',abv:range(0,0),nonAlcoholKcal:range(180,400)},
  coffee:{name:'无糖咖啡',abv:range(0,0),nonAlcoholKcal:range(0,10)},
  foam:{name:'蛋白',abv:range(0,0),nonAlcoholKcal:range(40,65)},
  protein:{name:'蛋黄',abv:range(0,0),nonAlcoholKcal:range(250,350)},
  water:{name:'水',abv:range(0,0),nonAlcoholKcal:range(0,0)},
};
function assumptionFor(i:Ingredient):CategoryAssumption|undefined {
  if(i.id==='soda'||i.id==='water')return CATEGORIES.water;
  if(i.id==='absinthe')return {name:'苦艾酒',abv:range(55,74),nonAlcoholKcal:range(0,30)};
  if(/overproof/.test(i.id))return {name:'高度朗姆酒',abv:range(57,75),nonAlcoholKcal:range(0,20)};
  if(i.id==='green_chartreuse')return {name:'绿查特酒',abv:range(50,57),nonAlcoholKcal:range(80,180)};
  if(['tawny_port','amontillado_sherry','palo_cortado'].includes(i.id))return CATEGORIES.fortified_wine;
  // Unknown modifiers, seasoning and solid herbs have no automatic category conversion.
  return CATEGORIES[i.role];
}
export interface DrinkEstimates {
  abvPercent:EstimateRange|null; caloriesKcal:EstimateRange|null;
  baseVolumeMl:number|null; servedVolumeMl:EstimateRange|null;
  assumptions:string[]; reasons:string[]; sources:readonly {label:string;url:string}[];
}
export function estimateDrink(recipe:Recipe,ingredients:Ingredient[],options:EstimateOptions={}):DrinkEstimates {
  const en=options.language==='en',say=(zh:string,english:string)=>en?english:zh;
  const assumptions:string[]=[],reasons:string[]=[],abvReasons:string[]=[],kcalReasons:string[]=[];
  let volume=0,ethanolMin=0,ethanolMax=0,kcalMin=0,kcalMax=0,amountsComplete=true;
  const entries=recipe.ingredients.filter(part=>part.stage!=='garnish');
  for(const part of entries){
    const i=ingredients.find(item=>item.id===part.ingredient_id),name=(en?i?.name_en:i?.name_zh)||part.ingredient_id;
    const display=displayQuantity(part,i,1,en?'en':'zh'),quantity=display.ml;
    if(part.stage==='rinse'||!['mix','top','float'].includes(part.stage)||quantity===null||!Number.isFinite(quantity)||quantity<=0){amountsComplete=false;reasons.push(`${name}: ${part.stage==='rinse'?say('冲洗留存量未知','Unknown retained rinse volume'):say(`原单位 ${part.unit} 的液体量或留存量无法确定`,`Liquid or retained volume cannot be established from ${part.unit}`)}`);continue;}
    if(display.note)assumptions.push(`${name}: ${display.note}`);
    volume+=quantity;
    const category=i&&assumptionFor(i),override=options.ingredientOverrides?.[part.ingredient_id];
    let abv:EstimateRange|undefined,kcal:EstimateRange|undefined;
    if(override?.abvPercent!==undefined){if(valid(override.abvPercent,100)){abv=override.abvPercent;assumptions.push(`${name}: ${say('自定酒精度假设','Custom ABV assumption')} ${abv.min}–${abv.max}%`);}else abvReasons.push(`${name}: ${say('酒精度假设无效','Invalid ABV assumption')}`);}
    else if(i?.abv_fraction!==null&&i?.abv_fraction!==undefined&&Number.isFinite(i.abv_fraction)&&i.abv_fraction>=0&&i.abv_fraction<=1){abv=range(i.abv_fraction*100,i.abv_fraction*100);assumptions.push(`${name}: ${say('目录酒精度','Catalog ABV')} ${abv.min}%`);}
    else if(category){abv=category.abv;assumptions.push(`${name}: ${say(`按${category.name}编辑假设`,`Editorial category assumption (${i?.role||'unknown'})`)} ${abv.min}–${abv.max}%`);}
    if(!abv)abvReasons.push(`${name}: ${say('缺少酒精度基础','Missing ABV basis')}`);
    else {ethanolMin+=quantity*abv.min/100;ethanolMax+=quantity*abv.max/100;}
    if(override?.kcalPer100ml!==undefined){if(valid(override.kcalPer100ml)){kcal=override.kcalPer100ml;assumptions.push(`${name}: ${say('自定总热量假设','Custom total energy assumption')} ${kcal.min}–${kcal.max} kcal/100 ml`);}else kcalReasons.push(`${name}: ${say('热量假设无效','Invalid energy assumption')}`);}
    else if(i?.kcal_per_100ml!==null&&i?.kcal_per_100ml!==undefined&&Number.isFinite(i.kcal_per_100ml)&&i.kcal_per_100ml>=0){kcal=range(i.kcal_per_100ml,i.kcal_per_100ml);assumptions.push(`${name}: ${say('目录总热量','Catalog total energy')} ${kcal.min} kcal/100 ml`);}
    else if(category&&abv){kcal=range(abv.min*.789*7+category.nonAlcoholKcal.min,abv.max*.789*7+category.nonAlcoholKcal.max);assumptions.push(`${name}: ${say('非酒精热量编辑假设','Editorial non-alcohol energy assumption')} ${category.nonAlcoholKcal.min}–${category.nonAlcoholKcal.max} kcal/100 ml; ${say('另加乙醇能量','plus ethanol energy')}`);}
    if(!kcal)kcalReasons.push(`${name}: ${say('缺少总热量基础','Missing total energy basis')}`);else {kcalMin+=quantity*kcal.min/100;kcalMax+=quantity*kcal.max/100;}
  }
  if(!entries.length||volume<=0){amountsComplete=false;reasons.push(say('没有可用的成杯液体剂量','No usable liquid serving volume'));}
  const defaultDilution:Record<string,EstimateRange>={shake:range(.15,.35),stir:range(.1,.3),build:range(0,.25),blend:range(.1,.5),throw:range(.1,.3),layer:range(0,.05)};
  const dilution=options.dilutionFraction||defaultDilution[recipe.method]||range(0,.3),dilutionValid=valid(dilution,2);
  if(dilutionValid)assumptions.push(say(`${options.dilutionFraction?'自定':'编辑'}融水假设：原液体积的 ${Math.round(dilution.min*100)}–${Math.round(dilution.max*100)}%；未实测，未计体积收缩`,`${options.dilutionFraction?'Custom':'Editorial'} dilution: ${Math.round(dilution.min*100)}–${Math.round(dilution.max*100)}% of base volume; unmeasured, volume contraction excluded.`));
  else reasons.push(say('融水比例假设无效','Invalid dilution assumption'));
  assumptions.push(say('乙醇能量 = 体积 ml × 酒精度小数 × 0.789 g/ml × 7 kcal/g；类别上下界是编辑假设，不是实测或统计置信区间。','Ethanol energy = ml × ABV fraction × 0.789 g/ml × 7 kcal/g. Category bounds are editorial assumptions, not measured confidence intervals.'),say('装饰默认不食用；所有列出的非装饰可选项按加入估量；实际品牌、糖量、温度与融冰可超出此范围。','Garnishes are assumed uneaten; all listed optional non-garnish ingredients are included. Actual brands, sugar, temperature and dilution may fall outside these bounds.'));
  const servedVolumeMl=amountsComplete&&dilutionValid?range(volume*(1+dilution.min),volume*(1+dilution.max)):null;
  const sourceLabels=['CDC / NIOSH: ethanol density at 20°C, 0.789 g/ml','European Commission JRC: ethanol energy, 7 kcal/g','NIAAA: illustrative category alcohol strengths'];
  return {abvPercent:servedVolumeMl&&!abvReasons.length?range(ethanolMin/servedVolumeMl.max*100,ethanolMax/servedVolumeMl.min*100):null,
    caloriesKcal:amountsComplete&&!kcalReasons.length?range(kcalMin,kcalMax):null,
    baseVolumeMl:amountsComplete?volume:null,servedVolumeMl,assumptions,reasons:[...new Set([...reasons,...abvReasons,...kcalReasons])],sources:[...ESTIMATE_SOURCES.map((source,index)=>({...source,label:en?sourceLabels[index]:source.label})),{label:say('NIST：公制与美制容量换算约定','NIST: metric and U.S. customary volume factors'),url:UNIT_SOURCE}]};
}
export function formatEstimate(value:EstimateRange|null,unit:'%'|'kcal'|'ml',language:'zh'|'en'='zh'):string {
  if(!value)return language==='en'?'Unknown':'无法估';
  const places=unit==='%'?1:0,min=value.min.toFixed(places),max=value.max.toFixed(places);
  return `≈${min===max?min:`${min}–${max}`}${unit==='%'?'%':` ${unit}`} · ${language==='en'?'est.':'估'}`;
}
