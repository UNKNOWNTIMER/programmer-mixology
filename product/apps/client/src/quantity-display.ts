import type { Ingredient, RecipeIngredient } from './types';
import { quantityText } from './domain';

export const UNIT_SOURCE = 'https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8';
export interface DisplayQuantity { text:string; note:string; ml:number|null; converted:boolean; assumed:boolean }
const exact:Record<string,{factor:number;unit:string}>={ml:{factor:1,unit:'ml'},cl:{factor:10,unit:'ml'},dl:{factor:100,unit:'ml'},l:{factor:1000,unit:'ml'},g:{factor:1,unit:'g'},kg:{factor:1000,unit:'g'},mg:{factor:.001,unit:'g'},oz_weight:{factor:28.349523125,unit:'g'},lb:{factor:453.59237,unit:'g'},us_fl_oz:{factor:29.5735295625,unit:'ml'},imperial_fl_oz:{factor:28.4130625,unit:'ml'}};
const customary:Record<string,number>={oz:29.5735295625,'fl oz':29.5735295625,tsp:4.92892159375,tbsp:14.78676478125,cup:236.5882365};
const labels:Record<string,[string,string]>={tsp:['茶匙','tsp'],tbsp:['汤匙','tbsp'],drop:['滴','drop'],piece:['个','piece'],whole:['个','whole'],leaf:['片叶','leaf'],slice:['片','slice'],sprig:['枝','sprig'],cube:['块','cube'],barspoon:['吧匙','barspoon'],shot:['shot','shot'],part:['份比例','part'],glass:['杯','glass'],jigger:['量酒器','jigger'],serving:['份','serving'],pinch:['撮','pinch'],bottle:['瓶','bottle'],scoop:['勺','scoop'],few_drops:['少量滴数','a few drops'],few_dashes:['少量dash','a few dashes']};
export function isLiquidIngredient(ingredient?:Ingredient):boolean {
  if(!ingredient)return false;
  const name=`${ingredient.id} ${ingredient.name_en}`.toLowerCase();
  if(/ice[_ ]cream|whipped[_ ]cream|(?:^|[_ ])powder|peel|nutmeg|(?:^|[_ ])sugar(?:$|[_ ])/i.test(name)&&!/syrup/.test(name))return false;
  if(['spirit','liqueur','bitter_liqueur','fortified_wine','juice','acid','carbonated','sparkling_wine','wine','water','coffee'].includes(ingredient.role))return true;
  return /rum|vodka|whisk|bourbon|brandy|gin\b|tequila|liqueur|schnapps|vermouth|curacao|cacao|cream|milk|nectar|juice|syrup|grenadine|soda|beer|wine|port\b|sherry|lemonade|tonic|tea\b|chocolate|amaro|anisette|applejack|dubonnet|galliano|hpnotiq|kirsch|malibu|midori|sloe|sour|southern|tia.maria|wild.turkey|jack.daniels|7.up|falernum/.test(name);
}
const number=(value:number,rounded:boolean)=>rounded?String(Number(value!==0&&Math.abs(value)<.01?value.toPrecision(3):value.toFixed(2))):String(Number(value.toPrecision(15)));
/** Display conventions never rewrite source doses or immutable order/archive snapshots. */
export function displayQuantity(part:RecipeIngredient,ingredient?:Ingredient,servings=1,language:'zh'|'en'='zh'):DisplayQuantity {
  const en=language==='en',unit=part.unit.toLowerCase(),liquid=isLiquidIngredient(ingredient);
  const convention=customary[unit]!==undefined&&(unit!=='oz'||liquid);
  const conversion=exact[unit]||(convention?{factor:customary[unit],unit:'ml'}:undefined);
  const valid=(v:number)=>Number.isFinite(v)&&v>=0;
  const amounts=part.quantity!==null&&valid(part.quantity)?[part.quantity]:part.quantity_range?.length===2&&part.quantity_range.every(valid)&&part.quantity_range[0]<=part.quantity_range[1]?[...part.quantity_range]:null;
  if(amounts&&Number.isFinite(servings)&&servings>0){
    const converted=!!conversion&&(conversion.factor!==1||unit!==conversion.unit),factor=conversion?.factor||1;
    const text=`${convention?'≈':''}${amounts.map(n=>number(n*servings*factor,converted)).join('–')} ${conversion?.unit||labels[unit]?.[en?1:0]||part.unit}`;
    const original=`${amounts.map(n=>number(n*servings,false)).join('–')} ${part.unit}`;
    const note=converted?en?`Source: ${original}. ${convention?'Display convention: U.S. customary volume; the source does not specify the regional standard. ':''}Source doses are retained.`:`原量：${original}。${convention?'显示按美制容量换算；来源未注明地区规格。':''}原配方剂量保留。`:'';
    return {text,note,ml:amounts.length===1&&conversion?.unit==='ml'&&(unit==='ml'||liquid)?amounts[0]*factor:null,converted,assumed:convention};
  }
  const unknown:Record<string,[string,string]>={to_top:['加满 · 用量待确认','Top up · amount unspecified'],top_up:['加满 · 用量待确认','Top up · amount unspecified'],splash:['少量 · 用量待确认','Splash · amount unspecified'],rinse:['洗杯 · 留存量待确认','Rinse · retained amount unknown'],garnish:['装饰 · 用量待确认','Garnish · amount unspecified'],to_taste:['按原谱酌量 · 用量待确认','To taste · amount unspecified'],unknown:['原始单位未注明 · 用量待确认','Unit and amount unspecified']};
  return {text:unknown[unit]?.[en?1:0]||(en?`${labels[unit]?.[1]||part.unit} · amount unspecified`:quantityText(part.quantity,part.unit,servings,part.quantity_range)),note:'',ml:null,converted:false,assumed:false};
}
