import type { Ingredient, Recipe, RecipeIngredient } from './types';
import { estimateDrink, type DrinkEstimates, type EstimateRange } from './estimates';
import { ingredientEstimateBasis } from './estimate-ingredient-assumptions';
import { recipeTranslationSignature } from './recipe-i18n';
import { hasZhenglinDocument } from './zhenglin-soup';
import { dlcRecipeId } from './dlc-art';

// AI-assisted editorial assumptions, not source doses or a ServingSpec. The model
// supplies no final calories/ABV; this versioned, bounded calculator owns the result.
export const ASSISTED_ESTIMATE_VERSION='2026-09-22.2';
type Range=EstimateRange;
type Basis=NonNullable<ReturnType<typeof ingredientEstimateBasis>>;
const r=(min:number,max=min):Range=>({min,max});
const mul=(a:Range,b:Range):Range=>r(a.min*b.min,a.max*b.max);
const scale=(a:Range,b:number):Range=>r(a.min*b,a.max*b);
const add=(a:Range,b:Range):Range=>r(a.min+b.min,a.max+b.max);
const valid=(a:Range,max=1e6)=>Number.isFinite(a.min)&&Number.isFinite(a.max)&&a.min>=0&&a.min<=a.max&&a.max<=max;
interface Portion { ml:Range; grams?:Range; note:string }
export interface EstimatedContribution { ingredientId:string; volumeMl:Range; abvPercent:Range; caloriesKcal:Range; basis:string; amountGroup?:string }
export interface AssistedDrinkEstimates extends DrinkEstimates {
  estimateVersion:string; portions:Range; contributions:EstimatedContribution[]; mainDrinkOnly?:boolean;
}
const GLASS:Record<string,Range>={rocks:r(110,170),coupe:r(100,160),martini:r(100,160),highball:r(200,300),hurricane:r(250,380),goblet:r(180,280),mug:r(200,300),flute:r(120,180)};
const LIQUID_UNITS:Record<string,number>={ml:1,cl:10,dl:100,l:1000,oz:29.5735295625,'fl oz':29.5735295625,us_fl_oz:29.5735295625,imperial_fl_oz:28.4130625,tsp:4.92892159375,tbsp:14.78676478125,cup:236.5882365};
const SOLID_KINDS=new Set(['sugar','herb','spice','salt','cookie']);
const BATCH:Record<string,{signature:string;portions:Range}>={
  cdb_13020:{signature:'781:303ad774',portions:r(6,8)},
  cdb_12944:{signature:'821:1c438059',portions:r(5,6)},
  cdb_12726:{signature:'547:717a7220',portions:r(2)},
};
function batchFor(recipe:Recipe){const b=BATCH[recipe.id];return b&&recipe.source.url===`https://www.thecocktaildb.com/drink/${recipe.id.slice(4)}`&&recipeTranslationSignature(recipe)===b.signature?b:undefined;}
function count(p:RecipeIngredient):Range|undefined {
  if(p.quantity!==null)return Number.isFinite(p.quantity)&&p.quantity>0?r(p.quantity):undefined;
  if(p.quantity_range){const q=r(...p.quantity_range);return valid(q)&&q.min>0?q:undefined;}
  return undefined;
}
function fruitCount(p:RecipeIngredient):Range {
  const numeric=count(p);if(numeric)return numeric;
  // Read numbers only; recipe prose can never become an instruction or executable.
  const source=p.quantity_note?.match(/原计量：([^。；]+)/)?.[1]||'';
  const fraction=source.match(/(?:Juice of\s*)?(\d+)\/(\d+)/i);
  if(fraction&&+fraction[2]>0&&+fraction[1]/+fraction[2]<=10)return r(+fraction[1]/+fraction[2]);
  const whole=source.match(/(?:Juice of\s*)?(\d+)/i);
  return whole&&+whole[1]>0&&+whole[1]<=20?r(+whole[1]):r(1);
}
function solidPortion(p:RecipeIngredient,b:Basis):Portion|undefined {
  const n=count(p)||r(1),u=p.unit;
  let g:Range|undefined;
  if(u==='g')g=n;else if(u==='kg')g=scale(n,1000);else if(u==='oz'||u==='oz_weight')g=scale(n,28.349523125);
  else if(b.kind==='sugar'){
    const measures:Record<string,Range>={tsp:r(3,5),barspoon:r(3,5),tbsp:r(10,15),cup:r(180,220),cube:r(3,5),pinch:r(.2,.6),dash:r(.2,.6),unknown:r(3,8)};
    if(measures[u])g=mul(n,measures[u]);
  }else if(b.kind==='cookie'&&['whole','piece','unknown'].includes(u))g=mul(n,r(9,13));
  else if(['herb','spice','salt'].includes(b.kind)){
    const measures:Record<string,Range>={leaf:r(.1,.4),sprig:r(.4,1.5),slice:r(.5,2),piece:r(.1,1),whole:r(.1,2),tsp:r(.5,2),tbsp:r(1.5,6),dash:r(.1,.5),pinch:r(.1,.5),to_taste:r(.1,.8),unknown:r(.1,2)};
    if(measures[u])g=mul(n,measures[u]);
    // Herbs/spices are mostly strained, not eaten; extraction contributes a range.
    if(g&&b.kind!=='salt')g=mul(g,r(0,.25));
  }
  if(!g)return undefined;
  return {grams:g,ml:mul(g,b.kind==='sugar'?r(.6,.65):r(.5,1)),note:'solid-mass / retained contribution'};
}
function portion(p:RecipeIngredient,i:Ingredient,b:Basis,recipe:Recipe,partScale:Range):Portion|undefined {
  const n=count(p),unit=p.unit;
  if(p.stage==='rinse')return {ml:r(.1,Math.min(2,(n?.max||2)*(LIQUID_UNITS[unit]||1))),note:'retained rinse only'};
  if(b.kind==='ice')return {ml:r(0),grams:r(0),note:'ice handled once in method dilution'};
  if(SOLID_KINDS.has(b.kind))return solidPortion(p,b);
  // Explicit mass and capacity units precede count-unit assumptions for fruit,
  // eggs and desserts too: 50 g of lime must never become 50 whole limes.
  const massUnits:Record<string,number>={g:1,kg:1000,mg:.001,oz_weight:28.349523125,lb:453.59237};
  if(n&&massUnits[unit]){
    const grams=scale(n,massUnits[unit]);
    const density=b.kind==='honey'?r(1.3,1.45):b.kind==='ice_cream'?r(.65,1.1):r(.9,1.15);
    return {grams,ml:r(grams.min/density.max,grams.max/density.min),note:'source mass / edible density assumption'};
  }
  if(n&&LIQUID_UNITS[unit])return {ml:scale(n,LIQUID_UNITS[unit]),note:unit==='ml'?'source volume':'source volume conversion'};
  if(b.kind==='fruit'&&!LIQUID_UNITS[unit]){
    if(!['whole','piece','slice','unknown'].includes(unit))return undefined;
    let yieldMl:Range;
    if(i.id==='lime_fruit')yieldMl=r(20,40);
    else if(i.id==='lemon_fruit')yieldMl=r(30,55);
    else if(i.id==='orange_fruit'||i.id==='cdb_blood_orange')yieldMl=r(50,90);
    else if(i.id==='cdb_kiwi')yieldMl=r(35,65);
    else if(i.id==='dlc_xd_green_grapes')yieldMl=r(2,6);
    else if(/blueberr/.test(i.id))yieldMl=r(.5,1.5);
    else if(/strawberr|blackberr/.test(i.id))yieldMl=r(5,15);
    else if(/cherr/.test(i.id))yieldMl=r(3,7);
    else yieldMl=r(10,25); // Explicit known fruit whitelist; pieces, never a whole pineapple.
    if(unit==='slice')yieldMl=scale(yieldMl,.12);
    return {ml:mul(fruitCount(p),yieldMl),note:'fruit juice / pulp yield'};
  }
  if(b.kind==='ice_cream'){
    if(!['scoop','unknown'].includes(unit))return undefined;
    const factor=r(40,70);
    return {ml:mul(n||r(1),factor),note:'melted ice cream volume'};
  }
  if(b.kind.startsWith('egg')&&(unit==='whole'||unit==='unknown')){
    return {ml:mul(n||r(1),b.kind==='egg_white'?r(25,35):b.kind==='egg_yolk'?r(15,20):r(40,55)),note:'edible egg volume'};
  }
  const measure:Record<string,Range>={dash:r(.5,1),drop:r(.03,.06),few_drops:r(.1,.3),few_dashes:r(1,3),barspoon:r(4,6),shot:r(25,45),jigger:r(30,45),splash:r(5,15),serving:r(25,40),bottle:r(700,750),glass:GLASS[recipe.glass_template]||r(150,250),part:partScale};
  if(measure[unit])return {ml:mul(n||r(1),measure[unit]),note:`${unit} measure assumption`};
  if(unit!=='unknown'&&unit!=='to_taste'&&unit!=='ml')return undefined;
  if(b.kind==='sauce')return {ml:r(.2,2),note:'seasoning amount'};
  const byKind:Record<string,Range>={spirit:r(30,50),liqueur:r(10,25),wine:r(60,100),fortified_wine:r(15,30),beer:r(100,180),juice:r(60,120),acid:r(15,30),syrup:r(5,20),honey:r(5,15),cream:r(15,40),milk:r(90,150),water:r(60,120),coffee:r(25,50),bitters:r(.5,2),floral_water:r(.1,1)};
  const fallback=byKind[b.kind];return fallback?{ml:fallback,note:'missing quantity / category serving assumption'}:undefined;
}
function dilution(recipe:Recipe):Range {
  if(batchFor(recipe)||/hot|heat/.test(recipe.method)||recipe.ingredients.some(p=>['hot_coffee','cdb_hot_chocolate'].includes(p.ingredient_id)))return r(0);
  if(/blend/.test(recipe.method))return r(.15,.5);
  if(/shake/.test(recipe.method))return r(.15,.35);
  if(/stir|throw/.test(recipe.method))return r(.1,.3);
  if(/layer/.test(recipe.method))return r(0,.05);
  return r(0,.25);
}
// Optimize a weighted mean over independent volume bounds. Dividing independent
// ethanol/volume extremes would spuriously widen a pure spirit to >100% ABV.
function mixtureAbv(parts:EstimatedContribution[],maximum:boolean):number {
  const grouped=parts.filter(p=>!p.amountGroup).map(p=>({volumeMl:p.volumeMl,abvPercent:p.abvPercent}));
  for(const key of new Set(parts.map(p=>p.amountGroup).filter(Boolean))){
    const members=parts.filter(p=>p.amountGroup===key),volume=members.reduce((sum,p)=>add(sum,p.volumeMl),r(0));
    if(volume.min>0)grouped.push({volumeMl:volume,abvPercent:members.reduce((sum,p)=>add(sum,scale(p.abvPercent,p.volumeMl.min/volume.min)),r(0))});
  }
  let low=0,high=100;
  for(let step=0;step<48;step++){
    const mid=(low+high)/2;
    const delta=grouped.reduce((sum,p)=>{const c=p.abvPercent[maximum?'max':'min']-mid;const v=p.volumeMl[(c>=0)===maximum?'max':'min'];return sum+c*v;},0);
    if(delta>0)low=mid;else high=mid;
  }
  return (low+high)/2;
}

/** Presentation only. Never write estimates into recipe doses, order snapshots or SKU labels. */
export function estimateDisplayDrink(recipe:Recipe,ingredients:Ingredient[],language:'zh'|'en'='zh'):AssistedDrinkEstimates {
  const base=estimateDrink(recipe,ingredients,{language}),en=language==='en';
  const result:AssistedDrinkEstimates={...base,estimateVersion:ASSISTED_ESTIMATE_VERSION,portions:r(1),contributions:[]};
  const notes=[en?'AI-assisted estimate · '+ASSISTED_ESTIMATE_VERSION:'AI 辅助估算 · '+ASSISTED_ESTIMATE_VERSION];
  const zhenglin=hasZhenglinDocument(recipe);
  const clarifiedLatte=dlcRecipeId(recipe)==='dlc_xd_clear_latte';
  const energyParts:{alcohol:Range;nonAlcohol:Range}[]=[];
  const documentAbv:Record<string,number>=zhenglin?{gin:40,cassis:17,cointreau:40}:{};
  if(zhenglin){
    result.estimateVersion='zhenglin-soup-v1-document-assumptions';result.mainDrinkOnly=true;
    notes.push(en?'Main drink only; optional whipped foam and decorative cassis drops excluded. Gin 40%, cassis 17%, Cointreau 40% are document assumptions; verified ingredient labels take priority. Foam yield and density are not supplied.':'仅估主酒；可选打发泡沫和装饰黑加仑滴另计。金酒40%、黑加仑17%、君度40%来自用户文档假设，已填写的实际原料标签优先。泡沫出成率与密度未提供。');
  }
  const failures:string[]=[],pending:{p:RecipeIngredient;i:Ingredient;b:Basis}[]=[];
  const entries=recipe.ingredients.filter(p=>p.stage!=='garnish'&&p.stage!=='side'&&!(zhenglin&&p.ingredient_id==='user_zhenglin_nebula_foam'));
  const partsTotal=entries.filter(p=>p.unit==='part').reduce((sum,p)=>sum+(count(p)?.max||0),0);
  const desired=GLASS[recipe.glass_template]||r(150,250);
  const allAlcohol=entries.filter(p=>p.unit==='part').every(p=>{const i=ingredients.find(i=>i.id===p.ingredient_id);return i&&(ingredientEstimateBasis(i)?.abvPercent.min||0)>0;});
  const partScale=scale(allAlcohol?r(60,90):desired,1/Math.max(1,partsTotal));
  function append(p:RecipeIngredient,i:Ingredient,b:Basis,q:Portion){
    const abv=i.abv_fraction!==null?r(i.abv_fraction*100):documentAbv[i.id]!==undefined?r(documentAbv[i.id]):b.abvPercent;
    let grams=q.grams;
    if(!grams&&b.energyBasis==='mass'){
      const density=b.kind==='honey'?r(1.3,1.45):i.id==='cdb_whipped_cream'?r(.3,.65):b.kind.startsWith('egg')?r(1,1.08):b.kind==='fruit'?r(.9,1.15):undefined;
      if(!density){failures.push(i.id);return;}
      grams=mul(q.ml,density);q={...q,note:q.note+' / retained edible density assumption'};
    }
    const nonAlcohol=grams&&b.nonAlcoholKcalPerGram?mul(grams,b.nonAlcoholKcalPerGram):b.nonAlcoholKcalPer100ml?scale(mul(q.ml,b.nonAlcoholKcalPer100ml),.01):undefined;
    if(!nonAlcohol){failures.push(i.id);return;}
    const kcal=i.kcal_per_100ml!==null?scale(q.ml,i.kcal_per_100ml/100):add(nonAlcohol,scale(mul(q.ml,abv),.789*7/100));
    if(!valid(q.ml,20000)||!valid(abv,100)||!valid(kcal,20000)){failures.push(i.id);return;}
    const amountGroup=p.unit==='part'&&p.quantity!==null?'parts':q.note==='shared glass top-up allowance'?'top-up':undefined;
    result.contributions.push({ingredientId:p.ingredient_id,volumeMl:q.ml,abvPercent:abv,caloriesKcal:kcal,basis:q.note,amountGroup});
    const alcohol=scale(mul(q.ml,abv),.789*7/100);
    energyParts.push({alcohol,nonAlcohol:i.kcal_per_100ml===null?nonAlcohol:r(Math.max(0,kcal.min-alcohol.max),Math.max(0,kcal.max-alcohol.min))});
    const name=en?i.name_en:i.name_zh;
    notes.push(`${name}: ≈${q.ml.min.toFixed(1)}–${q.ml.max.toFixed(1)} ml (${q.note})`);
  }
  for(const p of entries){
    const i=ingredients.find(i=>i.id===p.ingredient_id),b=i&&ingredientEstimateBasis(i);
    if(!i||!b||!['mix','top','float','rinse','finish'].includes(p.stage)){failures.push(p.ingredient_id);continue;}
    if((p.quantity!==null&&!count(p))||(p.quantity_range&&!count(p))){failures.push(p.ingredient_id);continue;}
    if(['to_top','top_up'].includes(p.unit)||(p.stage==='top'&&p.unit==='unknown')){pending.push({p,i,b});continue;}
    const q=portion(p,i,b,recipe,partScale);if(q)append(p,i,b,q);else failures.push(p.ingredient_id);
  }
  let volume=result.contributions.reduce((sum,p)=>add(sum,p.volumeMl),r(0));
  if(pending.length){
    // One shared fill budget, not a complete glass for every top-up ingredient.
    const fill=r(Math.max(10,desired.min-volume.max),Math.max(30,desired.max-volume.min));
    for(const {p,i,b}of pending)append(p,i,b,{ml:scale(fill,1/pending.length),note:'shared glass top-up allowance'});
    volume=result.contributions.reduce((sum,p)=>add(sum,p.volumeMl),r(0));
  }
  if(failures.length||volume.min<=0){return {...result,baseVolumeMl:null,servedVolumeMl:null,abvPercent:null,caloriesKcal:null,reasons:[...new Set([...base.reasons,...failures.map(id=>`${id}: ${en?'No supported estimate basis':'缺少适用估算依据'}`)])]};}
  // These three built-in batch records are estimates per portion, not a whole pitcher.
  result.portions=batchFor(recipe)?.portions||r(1); // Tomato Tang: choose the source's medium serving option.
  const d=clarifiedLatte?r(0):zhenglin?r(.25,.35):dilution(recipe);
  let kcal=result.contributions.reduce((sum,p)=>add(sum,p.caloriesKcal),r(0));
  let served=mul(volume,r(1+d.min,1+d.max));
  if(clarifiedLatte){
    // Cold filtration removes liquid and some milk solids. This deliberately
    // broad scenario is content-locked to the editorial working recipe; it is
    // not a measured yield or an assertion about the original venue's drink.
    const recovery=r(.5,.9),nonAlcoholRetention=r(.25,1);
    served=mul(volume,recovery);
    kcal=mul(energyParts.reduce((sum,p)=>add(sum,add(p.alcohol,mul(p.nonAlcohol,nonAlcoholRetention))),r(0)),recovery);
    notes.push(en?'Cold clarification scenario: 50–90% liquid and ethanol recovery; 25–100% of non-alcohol energy retained in that liquid. No additional shaking dilution is assumed. Yield, milk-solid loss and post-serving ice melt are unmeasured; this is not the venue recipe.':'冷制澄清估算假设：液体及其中乙醇回收50–90%；该回收液的非酒精能量另保留25–100%。不另加摇和融水。实际过滤出成、乳固体损失及服务后融冰均未测定，不代表原酒吧配方。');
  }
  const perPortion=(v:Range)=>r(v.min/result.portions.max,v.max/result.portions.min);
  notes.push(en?`Estimated portions: ${result.portions.min}–${result.portions.max}; dilution ${d.min*100}–${d.max*100}%.`:`估算份数 ${result.portions.min}–${result.portions.max}；融水 ${d.min*100}–${d.max*100}%。`);
  notes.push(en?'Ranges are editorial assumptions, not measured labels. Source recipe amounts are unchanged. Garnishes and side drinks excluded.':'范围为编辑估算，非标签实测。原配方剂量保持原样，装饰与另杯随附不计入。');
  if(batchFor(recipe)&&recipe.id==='cdb_12944')notes.push(en?'Heating evaporation is not measured; figures describe the mixture before evaporation.':'加热挥发量未实测，此处按挥发前的混合物估算。');
  return {...result,servedVolumeMl:perPortion(served),baseVolumeMl:volume.min===volume.max?volume.min/result.portions.min:null,
    abvPercent:r(mixtureAbv(result.contributions,false)/(1+d.max),mixtureAbv(result.contributions,true)/(1+d.min)),caloriesKcal:perPortion(kcal),assumptions:notes,reasons:[]};
}
