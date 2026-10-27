import {describe,it,expect} from 'vitest';
import {piePercentages,tastePieArt} from './taste-pie-art';
import type {Taste} from './types';
describe('read-only taste ASCII pie',()=>{
  it('uses all 10000 basis points without changing the caller and displays integers totaling 100',()=>{
    for(let n=0;n<300;n++){const parts=[0,10000,...[1,2,3,4].map(i=>(n*997+i*1879)%10001)].sort((a,b)=>a-b),v=parts.slice(1).map((p,i)=>p-parts[i]) as Taste,copy=[...v];const display=piePercentages(v);expect(display.every(Number.isInteger)).toBe(true);expect(display.reduce((a,b)=>a+b,0)).toBe(100);tastePieArt(v);expect(v).toEqual(copy);}
  });
  it('has a stable ASCII grid with a visible front wall and never paints zero sectors',()=>{
    for(let axis=0;axis<5;axis++){const v=[0,0,0,0,0] as Taste;v[axis]=10000;const grid=tastePieArt(v);expect(grid).toHaveLength(24);expect(grid.every(r=>r.length===61)).toBe(true);const visible=grid.flat().filter(c=>c.glyph!==' ');expect(visible.every(c=>c.axis===axis&&/^[ -~]$/.test(c.glyph))).toBe(true);expect(visible.filter(c=>c.face==='side').length).toBeGreaterThan(60);expect(tastePieArt(v)).toEqual(grid);}
  });
  it('redraws sectors when targets change and rejects invalid data instead of normalizing it',()=>{expect(tastePieArt([5000,3000,1000,1000,0])).not.toEqual(tastePieArt([3000,5000,1000,1000,0]));expect(()=>tastePieArt([1,2,3,4,5])).toThrow();expect(()=>piePercentages([9999.5,.5,0,0,0])).toThrow();});
  it('keeps a continuous visible lower contour and clear margins without solid wall noise',()=>{
    const grid=tastePieArt([5000,4000,1000,0,0]),ends:number[]=[];
    for(let x=3;x<=57;x++){
      const column=grid.map((row,y)=>({cell:row[x],y})).filter(p=>p.cell.glyph!==' ');
      const end=column.at(-1)!;expect(end.cell.face).toBe('side');ends.push(end.y);
    }
    expect(ends.every((y,i)=>i===0||Math.abs(y-ends[i-1])<=2)).toBe(true);
    expect(grid[0].every(c=>c.glyph===' ')).toBe(true);expect(grid[23].every(c=>c.glyph===' ')).toBe(true);
    expect(grid.every(row=>row[0].glyph===' '&&row[60].glyph===' ')).toBe(true);
    const wall=grid.flat().filter(c=>c.face==='side');expect(wall.filter(c=>c.glyph===' ').length/wall.length).toBeGreaterThan(.45);
  });
  it('joins true half-circle cuts vertically and omits artificial spokes for a single taste',()=>{
    const half=tastePieArt([5000,5000,0,0,0]);
    expect(half[9][30].glyph).toBe('+');
    for(let y=3;y<9;y++)expect(half[y][30].glyph).toBe('|');
    for(let y=17;y<21;y++){expect(half[y][30].glyph).toBe('|');expect(half[y][30].face).toBe('side');}
    const whole=tastePieArt([0,0,10000,0,0]);expect(whole[9][30].face).toBe('top');expect(whole.flat().some(c=>c.glyph==='+')).toBe(false);
    const tiny=tastePieArt([1,9999,0,0,0]);expect(tiny.flat().filter(c=>c.glyph!==' ').every(c=>c.axis===0||c.axis===1)).toBe(true);
  });
});
