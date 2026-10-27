import { afterAll, describe, expect, it, vi } from 'vitest';
import { enqueueArchive, enqueueCurrentArchive, removeQueuedArchive, reorderQueuedArchive, ARCHIVE_QUEUE_LIMIT, ARCHIVE_QUEUE_STATE_BYTES } from './archive-queue';
import { defaultState } from './bridge';
import type { ValidatedArchive } from './archive-bridge';
import type { Catalog, UserState } from './types';
import recipes from '../public/seed/recipes.json';
import profiles from '../public/seed/profiles.seed.json';
const catalog={recipes:recipes.recipes,profiles:profiles.profiles} as unknown as Catalog;
vi.stubGlobal('window',{matchMedia:()=>({matches:false})});
afterAll(()=>vi.unstubAllGlobals());
function archive(n:number):ValidatedArchive {
  const recipe=structuredClone(catalog.recipes[n%catalog.recipes.length]),profile=structuredClone(catalog.profiles.find(p=>p.recipe_id===recipe.id)!);
  recipe.id=`archive-${n}`;recipe.default_orderable=false;recipe.source.kind='imported_snapshot';profile.recipe_id=recipe.id;profile.measured=false;
  const target={taste_bps:[1000,2000,3000,1500,2500] as const,sensory_0_10:[1,2,3,4,5,6,7] as const};
  return {archive_id:`id-${n}`,sha256:`sha-${n}`,target,snapshot:{recipe,profile,target},personal:{recipe,profile,created_at:'2026-09-21T00:00:00Z',audit:{original_snapshot:{recipe:catalog.recipes[n%catalog.recipes.length]}}},guest_orderable:false,authority_restored:false} as unknown as ValidatedArchive;
}
const stateBytes=(state:UserState)=>new TextEncoder().encode(JSON.stringify(state)).byteLength;
function largeArchive(n:number):ValidatedArchive {
  const result=archive(n);
  // Six individually valid 1,800-character steps, with the real import contract's
  // second copy retained in provenance. Neither a huge invalid field nor fake bytes.
  result.personal.recipe.steps_zh=Array.from({length:6},()=> '调'.repeat(1800));
  result.personal.audit.original_snapshot=structuredClone({recipe:result.personal.recipe,profile:result.personal.profile,target:result.target});
  return result;
}
function oldQueueFixture(values:ValidatedArchive[]):UserState {
  return {...defaultState(catalog),archiveQueue:values.map((value,index)=>({id:`legacy-${index}`,archiveId:value.archive_id,sha256:value.sha256,importedAt:'2026-09-22T00:00:00Z',personal:structuredClone(value.personal),target:structuredClone(value.target)}))};
}
describe('persistent archive FIFO',()=>{
  it('reorders frozen queue occurrences without changing the working drink, target, locks, or snapshots',()=>{
    let state={...defaultState(catalog),locked:[0,2]};for(let n=0;n<4;n++)state=enqueueCurrentArchive(state,archive(n)).state;
    const before=structuredClone(state),queue=state.archiveQueue!,result=reorderQueuedArchive(state,queue[3].id,queue[1].id);
    expect(result.activated).toBe(false);expect(result.state.archiveQueue!.map(e=>e.id)).toEqual([queue[0].id,queue[3].id,queue[1].id,queue[2].id]);
    expect({...result.state,archiveQueue:state.archiveQueue}).toEqual(before);expect(state).toEqual(before);
    for(const entry of result.state.archiveQueue!)expect(entry).toBe(queue.find(e=>e.id===entry.id));
    const head=reorderQueuedArchive(result.state,queue[3].id,queue[0].id);
    expect(head.state.selected).toBe(state.selected);expect(head.state.target).toEqual(state.target);expect(head.state.locked).toEqual([0,2]);
    const restored=JSON.parse(JSON.stringify(head.state)) as UserState;
    const completed=removeQueuedArchive(restored,queue[3].id);
    expect(completed.state.selected).toBe(queue[0].personal.recipe.id);expect(completed.state.target).toEqual(queue[0].target);
  });
  it('moves duplicate recipes independently and preserves their different serving targets',()=>{
    const first=archive(0),second=archive(0);second.target={taste_bps:[10000,0,0,0,0],sensory_0_10:[9,8,7,6,5,4,3]};
    let state=enqueueCurrentArchive(defaultState(catalog),first).state;state=enqueueCurrentArchive(state,second).state;state=enqueueCurrentArchive(state,archive(1)).state;
    const [a,b,c]=state.archiveQueue!,moved=reorderQueuedArchive(state,b.id,a.id);
    expect(moved.state.archiveQueue!.map(e=>e.id)).toEqual([b.id,a.id,c.id]);expect(moved.state.archiveQueue![0].target).toEqual(second.target);
    const next=removeQueuedArchive(moved.state,b.id);expect(next.state.target).toEqual(first.target);expect(next.state.archiveQueue!.map(e=>e.id)).toEqual([a.id,c.id]);
  });
  it('appends by queue identity and ignores stale destinations, stale entries, and unchanged moves',()=>{
    let state=defaultState(catalog);for(let n=0;n<3;n++)state=enqueueCurrentArchive(state,archive(n)).state;
    const [a,b,c]=state.archiveQueue!;
    for(const [id,beforeId] of [[a.id,a.id],['stale',a.id],[a.id,'stale'],[a.id,b.id],[c.id,null]] as const){
      expect(reorderQueuedArchive(state,id,beforeId)).toEqual({state,activated:false});expect(reorderQueuedArchive(state,id,beforeId).state).toBe(state);
    }
    const moved=reorderQueuedArchive(state,a.id,null);expect(moved.state.archiveQueue!.map(e=>e.id)).toEqual([b.id,c.id,a.id]);
  });
  it('rejects an order that cannot preserve later FIFO working snapshots and leaves all entries intact',()=>{
    const state=oldQueueFixture([archive(0),largeArchive(1),largeArchive(2),largeArchive(3)]),before=structuredClone(state),queue=state.archiveQueue!;
    expect(()=>reorderQueuedArchive(state,queue[3].id,queue[2].id)).toThrow('读取后续快照');expect(state).toEqual(before);
  });
  it('activates the first import with separate target and never changes its source objects',()=>{
    const state=defaultState(catalog),before=structuredClone(state),a=archive(0),source=structuredClone(a);
    const result=enqueueArchive(state,a);
    expect(result.activated).toBe(true);expect(result.state.selected).toBe(a.personal.recipe.id);expect(result.state.target).toEqual(a.target);
    expect(result.state.archiveQueue).toHaveLength(1);expect(result.state.generatedTrials?.[0].recipe.default_orderable).toBe(false);
    result.state.target.taste_bps[0]=999;expect(result.state.archiveQueue![0].target.taste_bps[0]).toBe(1000);
    expect(state).toEqual(before);expect(a).toEqual(source);
  });
  it('appends FIFO without interrupting work or locks; completing the head activates next and keeps original snapshots',()=>{
    let state=enqueueArchive(defaultState(catalog),archive(0)).state;
    state={...state,target:{taste_bps:[2000,2000,2000,2000,2000],sensory_0_10:[9,8,7,6,5,4,3]},locked:[0]};
    const before=structuredClone(state),pending=enqueueArchive(state,archive(1));expect(pending.activated).toBe(false);
    expect(pending.state.target).toEqual(before.target);expect(pending.state.locked).toEqual([0]);expect(pending.state.selected).toBe(before.selected);
    const next=removeQueuedArchive(pending.state,pending.state.archiveQueue![0].id);
    expect(next.activated).toBe(true);expect(next.state.selected).toBe(archive(1).personal.recipe.id);expect(next.state.target).toEqual(archive(1).target);expect(next.state.locked).toEqual([]);
    expect(next.state.reviews).toEqual(before.reviews);expect(next.state.inventory).toEqual(before.inventory);expect(next.state.settings).toEqual(before.settings);
    expect(next.state.archiveQueue![0].personal.profile.measured).toBe(false);
  });
  it('removing a later entry or the final entry preserves current drink and target',()=>{
    let state=defaultState(catalog);for(let n=0;n<3;n++)state=enqueueArchive(state,archive(n)).state;
    const removed=removeQueuedArchive(state,state.archiveQueue![1].id);expect(removed.activated).toBe(false);expect(removed.state.selected).toBe(state.selected);expect(removed.state.target).toEqual(state.target);
    expect(removed.state.archiveQueue!.map(e=>e.archiveId)).toEqual(['id-0','id-2']);
    const next=removeQueuedArchive(removed.state,removed.state.archiveQueue![0].id),last=removeQueuedArchive(next.state,next.state.archiveQueue![0].id);
    expect(last.state.archiveQueue).toEqual([]);expect(last.state.selected).toBe(next.state.selected);expect(last.state.generatedTrials!.some(t=>t.recipe.id===last.state.selected)).toBe(true);
    expect(removeQueuedArchive(last.state,'absent').state).toBe(last.state);
  });
  it('allows repeated files as independent servings and persists/removes each occurrence separately',()=>{
    let state=defaultState(catalog);for(let n=0;n<3;n++)state=enqueueArchive(state,archive(n)).state;
    const duplicate=enqueueArchive(state,archive(1));expect(duplicate.activated).toBe(false);state=duplicate.state;
    expect(state.archiveQueue).toHaveLength(4);expect(new Set(state.archiveQueue!.map(e=>e.id)).size).toBe(4);
    expect(state.archiveQueue![1].archiveId).toBe(state.archiveQueue![3].archiveId);
    const removed=removeQueuedArchive(state,state.archiveQueue![1].id);expect(removed.state.archiveQueue).toHaveLength(3);expect(removed.state.archiveQueue!.at(-1)?.id).toBe(state.archiveQueue![3].id);
    const restored=JSON.parse(JSON.stringify(state)) as UserState;
    expect(removeQueuedArchive(restored,restored.archiveQueue![0].id).state).toEqual(removeQueuedArchive(state,state.archiveQueue![0].id).state);
  });
  it('never silently evicts a pending drink when count or SQLite state budget is full',()=>{
    let state=defaultState(catalog);for(let n=0;n<ARCHIVE_QUEUE_LIMIT;n++)state=enqueueArchive(state,archive(n)).state;
    const before=structuredClone(state);expect(()=>enqueueArchive(state,archive(30))).toThrow('队列已满');expect(state).toEqual(before);
    const large=archive(1);large.personal.recipe.notes_zh='字'.repeat(100000);
    expect(()=>enqueueArchive(defaultState(catalog),large)).toThrow('空间不足');
  });
  it('finishing one of two identical recipes restores the next independent serving target',()=>{
    const source=archive(0);let state=enqueueArchive(defaultState(catalog),source).state;
    state=enqueueArchive(state,source).state;const secondId=state.archiveQueue![1].id;
    state={...state,target:{taste_bps:[10000,0,0,0,0],sensory_0_10:[9,9,9,9,9,9,9]},locked:[0]};
    const next=removeQueuedArchive(state,state.archiveQueue![0].id);
    expect(next.activated).toBe(true);expect(next.state.archiveQueue).toHaveLength(1);expect(next.state.archiveQueue![0].id).toBe(secondId);expect(next.state.target).toEqual(source.target);expect(next.state.locked).toEqual([]);expect(next.state.selected).toBe(source.personal.recipe.id);
  });
  it('adding the current drink to an empty queue preserves the entire workbench and its locks',()=>{
    const state={...defaultState(catalog),locked:[0,3]},before=structuredClone(state),source=archive(0),snapshot=structuredClone(source);
    const queuedAt='2026-09-22T06:00:00Z',result=enqueueCurrentArchive(state,source,queuedAt);
    expect(result.activated).toBe(false);expect(result.state.selected).toBe(before.selected);expect(result.state.target).toEqual(before.target);expect(result.state.locked).toEqual([0,3]);
    expect({...result.state,archiveQueue:before.archiveQueue}).toEqual(before);expect(result.state.archiveQueue).toHaveLength(1);
    expect(result.state.archiveQueue![0]).toMatchObject({archiveId:source.archive_id,sha256:source.sha256,importedAt:queuedAt,personal:source.personal,target:source.target});
    expect(state).toEqual(before);expect(source).toEqual(snapshot);
  });
  it('freezes independent recipe profile and target snapshots for repeated current-drink servings',()=>{
    const original=defaultState(catalog),source=archive(0),snapshot=structuredClone(source);
    const first=enqueueCurrentArchive(original,source).state,firstBefore=structuredClone(first),second=enqueueCurrentArchive(first,source).state;
    expect(second.archiveQueue).toHaveLength(2);expect(second.archiveQueue![0].id).not.toBe(second.archiveQueue![1].id);expect(second.archiveQueue![0].archiveId).toBe(second.archiveQueue![1].archiveId);
    source.personal.recipe.name_zh='后来修改的酒名';source.personal.profile.sensory_0_10[0]=10;source.target.taste_bps=[10000,0,0,0,0];
    for(const entry of second.archiveQueue!){expect(entry.personal).toEqual(snapshot.personal);expect(entry.target).toEqual(snapshot.target);}
    second.archiveQueue![1].personal.recipe.name_zh='只修改第二份测试快照';second.archiveQueue![1].personal.profile.sensory_0_10[1]=0;second.archiveQueue![1].target.sensory_0_10[2]=10;
    expect(first).toEqual(firstBefore);expect(second.archiveQueue![0].personal).toEqual(snapshot.personal);expect(second.archiveQueue![0].target).toEqual(snapshot.target);
  });
  it('finishing a current-drink head loads the next validated snapshot and only then resets locks',()=>{
    const state={...defaultState(catalog),locked:[1,4]},first=archive(0),second=archive(1);
    second.target={taste_bps:[3000,1000,2000,2000,2000],sensory_0_10:[7,6,5,4,3,2,1]};
    const one=enqueueCurrentArchive(state,first).state,two=enqueueCurrentArchive(one,second).state,before=structuredClone(two);
    expect(two.selected).toBe(state.selected);expect(two.target).toEqual(state.target);expect(two.locked).toEqual(state.locked);
    const completed=removeQueuedArchive(two,two.archiveQueue![0].id);
    expect(completed.activated).toBe(true);expect(completed.state.selected).toBe(second.personal.recipe.id);expect(completed.state.target).toEqual(second.target);expect(completed.state.locked).toEqual([]);
    expect(completed.state.generatedTrials?.at(-1)).toEqual(second.personal);expect(completed.state.archiveQueue).toHaveLength(1);expect(two).toEqual(before);
    completed.state.target.taste_bps=[10000,0,0,0,0];completed.state.generatedTrials!.at(-1)!.recipe.name_zh='工作台后续修改';
    expect(completed.state.archiveQueue![0].target).toEqual(second.target);expect(completed.state.archiveQueue![0].personal).toEqual(second.personal);
  });
  it('rejects excess current-drink servings under the same limits without evicting or mutating pending work',()=>{
    let state={...defaultState(catalog),locked:[2]};for(let n=0;n<ARCHIVE_QUEUE_LIMIT;n++)state=enqueueCurrentArchive(state,archive(n)).state;
    const before=structuredClone(state),extra=archive(30),extraBefore=structuredClone(extra);
    expect(()=>enqueueCurrentArchive(state,extra)).toThrow('队列已满');expect(state).toEqual(before);expect(extra).toEqual(extraBefore);
    const pending=enqueueCurrentArchive(defaultState(catalog),archive(0)).state,pendingBefore=structuredClone(pending),large=archive(1);large.personal.recipe.notes_zh='字'.repeat(100000);const largeBefore=structuredClone(large);
    expect(()=>enqueueCurrentArchive(pending,large)).toThrow('空间不足');expect(pending).toEqual(pendingBefore);expect(large).toEqual(largeBefore);
  });
  it('reserves for every future activation, including a peak after the first completion',()=>{
    const values=[archive(0),archive(1),largeArchive(2),largeArchive(3),largeArchive(4)],unsafe=oldQueueFixture(values);
    expect(stateBytes(unsafe)).toBeLessThan(ARCHIVE_QUEUE_STATE_BYTES);
    const first=removeQueuedArchive(unsafe,unsafe.archiveQueue![0].id);
    expect(stateBytes(first.state)).toBeLessThan(ARCHIVE_QUEUE_STATE_BYTES);
    expect(()=>removeQueuedArchive(first.state,first.state.archiveQueue![0].id)).toThrow('读取后续快照');
    for(const enqueue of [enqueueCurrentArchive,enqueueArchive]){
      let state=defaultState(catalog);for(const value of values.slice(0,-1))state=enqueue(state,value).state;
      const before=structuredClone(state),source=structuredClone(values.at(-1)!);
      expect(()=>enqueue(state,values.at(-1)!)).toThrow('读取后续快照');expect(state).toEqual(before);expect(values.at(-1)).toEqual(source);
      while(state.archiveQueue!.length){state=removeQueuedArchive(state,state.archiveQueue![0].id).state;expect(stateBytes(state)).toBeLessThanOrEqual(ARCHIVE_QUEUE_STATE_BYTES);}
    }
  });
  it('guards completion of legacy queues before losing the head and allows removing a later cup to recover',()=>{
    const state=oldQueueFixture([archive(0),largeArchive(1),largeArchive(2),largeArchive(3)]),before=structuredClone(state);
    expect(stateBytes(state)).toBeLessThan(ARCHIVE_QUEUE_STATE_BYTES);
    expect(()=>removeQueuedArchive(state,state.archiveQueue![0].id)).toThrow('读取后续快照');expect(state).toEqual(before);
    const recovered=removeQueuedArchive(state,state.archiveQueue!.at(-1)!.id);
    expect(recovered.activated).toBe(false);expect(recovered.state.archiveQueue![0].id).toBe(state.archiveQueue![0].id);
    expect(recovered.state.selected).toBe(state.selected);expect(recovered.state.target).toEqual(state.target);
    const completed=removeQueuedArchive(recovered.state,recovered.state.archiveQueue![0].id);
    expect(completed.activated).toBe(true);expect(completed.state.selected).toBe(state.archiveQueue![1].personal.recipe.id);expect(stateBytes(completed.state)).toBeLessThanOrEqual(ARCHIVE_QUEUE_STATE_BYTES);
  });
});
