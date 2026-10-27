import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

/**
 * State for event/IPC coordination: every dispatch updates the canonical ref
 * immediately, while React may batch the visible commit. Updaters must be pure;
 * callers must use this dispatcher instead of writing the ref independently.
 * Keep this for ordinary workbench state, not deferred transition state.
 */
export function useCurrentState<T>(initial: T | (() => T)): readonly [T, Dispatch<SetStateAction<T>>, RefObject<T>] {
  const [value, setValue] = useState<T>(initial);
  const current = useRef(value);
  const dispatch = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    // Evaluate before changing the ref: a failed validation leaves state intact.
    const next = typeof action === 'function' ? (action as (previous: T) => T)(current.current) : action;
    current.current = next;
    // A function-valued T is a value here, not another updater to execute.
    setValue(() => next);
  }, []);
  return [value, dispatch, current] as const;
}
