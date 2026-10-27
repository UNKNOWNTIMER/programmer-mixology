import { describe, expect, it } from 'vitest';
import { buildGlassArt, buildRecipeGlassArt, fitGlassArt, compositionFacts, DETAILED_GLASS_KEYS, randomHotspotPoints, clampFloatingPanel } from './glass-art';
import { describeGlass, GLASS_PALETTES } from './glass-appearance';
import { clusterPresets, type ClassicPreset } from './Controls';
import type { Recipe, Profile, Ingredient } from './types';
import recipes from '../public/seed/recipes.json';
import profiles from '../public/seed/profiles.seed.json';
import ingredients from '../public/seed/ingredients.json';
const recipe=recipes.recipes.find(r=>r.id==='iba_negroni') as unknown as Recipe;
const makePreset=(id:string,bps:number):ClassicPreset=>({recipe_id:id,name_zh:id,name_en:id,profile:{recipe_id:id,taste_preference_bps:[bps,10000-bps,0,0,0],sensory_0_10:[1,2,3,4,5,6,7],taste_intensity_0_10:[1,2,0,0,0],status:'heuristic_unvalidated',measured:false,note_zh:''} as Profile});
describe('fine ASCII artwork',()=>{
  it('keeps every randomized hotspot pair apart and safely handles exhausted random placement',()=>{
    for(let n=0;n<1000;n++){const points=randomHotspotPoints();expect(points).toHaveLength(3);points.forEach((p,i)=>{expect(p.x).toBeGreaterThanOrEqual(24);expect(p.x).toBeLessThanOrEqual(76);expect(p.y).toBeGreaterThanOrEqual(16);expect(p.y).toBeLessThanOrEqual(80);points.slice(i+1).forEach(q=>expect(Math.hypot(p.x-q.x,p.y-q.y)).toBeGreaterThanOrEqual(28));});}
    expect(randomHotspotPoints(()=>.5)).toEqual([{x:28,y:22},{x:72,y:44},{x:38,y:76}]);
  });
  it('clamps floating portals within both small and large viewports',()=>{
    for(const viewport of [{width:390,height:844},{width:675,height:960},{width:1280,height:800}])for(const anchor of [{x:0,y:0},{x:viewport.width,y:viewport.height},{x:200,y:400}]){const p=clampFloatingPanel(anchor,300,400,viewport);expect(p.x).toBeGreaterThanOrEqual(8);expect(p.y).toBeGreaterThanOrEqual(8);expect(p.x+300).toBeLessThanOrEqual(viewport.width-8);expect(p.y+400).toBeLessThanOrEqual(viewport.height-8);}
  });
  it('builds eight distinct deterministic ASCII-only silhouettes with bounded coordinates',()=>{
    const outputs:string[]=[];
    for(const key of DETAILED_GLASS_KEYS){const art=buildGlassArt(key,false,false,false);expect(art.width).toBe(100);expect(art.height).toBe(65);const chars=art.cells.flat().filter(g=>g!==null);expect(chars.length).toBeGreaterThan(140);expect(chars.every(g=>g!.char.length===1&&g!.char.charCodeAt(0)<128)).toBe(true);expect(buildGlassArt(key,false,false,false)).toEqual(art);outputs.push(JSON.stringify(art));}
    expect(new Set(outputs).size).toBe(8);
  });
  it('adds ice and garnish only from explicit render arguments; no executable markup',()=>{
    const plain=buildGlassArt('rocks',false,false,false);expect(plain.cells.flat().some(g=>g?.tone==='ice'||g?.tone==='garnish')).toBe(false);
    const prepared=buildGlassArt('rocks',true,true,false,'citrus');expect(prepared.cells.flat().some(g=>g?.tone==='ice')).toBe(true);expect(prepared.cells.flat().some(g=>g?.tone==='garnish')).toBe(true);
  });
  it('renders all 300 sourced drinks as distinct stable ASCII grids without modifying recipes',()=>{
    const before=JSON.stringify(recipes),outputs=new Set<string>(),palettes=new Set<string>();
    expect(recipes.recipes).toHaveLength(300);
    for(const source of recipes.recipes){
      const r=source as unknown as Recipe,art=buildRecipeGlassArt(r),glyphs=art.cells.flat().filter(g=>g!==null);
      expect(art.cells, r.id).toHaveLength(65);expect(art.cells.every(row=>row.length===100),r.id).toBe(true);
      expect(glyphs.length,r.id).toBeGreaterThan(180);
      expect(glyphs.every(g=>g!.char.length===1&&/^[\x20-\x7E]$/.test(g!.char)),r.id).toBe(true);
      expect(buildRecipeGlassArt(r),r.id).toEqual(art);
      outputs.add(JSON.stringify(art.cells));palettes.add(art.appearance.palette);
    }
    expect(outputs.size).toBe(300);expect(palettes.size).toBe(10);expect(JSON.stringify(recipes)).toBe(before);
    expect(Object.values(GLASS_PALETTES).every(p=>Object.values(p).every(color=>/^#[0-9a-f]{6}$/.test(color)))).toBe(true);
  });
  it('fits all 300 complete silhouettes using uniform monospace cells at desktop and narrow viewport sizes',()=>{
    for(const source of recipes.recipes)for(const [width,height] of [[431,432],[227,348],[180,220],[860,864]]){
      const art=buildRecipeGlassArt(source as unknown as Recipe),fit=fitGlassArt(art,width,height);
      expect(fit.charW/fit.fontSize).toBeCloseTo(.6);expect(fit.lineH/fit.fontSize).toBeCloseTo(.92);
      expect(fit.x+fit.minX*fit.charW-fit.charW/2).toBeGreaterThanOrEqual(0);
      expect(fit.x+fit.maxX*fit.charW+fit.charW/2).toBeLessThanOrEqual(width);
      expect(fit.y+fit.minY*fit.lineH-fit.fontSize/2).toBeGreaterThanOrEqual(0);
      expect(fit.y+fit.maxY*fit.lineH+fit.fontSize/2).toBeLessThanOrEqual(height);
    }
  });
  it('does not invent garnish for unknown descriptions or ice for mixing/straining and hot drinks',()=>{
    for(const garnish of ['未指定','未指定。','来源未指定装饰。','来源只写装饰，未指定材料。','原谱列有青柠，未明确其装饰用途。','来源允许按口味补少量柠檬汁或橙汁。','挤少量柠檬皮油。'])expect(describeGlass({...recipe,garnish_zh:garnish}).garnishes,garnish).toEqual([]);
    for(const steps of [['所有材料加冰摇匀，滤入预冷鸡尾酒杯。'],['将材料放入调酒杯加碎冰搅拌，滤入预冷杯中。'],['热咖啡倒入耐热杯，加入威士忌，顶部打发奶油。']]){
      const appearance=describeGlass({...recipe,method:'build',steps_zh:steps,garnish_zh:'未指定'});expect(appearance.ice,steps.join('')).toBe('none');
    }
    const hot=describeGlass({...recipe,steps_zh:['热咖啡倒入耐热杯，加入威士忌，顶部打发奶油。'],garnish_zh:'打发奶油。'});expect(hot.hot).toBe(true);expect(hot.foam).toBe('cream');
  });
  it('distinguishes serving ice, garnish shapes, prepared rims and sourced carbonated ingredients',()=>{
    expect(describeGlass({...recipe,steps_zh:['在古典杯中加入一块冰，倒入材料。']}).ice).toBe('cubes');
    expect(describeGlass({...recipe,steps_zh:['在古典杯中加入一大块冰，倒入材料。']}).ice).toBe('large');
    expect(describeGlass({...recipe,steps_zh:['滤入装满碎冰的古典杯。']}).ice).toBe('crushed');
    expect(describeGlass({...recipe,steps_zh:['滤入装冰的高球杯，再补新冰。']}).ice).toBe('cubes');
    for(const id of ['iba_mojito','iba_moscow_mule','iba_old_fashioned','iba_mint_julep'])expect(describeGlass(recipes.recipes.find(r=>r.id===id) as unknown as Recipe).ice,id).not.toBe('none');
    expect(describeGlass({...recipe,garnish_zh:'柠檬皮卷与樱桃。'}).garnishes).toEqual(['twist','cherry']);
    expect(describeGlass({...recipe,garnish_zh:'柠檬糖杯口。'}).garnishes).toEqual([]);
    expect(describeGlass({...recipe,garnish_zh:'柠檬糖杯口。'}).rim).toBe(true);
    expect(describeGlass({...recipe,garnish_zh:'菠萝条、薄荷与青柠皮。'}).garnishes).toEqual(['twist','herb','pineapple']);
    expect(describeGlass({...recipe,ingredients:[{...recipe.ingredients[0],ingredient_id:'soda'}]}).bubbles).toBe(true);
    expect(describeGlass({...recipe,ingredients:[{...recipe.ingredients[0],ingredient_id:'vodka'}]}).bubbles).toBe(false);
  });
  it('uses the serving vessel and explicit ice size in the published recipes, never mixing-cup ice',()=>{
    const expected={cdb_17840:'none',cdb_11120:'none',cdb_11658:'none',cdb_17827:'none',iba_three_dots_and_a_dash:'crushed',cdb_12097:'cubes',cdb_11420:'cubes',cdb_14195:'cubes',cdb_17182:'large'};
    for(const [id,ice] of Object.entries(expected)){
      const source=recipes.recipes.find(r=>r.id===id) as unknown as Recipe;
      expect(source,id).toBeDefined();expect(describeGlass(source).ice,id).toBe(ice);
    }
    for(const vessel of ['调酒杯','搅拌杯','混合杯'])expect(describeGlass({...recipe,steps_zh:[`材料放入半装冰的${vessel}，搅匀后滤入鸡尾酒杯。`]}).ice,vessel).toBe('none');
  });
  it('supports unknown glass templates and personal imported IDs without changing source authority',()=>{
    const imported={...recipe,id:'archive-independent-user-recipe',glass_template:'user-defined',source:{...recipe.source,kind:'imported_snapshot'},default_orderable:false};
    const before=JSON.stringify(imported),art=buildRecipeGlassArt(imported);
    expect(art.cells.flat().filter(Boolean).length).toBeGreaterThan(180);expect(buildRecipeGlassArt(imported)).toEqual(art);expect(JSON.stringify(imported)).toBe(before);
    expect(art.cells).not.toEqual(buildRecipeGlassArt(recipe).cells);
  });
  it('retains source ml amounts and distinguishes unknown splash from full composition',()=>{
    const result=compositionFacts(recipe);expect(result.knownMl).toBe(90);expect(result.parts).toHaveLength(3);expect(result.parts.map(p=>p.ml)).toEqual([30,30,30]);expect(result.parts[0].percent).toBeCloseTo(100/3);expect(result.incomplete).toBe(false);
    const americano=recipes.recipes.find(r=>r.id==='iba_americano') as unknown as Recipe;const unknown=compositionFacts(americano);expect(unknown.knownMl).toBe(60);expect(unknown.incomplete).toBe(true);expect(unknown.parts.every(p=>p.ingredient_id!=='soda')).toBe(true);
  });
  it('keeps rinse amounts out of retained liquid shares, preserving uncertainty',()=>{
    const r={...recipe,ingredients:[...recipe.ingredients,{ingredient_id:'absinthe',quantity:5,unit:'ml',optional:false,stage:'rinse',quantity_note:null,allowed_alternatives:[]}]};const result=compositionFacts(r);expect(result.knownMl).toBe(90);expect(result.incomplete).toBe(true);expect(result.parts.some(p=>p.ingredient_id==='absinthe')).toBe(false);
  });
  it('distinguishes repeated ingredient rows so different amounts retain their actual ratio',()=>{
    const r={...recipe,ingredients:[{...recipe.ingredients[0],quantity:20},{...recipe.ingredients[0],quantity:40}]};const result=compositionFacts(r);expect(result.parts.map(p=>p.part_index)).toEqual([0,1]);expect(result.parts[0].percent).toBeCloseTo(100/3);expect(result.parts[1].percent).toBeCloseTo(200/3);
  });
  it('uses the same metric convention for cup shares and preserves unknown doses and source units',()=>{
    const r={...recipe,ingredients:[{...recipe.ingredients[0],quantity:1,unit:'oz'},{...recipe.ingredients[1],quantity:30,unit:'ml'},{...recipe.ingredients[2],quantity:1,unit:'shot'}]},before=JSON.stringify(r);
    const result=compositionFacts(r,ingredients.ingredients as Ingredient[]);
    expect(result.knownMl).toBeCloseTo(59.5735295625);expect(result.assumedConversion).toBe(true);expect(result.incomplete).toBe(true);expect(result.parts).toHaveLength(2);expect(result.parts.reduce((sum,p)=>sum+p.percent!,0)).toBeCloseTo(100);expect(JSON.stringify(r)).toBe(before);
  });
});
describe('classic profile projection clusters',()=>{
  it('groups nearby positions while preserving every full profile',()=>{const entries=[makePreset('a',2000),makePreset('b',2050),makePreset('c',9000)];const result=clusterPresets(entries,0);expect(result).toHaveLength(2);expect(result[0].entries.map(p=>p.recipe_id)).toEqual(['a','b']);expect(result[0].entries[1].profile.sensory_0_10).toEqual([1,2,3,4,5,6,7]);expect(result[1].position).toBe(9000);});
  it('keeps zero and full-scale projections valid and leaves source profiles untouched',()=>{const entries=[makePreset('zero',0),makePreset('max',10000)],before=JSON.stringify(entries);const result=clusterPresets(entries,0);expect(result.map(g=>g.position)).toEqual([0,10000]);expect(JSON.stringify(entries)).toBe(before);});
  it('projects every current seed profile without dropping overlapping candidates',()=>{const entries=profiles.profiles.map(p=>({recipe_id:p.recipe_id,name_zh:p.recipe_id,name_en:'',profile:p as unknown as Profile}));for(let axis=0;axis<5;axis++){const result=clusterPresets(entries,axis);expect(result.flatMap(g=>g.entries)).toHaveLength(profiles.profiles.length);expect(result.every(g=>g.position>=0&&g.position<=10000)).toBe(true);}});
});

