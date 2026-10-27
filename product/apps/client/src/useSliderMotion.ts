import { useLayoutEffect, useRef, useState } from 'react';

export interface SliderMotion { id:number; enabled:boolean }
const DURATION=420;

/** Presentation only: no intermediate frame is sent to matching, persistence or orders. */
export function useSliderMotion(values:number[],request?:SliderMotion,total?:number){
  const shown=useRef(values),previousId=useRef(request?.id);
  const [frame,setFrame]=useState({values,active:false});
  useLayoutEffect(()=>{
    let raf=0;
    const fresh=request?.id!==previousId.current;previousId.current=request?.id;
    const from=shown.current;
    // TIMER's explicit reduced-motion setting is applied to request.enabled by
    // the parent. It remains authoritative when Windows disables animations.
    if(!fresh||!request?.enabled||from.every((v,i)=>v===values[i])){
      shown.current=values;setFrame({values,active:false});return;
    }
    const started=performance.now();let lastPaint=started;
    setFrame({values:from,active:true});
    const tick=(now:number)=>{
      const progress=Math.min(1,Math.max(0,(now-started)/DURATION));
      if(progress<1&&now-lastPaint<1000/60){raf=requestAnimationFrame(tick);return;}
      lastPaint=now;
      const eased=1-(1-progress)**3;
      let next=values;
      if(progress<1){
        const raw=values.map((v,i)=>from[i]+(v-from[i])*eased);
        if(total!==undefined){
          next=raw.map(Math.floor);
          // Largest remainders keep every visual five-taste frame at 10000 integer bp.
          const order=raw.map((v,i)=>({i,remainder:v-next[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
          const remainder=total-next.reduce((sum,v)=>sum+v,0);
          for(let n=0;n<remainder;n++)next[order[n].i]++;
        }else next=raw.map(v=>Math.round(v*10)/10);
      }
      shown.current=next;setFrame({values:next,active:progress<1});
      if(progress<1)raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);
  },[values,request?.id,request?.enabled,total]);
  return frame;
}
