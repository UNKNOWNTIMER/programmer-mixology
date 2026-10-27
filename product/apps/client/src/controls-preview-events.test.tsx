import { afterEach,describe,expect,it,vi } from 'vitest';
import type { ReactElement,ReactNode } from 'react';
vi.mock('react',async importOriginal=>{const actual=await importOriginal<typeof import('react')>();return {...actual,useRef:<T,>(value:T)=>({current:value}),useMemo:<T,>(factory:()=>T)=>factory(),useState:<T,>(initial:T|(()=>T))=>[typeof initial==='function'?(initial as ()=>T)():initial,()=>{}],useId:()=>':control-test:',useEffect:()=>{},useLayoutEffect:()=>{}};});
vi.mock('./i18n',async importOriginal=>{const actual=await importOriginal<typeof import('./i18n')>();return {...actual,useI18n:()=>({language:'zh',t:(text:string)=>text})};});
import { TasteControls,type ControlProps } from './Controls';
type Element=ReactElement<Record<string,unknown>>;
function find(node:ReactNode,predicate:(element:Element)=>boolean):Element|undefined{if(!node||typeof node!=='object')return;if(Array.isArray(node)){for(const child of node){const result=find(child,predicate);if(result)return result;}return;}if('props' in node){const el=node as Element;if(predicate(el))return el;return find(el.props.children as ReactNode,predicate);}}
function setup(){
 const frames=new Map<number,()=>void>();let frameId=0;vi.stubGlobal('requestAnimationFrame',(run:()=>void)=>{frames.set(++frameId,run);return frameId;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
 const preview=vi.fn(),props:ControlProps={target:{taste_bps:[2000,2000,2000,2000,2000],sensory_0_10:[5,5,5,5,5,5,5]},locked:[],onLock:vi.fn(),onBegin:vi.fn(),onEnd:vi.fn(),onCancel:vi.fn(),onTaste:vi.fn(),onSensory:vi.fn(),onPreset:vi.fn(),onTastePreview:preview};
 const tree=TasteControls(props),root=find(tree,e=>e.props.className==='taste-controls detailed-taste')!,slider=find(tree,e=>e.props.type==='range'&&e.props['data-axis']===0)!;
 const host={getBoundingClientRect:()=>({left:0,right:300,top:0,bottom:200}),contains:(target:unknown)=>target==='inside'};(root.props.ref as {current:unknown}).current=host;
 const sliderHost={focus:()=>{(root.props.onFocusCapture as ()=>void)();},setPointerCapture:vi.fn(),getBoundingClientRect:()=>({left:0,width:200})};
 const event=(extra:Record<string,unknown>={})=>({clientX:30,clientY:30,pointerId:1,pointerType:'mouse',timeStamp:0,shiftKey:false,preventDefault:()=>{},currentTarget:sliderHost,...extra});
 const call=(element:Element,key:string,value?:unknown)=>(element.props[key] as (event:unknown)=>void)(value);
 return {preview,props,root,slider,event,call,host,paint:()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());}};
}
afterEach(()=>vi.unstubAllGlobals());
describe('actual taste-control engagement events',()=>{
 it('keeps the preview during captured drag beyond the region and closes it on an outside pointerup',()=>{
   const h=setup();h.call(h.root,'onPointerEnter');h.paint();expect(h.preview).toHaveBeenLastCalledWith(h.props.target.taste_bps);
   h.call(h.root,'onPointerDownCapture');h.call(h.slider,'onPointerDown',h.event());h.call(h.slider,'onPointerMove',h.event({clientX:50}));expect(h.props.onBegin).toHaveBeenCalledOnce();
   h.call(h.root,'onPointerLeave');h.paint();expect(h.preview).toHaveBeenCalledTimes(1);
   h.call(h.root,'onPointerUpCapture');h.call(h.slider,'onPointerUp',h.event({clientX:500,clientY:400}));expect(h.preview).toHaveBeenLastCalledWith(null);expect(h.props.onEnd).toHaveBeenCalledOnce();
 });
 it('opens for keyboard focus and closes when focus leaves without a pointer hover',()=>{
   const h=setup();h.call(h.root,'onFocusCapture');h.paint();expect(h.preview).toHaveBeenCalledExactlyOnceWith(h.props.target.taste_bps);
   h.call(h.root,'onPointerEnter');h.call(h.root,'onPointerLeave');h.paint();expect(h.preview).toHaveBeenCalledTimes(1);
   h.call(h.root,'onBlurCapture',{currentTarget:h.host,relatedTarget:'outside'});expect(h.preview).toHaveBeenLastCalledWith(null);
 });
 it('does not retain a mouse-only focus after a short click and pointer exit',()=>{
   const h=setup();h.call(h.root,'onPointerEnter');h.paint();h.call(h.root,'onPointerDownCapture');h.call(h.slider,'onPointerDown',h.event());
   h.call(h.root,'onPointerUpCapture');h.call(h.slider,'onPointerUp',h.event());h.call(h.root,'onPointerLeave');expect(h.preview).toHaveBeenLastCalledWith(null);
 });
 it('closes after lost capture outside and does not apply a second gesture end',()=>{
   const h=setup();h.call(h.root,'onPointerEnter');h.paint();h.call(h.root,'onPointerDownCapture');h.call(h.slider,'onPointerDown',h.event());h.call(h.slider,'onPointerMove',h.event({clientX:50}));h.call(h.root,'onPointerLeave');
   h.call(h.slider,'onLostPointerCapture',h.event({clientX:500,clientY:400}));expect(h.props.onCancel).toHaveBeenCalledOnce();expect(h.preview).toHaveBeenLastCalledWith(null);
   h.call(h.root,'onPointerUpCapture');h.call(h.slider,'onPointerUp',h.event({clientX:500,clientY:400}));expect(h.props.onEnd).not.toHaveBeenCalled();
 });
});
