import type { Ingredient } from './types';
import { dlcIngredientEstimateBasis } from './dlc-ingredient-estimates';

export interface IngredientBasisRange { readonly min:number; readonly max:number }
export interface IngredientEstimateBasis {
  readonly abvPercent:IngredientBasisRange;
  /** Non-alcohol energy only. Ethanol energy is added by the caller exactly once. */
  readonly nonAlcoholKcalPer100ml?:IngredientBasisRange;
  /** Solids use mass; no density or dissolved volume is implied by this table. */
  readonly nonAlcoholKcalPerGram?:IngredientBasisRange;
  readonly energyBasis:'volume'|'mass';
  readonly kind:string;
}

export const INGREDIENT_ESTIMATE_METADATA=Object.freeze({
  version:'2026-09-22.1',
  author:'AI-assisted / Codex',
  basis:'editorial_assumption',
  measured:false,
  scope:'Explicit catalog ingredient IDs; display estimates only; never dose, label, recipe or permission facts.',
  limitation:'Broad editorial ranges are not measured values, statistical confidence intervals, SKU labels, or bounds certified by the sources. Products may fall outside them. Solid energy requires a separately estimated or known retained mass. Actual label values take priority in the caller.',
  sources:Object.freeze([
    {label:'NIAAA: illustrative beverage strengths and variation',url:'https://www.niaaa.nih.gov/alcohols-effects-health/what-standard-drink',use:'Background alcohol-category examples; does not certify these ranges.'},
    {label:'USDA FoodData Central: food composition and data types',url:'https://fdc.nal.usda.gov/',use:'Reference framework for food energy by mass; no individual nutrient record is claimed as the source of an editorial range.'},
  ]),
});

const table=new Map<string,IngredientEstimateBasis>();
const range=(min:number,max:number):IngredientBasisRange=>Object.freeze({min,max});
function register(ids:string,kind:string,abv:[number,number],energy:[number,number],basis:'volume'|'mass'='volume'){
  const value:IngredientEstimateBasis=Object.freeze({kind,abvPercent:range(...abv),energyBasis:basis,
    ...(basis==='mass'?{nonAlcoholKcalPerGram:range(...energy)}:{nonAlcoholKcalPer100ml:range(...energy)})});
  for(const id of ids.trim().split(/\s+/)){
    if(table.has(id))throw new Error(`Duplicate editorial ingredient ID: ${id}`);
    table.set(id,value);
  }
}

// The groups below enumerate IDs, not name patterns or role-based fallbacks.
register(`cognac brandy gin calvados white_rum vodka bourbon rye cachaca citron_vodka
  goslings_rum irish_whiskey blackstrap_rum tequila jamaican_rum martinique_molasses_rum
  mezcal aged_rum blended_scotch islay_scotch pisco scotch whisky cuban_aguardiente
  old_tom_gin cuban_rum havana_profundo havana_smoky vanilla_vodka martinique_agricole_rum
  white_grappa jamaican_dark_rum puerto_rican_gold_rum cdb_kirschwasser cdb_anejo_rum
  cdb_applejack cdb_dark_rum cdb_absolut_vodka cdb_lemon_vodka cdb_blended_whiskey
  cdb_absolut_citron cdb_jack_daniels cdb_gold_tequila cdb_raspberry_vodka cdb_spiced_rum
  cdb_peach_vodka cdb_wild_turkey`,'spirit',[35,60],[0,30]);
register('rum jamaican_rum_unspecified demerara_rum','spirit',[35,80],[0,40]);
register('absinthe','spirit',[45,80],[0,50]);
register('jamaican_overproof_white_rum','spirit',[57,80],[0,30]);
register('cdb_151_proof_rum','spirit',[74,77],[0,30]);
register('pernod cdb_ricard','spirit',[35,50],[0,160]);

register(`creme_cacao_brown creme_cacao_white apricot_brandy maraschino creme_violette
  triple_sec coffee_liqueur kahlua blackberry_liqueur cointreau amaretto raspberry_liqueur
  creme_menthe_green cassis orange_curacao drambuie cherry_sangue_morlacco benedictine
  grand_marnier frangelico peach_brandy passion_fruit_liqueur cherry_brandy_luxardo
  peach_schnapps creme_menthe_white allspice_st_elizabeth cdb_strawberry_liqueur
  cdb_coconut_liqueur cdb_strawberry_schnapps cdb_sloe_gin cdb_blackberry_brandy cdb_kummel
  cdb_creme_de_cacao cdb_blue_curacao cdb_pisang_ambon cdb_galliano cdb_tia_maria
  cdb_cherry_brandy cdb_midori_melon_liqueur cdb_hpnotiq cdb_banana_liqueur cdb_passoa
  cdb_cherry_heering cdb_st_germain cdb_creme_de_banane cdb_melon_liqueur cdb_anisette
  cdb_sambuca cdb_butterscotch_schnapps cdb_jagermeister cdb_goldschlager`,'liqueur',[10,45],[60,300]);
register('cdb_southern_comfort cdb_anis','liqueur',[15,55],[20,250]);
register('cdb_coconut_rum cdb_malibu_rum','liqueur',[15,45],[40,240]);
register('green_chartreuse','liqueur',[50,60],[80,240]);
register('yellow_chartreuse','liqueur',[38,45],[80,240]);
register('campari fernet aperol amaro_nonino cynar cdb_amaro_montenegro','liqueur',[10,50],[40,240]);
register('irish_cream cdb_baileys_irish_cream','liqueur',[12,25],[120,300]);
register('cdb_advocaat','liqueur',[10,25],[120,300]);

// Falernum and unspecified cordials may be non-alcoholic syrups or alcoholic products.
register('falernum elderflower_cordial chamomile_cordial cdb_lime_juice_cordial','liqueur',[0,35],[40,350]);
register('vanilla_extract','liqueur',[0,50],[0,100]);
register('angostura orange_bitters amargo_bitters peychaud aromatic_bitters cdb_peach_bitters','bitters',[0,50],[0,150]);

register('sweet_vermouth dry_vermouth lillet_blanc tawny_port amontillado_sherry palo_cortado cdb_sherry cdb_port cdb_ruby_port cdb_dubonnet_rouge','fortified_wine',[14,24],[0,110]);
register('white_wine red_wine cdb_wine','wine',[8,17],[0,80]);
register('prosecco champagne sparkling_wine','wine',[8,15],[0,80]);
register('cdb_beer','beer',[0,12],[5,70]);
// Neither generic "cider" nor "ginger beer" guarantees alcohol-free contents.
register('apple_cider','juice',[0,8],[20,80]);
register('ginger_beer','beer',[0,8],[10,80]);

register('lemon lime','acid',[0,0],[10,45]);
register('orange_juice tomato_juice cranberry pineapple apple_juice grapefruit sugar_cane_juice cdb_peach_nectar cdb_passion_fruit_juice cdb_apricot_nectar cdb_pomegranate_juice','juice',[0,0],[10,100]);
register('cola ginger_ale grapefruit_soda cdb_schweppes_russchian cdb_tonic_water cdb_lemonade cdb_sprite cdb_7_up cdb_lemon_lime_soda cdb_sarsaparilla','juice',[0,0],[0,80]);
register('cdb_sour_mix cdb_sweet_and_sour','juice',[0,0],[0,160]);
register('peach_puree passion_fruit_puree','fruit',[0,0],[20,120]);
register('honey_syrup sugar_syrup simple_syrup raspberry_syrup demerara_syrup orgeat grenadine maple_syrup semi_rich_syrup passion_fruit_syrup honey_mix agave_nectar cdb_roses_sweetened_lime_juice cdb_cherry_grenadine cdb_pineapple_syrup cdb_sirup_of_roses','syrup',[0,0],[150,420]);
register('donns_mix','syrup',[0,0],[10,300]);
register('soda water','water',[0,0],[0,0]);
register('orange_flower_water','floral_water',[0,0],[0,5]);
register('espresso hot_coffee cdb_tea','coffee',[0,0],[0,10]);

register('cream cdb_cream cdb_heavy_cream','cream',[0,0],[100,450]);
register('cdb_light_cream','cream',[0,0],[100,260]);
register('coconut_cream cdb_cream_of_coconut','cream',[0,0],[100,450]);
register('cdb_milk','milk',[0,0],[20,100]);
register('cdb_hot_chocolate','milk',[0,0],[30,180]);
register('egg_white','egg_white',[0,0],[40,65]);
register('egg_yolk','egg_yolk',[0,0],[250,370]);
register('cdb_egg','egg',[0,0],[1.2,1.8],'mass');
register('cdb_whipped_cream','cream',[0,0],[.8,4.5],'mass');

register('sugar sugar_cube vanilla_sugar cdb_powdered_sugar','sugar',[0,0],[3.6,4.1],'mass');
register('raw_honey','honey',[0,0],[2.7,3.5],'mass');
register('lime_fruit pineapple_chunks orange_fruit lemon_fruit cdb_strawberries cdb_cherry cdb_pineapple cdb_blueberries cdb_kiwi cdb_blackberries cdb_blood_orange cdb_cherries','fruit',[0,0],[.2,1.2],'mass');
register('cdb_maraschino_cherry','fruit',[0,0],[1,3],'mass');
register('cdb_olive','fruit',[0,0],[1,3],'mass');
register('cdb_lemon_peel cdb_orange_peel cdb_orange_spiral cdb_lime_peel','fruit',[0,0],[.3,4.5],'mass');
register('basil mint cdb_lavender cdb_rosemary','herb',[0,0],[.1,3.5],'mass');
register('black_pepper fresh_ginger cloves red_chili cdb_nutmeg cdb_pepper cdb_cinnamon','spice',[0,0],[.2,5],'mass');
register('salt celery_salt','salt',[0,0],[0,0],'mass');
register('worcestershire','sauce',[0,0],[0,150]);
register('hot_sauce','sauce',[0,0],[0,100]);
register('cdb_ice','ice',[0,0],[0,0]);
// Energy is for a separately estimated melted volume, never for a scoop's airy bulk volume.
register('cdb_vanilla_ice_cream cdb_chocolate_ice_cream','ice_cream',[0,0],[90,450]);
register('cdb_oreo_cookie','cookie',[0,0],[4,6],'mass');

export const INGREDIENT_ESTIMATE_IDS:readonly string[]=Object.freeze([...table.keys()].sort());
/** Unknown IDs stay unknown even when their name or role resembles a whitelisted ingredient. */
export function ingredientEstimateBasis(i:Ingredient):IngredientEstimateBasis|undefined {
  return table.get(i.id)||dlcIngredientEstimateBasis(i.id);
}
