import { describe, expect, it } from 'vitest';
import { buildGlassArt, buildRecipeGlassArt, DETAILED_GLASS_KEYS } from './glass-art';
import { paintGlassArt } from './glass-paint';
import type { Recipe } from './types';
import seed from '../public/seed/recipes.json';

describe('glass portrait drawing contract',()=>{
  it('paints every cup using individual ASCII glyphs, without geometric or image substitutes',()=>{
    for(const template of DETAILED_GLASS_KEYS){
      const art=buildGlassArt(template,true,true,true,'citrus'),calls:{char:string;x:number;y:number;tone:unknown}[]=[];
      const ctx=new Proxy({fillStyle:'',fillText(char:string,x:number,y:number){calls.push({char,x,y,tone:this.fillStyle});}},{get(object,key){if(key in object)return object[key as keyof typeof object];throw Error(`Unexpected non-glyph canvas operation: ${String(key)}`);}}) as unknown as CanvasRenderingContext2D;
      const fit=paintGlassArt(ctx,art,227,348);expect(calls).toHaveLength(art.cells.flat().filter(Boolean).length);expect(calls.every(p=>/^[\x20-\x7e]$/.test(p.char))).toBe(true);
      expect(calls.every(p=>p.x-fit.charW/2>=0&&p.x+fit.charW/2<=227&&p.y-fit.fontSize/2>=0&&p.y+fit.fontSize/2<=348)).toBe(true);
      expect(new Set(calls.map(p=>p.tone)).size).toBeGreaterThanOrEqual(5);
    }
  });
  it('keeps source-dependent serving symbols intact through the richer silhouette renderer',()=>{
    for(const value of seed.recipes){
      const recipe=value as unknown as Recipe,art=buildRecipeGlassArt(recipe),glyphs=art.cells.flat().filter(Boolean),tones=new Set(glyphs.map(g=>g!.tone));
      if(art.appearance.ice==='none')expect(tones.has('ice'),recipe.id).toBe(false);
      if(art.appearance.foam==='none')expect(tones.has('foam'),recipe.id).toBe(false);
      if(!art.appearance.bubbles)expect(tones.has('bubble'),recipe.id).toBe(false);
      // More line volume must not fill the bowl or obscure a narrow viewport.
      expect(glyphs.length/(art.width*art.height),recipe.id).toBeLessThan(.24);
    }
  });
  it('keeps clear ungarnished stemware readable with distinct bowl, stem and foot',()=>{
    for(const template of ['martini','coupe','flute','hurricane','goblet']){
      const art=buildGlassArt(template,false,false,false),stem=art.cells.flatMap((row,y)=>row.flatMap((glyph,x)=>glyph?.tone==='stem'?[{x,y}]:[]));
      expect(stem.some(p=>p.y<56),template).toBe(true);expect(stem.some(p=>p.y>=60),template).toBe(true);
      expect(art.cells.slice(58).flat().filter(g=>g?.tone==='rim').length,template).toBeGreaterThan(12);
    }
  });
});
