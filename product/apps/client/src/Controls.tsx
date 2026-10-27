import { Localized, useI18n, type Language } from './i18n';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Profile, Target, Taste } from './types';
import { SENSORY_LABELS, TASTE_EN, TASTE_LABELS } from './domain';
import './controls-detail.css';
import { tastePercentages } from './taste-display';
import './control-inspector.css';
import { controlHint, createDelayedHint, createTastePreviewPublisher, type ControlKind } from './control-inspection';
import { useSliderMotion, type SliderMotion } from './useSliderMotion';

export interface ClassicPreset { recipe_id:string; name_zh:string; name_en:string; profile:Profile }
export interface ControlProps {
  target:Target; profile?:Profile; locked:number[]; presets?:ClassicPreset[];
  motion?:SliderMotion; onInterruptMotion?:()=>void;
  onTastePreview?:(taste:Taste|null)=>void;
  onLock:(axis:number)=>void; onBegin:()=>void; onEnd:()=>void; onCancel:()=>void;
  onTaste:(anchor:Taste,axis:number,value:number)=>void; onSensory:(axis:number,value:number)=>void;
  onPreset:()=>void; onSelectPreset?:(recipeId:string)=>void;
}
export interface PresetCluster { position:number; entries:ClassicPreset[] }
/** Close projections share one hit target; choosing a recipe always loads its full profile. */
export function clusterPresets(presets:ClassicPreset[],axis:number):PresetCluster[] {
  const sorted=presets.filter(p=>p.profile.taste_preference_bps?.length===5).map(p=>({entry:p,value:p.profile.taste_preference_bps[axis]})).sort((a,b)=>a.value-b.value||a.entry.recipe_id.localeCompare(b.entry.recipe_id));
  const clusters:PresetCluster[]=[];
  for(const item of sorted){const last=clusters.at(-1);if(last&&item.value-last.position<=200){last.entries.push(item.entry);}else clusters.push({position:item.value,entries:[item.entry]});}
  return clusters;
}
/** Show up to five groups within 20 percentage points, or the single nearest fallback. */
export function nearbyPresetClusters(clusters:readonly PresetCluster[],position:number,limit=5,keep?:PresetCluster):PresetCluster[] {
  const count=Math.max(0,Math.min(5,Math.floor(limit)));if(!count)return [];
  const ranked=[...clusters].sort((a,b)=>Math.abs(a.position-position)-Math.abs(b.position-position)||a.position-b.position);
  const adjacent=ranked.filter(cluster=>Math.abs(cluster.position-position)<=2000);
  const selected=(adjacent.length?adjacent:ranked.slice(0,1)).slice(0,count);
  if(keep&&clusters.includes(keep)&&!selected.includes(keep)){if(selected.length===count)selected.pop();selected.push(keep);}
  return selected.sort((a,b)=>a.position-b.position);
}
interface HintAnchor {axis:number;anchor:HTMLElement}
function useControlInspector(){
  const [active,setActive]=useState<HintAnchor|null>(null),id=useId();
  const delay=useMemo(()=>createDelayedHint<HintAnchor>(setActive,()=>setActive(null)),[]);
  useEffect(()=>()=>delay.dispose(),[delay]);
  return {active,id,begin:(axis:number,anchor:HTMLElement)=>delay.enter(String(axis),{axis,anchor}),hide:()=>delay.leave()};
}
function ControlInspector({active,id,kind,language,value}:{active:HintAnchor|null;id:string;kind:ControlKind;language:Language;value:number}){
  const panel=useRef<HTMLDivElement>(null),[position,setPosition]=useState<{x:number;y:number}|null>(null);
  useLayoutEffect(()=>{
    if(!active)return;
    const place=()=>{if(!panel.current||!active.anchor.isConnected)return;const box=active.anchor.getBoundingClientRect(),hint=panel.current.getBoundingClientRect();setPosition({x:Math.max(8,Math.min(innerWidth-hint.width-8,box.left+box.width/2-hint.width/2)),y:Math.max(8,Math.min(innerHeight-hint.height-8,box.top>=hint.height+16?box.top-hint.height-8:box.bottom+8))});};
    place();window.addEventListener('resize',place);return()=>window.removeEventListener('resize',place);
  },[active,language]);
  if(!active)return null;
  const labels=kind==='taste'?TASTE_LABELS:SENSORY_LABELS,label=labels[active.axis];
  const name=language==='en'?(kind==='taste'?TASTE_EN[active.axis]:['ALCOHOL','AROMA','BODY','BUBBLES','COOLING','HEAT','FINISH'][active.axis]):label;
  return createPortal(<div ref={panel} id={id} role="tooltip" data-i18n="verbatim" className="control-inspector" style={{left:position?.x??8,top:position?.y??8,width:Math.min(276,innerWidth-16),visibility:position?'visible':'hidden'}}><strong>{name} · {Math.round(value)}{kind==='taste'?'%':' / 10'}</strong><p>{controlHint(kind,active.axis,language)}</p>{kind==='taste'&&<small>{language==='en'?'Double-click to lock / unlock; scroll to adjust.':'双击锁定 / 解锁；滚轮可调整。'}</small>}</div>,document.body);
}
export function TasteControls(p:ControlProps) {
  const {language,t}=useI18n();
  const visual=useSliderMotion(p.target.taste_bps,p.motion,10000);
  const percentages=tastePercentages(visual.values),targetPercentages=tastePercentages(p.target.taste_bps);
  const gesture=useRef<{axis:number;anchor:Taste;x:number;y:number;moved:boolean;step:number}|null>(null),lastTap=useRef<{axis:number;at:number;x:number;y:number}|null>(null),root=useRef<HTMLDivElement>(null),latest=useRef(p);latest.current=p;
  const [open,setOpen]=useState<{axis:number;cluster:PresetCluster}|null>(null);
  const inspector=useControlInspector(),inside=useRef(false),focused=useRef(false),pointerFocus=useRef(false),visualRef=useRef(visual.values);visualRef.current=visual.values;
  const preview=useMemo(()=>createTastePreviewPublisher(value=>latest.current.onTastePreview?.(value)),[]);
  const showPreview=()=>preview.show(visualRef.current);
  const settlePreview=()=>{if(inside.current||focused.current||gesture.current)showPreview();else preview.hide();};
  const endPreview=(event?:{clientX:number;clientY:number})=>{if(event&&root.current){const box=root.current.getBoundingClientRect();inside.current=event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom;if(!inside.current)focused.current=false;}settlePreview();};
  useEffect(()=>{if(inside.current||focused.current||gesture.current)preview.show(visual.values);},[visual.values,preview]);
  useEffect(()=>()=>preview.hide(),[preview]);
  const candidates=useMemo(()=>p.presets|| (p.profile?[{recipe_id:p.profile.recipe_id,name_zh:'当前配方',name_en:'',profile:p.profile}]:[]),[p.presets,p.profile]);
  const clusters=useMemo(()=>TASTE_LABELS.map((_,i)=>clusterPresets(candidates,i)),[candidates]);
  useEffect(()=>{
    const onWheel=(e:WheelEvent)=>{const el=(e.target as HTMLElement).closest<HTMLInputElement>('input[type=range]');if(!el||!root.current?.contains(el)||e.deltaY===0)return;const axis=Number(el.dataset.axis),current=latest.current;if(current.locked.includes(axis))return;e.preventDefault();const step=e.shiftKey?10:50;current.onBegin();current.onTaste(current.target.taste_bps,axis,current.target.taste_bps[axis]+(e.deltaY<0?step:-step));current.onEnd();};
    const r=root.current;r?.addEventListener('wheel',onWheel,{passive:false});return()=>r?.removeEventListener('wheel',onWheel);
  },[]);
  useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(root.current&&!root.current.contains(e.target as Node))setOpen(null);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(null);};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};},[open]);
  return <Localized><div className="taste-controls detailed-taste" ref={root} data-motion-active={visual.active}
    onPointerEnter={()=>{inside.current=true;showPreview();}} onPointerLeave={()=>{inside.current=false;if(!focused.current)inspector.hide();settlePreview();}}
    onPointerDownCapture={()=>{pointerFocus.current=true;focused.current=false;}} onPointerUpCapture={()=>{pointerFocus.current=false;}} onPointerCancelCapture={()=>{pointerFocus.current=false;}}
    onFocusCapture={()=>{focused.current=!pointerFocus.current;showPreview();}} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){focused.current=false;settlePreview();}}} onKeyDownCapture={()=>{pointerFocus.current=false;focused.current=true;showPreview();}}>{TASTE_LABELS.map((label,i)=>{
    const locked=p.locked.includes(i),maximum=10000-p.locked.reduce((s,j)=>s+p.target.taste_bps[j],0),nearby=nearbyPresetClusters(clusters[i],visual.values[i],5,open?.axis===i?open.cluster:undefined),describedBy=inspector.active?.axis===i?inspector.id:undefined;
    return <div className={`taste-row ${locked?'locked':''}`} key={label}>
      <button className="taste-label taste-lock-label" aria-describedby={describedBy} onPointerEnter={event=>inspector.begin(i,event.currentTarget)} onPointerLeave={inspector.hide} onFocus={event=>inspector.begin(i,event.currentTarget)} onBlur={inspector.hide} aria-label={`${t(label)}味，${locked?'已锁定':'未锁定'}，双击或按 L 切换锁定`} aria-pressed={locked} onDoubleClick={()=>p.onLock(i)} onKeyDown={e=>{if(['l','L','Enter',' '].includes(e.key)){e.preventDefault();p.onLock(i);}}}><span>{t(label)}</span>{language==='zh'&&<small>{TASTE_EN[i]}</small>}</button>
      <div className="taste-track-wrap">
        <input type="range" aria-label={`${t(label)}味偏好`} aria-valuenow={p.target.taste_bps[i]} aria-valuetext={`${targetPercentages[i]}%，${locked?'已锁定':'可调'}`} aria-disabled={locked} aria-keyshortcuts="L" aria-describedby={describedBy} onPointerEnter={event=>inspector.begin(i,event.currentTarget)} onPointerLeave={inspector.hide} onFocus={event=>inspector.begin(i,event.currentTarget)} min={0} max={10000} step={1} value={visual.values[i]} data-axis={i} style={{'--fill':`${visual.values[i]/100}%`} as React.CSSProperties}
          onPointerDown={e=>{showPreview();p.onInterruptMotion?.();e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);gesture.current={axis:i,anchor:[...p.target.taste_bps],x:e.clientX,y:e.clientY,moved:false,step:e.shiftKey?10:50};setOpen(null);}}
          onPointerMove={e=>{const g=gesture.current;if(!g||g.axis!==i||locked)return;if(!g.moved&&Math.hypot(e.clientX-g.x,e.clientY-g.y)<3)return;if(!g.moved){g.moved=true;lastTap.current=null;p.onBegin();}const rect=e.currentTarget.getBoundingClientRect(),value=Math.max(0,Math.min(10000,(e.clientX-rect.left-5.5)/Math.max(1,rect.width-11)*10000));p.onTaste(g.anchor,i,Math.round(value/g.step)*g.step);}}
          onPointerUp={e=>{const g=gesture.current;gesture.current=null;endPreview(e);if(g?.moved){p.onEnd();return;}if(e.pointerType==='touch'){const last=lastTap.current;if(last?.axis===i&&e.timeStamp-last.at<400&&Math.hypot(last.x-e.clientX,last.y-e.clientY)<16){lastTap.current=null;p.onLock(i);}else lastTap.current={axis:i,at:e.timeStamp,x:e.clientX,y:e.clientY};}}}
          onDoubleClick={()=>{lastTap.current=null;p.onLock(i);}}
          onLostPointerCapture={event=>{if(!gesture.current)return;if(gesture.current.moved)p.onCancel();gesture.current=null;focused.current=false;endPreview(event);inspector.hide();}} onPointerCancel={event=>{if(gesture.current?.moved)p.onCancel();gesture.current=null;focused.current=false;endPreview(event);inspector.hide();}} onBlur={()=>{if(gesture.current?.moved)p.onEnd();gesture.current=null;inspector.hide();settlePreview();}}
          onKeyDown={e=>{if(e.key.toLowerCase()==='l'){e.preventDefault();p.onLock(i);return;}const step=e.shiftKey?10:50;const value=e.key==='Home'?0:e.key==='End'?maximum:e.key==='PageUp'?p.target.taste_bps[i]+1000:e.key==='PageDown'?p.target.taste_bps[i]-1000:['ArrowRight','ArrowUp'].includes(e.key)?p.target.taste_bps[i]+step:['ArrowLeft','ArrowDown'].includes(e.key)?p.target.taste_bps[i]-step:null;if(value!==null){e.preventDefault();if(locked)return;p.onBegin();p.onTaste(p.target.taste_bps,i,value);p.onEnd();}}}
          onChange={()=>{/* Pointer changes are committed only after an intentional drag. */}}/>
        <div className="preset-projections" aria-label={`${t(label)}味经典预设位置`}>{nearby.map(cluster=>{
          const position=Math.min(99,Math.max(1,cluster.position/100));
          // Enlarge the below-track hit area without covering a neighboring preset.
          const gap=Math.min(100,...nearby.filter(other=>other!==cluster).map(other=>Math.abs(Math.min(99,Math.max(1,other.position/100))-position)));
          return <button key={`${i}-${cluster.position}-${cluster.entries[0]?.recipe_id}`} data-preset-key={`${i}:${cluster.position}:${cluster.entries[0]?.recipe_id}`} className={`classic-marker ${open?.axis===i&&open.cluster===cluster?'active':''}`} style={{left:`${position}%`,width:`min(20px, ${gap}%)`}} aria-label={`查看${t(label)}味${Math.round(cluster.position/100)}%附近的${cluster.entries.length}个经典预设`} aria-expanded={open?.axis===i&&open.cluster===cluster} title={`${cluster.entries.slice(0,3).map(c=>language==='en'?c.name_en:c.name_zh).join(' / ')}${cluster.entries.length>3?'…':''} · ${t('配方预测')}`} onClick={()=>setOpen(open?.axis===i&&open.cluster===cluster?null:{axis:i,cluster})}><span/></button>;
        })}</div>
      </div>
      <input className="taste-number" aria-label={`${t(label)}味百分比`} type="number" min={0} max={100} step={1} value={percentages[i]} disabled={locked} onFocus={p.onInterruptMotion} onChange={e=>{if(e.target.value==='')return;const value=Number(e.target.value);if(!Number.isFinite(value))return;p.onBegin();p.onTaste(p.target.taste_bps,i,Math.round(value)*100);p.onEnd();}}/>
      <div className="touch-step"><button disabled={locked} aria-label={`${t(label)}味减少`} onClick={()=>{p.onBegin();p.onTaste(p.target.taste_bps,i,p.target.taste_bps[i]-50);p.onEnd();}}>−</button><button disabled={locked} aria-label={`${t(label)}味增加`} onClick={()=>{p.onBegin();p.onTaste(p.target.taste_bps,i,p.target.taste_bps[i]+50);p.onEnd();}}>+</button></div>
    </div>;
  })}{open&&<div className="classic-picker" role="dialog" aria-label={`${t(TASTE_LABELS[open.axis])}味经典预设选择`}><div><strong>{TASTE_LABELS[open.axis]}味附近的经典</strong><button onClick={()=>setOpen(null)} aria-label="关闭预设选择">×</button></div><p>选择后载入完整五味、七维与酒谱；可以撤销。</p><div className="classic-options">{open.cluster.entries.map(entry=><button key={entry.recipe_id} onClick={()=>{if(p.onSelectPreset)p.onSelectPreset(entry.recipe_id);else p.onPreset();setOpen(null);}}><span>{language==='en'?entry.name_en:entry.name_zh}{language==='zh'&&<small>{entry.name_en}</small>}</span><b>{tastePercentages(entry.profile.taste_preference_bps)[open.axis]}%</b></button>)}</div><small data-i18n="verbatim">{language==='en'?'Markers show recipe predictions, not tasting scores.':'标记表示配方预测，非实饮评分。'}</small></div>}<ControlInspector active={inspector.active} id={inspector.id} kind="taste" language={language} value={inspector.active?percentages[inspector.active.axis]:0}/></div></Localized>;
}

export function SensoryControls(p:ControlProps) {
  const {t,language}=useI18n(),inspector=useControlInspector();
  const visual=useSliderMotion(p.target.sensory_0_10,p.motion);
  const root=useRef<HTMLDivElement>(null),latest=useRef(p),raf=useRef<number|null>(null),pending=useRef<{axis:number;value:number}|null>(null),activePointer=useRef(false);latest.current=p;
  const [geometry,setGeometry]=useState({width:1,height:1,points:''});
  const apply=()=>{if(raf.current!==null){cancelAnimationFrame(raf.current);raf.current=null;}if(pending.current){const next=pending.current;pending.current=null;latest.current.onSensory(next.axis,next.value);}};
  const queue=(axis:number,value:number)=>{pending.current={axis,value};if(raf.current===null)raf.current=requestAnimationFrame(()=>{raf.current=null;apply();});};
  useLayoutEffect(()=>{
    const redraw=()=>{const r=root.current;if(!r)return;const box=r.getBoundingClientRect(),sx=r.clientWidth/box.width,sy=r.clientHeight/box.height;
      const inputs=Array.from(r.querySelectorAll<HTMLInputElement>('input[type=range]'));const points=inputs.map((input,i)=>{const b=input.getBoundingClientRect(),half=5/sy;const x=(b.left+b.width/2-box.left)*sx,y=(b.top+half+(b.height-half*2)*(1-visual.values[i]/10)-box.top)*sy;return `${x.toFixed(2)},${y.toFixed(2)}`;}).join(' ');
      setGeometry({width:r.clientWidth,height:r.clientHeight,points});};
    const observer=new ResizeObserver(redraw);if(root.current)observer.observe(root.current);redraw();return()=>observer.disconnect();
  },[visual.values]);
  useEffect(()=>{
    const r=root.current;const wheel=(e:WheelEvent)=>{const el=(e.target as HTMLElement).closest<HTMLInputElement>('[data-sensory-axis]');if(!el||!r?.contains(el)||e.deltaY===0)return;e.preventDefault();const current=latest.current,axis=Number(el.dataset.sensoryAxis),step=e.shiftKey?.1:.5;current.onBegin();current.onSensory(axis,Math.max(0,Math.min(10,Math.round((current.target.sensory_0_10[axis]+(e.deltaY<0?step:-step))*10)/10)));current.onEnd();};r?.addEventListener('wheel',wheel,{passive:false});return()=>{r?.removeEventListener('wheel',wheel);if(raf.current!==null)cancelAnimationFrame(raf.current);};
  },[]);
  return <Localized><div className="sensory-controls detailed-sensory" ref={root} data-motion-active={visual.active}>
    <svg className="sensory-connection" viewBox={`0 0 ${geometry.width} ${geometry.height}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={geometry.points}/></svg>
    {SENSORY_LABELS.map((label,i)=><div className="sensory-axis" key={label}>
      <span className="axis-name" tabIndex={0} aria-describedby={inspector.active?.axis===i?inspector.id:undefined} onPointerEnter={event=>inspector.begin(i,event.currentTarget)} onPointerLeave={inspector.hide} onFocus={event=>inspector.begin(i,event.currentTarget)} onBlur={inspector.hide}>{label}</span><output>{Math.round(visual.values[i])}</output>
      <div className="vertical-wrap"><span className="scale-max">10</span><input type="range" min={0} max={10} step={0.1} value={visual.values[i]} aria-valuenow={p.target.sensory_0_10[i]} aria-label={`${t(label)}目标`} aria-valuetext={`${Math.round(p.target.sensory_0_10[i])} 分，独立维度`} data-sensory-axis={i} aria-describedby={inspector.active?.axis===i?inspector.id:undefined} onPointerEnter={event=>inspector.begin(i,event.currentTarget)} onPointerLeave={inspector.hide} onFocus={event=>inspector.begin(i,event.currentTarget)}
        onPointerDown={()=>{activePointer.current=true;p.onBegin();}} onPointerUp={()=>{apply();activePointer.current=false;p.onEnd();}} onPointerCancel={()=>{if(raf.current!==null)cancelAnimationFrame(raf.current);raf.current=null;pending.current=null;activePointer.current=false;p.onCancel();}} onBlur={()=>{inspector.hide();if(activePointer.current){apply();activePointer.current=false;p.onEnd();}}}
        onKeyDown={e=>{const step=e.shiftKey?.1:.1;const value=e.key==='Home'?0:e.key==='End'?10:e.key==='PageUp'?Math.min(10,p.target.sensory_0_10[i]+1):e.key==='PageDown'?Math.max(0,p.target.sensory_0_10[i]-1):['ArrowUp','ArrowRight'].includes(e.key)?p.target.sensory_0_10[i]+step:['ArrowDown','ArrowLeft'].includes(e.key)?p.target.sensory_0_10[i]-step:null;if(value!==null){e.preventDefault();p.onBegin();p.onSensory(i,Math.round(Math.min(10,Math.max(0,value))*10)/10);p.onEnd();}}}
        onChange={e=>{const value=Number(e.target.value);if(activePointer.current)queue(i,value);else{p.onBegin();p.onSensory(i,value);p.onEnd();}}}/>
        {p.profile&&<span className="sensory-prior" title={`${t('配方预测')} ${Math.round(p.profile.sensory_0_10[i])}，${t('非实测')}`} style={{bottom:`${p.profile.sensory_0_10[i]*10}%`}}/>}<span className="scale-min">0</span></div>
    </div>)}
    <ControlInspector active={inspector.active} id={inspector.id} kind="sensory" language={language} value={inspector.active?visual.values[inspector.active.axis]:0}/>
  </div></Localized>;
}
