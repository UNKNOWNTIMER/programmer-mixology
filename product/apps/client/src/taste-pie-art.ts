import { validateTaste } from './domain';
import type { Taste } from './types';

export interface PieCell { glyph:string; axis:number; face:'top'|'edge'|'side'|'empty' }
export const PIE_COLORS=['#c77c71','#c6b582','#80a4ad','#8da89a','#a295b5'];
export { tastePercentages as piePercentages } from './taste-display';
/** An orthographic ASCII cylinder. Angular sectors encode target taste, never ingredient volume. */
export function tastePieArt(taste:Taste):PieCell[][]{
  validateTaste(taste);
  const width=61,height=24,cx=30,cy=9,rx=27,ry=7,depth=5;
  const boundaries:number[]=[];let total=0;for(const value of taste){total+=value;boundaries.push(total/10000*Math.PI*2);}
  const sector=(angle:number)=>{const turn=(angle+Math.PI/2+Math.PI*2)%(Math.PI*2);return Math.max(0,boundaries.findIndex(end=>turn<end));};
  const cells:PieCell[][]=Array.from({length:height},()=>Array.from({length:width},()=>({glyph:' ',axis:-1,face:'empty'})));
  const put=(x:number,y:number,glyph:string,axis:number,face:PieCell['face'])=>{if(cells[y]?.[x])cells[y][x]={glyph,axis,face};};
  // The front wall is a true extrusion of the visible half-ellipse. Quiet,
  // regular stippling separates its darker face without filling it with noise.
  for(let x=cx-rx;x<=cx+rx;x++){
    const dx=(x-cx)/rx,arc=Math.sqrt(Math.max(0,1-dx*dx));
    const front=Math.round(cy+ry*arc),axis=sector(Math.atan2(arc,dx));
    for(let y=front+1;y<front+depth;y++)put(x,y,(x%3===0&&y%2===0)?':':' ',axis,'side');
  }
  for(let y=cy-ry;y<=cy+ry;y++)for(let x=cx-rx;x<=cx+rx;x++){
    const dx=(x-cx)/rx,dy=(y-cy)/ry;if(dx*dx+dy*dy>1)continue;
    const axis=sector(Math.atan2(dy,dx));
    put(x,y,(x+2*y)%6===0?'.':' ',axis,'top');
  }
  // Bresenham paths use the slope in screen cells, not the unprojected circle.
  // Shallow cuts therefore have connected horizontal runs instead of slash bands.
  const line=(x0:number,y0:number,x1:number,y1:number,axis:number,face:PieCell['face'])=>{
    const dx=Math.abs(x1-x0),dy=Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;
    let error=dx-dy,x=x0,y=y0;
    while(true){
      if(x===x1&&y===y1){put(x,y,dx===0?'|':dy===0?'-':sx*sy>0?'\\':'/',axis,face);break;}
      const twice=2*error,nx=twice>-dy?x+sx:x,ny=twice<dx?y+sy:y;
      put(x,y,nx===x?'|':ny===y?'-':sx*sy>0?'\\':'/',axis,face);
      if(twice>-dy)error-=dy;if(twice<dx)error+=dx;x=nx;y=ny;
    }
  };
  const active=taste.flatMap((value,axis)=>value>0?[axis]:[]);
  if(active.length>1){
    let start=0;
    for(let axis=0;axis<taste.length;axis++){
      if(taste[axis]===0)continue;
      const angle=start/10000*Math.PI*2-Math.PI/2;
      const x=Math.round(cx+rx*Math.cos(angle)),y=Math.round(cy+ry*Math.sin(angle));
      line(cx,cy,x,y,axis,'edge');
      // Only front-facing sector cuts descend through the visible wall.
      if(Math.sin(angle)>0.000001)for(let row=y+1;row<y+depth;row++)put(x,row,'|',axis,'side');
      start+=taste[axis];
    }
    put(cx,cy,'+',active[0],'edge');
  }

  // Rasterise the outline once per column. Vertical joins at the two ends
  // close the ellipse; a narrow outline stays legible at the compact font size.
  const arc=(front:boolean,offset:number,face:PieCell['face'])=>{
    let previous:{x:number;y:number}|null=null;
    for(let x=cx-rx;x<=cx+rx;x++){
      const dx=(x-cx)/rx,curve=Math.sqrt(Math.max(0,1-dx*dx)),dy=(front?1:-1)*curve;
      const y=Math.round(cy+ry*dy)+offset,axis=sector(Math.atan2(dy,dx));
      const slope=-ry*dx/(rx*Math.max(.001,curve))*(front?1:-1);
      const glyph=Math.abs(slope)>.85?'|':Math.abs(slope)>.25?(slope>0?'\\':'/'):(front?'_':'-');
      if(previous&&Math.abs(y-previous.y)>1)for(let row=Math.min(y,previous.y)+1;row<Math.max(y,previous.y);row++)put(x,row,'|',axis,face);
      put(x,y,glyph,axis,face);previous={x,y};
    }
  };
  for(const x of [cx-rx,cx+rx])for(let y=cy;y<cy+depth;y++)put(x,y,'|',sector(x<cx?Math.PI:0),'side');
  arc(true,depth,'side');
  arc(false,0,'edge');
  arc(true,0,'edge');
  return cells;
}
