import type { QueueChange } from './archive-queue';
import type { UserState } from './types';

type ReadState=()=>UserState|null;
type WriteState=(state:UserState)=>Promise<void>;

/** Called inside the ordered writer, not when the user initially starts a save. */
export async function persistLatestState(read:ReadState,write:WriteState):Promise<void> {
  const state=read();if(!state)throw Error('工作台尚未载入。');
  await write(state);
}

/** Queue edits are serialized by the caller. Validate once before the durable
 * write; after success only merge that committed result, never rerun a fallible
 * operation against edits made while SQLite was writing. */
export async function persistQueueChange(read:ReadState,publish:(state:UserState)=>void,operation:(state:UserState)=>QueueChange,write:WriteState):Promise<QueueChange> {
  const before=read();if(!before)throw Error('工作台尚未载入。');
  const change=operation(before);
  const activated=change.activated?change.state.generatedTrials?.find(trial=>trial.recipe.id===change.state.selected):undefined;
  if(change.activated&&!activated)throw Error('后续酒谱的冻结快照缺失。');
  await write(change.state);
  const current=read()||before;
  let state=change.state;
  if(current!==before){
    state={...current,archiveQueue:change.state.archiveQueue};
    if(activated){
      // A successful head completion deliberately reads the next frozen serving.
      state={...state,selected:change.state.selected,target:change.state.target,locked:change.state.locked,
        generatedTrials:[...(current.generatedTrials||[]).filter(trial=>trial.recipe.id!==change.state.selected).slice(-3),activated]};
    }
  }
  publish(state);
  return {state,activated:change.activated};
}
