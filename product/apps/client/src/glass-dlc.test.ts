import { describe, expect, it } from 'vitest';
import { buildRecipeGlassArt, fitGlassArt } from './glass-art';
import { DLC_ART_PROFILES, dlcArtSignature, dlcGlassContour, dlcRecipeId } from './dlc-art';
import { paintGlassArt } from './glass-paint';
import type { Recipe } from './types';
import catalog from '../../../data/dlc/xiaodong/catalog.json';

const recipes=catalog.recipes as unknown as Recipe[];

describe('Xiaodong notebook content-addressed ASCII art',()=>{
  it('has one explicit art profile per serving recipe, stable after archive import or personal-library copy',()=>{
    expect(recipes).toHaveLength(96);expect(DLC_ART_PROFILES).toHaveLength(96);
    for(const recipe of recipes){
      expect(dlcRecipeId(recipe)).toBe(recipe.id);const before=buildRecipeGlassArt(recipe);
      const copy={...recipe,id:'personal-new-import-uuid',name_en:`  ${recipe.name_en.toUpperCase()}  `,recipe_revision_id:'new-local-revision',notes_zh:'本地备注已修改',source:{...recipe.source,kind:'imported_snapshot'},ingredients:[...recipe.ingredients].reverse()};
      expect(dlcArtSignature(copy)).toBe(dlcArtSignature(recipe));expect(buildRecipeGlassArt(copy)).toEqual(before);expect(dlcRecipeId(copy)).toBe(recipe.id);
      expect(before.appearance.design).toBe('xiaodong_notes');
      expect(dlcRecipeId({...recipe,ingredients:recipe.ingredients.map((p,i)=>i===0?{...p,quantity:123.456}:p)})).toBeUndefined();
      expect(dlcRecipeId({...recipe,garnish_zh:'替换装饰'})).toBeUndefined();
      expect(dlcRecipeId({...recipe,steps_zh:['不同制法']})).toBeUndefined();
    }
  });
  it('gives every drink unique ASCII pixels and bounded readable geometry at narrow and desktop sizes',()=>{
    const fingerprints=new Set<string>();
    for(const recipe of recipes){
      const art=buildRecipeGlassArt(recipe);expect(art.cells).toHaveLength(65);expect(art.cells.every(row=>row.length===100)).toBe(true);
      expect(art.cells.flat().filter(Boolean).every(g=>/^[\x20-\x7e]$/.test(g!.char))).toBe(true);
      expect(art.cells.flat().filter(Boolean).length).toBeGreaterThan(100);fingerprints.add(JSON.stringify(art.cells));
      for(const [width,height] of [[431,432],[227,348],[180,220]]){
        const fit=fitGlassArt(art,width,height);expect(Number.isFinite(fit.fontSize)).toBe(true);
        const ctx={fillStyle:'',fillText(char:string,x:number,y:number){expect(char).toMatch(/^[\x20-\x7e]$/);expect(x-fit.charW/2).toBeGreaterThanOrEqual(0);expect(x+fit.charW/2).toBeLessThanOrEqual(width);expect(y-fit.fontSize/2).toBeGreaterThanOrEqual(0);expect(y+fit.fontSize/2).toBeLessThanOrEqual(height);}} as unknown as CanvasRenderingContext2D;
        paintGlassArt(ctx,art,width,height);
      }
    }
    expect(fingerprints.size).toBe(96);
  },30_000); // Exhaustive 96-drink x 3-size pixel checks also run on shared CI CPUs.
  it('provides 32 different glass contours and confines colour bands to explicitly layered recipes',()=>{
    const contours=new Set<string>();
    for(const family of ['martini','coupe','flute','highball','hurricane','goblet','mug','rocks'])for(let variant=0;variant<4;variant++){
      const shape=dlcGlassContour(family,variant);expect(shape.top).toBeGreaterThanOrEqual(9);expect(shape.bottom).toBeLessThan(55);
      contours.add(JSON.stringify([shape.top,shape.bottom,shape.stem,Array.from({length:20},(_,i)=>shape.radius(shape.top+(shape.bottom-shape.top)*i/19))]));
    }
    expect(contours.size).toBe(32);
    for(const recipe of recipes){const art=buildRecipeGlassArt(recipe);const colorGlyphs=art.cells.flat().filter(g=>g?.color);expect(colorGlyphs.length>0).toBe((art.appearance.layers?.length??0)>1);}
  });
  it('respects alternatives, expressed peel oil, clarification and the explicit serving ice',()=>{
    const find=(name:string)=>buildRecipeGlassArt(recipes.find(recipe=>recipe.name_en===name)!).appearance;
    expect(find('Tom Collins').garnishes).toEqual(['citrus']);
    expect(find('Japanese Whisky Highball').ice).toBe('large');
    expect(find('Sloe Gin Sour').garnishes).toEqual([]);
    expect(find('Clear Latte / Milk Punch — venue note')).toMatchObject({foam:'none',palette:'amber',ice:'cubes'});
    expect(find('Espresso Martini — Irish cream note').foam).toBe('fine');
    expect(find('Mudslide')).toMatchObject({foam:'none',garnishes:['dust']});
    expect(find('Sunflower').ice).toBe('none');
    expect(find('B-52').layers).toHaveLength(3);
    expect(find('Tequila Sunrise — 1972 Rolling Stone note').layers).toEqual(['gold','ruby']);
    expect(find('Malibu Sunset').layers).toEqual(['gold','ruby']);
  });
});
