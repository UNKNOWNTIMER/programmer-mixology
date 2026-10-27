import { fitGlassArt, type GlassArt, type GlyphTone } from './glass-art';
import { GLASS_PALETTES } from './glass-appearance';

/** Shared by the live canvas and the inspection gallery: only character glyphs. */
export function paintGlassArt(ctx:CanvasRenderingContext2D,art:GlassArt,width:number,height:number,family='"Courier New", monospace') {
  const fit=fitGlassArt(art,width,height),{fontSize,charW,lineH,x,y}=fit;
  const colors:Record<GlyphTone,string>={rim:'#d2d9ce',edge:'#8da9ad',dim:'#4c6970',...GLASS_PALETTES[art.appearance.palette],ice:'#a9cfda',garnish:'#d8af68',leaf:'#96b982',fruit:'#cd796a',stem:'#c5d2c6',spark:'#e1aa82',foam:'#dfdbc6',bubble:'#b6d1c7'};
  if(art.appearance.design==='zhenglin_nebula')Object.assign(colors,{rim:'#d8ded5',edge:'#91a7a8',dim:'#53676b',foam:'#e4e1df',garnish:'#d7b76d',stem:'#c9c9c0'});
  ctx.imageSmoothingEnabled=false;ctx.font=`600 ${fontSize}px ${family}`;ctx.textBaseline='middle';ctx.textAlign='center';
  for(let row=0;row<art.height;row++)for(let col=0;col<art.width;col++){
    const glyph=art.cells[row][col];if(!glyph)continue;ctx.fillStyle=art.appearance.design==='xiaodong_notes'&&glyph.color?glyph.color:colors[glyph.tone];ctx.fillText(glyph.char,Math.round(x+col*charW),Math.round(y+row*lineH));
  }
  return fit;
}
