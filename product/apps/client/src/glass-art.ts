import type { Recipe, Ingredient } from './types';
import { displayQuantity } from './quantity-display';
import { describeGlass, isZhenglinSoup, GLASS_PALETTES, type GlassAppearance, type GlassGarnish } from './glass-appearance';
import { dlcGlassContour } from './dlc-art';

export type GlyphTone = 'rim' | 'edge' | 'dim' | 'liquid' | 'light' | 'shadow' | 'ice' | 'garnish' | 'leaf' | 'fruit' | 'stem' | 'spark' | 'foam' | 'bubble';
export interface Glyph { char: string; tone: GlyphTone; color?: string }
export interface GlassArt { width: number; height: number; cells: (Glyph | null)[][]; appearance: GlassAppearance }
export const DETAILED_GLASS_KEYS = ['highball','rocks','martini','coupe','flute','hurricane','mug','goblet'] as const;

export interface HotspotPoint { x:number; y:number }
/** Random slots stay separated even in a narrow glass viewport. Units are percent of each axis. */
export function randomHotspotPoints(random:()=>number=Math.random):HotspotPoint[] {
  const unit=()=>Math.max(0,Math.min(.999999,random()));
  const points:HotspotPoint[]=[];
  for(let attempt=0;attempt<160&&points.length<3;attempt++){
    const point={x:24+unit()*52,y:16+unit()*64};
    if(points.every(p=>Math.hypot(point.x-p.x,point.y-p.y)>=28))points.push(point);
  }
  // Deterministic safe fallback also handles a constant/injected random source.
  if(points.length<3)return [{x:28,y:22},{x:72,y:44},{x:38,y:76}];
  return points;
}
export function clampFloatingPanel(anchor:HotspotPoint,width:number,height:number,viewport:{width:number;height:number}):HotspotPoint {
  const gap=8;
  const preferredX=anchor.x+16+width<=viewport.width-gap?anchor.x+16:anchor.x-width-16;
  const preferredY=anchor.y-height*.35;
  return {x:Math.max(gap,Math.min(preferredX,viewport.width-width-gap)),y:Math.max(gap,Math.min(preferredY,viewport.height-height-gap))};
}

/** Recipe facts select symbols; a stable seed only varies the decorative surface texture. */
export function buildRecipeGlassArt(recipe: Recipe): GlassArt {
  return drawGlass(recipe.glass_template, describeGlass(recipe));
}

/** Compatibility entry point for previews; production uses buildRecipeGlassArt. */
export function buildGlassArt(template: string, hasGarnish: boolean, hasIce: boolean, hasFoam: boolean, garnishKind: 'citrus' | 'skewer' | 'dust' | 'herb' | 'generic' = 'generic'): GlassArt {
  return drawGlass(template, { seed: 0, ice: hasIce ? 'cubes' : 'none', foam: hasFoam ? 'fine' : 'none', garnishes: hasGarnish ? [garnishKind === 'skewer' ? 'olive' : garnishKind === 'generic' ? 'cherry' : garnishKind] : [], rim: false, bubbles: false, hot: false, palette: 'clear' });
}

/** A deterministic character grid. Every curve/reflection is ASCII, never a vector stroke. */
function drawGlass(template: string, appearance: GlassAppearance): GlassArt {
  const width=100,height=65,cells:(Glyph|null)[][]=Array.from({length:height},()=>Array(width).fill(null));
  const { seed }=appearance;
  const grain=(x:number,y:number,salt=0)=>{let n=Math.imul((x+17)|0,374761393)^Math.imul((y+31)|0,668265263)^seed^salt;n=Math.imul(n^(n>>>13),1274126177);return (n^(n>>>16))>>>0;};
  const put=(x:number,y:number,char:string,tone:GlyphTone)=>{const col=Math.round(x),row=Math.round(y);if(col>=0&&col<width&&row>=0&&row<height)cells[row][col]={char,tone};};
  const line=(x1:number,y1:number,x2:number,y2:number,tone:GlyphTone,forced?:string)=>{
    const dx=x2-x1,dy=y2-y1,steps=Math.max(Math.abs(dx),Math.abs(dy))*2;
    const char=forced||(Math.abs(dy)<Math.abs(dx)*.32?'_':Math.abs(dx)<Math.abs(dy)*.3?'|':dx*dy>0?'\\':'/');
    for(let n=0;n<=steps;n++){const t=steps?n/steps:0;put(x1+dx*t,y1+dy*t,char,tone);}
  };
  const ellipse=(x:number,y:number,rx:number,ry:number,tone:GlyphTone,half:'all'|'front'|'back'='all')=>{
    // Trace the complete curved contour, including the long shallow slopes.
    // Sampling only row endpoints left disconnected dots beside a flat top bar.
    const start=half==='back'?Math.PI:0,end=half==='front'?Math.PI:Math.PI*2,steps=Math.ceil(Math.max(8,rx*6));
    for(let n=0;n<=steps;n++){
      const angle=start+(end-start)*n/steps,dx=Math.cos(angle),dy=Math.sin(angle);
      const char=Math.abs(dy)<.18?(dx<0?'(':')'):dy<-.76?'-':dy>.76?'_':dy<0?'.':"'";
      put(x+dx*rx,y+dy*ry,char,tone);
    }
  };
  if(appearance.design==='zhenglin_nebula'){
    // User-authored V1: rounded coupe, one cassis-coloured mixed drink, optional
    // aquafaba cloud and lemon-peel orbit. These are artistic serving cues, not layers.
    const top=14,bottom=37,surface=20,radius=(y:number)=>32*Math.sqrt(Math.max(0,1-((y-top)/(bottom-top))**2));
    const surfaceRadius=radius(surface)-2;
    const inSurface=(x:number,y:number)=>((x-50)/surfaceRadius)**2+((y-surface)/4.2)**2<.94;
    for(let y=surface+1;y<bottom-1;y++)for(let x=20;x<80;x++)if(Math.abs(x-50)<radius(y)-3){
      const texture=grain(x,y)%100;
      if(texture<12)put(x,y,texture<3?':':'.',texture<4?'liquid':'shadow');
      else if(texture===69)put(x,y,"'",'light');
    }
    for(let y=top;y<bottom;y++){
      const r=radius(y),next=radius(y+1);
      line(50-r,y,50-next,y+1,'edge');line(50+r,y,50+next,y+1,'edge');
      if(y>top+3&&y<bottom-3){
        if(y<29)put(53-r,y,r-next>.45?'\\':'|',y<24?'rim':'dim');
        if(y>22&&y%5!==0)put(47+r,y,r-next>.45?'/':'|','dim');
      }
    }
    // The complete rim and lower rounded bowl stay distinct from the liquid surface.
    ellipse(50,top,32,4,'dim','back');ellipse(50,top+.6,30,3,'edge');
    ellipse(50,top+1,32,4,'rim','front');line(36,top-4,51,top-4,'rim','-');
    for(let y=surface-4;y<=surface+4;y++)for(let x=22;x<=78;x++)if(inSurface(x,y)&&grain(x,y,79)%9<3)put(x,y,'.','liquid');
    ellipse(50,surface,surfaceRadius,4.2,'shadow','back');ellipse(50,surface,surfaceRadius,4.2,'liquid','front');
    line(34,25,45,26,'light','_');
    if(appearance.foam!=='none'){
      // One tapered crescent occupies part of the surface; it is not a full foam cap.
      for(let n=0;n<=78;n++){
        const t=n/78,a=-.6+t*3.5,x=48+17*Math.cos(a),y=surface+3.1*Math.sin(a);
        if(inSurface(x,y))put(x,y,n%5===0?':':Math.abs(Math.cos(a))<.5?'_':'.','foam');
        if(t>.12&&t<.86&&inSurface(x,y-1))put(x,y-1,n%3===0?':':"'",'foam');
        if(n%9===0&&t>.2&&t<.8&&inSurface(x+1,y+1))put(x+1,y+1,'.','foam');
      }
      if(appearance.nebulaSwirl)for(let n=0;n<=35;n++){
        const t=n/35,a=t*5.6,r=.5+3.8*t,x=48+r*Math.cos(a),y=21.7+r*.32*Math.sin(a);
        if(inSurface(x,y))put(x,y,n%6<3?'~':'.','liquid');
      }
    }
    // Slender faceted stem and elliptical foot: a chilled cocktail, not a soup bowl.
    put(50,bottom,'V','rim');ellipse(50,bottom+1,2,1,'edge','front');
    line(49,bottom+2,49,56,'stem','|');line(51,bottom+2,51,56,'dim','|');
    for(let y=bottom+3;y<55;y+=5)put(50,y,':','edge');
    line(49,56,46,58,'edge');line(51,56,54,58,'dim');
    ellipse(50,60,17,2.5,'dim','back');ellipse(50,60,17,2.5,'rim','front');
    ellipse(50,60,12,1.2,'edge','front');line(40,62,52,62,'stem','_');line(41,63,61,63,'dim','_');
    if(appearance.garnishes.includes('twist')){
      // A thin, tilted loop of actual lemon peel perched on the rim. Its interior
      // stays empty; this is not a citrus wheel, glitter, or a ring around the drink.
      for(let n=0;n<=110;n++){
        const a=n/110*Math.PI*2,dx=11*Math.cos(a),dy=3*Math.sin(a),x=69+dx,y=12+dy-dx*.3;
        const tangent=-3*Math.sin(a)+3*Math.cos(a),char=Math.abs(tangent)<1.2?'_':Math.sin(a)>.6?'\'':Math.sin(a)<-.6?'.':tangent>0?'/':'\\';
        put(x,y,char,'garnish');
      }
      line(59,15,56,18,'garnish','/');put(57,17,"'",'spark');
    }
    return {width,height,cells,appearance};
  }
  const shape=DETAILED_GLASS_KEYS.includes(template as typeof DETAILED_GLASS_KEYS[number])?template:'coupe';
  let top=11,bottom=39,liquid=18,stem=true;
  let radius=(y:number)=>32*(1-(y-top)/(bottom-top));
  switch(shape){
    case 'highball':top=8;bottom=54;liquid=16;stem=false;radius=y=>18-(y-top)/46*2;break;
    case 'rocks':top=20;bottom=54;liquid=28;stem=false;radius=y=>25-(y-top)/34*2;break;
    case 'coupe':top=12;bottom=31;liquid=18;radius=y=>29*Math.sqrt(Math.max(0,1-((y-top)/(bottom-top))**2));break;
    case 'flute':top=7;bottom=41;liquid=14;radius=y=>10*Math.sqrt(Math.max(0,1-Math.pow((y-top)/(bottom-top),4)));break;
    case 'hurricane':top=8;bottom=47;liquid=17;radius=y=>{const t=(y-top)/(bottom-top),smooth=(n:number)=>n*n*(3-2*n);return t<.44?19-7*smooth(t/.44):t<.72?12+7*smooth((t-.44)/.28):19*Math.sqrt(Math.max(0,1-((t-.72)/.28)**2));};break;
    case 'mug':top=12;bottom=53;liquid=20;stem=false;radius=()=>20;break;
    case 'goblet':top=9;bottom=39;liquid=18;radius=y=>{const t=(y-top)/(bottom-top);return t<.35?20+t/.35*6:26*Math.sqrt(Math.max(0,1-((t-.35)/.65)**2));};break;
  }
  const dlc = appearance.design==='xiaodong_notes';
  if(dlc)({top,bottom,liquid,stem,radius}=dlcGlassContour(shape,appearance.variant??0));
  // One mixed-liquid field: these are editorial texture points, never taste/dose layers.
  const opaque=appearance.foam!=='none'||appearance.palette==='cream'||appearance.palette==='coffee';
  for(let y=liquid+1;y<bottom-1;y++)for(let x=0;x<width;x++){
    if(Math.abs(x-50)<radius(y)-3){
      const pattern=grain(x,y)%100;
      if(pattern<(opaque?11:6))put(x,y,pattern%4===0?':':'.','liquid');
      else if(pattern===24)put(x,y,"'",'shadow');
      else if(pattern===81&&y%2===0)put(x,y,'.','light');
      if(appearance.bubbles&&x%7===(seed%7)&&y%5===(Math.floor(x/7)%5))put(x,y,y%2?'o':'.','bubble');
    }
  }
  if(dlc&&appearance.layers&&appearance.layers.length>1){
    // Explicit floating/layering in the editorial recipe. Illustration bands
    // never encode doses, taste controls or nutrition.
    const layers=appearance.layers;
    const colourAt=(depth:number)=>{
      if(!appearance.gradient)return GLASS_PALETTES[layers[Math.min(layers.length-1,Math.floor(depth*layers.length))]].liquid;
      const a=GLASS_PALETTES[layers[0]].liquid,b=GLASS_PALETTES[layers[layers.length-1]].liquid,t=Math.max(0,Math.min(1,(depth-.12)/.76));
      return '#'+[1,3,5].map(offset=>Math.round(parseInt(a.slice(offset,offset+2),16)*(1-t)+parseInt(b.slice(offset,offset+2),16)*t).toString(16).padStart(2,'0')).join('');
    };
    for(let y=Math.ceil(liquid);y<bottom-1;y++){
      for(let x=Math.ceil(53-radius(y));x<48+radius(y);x++)if(grain(x,y)%5===0){
        put(x,y,grain(x,y)%2?':':'.','liquid');
        cells[Math.round(y)][Math.round(x)]!.color=colourAt((y-liquid)/(bottom-liquid));
      }
    }
    for(let band=1;!appearance.gradient&&band<layers.length;band++){
      const y=liquid+(bottom-liquid)*band/layers.length,r=radius(y)-3;
      ellipse(50,y,r,1.1,'liquid','front');
      for(let yy=Math.floor(y)-1;yy<=Math.ceil(y)+1;yy++)for(let x=Math.ceil(50-r);x<=50+r;x++){
        const glyph=cells[yy]?.[x];if(glyph?.tone==='liquid')glyph.color=GLASS_PALETTES[layers[band]].liquid;
      }
    }
  }
  for(let y=top;y<bottom;y++){
    const r=radius(y),next=radius(Math.min(bottom,y+1));
    line(50-r,y,50-next,y+1,'edge');line(50+r,y,50+next,y+1,'edge');
    if(y>top+5&&y<bottom-3&&r>5){
      const depth=(y-top)/(bottom-top),leftChar=Math.abs(r-next)>.45?'\\':'|',rightChar=Math.abs(r-next)>.45?'/':'|';
      // Long asymmetrical reflections read as transparent glass, not another rim.
      if(depth<.76&&y%7!==0)put(53-r,y,leftChar,depth<.5?'rim':'dim');
      if(depth>.28&&depth<.9&&y%5<3)put(47+r,y,rightChar,'dim');
      if(depth>.2&&depth<.48&&y%3===0)put(55-r,y,"'",'light');
    }
  }
  if(dlc){
    // Cut-glass reflections depict glassware, never added recipe ingredients.
    const style=(appearance.variant??0)%4;
    for(let y=Math.ceil(top+6);y<bottom-3;y++){
      const r=radius(y),depth=(y-top)/(bottom-top);
      if(style===1&&y%3!==0){put(50-r*.58,y,':','dim');put(50+r*.58,y,':','dim');}
      if(style===2&&r>8){put(50-r*.52+Math.sin(depth*13)*2,y,y%4<2?'/':'\\','dim');put(50+r*.52-Math.sin(depth*13)*2,y,y%4<2?'\\':'/','dim');}
      if(style===3&&y%7===0)for(let x=Math.ceil(53-r);x<48+r;x+=5)put(x,y,"'",'dim');
    }
  }
  // Back lip, inner aperture and foreground lip form a continuous double ellipse.
  ellipse(50,top,radius(top),3,'dim','back');
  ellipse(50,top+.6,radius(top)-2,2,'edge');
  ellipse(50,top+1,radius(top),3,'rim','front');
  line(50-radius(top)*.42,top-3,50+radius(top)*.12,top-3,'rim','-');
  put(50-radius(top)+1,top,'(','rim');put(50+radius(top)-1,top,')','edge');
  const surfaceRadius=Math.max(1,radius(liquid)-2);
  ellipse(50,liquid,surfaceRadius,2,'shadow','back');
  ellipse(50,liquid,surfaceRadius,2,'liquid','front');
  if(dlc&&appearance.layers&&appearance.layers.length>1){
    for(let y=Math.floor(liquid)-2;y<=Math.ceil(liquid)+2;y++)for(let x=0;x<width;x++){
      const glyph=cells[y]?.[x];if(glyph?.tone==='liquid')glyph.color=GLASS_PALETTES[appearance.layers[0]].liquid;
    }
  }
  // A short specular reflection leaves the main coloured meniscus legible.
  line(50-surfaceRadius*.65,liquid+2,50-surfaceRadius*.13,liquid+2,'light','_');
  if(appearance.foam!=='none'){
    for(let y=liquid-1;y<=liquid+1;y++)for(let x=Math.ceil(51-surfaceRadius);x<50+surfaceRadius-1;x++)if(grain(x,y)%4!==0)put(x,y,grain(x,y)%2?'~':':','foam');
    if(appearance.foam==='cream'){
      ellipse(50,liquid-2,surfaceRadius*.76,2.2,'foam','back');
      ellipse(51,liquid-4,surfaceRadius*.5,1.6,'foam','back');
      ellipse(50,liquid-5,surfaceRadius*.25,1,'foam','back');
    }
  }
  if(appearance.rim)for(let x=Math.ceil(50-radius(top))+1;x<50+radius(top);x++)if(x%3!==0)put(x,top-2+Math.round(Math.abs(x-50)/radius(top)),x%2?':':'.','garnish');
  if(stem){
    put(50,bottom,'V','rim');ellipse(50,bottom+1,2,1,'edge','front');
    line(49,bottom+2,49,56,'stem','|');line(51,bottom+2,51,56,'dim','|');
    for(let y=bottom+3;y<55;y+=4)put(50,y,':','edge');
    line(49,56,46,58,'edge');line(51,56,54,58,'dim');
    ellipse(50,60,15,2.5,'dim','back');ellipse(50,60,15,2.5,'rim','front');
    ellipse(50,60,11,1.2,'edge','front');line(41,62,52,62,'stem','_');line(41,63,60,63,'dim','_');
  }else{
    ellipse(50,bottom,radius(bottom)-1,2,'edge','front');ellipse(50,bottom+2,radius(bottom),2,'rim','front');
    line(50-radius(bottom),bottom,50-radius(bottom)+1,bottom+3,'rim','|');line(50+radius(bottom),bottom,50+radius(bottom)-1,bottom+3,'dim','|');
    line(53-radius(bottom),bottom+4,47+radius(bottom),bottom+4,'dim','_');
    line(56-radius(bottom),bottom+2,46,bottom+2,'stem','_');
    for(let x=Math.ceil(53-radius(bottom));x<47+radius(bottom);x+=5)put(x,bottom+1,'/','dim');
  }
  if(shape==='mug'&&dlc){
    const cy=(top+bottom)/2,rx=radius(cy),anchor=50+rx,ry=(bottom-top)*.29;
    for(let n=0;n<=70;n++){
      const a=-Math.PI/2+n/70*Math.PI;
      put(anchor+2+Math.cos(a)*10,cy+Math.sin(a)*ry,a<0?'.':')',a<0?'rim':'edge');
      put(anchor+2+Math.cos(a)*6,cy+Math.sin(a)*(ry-4),')','dim');
    }
    line(anchor-1,cy-ry,anchor+3,cy-ry,'rim','_');line(anchor-1,cy+ry,anchor+3,cy+ry,'edge','_');
  }else if(shape==='mug'){
    // Rounded C-shaped handle, attached at both ends but open through its centre.
    for(let y=-11;y<=11;y++){
      const r=12*Math.sqrt(Math.max(0,1-(y/11)**2));put(72+r,33+y,y===-11?'-':y===11?'_':y<-7?'.':y>7?"'":')',y<0?'rim':'edge');
      if(Math.abs(y)<7)put(72+7*Math.sqrt(Math.max(0,1-(y/7)**2)),33+y,')','dim');
    }
    line(70,22,73,22,'rim','_');line(70,44,73,44,'edge','_');
  }
  if(appearance.ice!=='none'){
    // Clip every ice symbol to the bowl; small stemware cannot grow an oversized cube.
    const icePut=(x:number,y:number,char:string,tone:GlyphTone='ice')=>{if(y>=liquid-1&&y<bottom-1&&Math.abs(x-50)<radius(y)-3)put(x,y,char,tone);};
    const iceLine=(x1:number,y1:number,x2:number,y2:number,tone:GlyphTone='ice')=>{
      const dx=x2-x1,dy=y2-y1,n=Math.max(Math.abs(dx),Math.abs(dy))*2,char=Math.abs(dy)<Math.abs(dx)*.35?'_':Math.abs(dx)<Math.abs(dy)*.35?'|':dx*dy>0?'\\':'/';
      for(let i=0;i<=n;i++){const t=n?i/n:0;icePut(x1+dx*t,y1+dy*t,char,tone);}
    };
    const cube=(cx:number,cy:number,s:number)=>{
      const a={x:cx-s,y:cy-s+1},b={x:cx+s-1,y:cy-s-1},c={x:cx+s+2,y:cy-s+2},d={x:cx-s+3,y:cy-s+4},depth=Math.max(4,s+1);
      iceLine(a.x,a.y,b.x,b.y);iceLine(b.x,b.y,c.x,c.y);iceLine(c.x,c.y,d.x,d.y);iceLine(d.x,d.y,a.x,a.y,'dim');
      for(const p of [a,c,d])iceLine(p.x,p.y,p.x,p.y+depth,p===d?'ice':'dim');
      iceLine(a.x,a.y+depth,d.x,d.y+depth,'dim');iceLine(d.x,d.y+depth,c.x,c.y+depth);
      iceLine(d.x+2,d.y+1,d.x+2,d.y+depth-1,'light');icePut(cx,cy-1,"'",'light');
    };
    if(appearance.ice==='crushed'){
      for(let y=liquid;y<bottom-2;y+=3)for(let x=Math.ceil(52-radius(y));x<48+radius(y);x+=4)if(grain(x,y)%3!==0){icePut(x,y,grain(x,y)%2?'/':'\\');icePut(x+1,y+1,'_','dim');}
    }else if(appearance.ice==='large')cube(50,Math.min(liquid+11,bottom-9),Math.min(8,Math.floor(surfaceRadius/2)));
    else{cube(45,liquid+5,4);cube(55,liquid+14,4);if(bottom-liquid>30)cube(45,liquid+25,4);}
  }
  const drawGarnish=(kind:GlassGarnish,index:number)=>{
    const side=index===1?-1:1,cx=index===2?50+radius(top)*.32:50+side*(radius(top)-2),cy=Math.max(6,top-1)+(index===2?2:0);
    if(kind==='olive'||kind==='cherry'){
      const cocktailPick=shape==='martini'||shape==='coupe';
      const fx=cocktailPick?55+index*7:cx,fy=cocktailPick?top+1:cy;
      if(cocktailPick&&index===0)line(67,2,42,Math.min(bottom-4,top+21),'garnish','/');
      ellipse(fx,fy,kind==='olive'?4:3,2.7,kind==='olive'?'leaf':'fruit');
      put(fx,fy,kind==='olive'?'@':'o','spark');put(fx-1,fy-1,"'",'light');
      if(kind==='cherry')line(fx+1,fy-3,fx+4,fy-5,'leaf','/');
    }else if(kind==='citrus'||kind==='kiwi'){
      ellipse(cx,cy,7,5,'garnish');ellipse(cx,cy,5.5,4,kind==='kiwi'?'leaf':'garnish');
      for(const angle of [0,.85,1.7,2.55,3.4,4.25,5.1])line(cx,cy,cx+Math.cos(angle)*5,cy+Math.sin(angle)*3,kind==='kiwi'?'leaf':'garnish',':');
      put(cx,cy,'+','light');
    }else if(kind==='twist'||kind==='cucumber'){
      const tone=kind==='cucumber'?'leaf':'garnish';
      for(let y=0;y<13;y++){const xx=cx+Math.sin(y*.6)*4;put(xx,cy-4+y,y%4<2?'/':'\\',tone);put(xx+2,cy-4+y,':','dim');}
      ellipse(cx,cy-3,4,1,tone,'back');
    }else if(kind==='dust'||kind==='beans'){
      if(kind==='beans'){for(const dx of [-5,0,5]){ellipse(50+dx,liquid-1+(dx===0?1:0),1.6,1,'garnish');put(50+dx,liquid-1+(dx===0?1:0),'/','shadow');}}
      else for(let x=50-surfaceRadius+3;x<50+surfaceRadius-2;x+=2)if(grain(x,0)%3!==0)put(x,liquid+(grain(x,1)%2),grain(x,2)%2?'.':':','garnish');
    }else if(kind==='herb'||kind==='sprig'||kind==='celery'){
      line(cx,cy+4,cx+side*3,cy-5,'leaf','/');
      for(let n=0;n<3;n++){
        const sy=cy-4+n*3,sx=cx+side*(2-n),size=kind==='herb'?4:2;
        line(sx,sy,sx-size,sy-2,'leaf','\\');line(sx,sy,sx+size,sy-2,'leaf','/');
        if(kind==='herb'){put(sx-size+1,sy-2,'(','leaf');put(sx+size-1,sy-2,')','leaf');}
      }
    }else if(kind==='pineapple'){
      line(cx-5,cy+5,cx-7,cy-5,'garnish');line(cx-7,cy-5,cx+6,cy+1,'garnish');line(cx+6,cy+1,cx-5,cy+5,'garnish');
      for(let y=cy-3;y<cy+3;y+=2)for(let x=cx-4;x<cx+1;x+=2)put(x,y,':','garnish');
    }else if(kind==='berry'||kind==='grape'){
      for(const [dx,dy] of [[-2,0],[2,0],[0,3]]){ellipse(cx+dx,cy+dy,2,1.8,'fruit');put(cx+dx-1,cy+dy-1,"'",'light');}
      if(kind==='berry')line(cx-2,cy-3,cx+2,cy-3,'leaf','^');
    }else if(kind==='passion'){
      ellipse(cx,cy+1,7,4,'garnish');ellipse(cx,cy+1,5,3,'fruit');
      for(let yy=-1;yy<3;yy++)for(let xx=-3;xx<4;xx+=2)put(cx+xx,cy+yy,':','garnish');
    }else if(kind==='chili'||kind==='carrot'){
      line(cx-2,cy-5,cx+2,cy-4,'leaf');line(cx-2,cy-4,cx,cy+7,'fruit');line(cx+2,cy-4,cx+3,cy+3,'fruit');line(cx+3,cy+3,cx,cy+7,'fruit');
    }else if(kind==='ginger'){
      ellipse(cx,cy,4,2,'garnish');line(cx-2,cy-1,cx+2,cy+1,'garnish',':');
    }
  };
  appearance.garnishes.forEach(drawGarnish);
  if(appearance.hot){
    for(let n=0;n<2;n++)for(let y=0;y<6;y++)put(45+n*11+Math.round(Math.sin(y*.9)),Math.max(1,top-7)+y,y%3?':':"'",'dim');
  }
  return {width,height,cells,appearance};
}

/** Uniform monospace cells preserve silhouette proportions at every available viewport. */
export function fitGlassArt(art: GlassArt, width: number, height: number) {
  const points=art.cells.flatMap((row,y)=>row.flatMap((glyph,x)=>glyph?[{x,y}]:[]));
  const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x));
  const minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
  const columns=maxX-minX+1,rows=maxY-minY+1;
  const fontSize=Math.max(.25,Math.floor(Math.min(width*.82/(columns*.6),height*.88/(rows*.92))*4)/4);
  const charW=fontSize*.6,lineH=fontSize*.92;
  return {fontSize,charW,lineH,x:(width-columns*charW)/2-minX*charW+charW/2,y:(height-rows*lineH)/2-minY*lineH+lineH/2,minX,maxX,minY,maxY};
}

/** Only explicit ml in drinking stages participates; non-ml and unknown amounts stay unknown. */
export function compositionFacts(recipe:Recipe,ingredients?:Ingredient[]){
  const liquidStages=new Set(['mix','top','float']);
  // This documented serving is double-strained: shaker ice is not an unknown
  // main-drink ingredient. Its melt water is handled separately by estimates.
  const strainedZhenglin=isZhenglinSoup(recipe);
  const included=recipe.ingredients.map((part,index)=>({part,index,amount:ingredients?displayQuantity(part,ingredients.find(i=>i.id===part.ingredient_id)):null})).filter(({part})=>liquidStages.has(part.stage)&&!(strainedZhenglin&&((part.ingredient_id==='cdb_ice'&&part.stage==='mix'&&part.unit==='g')||part.ingredient_id==='user_zhenglin_nebula_foam')));
  const volume=({part,amount}:typeof included[number])=>amount?amount.ml:part.unit==='ml'?part.quantity:null;
  const known=included.filter(row=>{const ml=volume(row);return ml!==null&&Number.isFinite(ml)&&ml>0;});
  const knownMl=known.reduce((n,row)=>n+volume(row)!,0);
  const incomplete=included.some(row=>volume(row)===null)||recipe.ingredients.some(i=>i.stage==='rinse');
  return {knownMl,incomplete,assumedConversion:known.some(row=>row.amount?.assumed),parts:known.map(row=>({ingredient_id:row.part.ingredient_id,part_index:row.index,ml:volume(row)!,percent:knownMl>0?volume(row)!/knownMl*100:null}))};
}
