import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { ArchiveDragGesture } from './ArchiveLogo';
const hooks=vi.hoisted(()=>({effects:[] as Array<()=>void|(()=>void)>,updates:[] as unknown[]}));
vi.mock('react',async original=>{
  const actual=await original<typeof import('react')>();
  return {...actual,useRef:<T,>(initial:T)=>({current:initial}),useState:<T,>(initial:T)=>[initial,(value:unknown)=>hooks.updates.push(value)],useEffect:(fn:()=>void|(()=>void))=>hooks.effects.push(fn)};
});
vi.mock('./i18n',async original=>({...await original<typeof import('./i18n')>(),useI18n:()=>({language:'zh',t:(s:string)=>s})}));
import { ArchiveQueueMenu, QUEUE_EXIT_MS, type ArchiveQueueMenuProps } from './ArchiveQueueMenu';
type Element=ReactElement<Record<string,unknown>>;
function find(node:ReactNode,predicate:(el:Element)=>boolean):Element|undefined {
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const child of node){const found=find(child,predicate);if(found)return found;}return;}
  if('props' in node){const element=node as Element;return predicate(element)?element:find(element.props.children as ReactNode,predicate);}
}
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {resolve,promise};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness(props:Partial<ArchiveQueueMenuProps>={}) {
  vi.stubGlobal('window',{innerWidth:800,innerHeight:700});hooks.updates=[];
  const items=[{id:'a',name:'same recipe'},{id:'b',name:'same recipe'},{id:'c',name:'third'}],start=hooks.effects.length;
  const tree=ArchiveQueueMenu({items,...props}),root=find(tree,e=>e.props['data-testid']==='archive-queue-menu')!;
  const captured=new Set<number>(),log:string[]=[],rows=items.map((item,index)=>({
    dataset:{archiveId:item.id},getBoundingClientRect:()=>({top:400+index*40,height:40}),
    setPointerCapture:(id:number)=>{captured.add(id);log.push('capture');},
    hasPointerCapture:(id:number)=>captured.has(id),
    releasePointerCapture:(id:number)=>{captured.delete(id);log.push('release');},
  }));
  const host={scrollTop:0,getBoundingClientRect:()=>({left:20,right:220,top:400,bottom:560}),querySelectorAll:()=>rows,querySelector:()=>null,focus:vi.fn()};
  (root.props.ref as {current:unknown}).current=host;
  const cleanups=hooks.effects.slice(start).map(fn=>fn());
  const row=(id='a')=>find(tree,e=>e.props['data-archive-id']===id)!;
  const call=(id:string,key:string,event?:unknown)=>(row(id).props[key] as (event:unknown)=>void)(event);
  const event=(id='a',extra:Record<string,unknown>={})=>({button:0,buttons:1,isPrimary:true,pointerType:'mouse',pointerId:4,clientX:80,clientY:410,target:{closest:()=>null},currentTarget:rows[items.findIndex(item=>item.id===id)],preventDefault:vi.fn(),stopPropagation:vi.fn(),...extra});
  const complete=(id='a')=>(find(row(id),e=>e.type==='button')!.props.onClick as ()=>void)();
  return {tree,row,call,event,complete,log,captured,host,unmount:()=>cleanups.forEach(fn=>{if(typeof fn==='function')fn();})};
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('preparation queue pointer and completion interaction',()=>{
  it('reorders within measured queue bounds without native export or removing the entry',async()=>{
    const onReorder=vi.fn(),onDragOut=vi.fn(async()=>{}),onRemove=vi.fn(),h=harness({onReorder,onDragOut,onRemove});
    h.call('a','onPointerDown',h.event());h.call('a','onPointerMove',h.event('a',{clientY:495}));
    expect(onReorder).not.toHaveBeenCalled();expect(onDragOut).not.toHaveBeenCalled();
    h.call('a','onPointerUp',h.event('a',{clientY:495}));await flush();
    expect(onReorder).toHaveBeenCalledExactlyOnceWith('a','c');expect(onRemove).not.toHaveBeenCalled();expect(h.captured.size).toBe(0);
    const click=h.event('a',{detail:1});h.call('a','onClickCapture',click);expect(click.preventDefault).toHaveBeenCalledOnce();
  });
  it('appends below the last midpoint and cancels releases elsewhere inside the main window',async()=>{
    const onReorder=vi.fn(),onDragOut=vi.fn(async()=>{}),h=harness({onReorder,onDragOut});
    h.call('a','onPointerDown',h.event());h.call('a','onPointerMove',h.event('a',{clientY:545}));h.call('a','onPointerUp',h.event('a',{clientY:545}));await flush();
    expect(onReorder).toHaveBeenCalledExactlyOnceWith('a',null);expect(h.host.scrollTop).toBeGreaterThan(0);
    h.call('a','onPointerDown',h.event());h.call('a','onPointerMove',h.event('a',{clientX:400}));h.call('a','onPointerUp',h.event('a',{clientX:400}));
    expect(onReorder).toHaveBeenCalledOnce();expect(onDragOut).not.toHaveBeenCalled();
  });
  it('exports only after leaving the viewport, releases capture before one OLE handoff, and never reorders on export',async()=>{
    const save=deferred(),done=deferred(),native=vi.fn(),onReorder=vi.fn();let gesture!:ArchiveDragGesture;
    const h=harness({onReorder,onDragOut:async(id,current)=>{expect(id).toBe('a');gesture=current;await save.promise;if(!current.signal.aborted&&current.handoff()){expect(h.captured.size).toBe(0);native();await done.promise;}}});
    h.call('a','onPointerDown',h.event());h.call('a','onPointerMove',h.event('a',{clientX:400}));await flush();expect(native).not.toHaveBeenCalled();
    h.call('a','onPointerMove',h.event('a',{clientX:801}));await flush();expect(h.captured.has(4)).toBe(true);
    save.resolve();await flush();expect(native).toHaveBeenCalledOnce();expect(h.log).toEqual(['capture','release']);expect(gesture.handoff()).toBe(false);
    h.call('a','onLostPointerCapture',h.event());expect(gesture.signal.aborted).toBe(false);
    done.resolve();await flush();expect(onReorder).not.toHaveBeenCalled();
  });
  it('cancels delayed exports after release, cancel, capture loss, or unmount',async()=>{
    for(const end of ['onPointerUp','onPointerCancel','onLostPointerCapture','unmount']){
      const save=deferred(),native=vi.fn();let gesture!:ArchiveDragGesture;
      const h=harness({onDragOut:async(_,current)=>{gesture=current;await save.promise;if(!current.signal.aborted&&current.handoff())native();}});
      h.call('a','onPointerDown',h.event());h.call('a','onPointerMove',h.event('a',{clientX:-2}));await flush();
      if(end==='unmount')h.unmount();else h.call('a',end,h.event('a',{clientX:-2}));
      expect(gesture.signal.aborted).toBe(true);expect(h.captured.size).toBe(0);save.resolve();await flush();expect(native).not.toHaveBeenCalled();
    }
  });
  it('ignores secondary buttons, interactive controls, and short clicks; Alt arrows provide reorder access',async()=>{
    const onReorder=vi.fn(),onDragOut=vi.fn(async()=>{}),h=harness({onReorder,onDragOut});
    h.call('a','onPointerDown',h.event('a',{button:2}));h.call('a','onPointerDown',h.event('a',{target:{closest:()=>({})}}));expect(h.captured.size).toBe(0);
    h.call('a','onPointerDown',h.event());h.call('a','onPointerMove',h.event('a',{clientY:414}));h.call('a','onPointerUp',h.event('a',{clientY:414}));expect(onReorder).not.toHaveBeenCalled();
    const up=h.event('b',{altKey:true,key:'ArrowUp'});h.call('b','onKeyDown',up);await flush();expect(onReorder).toHaveBeenLastCalledWith('b','a');expect(up.preventDefault).toHaveBeenCalledOnce();
    h.call('a','onKeyDown',h.event('a',{altKey:true,key:'ArrowDown'}));await flush();expect(onReorder).toHaveBeenLastCalledWith('a','c');
  });
  it('slides left for the configured duration, removes exactly once, and immediately completes with reduced motion',async()=>{
    vi.useFakeTimers();const onRemove=vi.fn(),h=harness({onRemove});h.complete();h.complete();expect(onRemove).not.toHaveBeenCalled();expect(hooks.updates).toContain('a');
    await vi.advanceTimersByTimeAsync(QUEUE_EXIT_MS-1);expect(onRemove).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(onRemove).toHaveBeenCalledExactlyOnceWith('a');
    const instant=vi.fn(),reduced=harness({onRemove:instant,reducedMotion:true});reduced.complete('b');expect(instant).toHaveBeenCalledExactlyOnceWith('b');
  });
  it('does not swallow the next fresh Complete click after an outside drag emits no browser click',async()=>{
    const onRemove=vi.fn(),h=harness({onRemove,onDragOut:async()=>{},reducedMotion:true});
    h.call('a','onPointerDown',h.event());h.call('a','onPointerMove',h.event('a',{clientX:-2}));await flush();
    h.call('b','onPointerDown',h.event('b',{target:{closest:()=>({})}}));
    const click=h.event('b',{detail:1});h.call('b','onClickCapture',click);expect(click.preventDefault).not.toHaveBeenCalled();
    h.complete('b');expect(onRemove).toHaveBeenCalledExactlyOnceWith('b');
  });
  it('restores the row and allows retry after a rejected completion; unmount cancels an uncommitted exit',async()=>{
    vi.useFakeTimers();const onRemove=vi.fn().mockRejectedValueOnce(Error('disk full')).mockResolvedValue(undefined),h=harness({onRemove});
    h.complete();await vi.advanceTimersByTimeAsync(QUEUE_EXIT_MS);expect(hooks.updates).toContain('Error: disk full');expect(hooks.updates.at(-1)).toBeNull();
    h.complete();await vi.advanceTimersByTimeAsync(QUEUE_EXIT_MS);expect(onRemove).toHaveBeenCalledTimes(2);
    const untouched=vi.fn(),closed=harness({onRemove:untouched});closed.complete();closed.unmount();await vi.advanceTimersByTimeAsync(QUEUE_EXIT_MS);expect(untouched).not.toHaveBeenCalled();
  });
});
