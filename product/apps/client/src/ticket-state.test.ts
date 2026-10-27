import { afterEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeOrder, captureOrder, matchingServing, pendingStorageKey, readPendingOrder, type StorageLike, type TicketOrder } from './ticket-state';
import { getAppSession, setActiveSession, setLocalSession, setRemoteIdentity, setRemoteSession } from './session-store';
import type { Recipe, Target } from './types';
const target: Target = { taste_bps: [4000, 3000, 2000, 500, 500], sensory_0_10: [5, 6, 4, 0, 1, 0, 5] };
const spec = { id: 'reviewed-1', recipe_revision_id: 'source-r1', name: 'Reviewed', source_recipe: { source_id: 'source-recipe' } };
const id = '12345678-1234-1234-1234-123456789012';
function storage(): StorageLike { const rows = new Map<string, string>(); return { getItem: key => rows.get(key) ?? null, setItem: (key, value) => { rows.set(key, value); }, removeItem: key => { rows.delete(key); } }; }
function receipt(requestId = id): TicketOrder { return { id: 'host-order', guest_id: 'guest', request_id: requestId, snapshot: { units_count: 1, serving_spec: { id: spec.id, recipe_revision_id: spec.recipe_revision_id }, target_profile: target }, status: 'received', version: 1, created_at: 1234, stamp_open: false }; }
describe('ticket request custody', () => {
  it('persists before transport and reuses the original target and UUID after a failure', () => {
    const store = storage(), source = structuredClone(target), uuid = vi.fn(() => id);
    const first = captureOrder(store, 'key', spec, source, '', uuid);
    expect(readPendingOrder(store, 'key')).toEqual(first);
    source.taste_bps = [10000, 0, 0, 0, 0];
    const retry = captureOrder(store, 'key', spec, source, 'later note', uuid);
    expect(retry).toEqual(first); expect(retry.target_profile).toEqual(target); expect(uuid).toHaveBeenCalledTimes(1);
  });
  it('cannot use an unresolved UUID for a different recipe or silently discard corrupt data', () => {
    const store = storage(); captureOrder(store, 'key', spec, target, '', () => id);
    expect(() => captureOrder(store, 'key', { ...spec, id: 'other-serving' }, target)).toThrow();
    store.setItem('broken', '{'); expect(() => captureOrder(store, 'broken', spec, target)).toThrow(); expect(store.getItem('broken')).toBe('{');
  });
  it('does not clear custody until the response identifies the committed original serving and request', () => {
    const store = storage(), request = captureOrder(store, 'key', spec, target, '', () => id);
    expect(() => acknowledgeOrder(store, 'key', request, receipt('other'))).toThrow(); expect(readPendingOrder(store, 'key')).not.toBeNull();
    const wrong = receipt(); (wrong.snapshot.serving_spec as Record<string, unknown>).id = 'other';
    expect(() => acknowledgeOrder(store, 'key', request, wrong)).toThrow(); expect(readPendingOrder(store, 'key')).not.toBeNull();
    acknowledgeOrder(store, 'key', request, receipt()); expect(store.getItem('key')).toBeNull();
  });
  it('requires writable persistence and valid 10000 basis-point targets before submission', () => {
    const store = storage(); expect(() => captureOrder(store, 'key', spec, { ...target, taste_bps: [0, 0, 0, 0, 0] }, '', () => id)).toThrow(); expect(store.getItem('key')).toBeNull();
    const failing = { ...storage(), setItem: () => { throw Error('quota exhausted'); } }; expect(() => captureOrder(failing, 'key', spec, target, '', () => id)).toThrow('quota exhausted');
  });
  it('matches the exact reviewed revision and source, never a generated draft or matching display name', () => {
    const recipe = { id: 'source-recipe', recipe_revision_id: 'source-r1', source: { kind: 'official_recipe' } } as Recipe;
    expect(matchingServing([spec], recipe)).toEqual(spec);
    expect(matchingServing([spec], { ...recipe, recipe_revision_id: 'source-r2' })).toBeUndefined();
    expect(matchingServing([spec], { ...recipe, id: 'different-source' })).toBeUndefined();
    expect(matchingServing([spec], { ...recipe, source: { ...recipe.source, kind: 'generated_trial' } })).toBeUndefined();
  });
  it('keeps pending records separated across accounts and paired hosts', () => {
    expect(pendingStorageKey('local', 'guest')).toBe('pixelmix.pending-order.guest');
    expect(pendingStorageKey('remote', 'guest', 'host1')).not.toBe(pendingStorageKey('remote', 'guest', 'host2'));
    expect(() => pendingStorageKey('remote', 'guest')).toThrow();
  });
});
describe('application-lifetime memory session custody', () => {
  afterEach(() => { setLocalSession(null); setRemoteSession(null); setRemoteIdentity(null); setActiveSession('local'); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('holds login across component lifetime without accessing browser storage and expires on time', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000); const touched = vi.fn(() => { throw Error('credentials must not be persisted'); }); vi.stubGlobal('localStorage', { getItem: touched, setItem: touched });
    setLocalSession({ token: 'secret-in-ram', account_id: 'guest', role: 'guest', expires_at: 1010 });
    expect(getAppSession().local?.token).toBe('secret-in-ram'); expect(touched).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000); expect(getAppSession().local).toBeNull();
  });
  it('a prior expiry cannot clear a later login and remote tokens stay in the native adapter', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    setLocalSession({ token: 'old', account_id: 'guest', role: 'guest', expires_at: 1010 });
    setLocalSession({ token: 'new', account_id: 'guest', role: 'guest', expires_at: 1020 });
    vi.advanceTimersByTime(10_000); expect(getAppSession().local?.token).toBe('new');
    setRemoteIdentity({ protocol_version: 1, host_id: 'host', address: '127.0.0.1:1234', certificate_pem: 'public', certificate_sha256: 'public' });
    setRemoteSession({ account_id: 'remote', role: 'guest', expires_at: 1020, token: 'do-not-store' } as Parameters<typeof setRemoteSession>[0]);
    expect(getAppSession().active).toBe('remote'); expect('token' in getAppSession().remote!).toBe(false);
    setRemoteIdentity(null); expect(getAppSession().remote).toBeNull(); expect(getAppSession().active).toBe('local');
  });
});
