import type { Recipe, Target } from './types';
export interface ServingMenuItem { id: string; recipe_revision_id: string; name: string; source_recipe?: Record<string, unknown> }
export interface TicketRecord { window_id: string; quota: number; spent: number; starts: number; expires: number }
export interface TicketStatus { server_now: number; available: number; serving_enabled: boolean; tickets: TicketRecord[] }
export interface TicketOrder { id: string; guest_id: string; request_id: string; snapshot: Record<string, unknown>; status: string; version: number; created_at: number; stamp_open: boolean }
export interface PendingOrder { protocol_version: 1; request_id: string; recipe_revision_id: string; serving_spec_id: string; target_profile: Target; units_count: 1; guest_note: string }
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export function pendingStorageKey(channel: 'local' | 'remote', account: string, host?: string) {
  if (!account || channel === 'remote' && !host) throw Error('点单身份不完整。');
  return channel === 'local' ? `pixelmix.pending-order.${account}` : `pixelmix.remote-pending.${host}.${account}`;
}
export function matchingServing(menu: ServingMenuItem[], recipe: Recipe): ServingMenuItem | undefined {
  if (!recipe.recipe_revision_id || recipe.source.kind === 'generated_trial' || recipe.source.kind === 'generated') return undefined;
  return menu.find(spec => spec.recipe_revision_id === recipe.recipe_revision_id && (!spec.source_recipe?.source_id || spec.source_recipe.source_id === recipe.id));
}
export function readPendingOrder(storage: StorageLike, key: string): PendingOrder | null {
  const saved = storage.getItem(key); if (!saved) return null;
  if (saved.length > 65536) throw Error('保留请求超过大小上限。请核查原请求，不能自动更换编号。');
  let value: PendingOrder;
  try { value = JSON.parse(saved) as PendingOrder; } catch { throw Error('本机保留的原订单请求无法读取。请先核查原请求，不能另建扣票编号。'); }
  if (!value || value.protocol_version !== 1 || value.units_count !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.request_id) || !value.recipe_revision_id || !value.serving_spec_id || !value.target_profile || !Array.isArray(value.target_profile.taste_bps) || value.target_profile.taste_bps.length !== 5 || value.target_profile.taste_bps.some(x => !Number.isInteger(x) || x < 0 || x > 10000) || value.target_profile.taste_bps.reduce((a, b) => a + b, 0) !== 10000 || !Array.isArray(value.target_profile.sensory_0_10) || value.target_profile.sensory_0_10.length !== 7 || value.target_profile.sensory_0_10.some(x => !Number.isFinite(x) || x < 0 || x > 10) || typeof value.guest_note !== 'string' || value.guest_note.length > 300) throw Error('保留请求未通过格式校验。请核查原请求，不能自动丢弃并重新扣票。');
  return value;
}
/** Persist synchronously BEFORE the first network await. A failed acknowledgement never changes the UUID. */
export function captureOrder(storage: StorageLike, key: string, spec: ServingMenuItem, target: Target, note = '', uuid: () => string = () => crypto.randomUUID()): PendingOrder {
  const prior = readPendingOrder(storage, key);
  if (prior) {
    if (prior.recipe_revision_id !== spec.recipe_revision_id || prior.serving_spec_id !== spec.id) throw Error('另一份配方仍有未确认请求。请先在主机面板核查原请求。');
    return prior;
  }
  const captured: PendingOrder = { protocol_version: 1, request_id: uuid(), recipe_revision_id: spec.recipe_revision_id, serving_spec_id: spec.id, target_profile: structuredClone(target), units_count: 1, guest_note: note };
  const json = JSON.stringify(captured);
  readPendingOrder({ getItem: () => json, setItem: () => {}, removeItem: () => {} }, key);
  storage.setItem(key, json);
  return readPendingOrder(storage, key)!;
}
export function acknowledgeOrder(storage: StorageLike, key: string, request: PendingOrder, order: TicketOrder) {
  const spec = order.snapshot?.serving_spec as Record<string, unknown> | undefined;
  if (!order.id || order.request_id !== request.request_id || !order.snapshot || order.snapshot.units_count !== 1 || spec?.id !== request.serving_spec_id || spec?.recipe_revision_id !== request.recipe_revision_id) throw Error('主机响应与原请求不一致，保留请求等待核查。');
  const prior = readPendingOrder(storage, key);
  if (prior?.request_id === request.request_id) storage.removeItem(key);
}
