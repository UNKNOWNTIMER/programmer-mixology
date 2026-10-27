import { describe,it,expect,vi } from 'vitest';
import type { ReactElement } from 'react';
const effects=vi.hoisted(()=>({callbacks:[] as Array<()=>void|(()=>void)>}));
// Exercise actual component handlers and cleanup without a DOM emulation dependency.
// Native OLE acceptance remains a separate native integration check.
vi.mock('react',async importOriginal=>{
 const actual=await importOriginal<typeof import('react')>();
 return {...actual,useRef:<T,>(initial:T)=>({current:initial}),useEffect:(effect:()=>void|(()=>void))=>{effects.callbacks.push(effect);}};
});
import { ArchiveLogo, type ArchiveDragGesture } from './ArchiveLogo';
function harness(onDrag?:(gesture:ArchiveDragGesture)=>Promise<void>){
 const log:string[]=[],captured=new Set<number>();
 const element={setPointerCapture:(id:number)=>{captured.add(id);log.push(`capture:${id}`);},hasPointerCapture:(id:number)=>captured.has(id),releasePointerCapture:(id:number)=>{captured.delete(id);log.push(`release:${id}`);}};
 const firstEffect=effects.callbacks.length;
 const boundary=ArchiveLogo({children:null,onDrag}) as ReactElement<{children:ReactElement<Record<string,(event:unknown)=>void>>}>;
 const cleanups=effects.callbacks.slice(firstEffect).map(effect=>effect());
 const handlers=boundary.props.children.props;
 const event=(overrides:Record<string,unknown>={})=>({button:0,buttons:1,isPrimary:true,pointerId:7,clientX:36,clientY:548,currentTarget:element,...overrides});
 return {log,captured,event,down:(e=event())=>handlers.onPointerDown(e),move:(e=event())=>handlers.onPointerMove(e),up:(e=event())=>handlers.onPointerUp(e),cancel:(e=event())=>handlers.onPointerCancel(e),lost:(e=event())=>{captured.delete(e.pointerId);handlers.onLostPointerCapture(e);},unmount:()=>{for(const cleanup of cleanups)if(typeof cleanup==='function')cleanup();},click:()=>{const preventDefault=vi.fn(),stopPropagation=vi.fn();handlers.onClickCapture({preventDefault,stopPropagation});return {preventDefault,stopPropagation};}};
}
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
describe('archive logo pointer capture and originating asynchronous gesture',()=>{
 it('keeps a fast move captured during save and releases it exactly before one held-gesture OLE handoff',async()=>{
   const save=deferred(),nativeDone=deferred();let h!:ReturnType<typeof harness>;const native=vi.fn(()=>{h.log.push('native');expect(h.captured.size).toBe(0);return nativeDone.promise;});
   const drag=vi.fn(async(gesture:ArchiveDragGesture)=>{await save.promise;if(gesture.signal.aborted||!gesture.handoff())return;await native();});h=harness(drag);
   h.down();expect(h.captured.has(7)).toBe(true);
   // An outside-region pointermove reaches the logo because the pointer remains captured.
   if(h.captured.has(7))h.move(h.event({clientX:130,clientY:667}));
   h.move(h.event({clientX:180,clientY:700}));expect(drag).toHaveBeenCalledTimes(1);expect(h.captured.has(7)).toBe(true);expect(native).not.toHaveBeenCalled();
   save.resolve();await flush();expect(h.log).toEqual(['capture:7','release:7','native']);expect(native).toHaveBeenCalledTimes(1);
   const gesture=drag.mock.calls[0][0];expect(gesture.handoff()).toBe(false);h.lost();expect(gesture.signal.aborted).toBe(false);
   const click=h.click();expect(click.preventDefault).toHaveBeenCalledOnce();expect(click.stopPropagation).toHaveBeenCalledOnce();nativeDone.resolve();await flush();
 });
 it('cannot attach a delayed old save to a release then re-press; only the new held gesture starts',async()=>{
   const saves=[deferred(),deferred()],gestures:ArchiveDragGesture[]=[],native=vi.fn();
   const h=harness(async gesture=>{const i=gestures.push(gesture)-1;await saves[i].promise;if(gesture.signal.aborted||!gesture.handoff())return;native(i);});
   h.down();h.move(h.event({clientX:130}));h.up();expect(gestures[0].signal.aborted).toBe(true);
   h.down();h.move(h.event({clientX:150}));expect(h.captured.has(7)).toBe(true);expect(gestures[1].signal.aborted).toBe(false);
   saves[0].resolve();await flush();expect(native).not.toHaveBeenCalled();expect(h.captured.has(7)).toBe(true);expect(gestures[0].handoff()).toBe(false);
   saves[1].resolve();await flush();expect(native).toHaveBeenCalledExactlyOnceWith(1);expect(h.captured.size).toBe(0);
 });
 it('invalidates an old generation on a new pointerdown even when the prior pointerup was not observed',async()=>{
   const saves=[deferred(),deferred()],gestures:ArchiveDragGesture[]=[],native=vi.fn();
   const h=harness(async gesture=>{const i=gestures.push(gesture)-1;await saves[i].promise;if(!gesture.signal.aborted&&gesture.handoff())native(i);});
   h.down();h.move(h.event({clientX:130}));h.down();h.move(h.event({clientX:160}));expect(gestures[0].signal.aborted).toBe(true);
   saves[0].resolve();await flush();expect(native).not.toHaveBeenCalled();expect(h.captured.has(7)).toBe(true);
   saves[1].resolve();await flush();expect(native).toHaveBeenCalledExactlyOnceWith(1);
 });
 it('cancels delayed save handoffs after pointer cancellation, capture loss or unmount',async()=>{
   for(const end of ['cancel','lost','unmount'] as const){const save=deferred(),native=vi.fn();let gesture!:ArchiveDragGesture;
     const h=harness(async current=>{gesture=current;await save.promise;if(!current.signal.aborted&&current.handoff())native();});
     h.down();h.move(h.event({clientX:130}));h[end]();expect(gesture.signal.aborted).toBe(true);expect(h.captured.size).toBe(0);
     save.resolve();await flush();expect(native).not.toHaveBeenCalled();expect(gesture.handoff()).toBe(false);
   }
 });
 it('releases a short click and preserves the normal ticket click',()=>{
   const drag=vi.fn(async()=>{}),h=harness(drag);h.down();h.move(h.event({clientX:39,clientY:550}));h.up();
   expect(h.captured.size).toBe(0);expect(h.log).toEqual(['capture:7','release:7']);expect(drag).not.toHaveBeenCalled();expect(h.click().preventDefault).not.toHaveBeenCalled();
 });
 it('releases lost-button capture without exporting and ignores other pointers',()=>{
   const drag=vi.fn(async()=>{}),h=harness(drag);h.down();h.move(h.event({pointerId:9,clientX:200}));expect(drag).not.toHaveBeenCalled();expect(h.captured.has(7)).toBe(true);
   h.move(h.event({buttons:0,clientX:200}));expect(h.captured.size).toBe(0);expect(drag).not.toHaveBeenCalled();
 });
 it('does not capture a secondary button, secondary touch pointer or a logo without export support',()=>{
   const drag=vi.fn(async()=>{}),h=harness(drag);h.down(h.event({button:2}));h.down(h.event({isPrimary:false}));expect(h.log).toEqual([]);expect(drag).not.toHaveBeenCalled();
   const disabled=harness();disabled.down();expect(disabled.log).toEqual([]);
 });
});
