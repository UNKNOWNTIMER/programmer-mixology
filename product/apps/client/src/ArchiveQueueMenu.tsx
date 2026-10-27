import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Localized, useI18n } from './i18n';
import type { ArchiveDragGesture } from './ArchiveLogo';

export interface ArchiveQueueItem { id: string; name: string }
export interface ArchiveQueueMenuProps {
  items: readonly ArchiveQueueItem[];
  onRemove?: (id: string) => void | Promise<void>;
  onReorder?: (id: string, beforeId: string | null) => void | Promise<void>;
  onDragOut?: (id: string, gesture: ArchiveDragGesture) => Promise<void>;
  reducedMotion?: boolean;
}
interface Press {
  id:string; x:number; y:number; pointerId:number; target:HTMLLIElement;
  dragging:boolean; exporting:boolean; handedOff:boolean; controller:AbortController;
  dragOut:ArchiveQueueMenuProps['onDragOut'];
  destination:string|null|undefined;
}
export const QUEUE_EXIT_MS=220;

/** Local preparation queue; actions never acknowledge orders or debit tickets. */
export function ArchiveQueueMenu({ items, onRemove, onReorder, onDragOut, reducedMotion=false }: ArchiveQueueMenuProps) {
  const {t,language}=useI18n();
  const list=useRef<HTMLDivElement>(null), pendingFocus=useRef<string|null>(null);
  const press=useRef<Press|null>(null), suppress=useRef(false), mounted=useRef(true);
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined), busy=useRef<string|null>(null);
  const [dragging,setDragging]=useState<string|null>(null), [dropBefore,setDropBefore]=useState<string|null|undefined>(undefined);
  const [exiting,setExiting]=useState<string|null>(null), [error,setError]=useState('');
  const release=(p:Press)=>{if(p.target.hasPointerCapture(p.pointerId))p.target.releasePointerCapture(p.pointerId);};
  const cancel=(p:Press|null=press.current)=>{
    if(!p)return;
    p.controller.abort();
    // Clear first: releasing capture dispatches lostpointercapture synchronously on some WebViews.
    if(press.current===p)press.current=null;
    release(p);
    if(mounted.current){setDragging(null);setDropBefore(undefined);}
  };
  useEffect(()=>{
    mounted.current=true;
    return ()=>{mounted.current=false;clearTimeout(timer.current);cancel();};
  },[]);
  useEffect(()=>{
    if(press.current&&!items.some(item=>item.id===press.current!.id))cancel();
    if(!pendingFocus.current||items.some(item=>item.id===pendingFocus.current))return;
    pendingFocus.current=null;
    (list.current?.querySelector<HTMLButtonElement>('button')||list.current)?.focus();
  },[items]);

  const reorder=async(id:string,beforeId:string|null)=>{
    if(!onReorder||busy.current)return;
    busy.current=id;setError('');
    try{await onReorder(id,beforeId);}
    catch(reason){if(mounted.current)setError(String(reason));}
    finally{busy.current=null;}
  };
  const complete=(id:string)=>{
    if(!onRemove||busy.current)return;
    cancel();busy.current=id;setError('');setExiting(id);
    const commit=async()=>{
      timer.current=undefined;
      if(!mounted.current)return;
      pendingFocus.current=id;
      try{await onRemove(id);}
      catch(reason){pendingFocus.current=null;if(mounted.current)setError(String(reason));}
      finally{busy.current=null;if(mounted.current)setExiting(null);}
    };
    if(reducedMotion)void commit();else timer.current=setTimeout(()=>void commit(),QUEUE_EXIT_MS);
  };
  const destination=(p:Press,x:number,y:number):string|null|undefined=>{
    const node=list.current;if(!node)return undefined;
    const bounds=node.getBoundingClientRect();
    if(x<bounds.left||x>bounds.right||y<bounds.top||y>bounds.bottom)return undefined;
    // Client coordinates and measured rectangles share the same scaled viewport.
    // Keep a long queue reachable without scrolling the fixed workbench.
    if(y<bounds.top+16)node.scrollTop-=10;
    if(y>bounds.bottom-16)node.scrollTop+=10;
    for(const row of node.querySelectorAll<HTMLLIElement>('li[data-archive-id]')){
      if(row.dataset.archiveId===p.id)continue;
      const rect=row.getBoundingClientRect();
      if(y<rect.top+rect.height/2)return row.dataset.archiveId;
    }
    return null;
  };
  const move=(event:PointerEvent<HTMLLIElement>)=>{
    const p=press.current;
    if(!p||p.pointerId!==event.pointerId)return;
    if((event.buttons&1)===0){cancel(p);return;}
    if(p.exporting)return;
    if(!p.dragging&&Math.hypot(event.clientX-p.x,event.clientY-p.y)<8)return;
    p.dragging=true;suppress.current=true;setDragging(p.id);event.preventDefault();
    const outside=event.clientX<0||event.clientY<0||event.clientX>=window.innerWidth||event.clientY>=window.innerHeight;
    if(outside&&p.dragOut&&event.pointerType!=='touch'){
      p.exporting=true;p.destination=undefined;setDropBefore(undefined);
      const gesture:ArchiveDragGesture={signal:p.controller.signal,handoff:()=>{
        if(press.current!==p||p.controller.signal.aborted||p.handedOff)return false;
        p.handedOff=true;release(p);return true;
      }};
      // Save/validate the frozen entry before handoff. A released originating
      // gesture must not become a drag during a later click.
      void Promise.resolve().then(()=>{if(!gesture.signal.aborted)return p.dragOut!(p.id,gesture);}).catch(reason=>{
        if(mounted.current&&!gesture.signal.aborted)setError(String(reason));
      }).finally(()=>{if(press.current===p)cancel(p);});
      return;
    }
    p.destination=onReorder?destination(p,event.clientX,event.clientY):undefined;
    setDropBefore(p.destination);
  };
  const end=(event:PointerEvent<HTMLLIElement>)=>{
    const p=press.current;if(!p||p.pointerId!==event.pointerId)return;
    const before=p.dragging&&!p.exporting?destination(p,event.clientX,event.clientY):undefined;
    cancel(p);
    if(before!==undefined)void reorder(p.id,before);
  };
  const hint=language==='en'?'Drag to reorder or outside the window to export · Alt + ↑ / ↓':'拖动排序，拖出窗口保存 · Alt + ↑ / ↓';
  return <Localized><div ref={list} id="archive-queue-menu" className={`archive-queue-menu${reducedMotion?' reduce-motion':''}`} data-testid="archive-queue-menu" role="region" aria-label="本机制作队列" tabIndex={-1} aria-busy={exiting!==null}>
    {items.length?<ol data-drop-end={dropBefore===null}>
      {items.map((item,index)=><li key={item.id} data-testid="archive-queue-item" data-archive-id={item.id} data-current={index===0} data-dragging={dragging===item.id} data-drop-before={dropBefore===item.id} data-exiting={exiting===item.id}
        tabIndex={onReorder||onDragOut?0:undefined} title={onReorder||onDragOut?hint:undefined} aria-keyshortcuts={onReorder?'Alt+ArrowUp Alt+ArrowDown':undefined}
        onPointerDown={event=>{
          if(event.button!==0||event.isPrimary===false)return;
          // An outside release/OLE handoff may never dispatch a browser click.
          // Its suppression must not swallow a later fresh Complete click.
          cancel();suppress.current=false;
          if(busy.current||(!onReorder&&!onDragOut)||(event.target as HTMLElement).closest('button'))return;
          setError('');
          const p:Press={id:item.id,x:event.clientX,y:event.clientY,pointerId:event.pointerId,target:event.currentTarget,dragging:false,exporting:false,handedOff:false,controller:new AbortController(),dragOut:onDragOut,destination:undefined};
          press.current=p;event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={move} onPointerUp={end}
        onPointerCancel={event=>{if(press.current?.pointerId===event.pointerId)cancel();}}
        onLostPointerCapture={event=>{const p=press.current;if(p?.pointerId===event.pointerId&&!p.handedOff)cancel(p);}}
        onClickCapture={event=>{if(suppress.current&&event.detail!==0){event.preventDefault();event.stopPropagation();suppress.current=false;}}}
        onDragStart={event=>event.preventDefault()}
        onKeyDown={event=>{
          if(event.key==='Escape'&&press.current){event.preventDefault();event.stopPropagation();cancel();return;}
          if(!event.altKey||!onReorder||busy.current)return;
          if(event.key==='ArrowUp'&&index>0){event.preventDefault();event.stopPropagation();void reorder(item.id,items[index-1].id);}
          if(event.key==='ArrowDown'&&index<items.length-1){event.preventDefault();event.stopPropagation();void reorder(item.id,items[index+2]?.id||null);}
        }}>
        <span className="archive-queue-cursor" aria-hidden="true">{index===0?'▸':'⋮'}</span>
        <span className="archive-queue-copy"><strong data-i18n="verbatim" title={item.name}>{item.name}</strong><small>{index===0?'调制中':'待调制'}</small></span>
        <button data-i18n="verbatim" type="button" disabled={!onRemove||exiting!==null} aria-label={`${t(index===0?'完成':'移除')}${item.name}`} title={t(index===0?'完成这杯，读取下一杯':'从队列移除')} onClick={()=>complete(item.id)}>×</button>
      </li>)}
    </ol>:<p className="archive-queue-empty">队列为空<span>点击＋队列，或拖入存档</span></p>}
    {error&&<p className="archive-queue-error" role="alert" data-i18n="verbatim">{error}</p>}
  </div></Localized>;
}
