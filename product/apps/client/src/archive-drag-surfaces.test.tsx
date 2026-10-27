import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
const hooks=vi.hoisted(()=>({values:[] as unknown[],index:0,native:true}));
// Exercise the actual button/drag handlers; OS OLE transfer is covered separately.
vi.mock('react',async original=>{
  const actual=await original<typeof import('react')>();
  return {...actual,
    useRef:<T,>(initial:T)=>{const i=hooks.index++;if(!(i in hooks.values))hooks.values[i]={current:initial};return hooks.values[i];},
    useState:<T,>(initial:T|(()=>T))=>{const i=hooks.index++;if(!(i in hooks.values))hooks.values[i]=typeof initial==='function'?(initial as ()=>T)():initial;return [hooks.values[i],(next:T|((value:T)=>T))=>{hooks.values[i]=typeof next==='function'?(next as (value:T)=>T)(hooks.values[i] as T):next;}];},
    useMemo:<T,>(factory:()=>T)=>factory(),useEffect:()=>{},useLayoutEffect:()=>{},
  };
});
vi.mock('./bridge',()=>({get native(){return hooks.native;}}));
vi.mock('./i18n',()=>({Localized:({children}:{children:ReactNode})=>children,useI18n:()=>({language:'zh',t:(value:string)=>value})}));
import { ArchiveDragButton } from './ArchiveDragButton';
import { useArchiveDrag, type ArchiveDragGesture } from './archive-drag';
import RecipeLibrary from './RecipeLibrary';
import { Glass } from './Glass';
import { emptyLibrary } from './recipe-library';
import seedRecipes from '../public/seed/recipes.json';
import seedProfiles from '../public/seed/profiles.seed.json';
import type { Catalog, UserState } from './types';

type Element=ReactElement<Record<string,unknown>>;
const catalog={schema_version:'1',recipes:seedRecipes.recipes.slice(0,2),profiles:seedProfiles.profiles,ingredients:[],sources:[]} as unknown as Catalog;
const state:UserState={version:1,selected:catalog.recipes[1].id,favorites:[],inventory:[],excluded:[],inventoryOnly:false,locked:[],reviews:[],drafts:[],settings:{reducedMotion:false,fontScale:1.25,startupAnimation:true},target:{taste_bps:[2000,2000,2000,2000,2000],sensory_0_10:[0,1,2,3,4,5,6]}};
function all(node:ReactNode):Element[]{if(Array.isArray(node))return node.flatMap(all);if(!node||typeof node!=='object'||!('props'in node))return [];const el=node as Element;return [el,...all(el.props.children as ReactNode)];}
function reset(){hooks.values=[];hooks.index=0;}
function pointers(handlers:Record<string,unknown>){
  const captured=new Set<number>(),element={setPointerCapture:(id:number)=>captured.add(id),hasPointerCapture:(id:number)=>captured.has(id),releasePointerCapture:(id:number)=>captured.delete(id)};
  const event=(extra:Record<string,unknown>={})=>({button:0,buttons:1,isPrimary:true,pointerId:4,clientX:20,clientY:20,currentTarget:element,...extra});
  const call=(key:string,extra:Record<string,unknown>={})=>(handlers[key] as (value:unknown)=>void)(event(extra));
  return {captured,down:()=>call('onPointerDown'),move:(x:number,y=20)=>call('onPointerMove',{clientX:x,clientY:y}),up:()=>call('onPointerUp'),click:()=>{
    let prevented=false;const e={preventDefault:()=>{prevented=true;},stopPropagation:vi.fn()};(handlers.onClickCapture as (value:unknown)=>void)(e);
    if(!prevented)(handlers.onClick as (()=>void)|undefined)?.();return prevented;
  }};
}
const pending=()=>{let resolve!:()=>void;return {promise:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};};
beforeEach(()=>{reset();hooks.native=true;});
describe('library and ASCII native archive drag surfaces',()=>{
  it('exports the dragged library recipe and its own prediction, without selecting it or turning action controls into exports',async()=>{
    const wait=pending(),onSelect=vi.fn(),onRecipeDrag=vi.fn(async()=>wait.promise);
    const tree=all(RecipeLibrary({catalog,library:emptyLibrary(),state,onApply:vi.fn(),onSelect,onRecipeDrag}));
    const source=tree.find(el=>el.type===ArchiveDragButton)!;
    expect(tree.filter(el=>el.props['data-action']).every(el=>el.type==='button'&&!el.props.onArchiveDrag)).toBe(true);
    reset();const button=ArchiveDragButton(source.props as Parameters<typeof ArchiveDragButton>[0]) as Element;
    expect(button.type).toBe('button');expect(button.props.draggable).toBe(false);
    const p=pointers(button.props);p.down();p.move(60);
    expect(onRecipeDrag).toHaveBeenCalledExactlyOnceWith(catalog.recipes[0],catalog.profiles.find(profile=>profile.recipe_id===catalog.recipes[0].id),expect.objectContaining({signal:expect.any(AbortSignal),handoff:expect.any(Function)}));
    expect(onSelect).not.toHaveBeenCalled();p.up();expect(p.click()).toBe(true);expect(onSelect).not.toHaveBeenCalled();wait.resolve();await wait.promise;
  });
  it('retains short-click loading and cancels pending library export when the pointer is released',async()=>{
    const wait=pending(),onSelect=vi.fn(),gestures:ArchiveDragGesture[]=[];
    const tree=all(RecipeLibrary({catalog,library:emptyLibrary(),state,onApply:vi.fn(),onSelect,onRecipeDrag:async(_recipe,_profile,gesture)=>{gestures.push(gesture);await wait.promise;}}));
    const source=tree.find(el=>el.type===ArchiveDragButton)!;reset();const button=ArchiveDragButton(source.props as Parameters<typeof ArchiveDragButton>[0]) as Element,p=pointers(button.props);
    p.down();p.move(24);p.up();expect(p.click()).toBe(false);expect(onSelect).toHaveBeenCalledExactlyOnceWith(catalog.recipes[0]);expect(gestures).toHaveLength(0);
    p.down();p.move(50);p.up();expect(gestures[0].signal.aborted).toBe(true);expect(gestures[0].handoff()).toBe(false);expect(p.captured.size).toBe(0);wait.resolve();await wait.promise;
  });
  it('keeps glass layout and quote click, with only the canvas acting as a drag surface',()=>{
    const onArchiveDrag=vi.fn(async()=>{}),props={recipe:catalog.recipes[0],ingredients:[],onArchiveDrag};
    const tree=all(Glass(props)),source=tree.find(el=>el.type===ArchiveDragButton)!;
    expect(source.props.className).toBe('canvas-button detailed-canvas');expect(source.props.onArchiveDrag).toBe(onArchiveDrag);
    expect(all(source.props.children as ReactNode).some(el=>el.type==='canvas')).toBe(true);
    const hotspots=tree.filter(el=>String(el.props.className).includes('detail-hotspot'));
    expect(hotspots).toHaveLength(3);expect(hotspots.every(el=>el.type==='button'&&!el.props.onArchiveDrag&&!el.props.onPointerDown)).toBe(true);
    (source.props.onClick as ()=>void)();hooks.index=0;
    expect(all(Glass(props)).some(el=>el.props.className==='detail-quote')).toBe(true);
  });
  it('does not expose native drag behavior in the browser preview or on disabled library buttons',()=>{
    hooks.native=false;const onArchiveDrag=vi.fn(async()=>{});
    const glass=all(Glass({recipe:catalog.recipes[0],ingredients:[],onArchiveDrag})).find(el=>el.type===ArchiveDragButton)!;
    expect(glass.props.onArchiveDrag).toBeUndefined();reset();
    const library=all(RecipeLibrary({catalog,library:emptyLibrary(),state,onApply:vi.fn(),onSelect:vi.fn(),onRecipeDrag:vi.fn()}));
    expect(library.filter(el=>el.type===ArchiveDragButton).every(el=>!el.props.onArchiveDrag)).toBe(true);reset();
    const disabled=ArchiveDragButton({disabled:true,onArchiveDrag}) as Element,p=pointers(disabled.props);p.down();p.move(50);
    expect(disabled.props['data-archive-draggable']).toBe(false);expect(p.captured.size).toBe(0);expect(onArchiveDrag).not.toHaveBeenCalled();
  });
  it('keeps the originating cup callback even if the surface renders another cup while the pointer is down',async()=>{
    const wait=pending(),first=vi.fn(async()=>wait.promise),second=vi.fn(async()=>{});
    let handlers=useArchiveDrag<HTMLButtonElement>(first) as Record<string,unknown>;const p=pointers(handlers);p.down();
    hooks.index=0;handlers=useArchiveDrag<HTMLButtonElement>(second) as Record<string,unknown>;
    // Pointer capture remains owned by the original node; handlers from the new render see the same press ref.
    const capturedElement={hasPointerCapture:()=>true,releasePointerCapture:vi.fn()};
    (handlers.onPointerMove as (e:unknown)=>void)({pointerId:4,buttons:1,clientX:70,clientY:20,currentTarget:capturedElement});
    expect(first).toHaveBeenCalledOnce();expect(second).not.toHaveBeenCalled();p.up();wait.resolve();await wait.promise;
  });
});
