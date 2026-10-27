import { useEffect, useRef, type DOMAttributes } from 'react';

/** A single originating pointer gesture, never a later mouse-button press. */
export interface ArchiveDragGesture {
  readonly signal:AbortSignal;
  /** Claim once, immediately before native OLE; releases browser capture synchronously. */
  handoff:()=>boolean;
}
type DragArchive=(gesture:ArchiveDragGesture)=>Promise<void>;
interface Press<T extends HTMLElement> {
  x:number;y:number;pointerId:number;started:boolean;handedOff:boolean;
  controller:AbortController;target:T;drag:DragArchive;
}

/** File transfer is native OLE. Short clicks keep their original button action. */
export function useArchiveDrag<T extends HTMLElement>(onDrag?:DragArchive):DOMAttributes<T> {
  const press=useRef<Press<T>|null>(null),suppress=useRef(false);
  const release=(p:Press<T>)=>{if(p.target.hasPointerCapture(p.pointerId))p.target.releasePointerCapture(p.pointerId);};
  const cancel=(p:Press<T>|null=press.current)=>{if(!p)return;p.controller.abort();if(press.current===p)press.current=null;release(p);};
  useEffect(()=>()=>cancel(),[]);
  return {
    onPointerDown:event=>{
      if(event.button!==0||event.isPrimary===false||!onDrag)return;
      cancel();suppress.current=false;
      // Freeze the source callback now: a render during save cannot change which cup is exported.
      const p:Press<T>={x:event.clientX,y:event.clientY,pointerId:event.pointerId,started:false,handedOff:false,controller:new AbortController(),target:event.currentTarget,drag:onDrag};
      press.current=p;event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove:event=>{
      const p=press.current;if(!p||p.pointerId!==event.pointerId)return;
      if((event.buttons&1)===0){cancel(p);return;}
      if(p.started||Math.hypot(event.clientX-p.x,event.clientY-p.y)<8)return;
      p.started=true;suppress.current=true;
      const gesture:ArchiveDragGesture={signal:p.controller.signal,handoff:()=>{
        if(press.current!==p||p.controller.signal.aborted||p.handedOff)return false;
        p.handedOff=true;release(p);return true;
      }};
      // The caller reports save errors. Always release capture, including synchronous failures.
      void (async()=>{try{await p.drag(gesture);}finally{if(press.current===p)cancel(p);}})();
    },
    onPointerUp:event=>{const p=press.current;if(p?.pointerId===event.pointerId)cancel(p);},
    onPointerCancel:event=>{const p=press.current;if(p?.pointerId===event.pointerId)cancel(p);},
    onLostPointerCapture:event=>{const p=press.current;if(p?.pointerId===event.pointerId&&!p.handedOff)cancel(p);},
    onClickCapture:event=>{if(suppress.current){event.preventDefault();event.stopPropagation();suppress.current=false;}},
    onDragStart:event=>event.preventDefault(),
  };
}
