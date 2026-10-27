import { Localized } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { native } from './bridge';
/** Show a decoded, dark native surface first; count the logo hold from visible paint. */
export default function BootMosaic({ready,animate,onDone,onError}:{ready:boolean;animate:boolean;onDone:(animated:boolean)=>void;onError?:(message:string)=>void}) {
  const done=useRef(onDone),failed=useRef(onError),logo=useRef<HTMLImageElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const [logoReady,setLogoReady]=useState(false),[phase,setPhase]=useState('preparing'),[pixelated,setPixelated]=useState(false);
  done.current=onDone;failed.current=onError;
  useEffect(()=>{if(logo.current?.complete)setLogoReady(true);},[]);
  useEffect(()=>{
    if(!ready||!logoReady)return;
    let cancelled=false,finished=false,frame=0,paintFrame=0,holdTimer:ReturnType<typeof setTimeout>|undefined;
    let motion=false;
    performance.mark('timer:boot-prepared',{detail:{animate,systemReduced:matchMedia('(prefers-reduced-motion: reduce)').matches,visibility:document.visibilityState}});
    const image=logo.current,output=canvas.current,context=output?.getContext('2d');
    const small=document.createElement('canvas'),pixels=small.getContext('2d');
    let previousSize=0;
    const draw=(size:number)=>{
      if(size===previousSize||!image?.naturalWidth||!context||!pixels||!output)return;
      previousSize=size;small.width=size;small.height=size;
      pixels.clearRect(0,0,size,size);pixels.drawImage(image,0,0,size,size);
      context.clearRect(0,0,128,128);context.imageSmoothingEnabled=false;context.drawImage(small,0,0,128,128);
      setPixelated(true);
    };
    const finish=()=>{
      if(cancelled||finished)return;finished=true;cancelAnimationFrame(frame);cancelAnimationFrame(paintFrame);clearTimeout(holdTimer);
      performance.mark('timer:workbench-reveal');done.current(motion);
    };
    const hold=()=>{
      if(cancelled)return;
      // TIMER's explicit motion preference controls this application independently
      // of Windows' animation setting. The checkbox can always disable it again.
      motion=animate;
      performance.mark('timer:logo-visible',{detail:{animate,motion,systemReduced:matchMedia('(prefers-reduced-motion: reduce)').matches}});
      if(!motion){finish();return;}
      const start=performance.now(),sizes=[8,12,24,32,64,128];
      const tick=()=>{if(cancelled||finished)return;draw(sizes[Math.min(5,Math.floor((performance.now()-start)/60))]);frame=requestAnimationFrame(tick);};
      tick();holdTimer=setTimeout(finish,400);
    };
    if(animate)draw(8);
    // Show before waiting for frames: a hidden WebView may throttle RAF indefinitely.
    const reveal=async()=>{
      try{
        if(native)await getCurrentWindow().show();
        if(cancelled)return;setPhase('holding');
        frame=requestAnimationFrame(()=>{paintFrame=requestAnimationFrame(hold);});
      }catch(error){if(!cancelled)failed.current?.(`启动窗口未能显示：${String(error)}`);}
    };
    void reveal();
    return()=>{cancelled=true;cancelAnimationFrame(frame);cancelAnimationFrame(paintFrame);clearTimeout(holdTimer);};
  },[ready,animate,logoReady]);
  return <Localized><div className="boot-mosaic" data-phase={phase} data-pixelated={pixelated} aria-label="程序员调酒台启动">
    <img ref={logo} src="/assets/timer-logo.png" alt="TIMER" onLoad={()=>setLogoReady(true)} onError={()=>setLogoReady(true)}/>
    <canvas ref={canvas} width={128} height={128} aria-hidden="true"/>
  </div></Localized>;
}
