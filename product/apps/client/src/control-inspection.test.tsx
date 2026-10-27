import { afterEach,describe,expect,it,vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from './i18n';
import { clusterPresets, nearbyPresetClusters, TasteControls, SensoryControls, type ClassicPreset, type ControlProps } from './Controls';
import { CONTROL_HINT_DELAY, controlHint, createDelayedHint, createTastePreviewPublisher } from './control-inspection';
import type { Profile,Taste } from './types';
const preset=(id:string,value:number):ClassicPreset=>({recipe_id:id,name_zh:id,name_en:id,profile:{recipe_id:id,taste_preference_bps:[value,10000-value,0,0,0],sensory_0_10:[5,5,5,5,5,5,5],taste_intensity_0_10:null,status:'heuristic_unvalidated',measured:false,note_zh:''} as Profile});
const noop=()=>{};
const props:ControlProps={target:{taste_bps:[2000,2000,2000,2000,2000],sensory_0_10:[5,5,5,5,5,5,5]},locked:[],onLock:noop,onBegin:noop,onEnd:noop,onCancel:noop,onTaste:noop,onSensory:noop,onPreset:noop};
afterEach(()=>vi.useRealTimers());
describe('bounded nearby preset projections',()=>{
 it('selects the five nearest positions, keeps rail ordering and does not alter overlapping recipes',()=>{
   const inputs=Array.from({length:11},(_,n)=>preset(`drink-${n}`,n*900));inputs.push(preset('overlap-a',4510),preset('overlap-b',4590));const before=JSON.stringify(inputs);
   const clusters=clusterPresets(inputs,0),near=nearbyPresetClusters(clusters,4500);
   expect(near.map(c=>c.position)).toEqual([2700,3600,4500,5400,6300]);expect(near.find(c=>c.position===4500)?.entries.map(p=>p.recipe_id)).toEqual(['drink-5','overlap-a','overlap-b']);expect(JSON.stringify(inputs)).toBe(before);
 });
 it('keeps an opened candidate group available and never exceeds five groups',()=>{
   const all=clusterPresets(Array.from({length:11},(_,n)=>preset(`drink-${n}`,n*900)),0);
   const near=nearbyPresetClusters(all,9000,5,all[0]);expect(near.map(c=>c.position)).toEqual([0,7200,8100,9000]);expect(near).toContain(all[0]);expect(near.map(c=>c.position)).toEqual([...near].map(c=>c.position).sort((a,b)=>a-b));
   const capped=nearbyPresetClusters(all,4500,99,all[0]);expect(capped).toHaveLength(5);expect(capped).toContain(all[0]);expect(nearbyPresetClusters(all,0,0)).toEqual([]);expect(nearbyPresetClusters([],0)).toEqual([]);
 });
 it('keeps the inclusive 2000 bp neighborhood and only one nearest group when it is empty',()=>{
   const all=clusterPresets([preset('zero',0),preset('ten',1000),preset('twenty',2000),preset('forty',4000)],0);
   expect(nearbyPresetClusters(all,2000).map(c=>c.position)).toEqual([0,1000,2000,4000]);
   expect(nearbyPresetClusters(all,2001).map(c=>c.position)).toEqual([1000,2000,4000]);
   expect(nearbyPresetClusters(all,10000).map(c=>c.position)).toEqual([4000]);
   expect(nearbyPresetClusters(all,10000,5,all[1]).map(c=>c.position)).toEqual([1000,4000]);
 });
 it('renders bounded native buttons for keyboard selection and a current-value CSS fill',()=>{
   const html=renderToStaticMarkup(<TasteControls {...props} presets={Array.from({length:30},(_,n)=>preset(`drink-${n}`,n*330))}/>);
   expect((html.match(/class="classic-marker /g)||[]).length).toBeLessThanOrEqual(25);expect(html).toContain('--fill:20%');expect(html).toContain('type="range"');expect(html).toContain('aria-expanded="false"');expect(html).not.toContain('tabindex="-1"');
   const sensory=renderToStaticMarkup(<I18nProvider language="en"><SensoryControls {...props}/></I18nProvider>);expect((sensory.match(/class="axis-name" tabindex="0"/g)||[])).toHaveLength(7);
 });

});
describe('one-second bilingual control inspector',()=>{
 it('waits a full second, does not restart within one control, and cancels an abandoned hover',()=>{
   vi.useFakeTimers();const reveal=vi.fn(),hide=vi.fn(),hint=createDelayedHint(reveal,hide);hint.enter('sweet',{axis:0});vi.advanceTimersByTime(600);hint.enter('sweet',{axis:0});vi.advanceTimersByTime(CONTROL_HINT_DELAY-601);expect(reveal).not.toHaveBeenCalled();vi.advanceTimersByTime(1);expect(reveal).toHaveBeenCalledExactlyOnceWith({axis:0});
   hint.enter('sour',{axis:1});vi.advanceTimersByTime(999);hint.leave();vi.advanceTimersByTime(1);expect(reveal).toHaveBeenCalledTimes(1);
 });
 it('restarts the dwell for another axis and clears timers on disposal',()=>{
   vi.useFakeTimers();const reveal=vi.fn(),hint=createDelayedHint(reveal,()=>{});hint.enter('sweet',0);vi.advanceTimersByTime(700);hint.enter('sour',1);vi.advanceTimersByTime(300);expect(reveal).not.toHaveBeenCalled();vi.advanceTimersByTime(700);expect(reveal).toHaveBeenCalledExactlyOnceWith(1);
   hint.enter('bitter',2);hint.dispose();vi.advanceTimersByTime(1000);expect(reveal).toHaveBeenCalledTimes(1);
 });
 it('defines all 12 axes in both languages without presenting taste as doses or alcohol sensation as ABV',()=>{
   for(const language of ['zh','en'] as const){for(let n=0;n<5;n++)expect(controlHint('taste',n,language)).toContain('100%');for(let n=0;n<7;n++)expect(controlHint('sensory',n,language).length).toBeGreaterThan(15);}
   for(let n=0;n<5;n++){expect(controlHint('taste',n,'zh')).toContain('偏好权重，非原料比例');expect(controlHint('taste',n,'en')).toContain('preference weights, not ingredient ratios');}
   expect(controlHint('taste',0,'zh')).toContain('入口与回味');expect(controlHint('taste',1,'en')).toContain('mouthwatering');expect(controlHint('taste',2,'en')).toContain('persistence');expect(controlHint('taste',3,'en')).toContain('noticeable saltiness');expect(controlHint('taste',4,'en')).toContain('savory umami');
   expect(controlHint('sensory',0,'en')).toContain('not ABV');expect(controlHint('sensory',4,'en')).toContain('not drink temperature');expect(controlHint('sensory',6,'en')).toContain('not measured in seconds');
 });
});
describe('taste preview frame channel',()=>{
 function channel(){const queued=new Map<number,()=>void>();let id=0;const emit=vi.fn(),cancel=vi.fn((key:number)=>{queued.delete(key);}),publisher=createTastePreviewPublisher(emit,fn=>{queued.set(++id,fn);return id;},cancel);return {publisher,emit,queued,cancel,paint:()=>{const work=[...queued.values()];queued.clear();work.forEach(fn=>fn());}};}
 const initial:Taste=[2000,2000,2000,2000,2000],next:Taste=[3000,1750,1750,1750,1750];
 it('coalesces animation frames, deduplicates unchanged vectors and sends a defensive copy',()=>{
   const h=channel();h.publisher.show(initial);h.publisher.show(next);expect(h.queued.size).toBe(1);expect(h.emit).not.toHaveBeenCalled();h.paint();expect(h.emit).toHaveBeenCalledExactlyOnceWith(next);expect(h.emit.mock.calls[0][0]).not.toBe(next);
   h.publisher.show(next);h.paint();expect(h.emit).toHaveBeenCalledTimes(1);h.publisher.show(initial);h.paint();expect(h.emit).toHaveBeenCalledTimes(2);
 });
 it('closes immediately on leaving and cancels stale pending updates before reopening',()=>{
   const h=channel();h.publisher.show(initial);h.paint();h.publisher.show(next);h.publisher.hide();expect(h.queued.size).toBe(0);expect(h.emit).toHaveBeenLastCalledWith(null);h.paint();h.publisher.hide();expect(h.emit).toHaveBeenCalledTimes(2);
   h.publisher.show(initial);h.paint();expect(h.emit).toHaveBeenCalledTimes(3);expect(h.emit).toHaveBeenLastCalledWith(initial);
 });
 it('never publishes fractional, negative or non-conserving taste frames',()=>{
   const h=channel();for(const values of [[1,2,3],[-1,2500,2500,2500,2501],[2000.5,1999.5,2000,2000,2000],[2000,2000,2000,2000,1999]])h.publisher.show(values);expect(h.queued.size).toBe(0);expect(h.emit).not.toHaveBeenCalled();
 });
});
