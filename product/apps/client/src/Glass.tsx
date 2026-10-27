import { Localized, useI18n } from './i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Recipe, Ingredient, Profile, Target } from './types';
import { GLASS_LABELS } from './domain';
import { GlassCallout } from './GlassCallout';
import { ArchiveDragButton } from './ArchiveDragButton';
import type { ArchiveDragGesture } from './archive-drag';
import { native } from './bridge';
import { buildRecipeGlassArt, randomHotspotPoints, clampFloatingPanel } from './glass-art';
import { paintGlassArt } from './glass-paint';
import recipeQuotes from './recipe-quotes.json';
import englishQuotes from './recipe-quotes.en.json';
import { zhenglinQuote } from './zhenglin-soup';
import { notebookQuote } from './dlc-notebook';
import './glass-detail.css';
export const GLASSES: Record<string,string[]> = {
  highball: ['     __________     ','    |          |    ','    |          |    ','    |          |    ','    |          |    ','    |          |    ','    |__________|    '],
  rocks: ['    ____________    ','   |            |   ','   |            |   ','   |            |   ','   |____________|   '],
  martini: ['  ________________  ','   \\            /   ','    \\          /    ','     \\        /     ','      \\______/      ','         ||         ','         ||         ','      ___||___      '],
  coupe: ['   ______________   ','   \\            /   ','    \\__________/    ','         ||         ','         ||         ','      ___||___      '],
  flute: ['       ______       ','      |      |      ','      |      |      ','      |      |      ','       \\____/       ','         ||         ','         ||         ','       __||__       '],
  hurricane: ['      ________      ','     /        \\     ','     \\        /     ','      |      |      ','     /        \\     ','     \\________/     ','         ||         ','      ___||___      '],
  mug: ['    __________      ','   |          |__   ','   |          |  |  ','   |          |__|  ','   |__________|     '],
  goblet: ['     __________     ','    /          \\    ','    \\          /    ','     \\________/     ','         ||         ','      ___||___      '],
};
export function renderGlass(key: string): string[] {
  return (GLASSES[key] || GLASSES.coupe).map(row => {
    const chars = [...row], start = chars.findIndex(c => '|/\\'.includes(c));
    const end = chars.findIndex((c,i) => i > start && '|/\\'.includes(c));
    if (start >= 0 && end-start > 3) for(let i=start+1; i<end; i++) if(chars[i] === ' ') chars[i] = i%3 ? '.' : ':';
    return chars.join('');
  });
}
interface GlassProps { recipe: Recipe; ingredients: Ingredient[]; profile?: Profile; target?: Target; quoteKey?: string; onArchiveDrag?:(gesture:ArchiveDragGesture)=>Promise<void> }
type Hotspot = 'composition' | 'facts' | 'profile';
const HOTSPOTS:Hotspot[]=['composition','facts','profile'];
function FloatingGlassPanel({anchor,children,className,onEnter,onLeave}:{anchor:HTMLElement|null;children:ReactNode;className:string;onEnter?:()=>void;onLeave?:()=>void}) {
  const panel=useRef<HTMLDivElement>(null),[position,setPosition]=useState<{x:number;y:number}|null>(null);
  useLayoutEffect(()=>{
    const place=()=>{const el=panel.current;if(!el||!anchor)return;const a=anchor.getBoundingClientRect(),b=el.getBoundingClientRect();setPosition(clampFloatingPanel({x:a.left+a.width/2,y:a.top+a.height/2},b.width,b.height,{width:window.innerWidth,height:window.innerHeight}));};
    const observer=new ResizeObserver(place);if(panel.current)observer.observe(panel.current);if(anchor)observer.observe(anchor);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);place();return()=>{observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[anchor]);
  return createPortal(<div ref={panel} className={`${className} glass-floating`} role="dialog" style={{left:position?.x??8,top:position?.y??8,visibility:position?'visible':'hidden'}} onMouseEnter={onEnter} onMouseLeave={onLeave}>{children}</div>,document.body);
}
export function Glass({recipe,ingredients,profile,target,quoteKey,onArchiveDrag}:GlassProps) {
  const {language}=useI18n();
  const art=useMemo(()=>buildRecipeGlassArt(recipe),[recipe]);
  const canvas=useRef<HTMLCanvasElement>(null),host=useRef<HTMLDivElement>(null),hotspotRefs=useRef<Partial<Record<Hotspot,HTMLButtonElement>>>({}),closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [hovered,setHovered]=useState<Hotspot|null>(null),[selected,setSelected]=useState<Hotspot|null>(null),[quote,setQuote]=useState(false);
  const [points,setPoints]=useState(randomHotspotPoints);
  const active=hovered||selected;

  const cancelClose=()=>{if(closeTimer.current!==null){clearTimeout(closeTimer.current);closeTimer.current=null;}};
  const scheduleClose=()=>{cancelClose();closeTimer.current=setTimeout(()=>setHovered(null),500);};
  const closeAll=()=>{cancelClose();setHovered(null);setSelected(null);setQuote(false);};
  useEffect(()=>{setHovered(null);setSelected(null);setQuote(false);setPoints(randomHotspotPoints());},[recipe.id]);
  useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')closeAll();};const outside=(e:PointerEvent)=>{const el=e.target as HTMLElement;if(!host.current?.contains(el)&&!el.closest('.glass-floating,.glass-browser-callout,.glass-connector'))closeAll();};document.addEventListener('keydown',escape);document.addEventListener('pointerdown',outside);return()=>{cancelClose();document.removeEventListener('keydown',escape);document.removeEventListener('pointerdown',outside);};},[]);
  useEffect(()=>{
    let alive=true;
    const redraw=()=>{
      const c=canvas.current,h=host.current;if(!alive||!c||!h)return;
      const w=h.clientWidth,height=h.clientHeight,dpr=window.devicePixelRatio||1;
      if(!w||!height)return;c.width=Math.round(w*dpr);c.height=Math.round(height*dpr);
      const ctx=c.getContext('2d');if(!ctx)return;ctx.scale(dpr,dpr);ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,w,height);
      const family=getComputedStyle(h).getPropertyValue('--ascii-font').trim()||'"Courier New", monospace';
      paintGlassArt(ctx,art,w,height,family);
    };
    const observer=new ResizeObserver(redraw);if(host.current)observer.observe(host.current);
    window.addEventListener('resize',redraw);document.fonts?.ready.then(redraw);document.fonts?.addEventListener('loadingdone',redraw);redraw();
    return()=>{alive=false;observer.disconnect();window.removeEventListener('resize',redraw);document.fonts?.removeEventListener('loadingdone',redraw);};
  },[art]);
  const hotspot=(key:Hotspot,label:string)=>{const point=points[HOTSPOTS.indexOf(key)];return <button key={key} ref={el=>{if(el)hotspotRefs.current[key]=el;}} className={`detail-hotspot detail-${key} ${active===key?'active':''}`} style={{left:`${point.x}%`,top:`${point.y}%`}} aria-label={label} aria-expanded={active===key} onMouseEnter={()=>{cancelClose();setHovered(key);setQuote(false);}} onMouseLeave={scheduleClose} onFocus={()=>{setSelected(key);setQuote(false);}} onClick={()=>{cancelClose();setSelected(key);setQuote(false);}}><span/></button>;};
  const point=active?points[HOTSPOTS.indexOf(active)]:null;
  const currentQuote=notebookQuote(recipe)||zhenglinQuote(recipe,language)||(language==='en'?(englishQuotes as Record<string,string>)[quoteKey||recipe.id]||`${recipe.name_en} — leave an unnamed feeling in the finish of this glass.`:(recipeQuotes as Record<string,string>)[quoteKey||recipe.id]||`${recipe.name_zh}，把尚未命名的心情，留在这一杯的余韵里。`);
  return <Localized><div className="glass-scene detailed-glass" ref={host} data-art-design={art.appearance.design} data-art-palette={art.appearance.palette} data-art-ice={art.appearance.ice} data-art-garnishes={art.appearance.garnishes.join(',')} data-art-seed={art.appearance.seed}>
    <ArchiveDragButton className="canvas-button detailed-canvas" onArchiveDrag={native?onArchiveDrag:undefined} onClick={()=>{cancelClose();setQuote(v=>!v);setSelected(null);setHovered(null);}} aria-label={`${GLASS_LABELS[recipe.glass_template]||GLASS_LABELS.coupe}，点击查看酒语`} title={native&&onArchiveDrag?(language==='en'?'Click for a quote · Drag to save .timermix':'点击查看酒语 · 拖出保存 .timermix'):'按来源杯型、配料与装饰绘制；颜色和纹理为艺术示意。点击查看酒语。'}><canvas ref={canvas} aria-hidden="true"/></ArchiveDragButton>
    {hotspot('composition','查看原配方材料与已知毫升占比')}{hotspot('facts','查看酒精度与热量资料')}{hotspot('profile','查看配方感官预测与目标差异')}
    <GlassCallout kind={active} point={point} host={host} recipe={recipe} ingredients={ingredients} profile={profile} target={target} onEnter={cancelClose} onLeave={scheduleClose} onClose={closeAll}/>
    {quote&&<FloatingGlassPanel anchor={host.current} className="detail-quote"><p data-i18n="verbatim">{currentQuote}</p><button onClick={()=>setQuote(false)} aria-label="收起酒语">收起 ×</button></FloatingGlassPanel>}
    <span className="detail-caption">{GLASS_LABELS[recipe.glass_template]||GLASS_LABELS.coupe}</span>
  </div></Localized>;
}


