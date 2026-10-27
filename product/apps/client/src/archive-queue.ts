import type { ValidatedArchive } from './archive-bridge';
import type { ArchiveQueueEntry, UserState } from './types';

export const ARCHIVE_QUEUE_LIMIT = 20;
// SQLite settings allow 256 KiB. Leave room for ordinary controls and settings.
export const ARCHIVE_QUEUE_STATE_BYTES = 240 * 1024;
export interface QueueChange { state:UserState; activated:boolean }
const FIFO_SPACE_ERROR='本机存档队列空间不足；读取后续快照会超过保存上限，请先移除后面的存档。';

function activate(state:UserState, entry:ArchiveQueueEntry):UserState {
  return {...state, selected:entry.personal.recipe.id, target:structuredClone(entry.target), locked:[],
    generatedTrials:[...(state.generatedTrials||[]).filter(t=>t.recipe.id!==entry.personal.recipe.id).slice(-3), structuredClone(entry.personal)]};
}

function assertStateBudget(state:UserState,message:string):void {
  if(new TextEncoder().encode(JSON.stringify(state)).byteLength>ARCHIVE_QUEUE_STATE_BYTES)throw Error(message);
}

/** Activation also retains a working copy. Reserve for every later FIFO state,
 * including its real trial-cache deduplication, rather than only the queued bytes. */
function assertFifoBudget(state:UserState):void {
  const queue=state.archiveQueue||[];
  let future=state;
  for(let head=1;head<queue.length;head++){
    future=activate({...future,archiveQueue:queue.slice(head)},queue[head]);
    assertStateBudget(future,FIFO_SPACE_ERROR);
  }
}

function appendArchive(state:UserState, archive:ValidatedArchive, importedAt:string, activateFirst:boolean):QueueChange {
  // Each deliberate addition is another serving. Archive identity remains provenance,
  // while queue identity belongs to this individual import occurrence.
  const queue=state.archiveQueue||[], id=crypto.randomUUID();
  if(queue.length>=ARCHIVE_QUEUE_LIMIT)throw Error(`存档队列已满（${ARCHIVE_QUEUE_LIMIT} 杯），请先完成或移除一杯。`);
  const entry:ArchiveQueueEntry={id,archiveId:archive.archive_id,sha256:archive.sha256,importedAt,personal:structuredClone(archive.personal),target:structuredClone(archive.target)};
  let next:UserState={...state,archiveQueue:[...queue,entry]};
  const activated=activateFirst&&!queue.length;
  if(activated)next=activate(next,entry);
  assertStateBudget(next,'本机存档队列空间不足；请先完成或移除队列中的存档，再导入。');
  assertFifoBudget(next);
  return {state:next,activated};
}

/** A queue is local work-in-progress, never a host order or an approval. */
export function enqueueArchive(state:UserState, archive:ValidatedArchive, importedAt=new Date().toISOString()):QueueChange {
  return appendArchive(state,archive,importedAt,true);
}

/** Add a serving of the current drink without replacing its workbench or user controls. */
export function enqueueCurrentArchive(state:UserState, archive:ValidatedArchive, queuedAt=new Date().toISOString()):QueueChange {
  return appendArchive(state,archive,queuedAt,false);
}

/** Move one serving before another (null appends). Identity belongs to the queue
 * occurrence, so repeated recipes remain independent. Reordering never activates
 * a drink or rewrites a frozen recipe, its target, or the current workbench. */
export function reorderQueuedArchive(state:UserState, id:string, beforeId:string|null):QueueChange {
  const queue=state.archiveQueue||[], index=queue.findIndex(entry=>entry.id===id);
  if(index<0||beforeId===id||(beforeId!==null&&!queue.some(entry=>entry.id===beforeId)))return {state,activated:false};
  const remaining=queue.filter(entry=>entry.id!==id);
  const destination=beforeId===null?remaining.length:remaining.findIndex(entry=>entry.id===beforeId);
  remaining.splice(destination,0,queue[index]);
  if(remaining.every((entry,n)=>entry===queue[n]))return {state,activated:false};
  const next={...state,archiveQueue:remaining};
  // A different order can change the trial-cache peak during later completions.
  assertStateBudget(next,FIFO_SPACE_ERROR);
  assertFifoBudget(next);
  return {state:next,activated:false};
}

/** Finishing the head advances FIFO; cancelling a later item never changes the workbench. */
export function removeQueuedArchive(state:UserState, id:string):QueueChange {
  const queue=state.archiveQueue||[], index=queue.findIndex(entry=>entry.id===id);
  if(index<0)return {state,activated:false};
  const remaining=queue.filter(entry=>entry.id!==id);
  let next:UserState={...state,archiveQueue:remaining};
  if(index===0&&remaining.length)next=activate(next,remaining[0]);
  // Old persisted queues and workbench changes may predate the enqueue check.
  // Reject this transition without deleting its head; later entries can still be
  // removed individually to recover space, without requiring all future states to fit.
  assertStateBudget(next,FIFO_SPACE_ERROR);
  return {state:next,activated:index===0&&remaining.length>0};
}
