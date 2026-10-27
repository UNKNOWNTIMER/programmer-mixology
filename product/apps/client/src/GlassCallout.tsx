import { Localized, I18nProvider, useI18n, type Language } from './i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { native } from './bridge';
import { GlassDetails, type GlassDetailKind } from './GlassDetails';
import type { Ingredient, Profile, Recipe, Target } from './types';
import './glass-window.css';

type Side='left'|'right';
interface Anchor {x:number;y:number;left_x:number;right_x:number;end_y:number;preferred_side:Side}
interface Placement {side:Side;x:number;y:number;width:number;height:number;end_x:number;end_y:number}
interface Payload {language?:Language;token:string;kind:GlassDetailKind;recipe:Recipe;ingredients:Ingredient[];profile:Profile|null;target:Target|null;anchor:Anchor}
interface Snapshot {payload:Payload;placement:Placement}
interface Props {kind:GlassDetailKind|null;point:{x:number;y:number}|null;host:RefObject<HTMLDivElement|null>;recipe:Recipe;ingredients:Ingredient[];profile?:Profile;target?:Target;onEnter:()=>void;onLeave:()=>void;onClose:()=>void}

/** Browsers cannot create owned desktop surfaces; keep the touch fallback inside their viewport. */
function browserPlacement(anchor:Anchor,height:number):Placement {
  const margin=8,viewWidth=innerWidth,viewHeight=innerHeight;
  const width=Math.min(320,viewWidth-2*margin),h=Math.min(height,viewHeight-2*margin);
  const fitsLeft=anchor.left_x-width>=margin,fitsRight=anchor.right_x+width<=viewWidth-margin;
  let side=anchor.preferred_side;
  if(side==='left'&&!fitsLeft&&fitsRight)side='right';
  else if(side==='right'&&!fitsRight&&fitsLeft)side='left';
  let x=side==='left'?anchor.left_x-width:anchor.right_x;
  let y=anchor.end_y-22;
  if(!fitsLeft&&!fitsRight){
    // At phone widths place the card below/above the source instead of covering the red point.
    x=Math.max(margin,Math.min(viewWidth-width-margin,anchor.x-width/2));
    y=anchor.y+38+h<=viewHeight-margin?anchor.y+38:anchor.y-h-38;
    side=anchor.x<viewWidth/2?'right':'left';
  }
  x=Math.max(margin,Math.min(viewWidth-width-margin,x));
  y=Math.max(margin,Math.min(viewHeight-h-margin,y));
  return {side,x,y,width,height:h,end_x:side==='right'?x:x+width,end_y:y+22};
}

export function GlassCallout(props:Props){
  const {language}=useI18n();
  const current=useRef(props);current.current=props;
  const token=useMemo(()=>props.kind?crypto.randomUUID():null,[props.kind,props.recipe.id]);
  const tokenRef=useRef(token);tokenRef.current=token;
  const [measured,setMeasured]=useState<{token:string;anchor:Anchor}|null>(null);
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState('');
  const [browserHeight,setBrowserHeight]=useState(400),[viewport,setViewport]=useState({width:innerWidth,height:innerHeight});
  const browserCard=useRef<HTMLDivElement>(null),queue=useRef(Promise.resolve()),generation=useRef(0);
  useLayoutEffect(()=>{
    if(!token||!props.point){setMeasured(null);return;}
    const point=props.point;
    const measure=()=>{
      const element=props.host.current;if(!element)return;
      const box=element.getBoundingClientRect();
      const dot=element.querySelector(`.detail-${props.kind}`)?.getBoundingClientRect();
      const x=dot?dot.left+dot.width/2:box.left+box.width*point.x/100,y=dot?dot.top+dot.height/2:box.top+box.height*point.y/100;
      const anchor:Anchor={x,y,left_x:box.left+16,right_x:box.right-16,end_y:Math.max(box.top+22,y-34),preferred_side:x<box.left+box.width/2?'left':'right'};
      setMeasured(previous=>previous?.token===token&&JSON.stringify(previous.anchor)===JSON.stringify(anchor)?previous:{token,anchor});
      setViewport({width:innerWidth,height:innerHeight});
    };
    const observer=new ResizeObserver(measure);if(props.host.current)observer.observe(props.host.current);
    window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);measure();
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);};
  },[token,props.point?.x,props.point?.y,props.host]);
  const payload=useMemo<Payload|null>(()=>token&&props.kind&&measured?.token===token?{
    language,token,kind:props.kind,recipe:props.recipe,ingredients:props.ingredients.filter(i=>props.recipe.ingredients.some(p=>p.ingredient_id===i.id)),profile:props.profile||null,target:props.target||null,anchor:measured.anchor,
  }:null,[language,token,props.kind,measured,props.recipe,props.ingredients,props.profile,props.target]);
  useEffect(()=>{
    if(!native)return;
    let disposed=false;const unlisten:(()=>void)[]=[];
    const accept=(value:Snapshot|null)=>{if(value?.payload.token===tokenRef.current)setSnapshot(value);};
    void listen<Snapshot>('glass-window-position',event=>accept(event.payload)).then(fn=>disposed?fn():unlisten.push(fn));
    void listen<{token:string;kind:string}>('glass-window-action',({payload:action})=>{
      if(action.token!==tokenRef.current)return;
      if(action.kind==='enter')current.current.onEnter();else if(action.kind==='leave')current.current.onLeave();else if(action.kind==='close')current.current.onClose();
    }).then(fn=>disposed?fn():unlisten.push(fn));
    return()=>{disposed=true;unlisten.forEach(fn=>fn());generation.current++;queue.current=queue.current.then(()=>invoke<void>('glass_window_update',{payload:null})).catch(()=>{});};
  },[]);
  useEffect(()=>{
    if(!native)return;
    const version=++generation.current;setError('');if(!payload)setSnapshot(null);
    queue.current=queue.current.then(async()=>{
      if(version!==generation.current)return;
      const next=await invoke<Snapshot|null>('glass_window_update',{payload});
      if(version===generation.current&&next?.payload.token===tokenRef.current)setSnapshot(next);
    }).catch(reason=>{if(version===generation.current)setError(`杯图资料窗口：${String(reason)}`);});
  },[payload]);
  useLayoutEffect(()=>{
    if(native||!payload||!browserCard.current)return;
    const card=browserCard.current;
    const measure=()=>{const body=card.querySelector<HTMLElement>('.glass-callout-body');if(body)setBrowserHeight(Math.ceil(body.scrollHeight+44));};
    const observer=new ResizeObserver(measure);observer.observe(card);
    const mutation=new MutationObserver(measure);mutation.observe(card,{subtree:true,attributes:true,attributeFilter:['open'],childList:true});
    document.fonts.ready.then(measure);measure();return()=>{observer.disconnect();mutation.disconnect();};
  },[payload]);
  if(!payload)return null;
  const placement=native?(snapshot?.payload.token===payload.token?snapshot.placement:null):browserPlacement(payload.anchor,browserHeight);
  const anchor=payload.anchor;
  const bend=placement?{x:anchor.x+(placement.side==='left'?-1:1)*Math.min(38,Math.abs(placement.end_x-anchor.x)/2),y:placement.end_y}:anchor;
  const line=placement?`${anchor.x},${anchor.y} ${bend.x},${bend.y} ${placement.end_x},${placement.end_y}`:'';
  const firstLength=Math.hypot(bend.x-anchor.x,bend.y-anchor.y),trim=Math.min(1,28/Math.max(1,firstLength));
  const corridor=placement?`${anchor.x+(bend.x-anchor.x)*trim},${anchor.y+(bend.y-anchor.y)*trim} ${bend.x},${bend.y} ${placement.end_x},${placement.end_y}`:'';
  return <Localized><>{placement&&createPortal(<svg className="glass-connector" data-callout-side={placement.side} viewBox={`0 0 ${viewport.width} ${viewport.height}`} aria-hidden="true">
    <polyline className="glass-connector-blue" points={line}/><polyline data-callout-line className="glass-connector-red" points={line}/>
    <polyline className="glass-connector-hover" points={corridor} onMouseEnter={props.onEnter} onMouseLeave={props.onLeave}/>
    <rect x={placement.end_x-2} y={placement.end_y-3} width="4" height="6"/>
  </svg>,document.body)}
    {!native&&placement&&createPortal(<div ref={browserCard} className={`glass-browser-callout popover-${payload.kind}`} data-callout-side={placement.side} style={{left:placement.x,top:placement.y,width:placement.width,'--glass-callout-max-height':`${placement.height}px`} as React.CSSProperties} onMouseEnter={props.onEnter} onMouseLeave={props.onLeave}>
      <GlassDetails kind={payload.kind} recipe={payload.recipe} ingredients={payload.ingredients} profile={payload.profile||undefined} target={payload.target||undefined} onClose={props.onClose}/>
    </div>,document.body)}
    {error&&<span className="glass-callout-error" role="alert">{error}</span>}
  </></Localized>;
}

export function GlassPopupWindow(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[fontsReady,setFontsReady]=useState(false),[error,setError]=useState('');
  const root=useRef<HTMLDivElement>(null),latest=useRef(snapshot),lastSize=useRef(''),pointerInside=useRef(false);latest.current=snapshot;
  const action=(kind:'enter'|'leave'|'close')=>{const token=latest.current?.payload.token;if(token)void invoke('glass_window_action',{token,kind}).catch(reason=>{if(kind==='close'&&latest.current?.payload.token===token)setError(String(reason));});};
  useEffect(()=>{setError('');pointerInside.current=false;},[snapshot?.payload.token]);
  const enter=()=>{if(!pointerInside.current){pointerInside.current=true;action('enter');}};
  const leave=()=>{pointerInside.current=false;action('leave');};
  useEffect(()=>{
    let disposed=false,off:(()=>void)|undefined,events=0;
    document.documentElement.classList.add('glass-popup-document');
    void (async()=>{
      const stop=await listen<Snapshot|null>('glass-window-data',event=>{events++;if(!disposed)setSnapshot(event.payload);});
      if(disposed){stop();return;}off=stop;
      const version=events,initial=await invoke<Snapshot|null>('glass_window_payload');
      if(!disposed&&version===events)setSnapshot(initial);
      await document.fonts.load('12px PixelMix');if(!disposed)setFontsReady(true);
    })().catch(reason=>{if(!disposed)setError(String(reason));});
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();action('close');}};
    document.addEventListener('keydown',escape);
    return()=>{disposed=true;off?.();document.removeEventListener('keydown',escape);};
  },[]);
  useLayoutEffect(()=>{
    if(!fontsReady||!snapshot||!root.current)return;
    const element=root.current;let disposed=false,frame=0;
    const resize=()=>{
      const current=latest.current,body=element.querySelector<HTMLElement>('.glass-callout-body');if(!current||!body)return;
      const height=Math.ceil(body.scrollHeight+44),key=`${current.payload.token}:${height}`;
      if(lastSize.current===key)return;
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{
        if(disposed||latest.current?.payload.token!==current.payload.token||lastSize.current===key)return;
        lastSize.current=key;
        void invoke('glass_window_ready',{token:current.payload.token,height}).catch(reason=>{if(latest.current?.payload.token===current.payload.token)setError(String(reason));});
      });});
    };
    const observer=new ResizeObserver(resize);observer.observe(element);
    const mutation=new MutationObserver(resize);mutation.observe(element,{subtree:true,attributes:true,attributeFilter:['open'],childList:true});
    resize();return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();mutation.disconnect();};
  },[snapshot,fontsReady]);
  const payload=snapshot?.payload;
  return <I18nProvider language={payload?.language==='en'?'en':'zh'}><Localized><div ref={root} className="glass-popup-shell" data-callout-side={snapshot?.placement.side} onMouseEnter={enter} onMouseMove={enter} onMouseLeave={leave}>
    {payload&&<GlassDetails kind={payload.kind} recipe={payload.recipe} ingredients={payload.ingredients} profile={payload.profile||undefined} target={payload.target||undefined} onClose={()=>action('close')}/>}
    {error&&<p role="alert">{error}</p>}
  </div></Localized></I18nProvider>;
}
