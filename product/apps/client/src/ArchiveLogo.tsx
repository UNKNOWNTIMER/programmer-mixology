import { Localized } from './i18n';
import { useEffect, useRef } from 'react';
import { useArchiveDrag, type ArchiveDragGesture } from './archive-drag';
export type { ArchiveDragGesture } from './archive-drag';

/** Leave native file transfer to Windows OLE. A short click retains the ticket action. */
export function ArchiveLogo({children,onDrag,importSequence=0,reducedMotion=false}:{children:React.ReactNode;onDrag?:(gesture:ArchiveDragGesture)=>Promise<void>;importSequence?:number;reducedMotion?:boolean}){
  const drag=useArchiveDrag<HTMLDivElement>(onDrag);
  const element=useRef<HTMLDivElement>(null),previousImport=useRef(importSequence),turn=useRef<Animation|null>(null);
  useEffect(()=>{
    const changed=importSequence!==previousImport.current;
    previousImport.current=importSequence;
    if(reducedMotion){turn.current?.cancel();turn.current=null;return;}
    if(!changed)return;
    turn.current?.cancel();
    // Animate the wrapper so ticket-confirmation animation on its image remains independent.
    turn.current=element.current?.animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:720,easing:'cubic-bezier(.16,1,.3,1)'})||null;
  },[importSequence,reducedMotion]);
  useEffect(()=>()=>{turn.current?.cancel();},[]);
  return <Localized><div ref={element} className="archive-logo" data-import-sequence={importSequence} title="拖出 TIMER 保存当前酒谱；将 .timermix 文件拖回即可恢复"
    {...drag}>{children}</div></Localized>;
}
