import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { native } from './bridge';
import type { Taste } from './types';
import { PIE_COLORS, piePercentages, tastePieArt } from './taste-pie-art';
import type { Language } from './i18n';
import './taste-pie.css';

interface Payload {token:string;taste:Taste;language:Language;anchor_y:number}
export function TastePieCard({taste,language}:{taste:Taste;language:Language}){
  const grid=useMemo(()=>tastePieArt(taste),[taste]),percent=piePercentages(taste);
  const labels=language==='en'?['Sweet','Sour','Bitter','Salty','Umami']:['甜','酸','苦','咸','鲜'];
  return <section className="taste-pie-card" aria-label={language==='en'?'Taste composition':'味觉构成'} data-taste-bps={taste.join(',')}>
    <header><span>{language==='en'?'TASTE':'味觉构成'}</span><b>Σ 100%</b></header>
    <pre className="taste-pie-art" aria-hidden="true">{grid.map((row,y)=>{
      const groups:{key:string;text:string;axis:number;face:string}[]=[];
      row.forEach((cell,x)=>{const last=groups.at(-1);if(last&&last.axis===cell.axis&&last.face===cell.face)last.text+=cell.glyph;else groups.push({key:`${y}-${x}`,text:cell.glyph,axis:cell.axis,face:cell.face});});
      return <span className="taste-pie-row" key={y}>{groups.map(g=><span key={g.key} className={`pie-${g.face}`} style={{color:PIE_COLORS[g.axis]||'transparent'}}>{g.text}</span>)}</span>;
    })}</pre>
    <div className="taste-pie-legend">{labels.map((label,i)=><div key={label} style={{'--pie-color':PIE_COLORS[i]} as React.CSSProperties}><i/><span>{label}</span><b title={`${taste[i]} / 10000`}>{percent[i]}%</b></div>)}</div>
  </section>;
}

/** A coalesced read-only presentation channel; targets, recipe and SQLite stay in the workbench. */
export function TastePreview({taste,language}:{taste:Taste|null;language:Language}){
  const [error,setError]=useState('');
  const active=taste!==null,token=useMemo(()=>active?crypto.randomUUID():'',[active]);
  const pending=useRef<Payload|null>(null),running=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null),generation=useRef(0);
  const flush=async()=>{
    if(running.current)return;running.current=true;
    const version=generation.current,value=pending.current;
    try{await invoke('taste_window_update',{payload:value});if(version===generation.current)setError('');}
    catch(reason){if(version===generation.current)setError(String(reason));}
    finally{running.current=false;if(version!==generation.current&&timer.current===null){timer.current=setTimeout(()=>{timer.current=null;void flush();},pending.current?24:0);}}
  };
  useEffect(()=>{
    if(!native)return;
    const box=document.querySelector('.detailed-taste')?.getBoundingClientRect();
    pending.current=taste?{token,taste:[...taste],language,anchor_y:box?box.top+box.height/2:600}:null;
    generation.current++;
    // Throttle, not debounce: continuous animation frames must reach the native window.
    if(!taste){if(timer.current){clearTimeout(timer.current);timer.current=null;}void flush();}
    else if(!running.current&&timer.current===null)timer.current=setTimeout(()=>{timer.current=null;void flush();},24);
  },[taste,language,token]);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);pending.current=null;generation.current++;void flush();},[]);
  if(!taste)return null;
  if(native)return error?<span className="taste-preview-error" role="alert">{language==='en'?'Taste preview unavailable':'味觉预览不可用'}: {error}</span>:null;
  return createPortal(<aside className="taste-browser-preview"><TastePieCard taste={taste} language={language}/></aside>,document.body);
}

export function TastePopupWindow(){
  const [payload,setPayload]=useState<Payload|null>(null),[ready,setReady]=useState(false),[error,setError]=useState('');
  const current=useRef(payload);current.current=payload;
  useEffect(()=>{
    document.documentElement.classList.add('taste-popup-document');let gone=false,off:(()=>void)|undefined,events=0;
    void (async()=>{const stop=await listen<Payload|null>('taste-window-data',event=>{events++;if(!gone)setPayload(event.payload);});if(gone){stop();return;}off=stop;const version=events,initial=await invoke<Payload|null>('taste_window_payload');if(!gone&&version===events)setPayload(initial);await document.fonts.load('12px PixelMix');if(!gone)setReady(true);})().catch(reason=>{if(!gone)setError(String(reason));});
    return()=>{gone=true;off?.();};
  },[]);
  useEffect(()=>{if(!ready||!payload)return;const token=payload.token;let cancelled=false;const raf=requestAnimationFrame(()=>{if(!cancelled&&current.current?.token===token)void invoke('taste_window_ready',{token}).catch(reason=>setError(String(reason)));});return()=>{cancelled=true;cancelAnimationFrame(raf);};},[ready,payload?.token]);
  return <>{payload&&<TastePieCard taste={payload.taste} language={payload.language}/>} {error&&<p role="alert">{error}</p>}</>;
}
