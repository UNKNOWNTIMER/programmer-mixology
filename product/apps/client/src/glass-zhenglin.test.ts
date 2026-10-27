import { describe, expect, it } from 'vitest';
import { buildRecipeGlassArt, fitGlassArt } from './glass-art';
import { describeGlass, isZhenglinSoup } from './glass-appearance';
import { paintGlassArt } from './glass-paint';
import type { Recipe, RecipeIngredient } from './types';
import seed from '../public/seed/recipes.json';

const part=(ingredient_id:string,quantity:number|null,stage='mix',unit='ml',optional=false):RecipeIngredient=>({ingredient_id,quantity,stage,unit,optional,quantity_note:null,allowed_alternatives:[]});
const soup:Recipe={...(seed.recipes[0] as unknown as Recipe),id:'personal-zhenglin-fixture',name_zh:'政霖汤',name_en:'Zhenglin Soup',glass_template:'coupe',method:'shake',default_orderable:false,ingredients:[part('gin',45),part('cassis',15),part('cointreau',10),part('lemon',22.5),part('simple_syrup',7.5),{...part('cdb_ice',null,'mix','g'),quantity_range:[150,200]},part('cdb_lemon_peel',1,'garnish','piece'),part('user_zhenglin_nebula_foam',15,'garnish','ml',true),{...part('cassis',null,'garnish','drop',true),quantity_range:[2,3]}],garnish_zh:'柠檬皮环，可选香草星云泡沫与黑加仑滴纹。',steps_zh:['加冰摇和后双重过滤，成杯不留冰。','可选的泡沫铺成不完全覆盖杯面的弧形云带。']};

describe('Zhenglin Soup recipe-specific ASCII portrait',()=>{
  it('recognises the actual V1 contents across personal and imported IDs without accepting name-only matches',()=>{
    expect(isZhenglinSoup(soup)).toBe(true);
    const imported={...soup,id:'imported-a-new-random-id',name_en:'  ZHENGLIN  Soup ',source:{...soup.source,kind:'imported_snapshot'}};
    expect(isZhenglinSoup(imported)).toBe(true);expect(buildRecipeGlassArt(imported)).toEqual(buildRecipeGlassArt(soup));
    for(const change of [{name_en:'Another soup'},{glass_template:'mug'},{method:'build'}])expect(isZhenglinSoup({...soup,...change})).toBe(false);
    for(const changed of [{quantity:46},{unit:'cl'},{optional:true},{quantity_range:[45,50] as [number,number]},{ingredient_id:'vodka'}])expect(isZhenglinSoup({...soup,ingredients:soup.ingredients.map((p,i)=>i===0?{...p,...changed}:p)})).toBe(false);
    expect(isZhenglinSoup({...soup,ingredients:[...soup.ingredients,part('gin',45)]})).toBe(false);
    expect(isZhenglinSoup({...soup,ingredients:[...soup.ingredients,part('soda',30,'top')]})).toBe(false);
    expect(isZhenglinSoup({...soup,ingredients:[...soup.ingredients,part('absinthe',2,'rinse')]})).toBe(false);
  });
  it('draws only explicitly present optional surface decorations and never serving ice',()=>{
    const art=buildRecipeGlassArt(soup),before=JSON.stringify(soup),appearance=describeGlass(soup);
    expect(appearance).toMatchObject({design:'zhenglin_nebula',ice:'none',palette:'cassis',foam:'fine',garnishes:['twist'],nebulaSwirl:true});
    const glyphs=art.cells.flat().filter(Boolean);expect(glyphs.some(g=>g?.tone==='ice'||g?.tone==='bubble')).toBe(false);
    const foam=art.cells.flatMap((row,y)=>row.flatMap((g,x)=>g?.tone==='foam'?[{x,y}]:[]));
    expect(foam.length).toBeGreaterThan(25);expect(foam.every(p=>p.x>=29&&p.x<=67&&p.y>=16&&p.y<=24)).toBe(true);
    const plain={...soup,ingredients:soup.ingredients.filter(p=>p.stage==='mix')},plainArt=buildRecipeGlassArt(plain);
    expect(isZhenglinSoup(plain)).toBe(true);expect(plainArt.appearance.foam).toBe('none');expect(plainArt.appearance.garnishes).toEqual([]);
    expect(plainArt.cells.flat().some(g=>g?.tone==='foam'||g?.tone==='garnish')).toBe(false);
    const noDrops={...soup,ingredients:soup.ingredients.filter(p=>!(p.ingredient_id==='cassis'&&p.stage==='garnish'))};expect(describeGlass(noDrops).nebulaSwirl).toBe(false);
    const floatFoam={...soup,ingredients:soup.ingredients.map(p=>p.ingredient_id==='user_zhenglin_nebula_foam'?{...p,stage:'float'}:p)};
    expect(buildRecipeGlassArt(floatFoam)).toEqual(art);expect(JSON.stringify(soup)).toBe(before);
  });
  it('keeps the complete rounded bowl, stem, foot and gold peel inside desktop and narrow canvases using only ASCII glyphs',()=>{
    const art=buildRecipeGlassArt(soup);expect(art.cells).toHaveLength(65);expect(art.cells.every(row=>row.length===100)).toBe(true);
    expect(art.cells.flat().filter(Boolean).every(g=>/^[\x20-\x7e]$/.test(g!.char))).toBe(true);
    expect(art.cells.slice(39,56).flat().some(g=>g?.tone==='stem')).toBe(true);expect(art.cells.slice(58).flat().filter(g=>g?.tone==='rim').length).toBeGreaterThan(12);
    for(const [width,height] of [[431,432],[227,348],[180,220]]){
      const fit=fitGlassArt(art,width,height),colors=new Set<string>();
      const ctx={fillStyle:'',fillText(this:{fillStyle:string},char:string,x:number,y:number){expect(char).toMatch(/^[\x20-\x7e]$/);expect(x-fit.charW/2).toBeGreaterThanOrEqual(0);expect(x+fit.charW/2).toBeLessThanOrEqual(width);expect(y-fit.fontSize/2).toBeGreaterThanOrEqual(0);expect(y+fit.fontSize/2).toBeLessThanOrEqual(height);colors.add(this.fillStyle);}} as unknown as CanvasRenderingContext2D;
      paintGlassArt(ctx,art,width,height);expect(colors.has('#e4e1df')).toBe(true);expect(colors.has('#d7b76d')).toBe(true);expect(colors.has('#b4638f')).toBe(true);expect(colors.has('#78abb8')).toBe(false);
    }
  });
  it('preserves every preexisting 300-recipe grid and appearance byte-for-byte',async()=>{
    const serialized=JSON.stringify(seed.recipes.map(recipe=>buildRecipeGlassArt(recipe as unknown as Recipe)));
    // Measured from the production renderer immediately before adding this special portrait.
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized))),byte=>byte.toString(16).padStart(2,'0')).join('');
    expect(hash).toBe('4c9737b0c032b453c84fedd7a19153bc2c7731cc6dfccfce9696bbe12fd43e85');
  });
});
