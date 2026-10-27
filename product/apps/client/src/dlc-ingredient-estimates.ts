import type { IngredientEstimateBasis,IngredientBasisRange } from './estimate-ingredient-assumptions';

/** Display-only editorial scenarios. These ranges are not measurements, label
 * values, confidence intervals, or certified limits. The source catalog stays null. */
export const DLC_INGREDIENT_ESTIMATE_METADATA=Object.freeze({
  version:'xiaodong-display-assumptions-2026-09-22.1',basis:'editorial_assumption',measured:false,
  limitation:'Explicit food-category scenarios only. Unknown products remain unidentified; actual products may fall outside these broad ranges. Never recipe quantities, SKU facts, or ordering authority.',
});
const table=new Map<string,IngredientEstimateBasis>();
const range=(min:number,max:number):IngredientBasisRange=>Object.freeze({min,max});
function register(ids:string,kind:string,abv:[number,number],energy:[number,number],basis:'volume'|'mass'='volume'){
  const value:IngredientEstimateBasis=Object.freeze({kind,abvPercent:range(...abv),energyBasis:basis,
    ...(basis==='mass'?{nonAlcoholKcalPerGram:range(...energy)}:{nonAlcoholKcalPer100ml:range(...energy)})});
  for(const id of ids.trim().split(/\s+/)){if(table.has(id))throw new Error(`Duplicate DLC estimate ID: ${id}`);table.set(id,value);}
}
// Unidentified mixtures are not silently treated as a brand or as alcohol-free.
register('dlc_xd_tequila_premix dlc_xd_americano_aperitif dlc_xd_telska_unresolved dlc_xd_ume_su dlc_xd_plum_tea_campari','unresolved_mixture',[0,80],[0,450]);
register('dlc_xd_black_rum dlc_xd_gold_rum dlc_xd_japanese_whisky dlc_xd_single_malt_scotch dlc_xd_woodford_whisky dlc_xd_coconut_vodka','spirit',[30,65],[0,80]);
register('dlc_xd_overproof_rum','spirit',[50,85],[0,40]);
register('dlc_xd_green_tea_shochu','spirit',[15,45],[0,80]);
register('dlc_xd_white_vermouth dlc_xd_oloroso_sherry','fortified_wine',[12,25],[0,150]);
register('dlc_xd_suze dlc_xd_walnut_liqueur dlc_xd_averna dlc_xd_umeshu dlc_xd_green_tea_umeshu dlc_xd_intense_umeshu dlc_xd_fireball','liqueur',[5,50],[20,350]);
register('dlc_xd_chartreuse_unspecified','liqueur',[35,60],[60,300]);
register('dlc_xd_burgundy_cremant','wine',[8,15],[0,80]);
register('dlc_xd_rosemary_syrup dlc_xd_fructose_preparation dlc_xd_rich_syrup dlc_xd_rich_demerara dlc_xd_cinnamon_syrup','syrup',[0,0],[100,450]);
register('dlc_xd_spicy_pineapple_soda dlc_xd_sanbitter dlc_xd_stappi dlc_xd_salted_lemon_soda','juice',[0,0],[0,100]);
register('dlc_xd_mugicha dlc_xd_matured_milk_coffee','coffee',[0,0],[0,20]);
register('dlc_xd_ginger_juice','juice',[0,0],[0,100]);
register('dlc_xd_coconut_milk','milk',[0,0],[20,300]);
register('dlc_xd_aquafaba','foam_liquid',[0,0],[0,50]);
register('dlc_xd_green_grapes','fruit',[0,0],[.4,.9],'mass');
register('dlc_xd_cucumber','fruit',[0,0],[.05,.3],'mass');
register('dlc_xd_lemon_slice dlc_xd_grapefruit_peel dlc_xd_melon_ball','fruit',[0,0],[.2,1.5],'mass');
register('dlc_xd_preserved_plum dlc_xd_hawthorn dlc_xd_candied_ginger','fruit',[0,0],[.3,3.8],'mass');
register('dlc_xd_yuzu_salt','salt',[0,0],[0,.3],'mass');
register('dlc_xd_chocolate_garnish','cookie',[0,0],[3,6.5],'mass');

export const DLC_INGREDIENT_ESTIMATE_IDS:readonly string[]=Object.freeze([...table.keys()].sort());
export function dlcIngredientEstimateBasis(id:string):IngredientEstimateBasis|undefined{return table.get(id);}
