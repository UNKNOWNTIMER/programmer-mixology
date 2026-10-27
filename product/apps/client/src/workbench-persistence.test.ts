import { describe, expect, it, vi } from 'vitest';
import { persistLatestState, persistQueueChange } from './workbench-persistence';
import { enqueueCurrentArchive, removeQueuedArchive, reorderQueuedArchive, ARCHIVE_QUEUE_STATE_BYTES } from './archive-queue';
import type { ValidatedArchive } from './archive-bridge';
import type { Profile, Recipe, Review, UserState } from './types';
import seedRecipes from '../public/seed/recipes.json';
import seedProfiles from '../public/seed/profiles.seed.json';

function fixture(){
  const recipe=structuredClone(seedRecipes.recipes[0]) as Recipe,profile=structuredClone(seedProfiles.profiles.find(value=>value.recipe_id===recipe.id)) as unknown as Profile;
  const target:UserState['target']={taste_bps:[2000,2000,2000,2000,2000],sensory_0_10:[1,2,3,4,5,6,7]};
  let state:UserState={version:1,selected:recipe.id,target,locked:[1],favorites:[],reviews:[],inventory:[],excluded:[],inventoryOnly:false,settings:{fontScale:1.25,reducedMotion:false},drafts:[]};
  for(let n=0;n<3;n++){
    const personal={recipe:{...recipe,id:`import-${n}`,default_orderable:false,source:{...recipe.source,kind:'imported_snapshot'}},profile:{...profile,recipe_id:`import-${n}`,measured:false},created_at:'2026-09-22T00:00:00Z',audit:{}};
    const archive:ValidatedArchive={archive_id:`file-${n}`,sha256:`sha-${n}`,snapshot:{recipe,profile,target},personal,target,guest_orderable:false,authority_restored:false};
    state=enqueueCurrentArchive(state,archive).state;
  }
  const review:Review={id:'new-review',recipe_id:recipe.id,recipe_revision_id:'review-version',user_name:'Reviewer',score:3,note:'Actual tasting note',tasted_at:'2026-09-22T00:00:00Z',consent:true,snapshot:recipe};
  return {state,review};
}
function deferred(){let resolve!:()=>void,reject!:(error:Error)=>void;return {promise:new Promise<void>((yes,no)=>{resolve=yes;reject=no;}),resolve:()=>resolve(),reject:(error:Error)=>reject(error)};}
const bytes=(value:UserState)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;

describe('ordered workbench persistence under concurrent edits',()=>{
  it('saves a concurrently submitted review after queue completion without resurrecting the old head',async()=>{
    const {state,review}=fixture(),gate=deferred(),writes:UserState[]=[];
    let current=state;const read=()=>current,head=state.archiveQueue![0].id;
    const write=vi.fn(async(value:UserState)=>{writes.push(structuredClone(value));if(writes.length===1)await gate.promise;});
    const completion=persistQueueChange(read,value=>{current=value;},value=>removeQueuedArchive(value,head),write);
    current={...current,reviews:[...current.reviews,review]};
    // Equivalent to the App's serialized review save. Read only when its turn starts.
    const reviewSave=completion.then(()=>persistLatestState(read,write));gate.resolve();await reviewSave;
    expect(writes).toHaveLength(2);expect(writes[0].reviews).toEqual([]);expect(writes[1].reviews).toEqual([review]);
    expect(writes.every(value=>!value.archiveQueue!.some(entry=>entry.id===head))).toBe(true);
    expect(current.archiveQueue!.map(entry=>entry.archiveId)).toEqual(['file-1','file-2']);expect(current.selected).toBe('import-1');expect(current.reviews).toEqual([review]);
  });
  it('merges committed order into the newest controls, settings, drafts and trial cache',async()=>{
    const {state,review}=fixture(),gate=deferred();let current=state;
    const [first,,last]=state.archiveQueue!,operation=vi.fn((value:UserState)=>reorderQueuedArchive(value,last.id,first.id));
    const pending=persistQueueChange(()=>current,value=>{current=value;},operation,async()=>gate.promise);
    const target:UserState['target']={taste_bps:[10000,0,0,0,0],sensory_0_10:[9,8,7,6,5,4,3]};
    current={...current,target,settings:{...current.settings,language:'en'},reviews:[review],generatedTrials:[state.archiveQueue![0].personal]};
    const during=current;gate.resolve();const result=await pending;
    expect(operation).toHaveBeenCalledOnce();expect(result.activated).toBe(false);expect(current.archiveQueue!.map(entry=>entry.archiveId)).toEqual(['file-2','file-0','file-1']);
    expect({...current,archiveQueue:during.archiveQueue}).toEqual(during);expect(current.target).toBe(target);
  });
  it('never reports a committed completion as failed because newer nonqueue edits grew past the queue budget',async()=>{
    const {state,review}=fixture();let before=state;const head=state.archiveQueue![0].id;
    // Many individually bounded real review snapshots approach the state budget.
    for(let index=0;;index++){
      const candidate={...before,reviews:[...before.reviews,{...review,id:`existing-${index}`,note:'x'.repeat(1000)}]};
      try{removeQueuedArchive(candidate,head);before=candidate;}catch{break;}
    }
    expect(bytes(before)).toBeLessThan(256*1024);
    const gate=deferred();let current=before,durable:UserState|undefined;
    const operation=vi.fn((value:UserState)=>removeQueuedArchive(value,head));
    const pending=persistQueueChange(()=>current,value=>{current=value;},operation,async value=>{durable=structuredClone(value);await gate.promise;});
    current={...current,reviews:[...current.reviews,{...review,id:'concurrent-review',note:'x'.repeat(1000)}]};
    expect(()=>removeQueuedArchive(current,head)).toThrow('空间不足');
    const expectedReviewCount=current.reviews.length;gate.resolve();const result=await pending;
    expect(operation).toHaveBeenCalledOnce();expect(result.activated).toBe(true);expect(durable!.archiveQueue!.some(entry=>entry.id===head)).toBe(false);expect(bytes(durable!)).toBeLessThanOrEqual(ARCHIVE_QUEUE_STATE_BYTES);
    expect(current.archiveQueue!.some(entry=>entry.id===head)).toBe(false);expect(current.reviews).toHaveLength(expectedReviewCount);expect(current.selected).toBe('import-1');
  });
  it('keeps the queue and concurrent edits intact when the durable write fails',async()=>{
    const {state,review}=fixture(),gate=deferred();let current=state;const publish=vi.fn((value:UserState)=>{current=value;});
    const pending=persistQueueChange(()=>current,publish,value=>removeQueuedArchive(value,state.archiveQueue![0].id),async()=>gate.promise);
    current={...current,reviews:[review]};const during=current;gate.reject(Error('SQLite write failed'));
    await expect(pending).rejects.toThrow('SQLite write failed');expect(publish).not.toHaveBeenCalled();expect(current).toBe(during);expect(current.archiveQueue).toHaveLength(3);
  });
  it('performs all fallible queue validation before writing or publishing anything',async()=>{
    const {state}=fixture(),write=vi.fn(async()=>{}),publish=vi.fn();
    await expect(persistQueueChange(()=>state,publish,()=>{throw Error('Queue capacity exceeded');},write)).rejects.toThrow('Queue capacity');
    await expect(persistQueueChange(()=>state,publish,()=>({state,activated:true}),write)).rejects.toThrow('冻结快照缺失');
    await expect(persistLatestState(()=>null,write)).rejects.toThrow('尚未载入');expect(write).not.toHaveBeenCalled();expect(publish).not.toHaveBeenCalled();
  });
});
