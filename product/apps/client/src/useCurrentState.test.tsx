import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';

// Deterministically model React's deferred state queue. No DOM, application
// bridge, SQLite or native process is used; production hook/queue functions run.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, pending: [] as (() => void)[] }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.index++;
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      const set = (action: SetStateAction<T>) => hooks.pending.push(() => {
        const prior = hooks.values[index] as T;
        // Development StrictMode may evaluate React updaters twice. The domain
        // updater must already have run exactly once at the dispatcher boundary.
        if (typeof action === 'function') (action as (prior: T) => T)(prior);
        hooks.values[index] = typeof action === 'function' ? (action as (prior: T) => T)(prior) : action;
      });
      return [hooks.values[index], set];
    },
    useRef: <T,>(initial: T) => {
      const index = hooks.index++;
      if (!(index in hooks.values)) hooks.values[index] = { current: initial };
      return hooks.values[index];
    },
    useCallback: <T,>(callback: T) => {
      const index = hooks.index++;
      if (!(index in hooks.values)) hooks.values[index] = callback;
      return hooks.values[index];
    },
  };
});
import { useCurrentState } from './useCurrentState';
import { enqueueCurrentArchive, removeQueuedArchive } from './archive-queue';
import type { ValidatedArchive } from './archive-bridge';
import type { Profile, Recipe, UserState } from './types';
import recipes from '../public/seed/recipes.json';
import profiles from '../public/seed/profiles.seed.json';

beforeEach(() => { hooks.values = []; hooks.pending = []; hooks.index = 0; });
function harness<T>(initial: T | (() => T)) {
  const render = () => { hooks.index = 0; return useCurrentState<T>(initial); };
  const commit = (count = hooks.pending.length) => { for (let n = 0; n < count; n++) hooks.pending.shift()?.(); return render(); };
  return { render, commit };
}
function fixture() {
  const recipe = structuredClone(recipes.recipes[0]) as Recipe;
  const profile = structuredClone(profiles.profiles.find(p => p.recipe_id === recipe.id)) as unknown as Profile;
  const target = { taste_bps: [2000, 2000, 2000, 2000, 2000], sensory_0_10: [1, 1, 1, 1, 1, 1, 1] } as UserState['target'];
  const state: UserState = { version: 1, selected: recipe.id, target, locked: [], favorites: [], reviews: [], inventory: [], excluded: [], inventoryOnly: false, settings: { reducedMotion: false, fontScale: 1.25 }, drafts: [], archiveQueue: [] };
  const archive: ValidatedArchive = { archive_id: 'saved-on-click', sha256: 'digest', snapshot: { recipe, profile, target }, target: structuredClone(target), personal: { recipe: { ...recipe, id: 'imported-copy', default_orderable: false, source: { ...recipe.source, kind: 'imported_snapshot' } }, profile: { ...profile, recipe_id: 'imported-copy', measured: false }, created_at: '2026-09-22T00:00:00Z', audit: {} }, guest_orderable: false, authority_restored: false };
  return { state, archive };
}

describe('synchronous canonical workbench state before React commits', () => {
  it('merges queued functional updates immediately and preserves stable dispatcher/ref identities', () => {
    const initialize = vi.fn(() => ({ count: 0 })), h = harness(initialize);
    const [painted, set, ref] = h.render();
    set(v => ({ count: v.count + 1 })); set(v => ({ count: v.count + 1 }));
    expect(painted.count).toBe(0); expect(ref.current.count).toBe(2);
    const [committed, sameSet, sameRef] = h.commit();
    expect(committed.count).toBe(2); expect(sameSet).toBe(set); expect(sameRef).toBe(ref); expect(initialize).toHaveBeenCalledOnce();
  });

  it('does not overwrite a newer ref when an older visible update commits first', () => {
    const h = harness(0), [, set, ref] = h.render();
    set(1); set(2); set(3);
    expect(h.commit(1)[0]).toBe(1); expect(ref.current).toBe(3);
    expect(h.commit()[0]).toBe(3); expect(ref.current).toBe(3);
  });

  it('applies domain updaters once and keeps both state channels unchanged after a validation error', () => {
    const h = harness({ count: 2 }), [, set, ref] = h.render(), action = vi.fn(v => ({ count: v.count + 1 }));
    set(action); h.commit(); expect(action).toHaveBeenCalledOnce();
    const before = ref.current;
    expect(() => set(() => { throw Error('Queue full'); })).toThrow('Queue full');
    expect(ref.current).toBe(before); expect(hooks.pending).toHaveLength(0); expect(h.render()[0]).toBe(before);
  });

  it('retains function-valued states instead of calling the stored value', () => {
    const first = vi.fn(() => 1), second = vi.fn(() => 2), h = harness<() => number>(() => first);
    const [, set, ref] = h.render(); set(() => second);
    expect(ref.current).toBe(second); expect(h.commit()[0]).toBe(second);
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
  });

  it('preserves uncommitted slider edits and queue deletion when an archive IPC completes', async () => {
    const { state, archive } = fixture(), pendingState = enqueueCurrentArchive(state, archive).state;
    const h = harness(pendingState), [, set, ref] = h.render(), clickedTarget = structuredClone(ref.current.target);
    let resolve!: (value: ValidatedArchive) => void;
    const ipc = new Promise<ValidatedArchive>(done => { resolve = done; });
    const writes: UserState[] = [];
    const completion = (async () => {
      const imported = await ipc;
      const next = enqueueCurrentArchive(ref.current, imported).state;
      set(next); writes.push(next);
    })();
    set(u => ({ ...u, target: { ...u.target, sensory_0_10: [9, 1, 1, 1, 1, 1, 1] } }));
    const oldHead = ref.current.archiveQueue![0].id;
    set(u => removeQueuedArchive(u, oldHead).state);
    set(u => ({ ...u, selected: 'new-library-selection', favorites: ['new-favorite'] }));
    resolve(archive); await completion;
    const committed = h.commit()[0];
    expect(committed.target.sensory_0_10[0]).toBe(9);
    expect(committed.selected).toBe('new-library-selection'); expect(committed.favorites).toEqual(['new-favorite']);
    expect(committed.archiveQueue).toHaveLength(1); expect(committed.archiveQueue![0].id).not.toBe(oldHead);
    expect(committed.archiveQueue![0].target).toEqual(clickedTarget);
    expect(writes[0]).toEqual(committed); expect(ref.current).toBe(committed);
  });
});
