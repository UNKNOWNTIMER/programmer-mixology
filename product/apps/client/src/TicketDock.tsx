import { Localized, useI18n } from './i18n';
import { recipeName } from './recipe-i18n';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Recipe, Target } from './types';
import { notifyTicketChange, setActiveSession, TICKET_SYNC_EVENT, useAppSession } from './session-store';
import { acknowledgeOrder, captureOrder, matchingServing, pendingStorageKey, readPendingOrder, type PendingOrder, type ServingMenuItem, type TicketOrder, type TicketStatus } from './ticket-state';
import './ticket-dock.css';
import { ArchiveLogo, type ArchiveDragGesture } from './ArchiveLogo';
import { ArchiveQueueMenu, type ArchiveQueueItem } from './ArchiveQueueMenu';
export type { TicketOrder } from './ticket-state';
const native = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const jsonRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const orderName = (order: TicketOrder) => String(jsonRecord(order.snapshot.serving_spec).name || '已提交订单');
const guestName = (order: TicketOrder) => String(jsonRecord(order.snapshot.guest).display_name || '客人');
const statusLabels: Record<string, string> = { received: '待接单', accepted: '已接单', mixing: '制作中', ready: '可领取', completed: '完成', rejected: '已拒绝', cancelled: '已取消' };

function Stamp({ order, busy, onOpen }: { order: TicketOrder; busy: boolean; onOpen: () => void }) {
  const gesture = useRef<{ x: number; width: number; distance: number } | null>(null), suppress = useRef(false);
  const [distance, setDistance] = useState(0);
  return <Localized><button type="button" className={`dock-stamp ${order.stamp_open ? 'is-open' : ''}`} disabled={busy}
    aria-label={`撕开订单 ${orderName(order)} ${guestName(order)}`} title="拖开35%或按 Enter 阅读；不接单、不扣票"
    style={{ transform: distance ? `translateX(${Math.min(distance, 35)}px)` : undefined }}
    onPointerDown={event => { gesture.current = { x: event.clientX, width: event.currentTarget.getBoundingClientRect().width, distance: 0 }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (gesture.current) { gesture.current.distance = Math.abs(event.clientX - gesture.current.x); setDistance(gesture.current.distance); } }}
    onPointerUp={() => { const current = gesture.current; gesture.current = null; setDistance(0); if (!current) return; suppress.current = current.distance > 6; if (current.distance >= current.width * .35) onOpen(); }}
    onPointerCancel={() => { gesture.current = null; setDistance(0); suppress.current = true; }}
    onClick={event => { if (suppress.current && event.detail !== 0) { suppress.current = false; return; } suppress.current = false; onOpen(); }}>
    <span className="dock-stamp-corner" aria-hidden="true">↗</span><strong data-i18n="verbatim">{guestName(order)}</strong><span data-i18n="verbatim">{orderName(order)}</span><small>{statusLabels[order.status] || order.status}</small>
  </button></Localized>;
}

export function TicketDock({ recipe, target, reducedMotion = false, onManage, onOpenOrder, onArchiveDrag, archiveQueue = [], onArchiveRemove, onArchiveReorder, onQueueArchiveDrag, archiveImportSequence = 0 }: { recipe: Recipe; target: Target; reducedMotion?: boolean; onManage: () => void; onOpenOrder?: (order: TicketOrder) => void; onArchiveDrag?:(gesture:ArchiveDragGesture)=>Promise<void>; archiveQueue?:readonly ArchiveQueueItem[]; onArchiveRemove?:(id:string)=>void|Promise<void>; onArchiveReorder?:(id:string,beforeId:string|null)=>void|Promise<void>; onQueueArchiveDrag?:(id:string,gesture:ArchiveDragGesture)=>Promise<void>; archiveImportSequence?:number }) {
  const {language}=useI18n();
  const app = useAppSession();
  const session = app.active === 'remote' ? app.remote : app.local;
  const account = session?.account_id, channel = app.active;
  const [menu, setMenu] = useState<ServingMenuItem[]>([]), [tickets, setTickets] = useState<TicketStatus | null>(null);
  const [orders, setOrders] = useState<TicketOrder[]>([]), [pending, setPending] = useState<PendingOrder | null>(null);
  const [syncError, setSyncError] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false), [acknowledging, setAcknowledging] = useState(false), [opening, setOpening] = useState('');
  const [fallbackOrder, setFallbackOrder] = useState<TicketOrder | null>(null);
  const [queueOpen, setQueueOpen] = useState(archiveQueue.length > 0);
  const queueToggle = useRef<HTMLButtonElement>(null), queueWasEmpty = useRef(archiveQueue.length === 0), previousImport = useRef(archiveImportSequence);
  const submittingRef = useRef(false), openingRef = useRef(false), ackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = account && (channel === 'local' || app.remoteIdentity) ? pendingStorageKey(channel, account, app.remoteIdentity?.host_id) : null;
  const admin = channel === 'local' && session?.role === 'admin';
  const serving = matchingServing(menu, recipe);
  const pendingMatches = Boolean(pending && pending.recipe_revision_id === recipe.recipe_revision_id);
  const ready = session?.role === 'guest' && !!serving && !!tickets?.serving_enabled && tickets.available > 0 && !syncError;
  const canSubmit = session?.role === 'guest' && (pendingMatches || ready) && !(pending && !pendingMatches) && !submitting && !acknowledging;

  useEffect(() => {
    if (archiveQueue.length && (queueWasEmpty.current || archiveImportSequence !== previousImport.current)) setQueueOpen(true);
    queueWasEmpty.current = archiveQueue.length === 0;
    previousImport.current = archiveImportSequence;
  }, [archiveQueue.length, archiveImportSequence]);
  useEffect(() => () => clearTimeout(ackTimer.current), []);
  useEffect(() => {
    setMenu([]); setTickets(null); setError(''); setNotice(''); setSyncError(''); setPending(null);
    if (!native || session?.role !== 'guest' || !key) return;
    let active = true, inFlight = false;
    const sync = async () => {
      if (inFlight) return; inFlight = true;
      try {
        const saved = readPendingOrder(localStorage, key); if (active) setPending(saved);
        const request = <T,>(operation: string) => channel === 'remote' ? invoke<T>('guest_call', { operation, payload: {} }) : invoke<T>('host_call', { operation, session: app.local?.token, payload: {} });
        const [nextMenu, nextTickets] = await Promise.all([request<ServingMenuItem[]>('catalog'), request<TicketStatus>('ticket_status')]);
        if (active) { setMenu(nextMenu); setTickets(nextTickets); setSyncError(''); }
      } catch (reason) { if (active) { setTickets(null); setSyncError(String(reason)); } }
      finally { inFlight = false; }
    };
    const refresh = () => { void sync(); }; refresh(); const timer = setInterval(refresh, 8000);
    window.addEventListener(TICKET_SYNC_EVENT, refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener(TICKET_SYNC_EVENT, refresh); };
  }, [channel, account, session?.role, app.local?.token, app.remoteIdentity?.host_id, key]);
  useEffect(() => {
    setOrders([]);
    if (!native || app.local?.role !== 'admin') return;
    let active = true, inFlight = false;
    const refresh = async () => {
      if (inFlight) return; inFlight = true;
      try { const actual = await invoke<TicketOrder[]>('host_call', { operation: 'admin_orders', session: app.local!.token, payload: {} }); if (active) setOrders(actual); }
      catch (reason) { if (active) setError(`主机订单未同步：${String(reason)}`); }
      finally { inFlight = false; }
    };
    const sync = () => { void refresh(); }; sync(); const timer = setInterval(sync, 6000); window.addEventListener(TICKET_SYNC_EVENT, sync);
    return () => { active = false; clearInterval(timer); window.removeEventListener(TICKET_SYNC_EVENT, sync); };
  }, [app.local?.token, app.local?.role]);

  async function submit() {
    if (submittingRef.current || !canSubmit || !key || !session) return;
    submittingRef.current = true; setSubmitting(true); setError(''); setNotice('');
    try {
      const retained = readPendingOrder(localStorage, key);
      if (retained && retained.recipe_revision_id !== recipe.recipe_revision_id) throw Error('仍有另一份配方的原请求未确认，请先核查。');
      if (!retained && !serving) throw Error('当前版本没有主机已审核的操作规格。');
      // Capture request and target durably before issuing a command. Never regenerate an ID after a timeout.
      const captured = retained || captureOrder(localStorage, key, serving!, target);
      setPending(captured);
      const result = channel === 'remote'
        ? await invoke<TicketOrder>('guest_call', { operation: 'place_order', payload: captured })
        : await invoke<TicketOrder>('host_call', { operation: 'place_order', session: app.local!.token, payload: captured });
      acknowledgeOrder(localStorage, key, captured, result);
      setPending(null); setTickets(null); setAcknowledging(true);
      setNotice(`主机已确认 · ${result.id.slice(0, 8)}`);
      // This animation is reached only after an authoritative committed response.
      clearTimeout(ackTimer.current); ackTimer.current = setTimeout(() => setAcknowledging(false), reducedMotion ? 0 : 1000);
      notifyTicketChange();
    } catch (reason) { setError(`尚未取得提交确认；沿用原编号重试。${String(reason)}`); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }
  async function open(order: TicketOrder) {
    if (openingRef.current || app.local?.role !== 'admin') return;
    openingRef.current = true; setOpening(order.id); setError('');
    try {
      await invoke('host_call', { operation: 'open_stamp', session: app.local.token, payload: { order_id: order.id } });
      const viewed = { ...order, stamp_open: true }; setOrders(current => current.map(row => row.id === order.id ? viewed : row));
      if (onOpenOrder) onOpenOrder(viewed); else setFallbackOrder(viewed);
    } catch (reason) { setError(`订单尚未打开：${String(reason)}`); }
    finally { openingRef.current = false; setOpening(''); }
  }
  const explanation = !native ? '请在本机应用查看真实票据' : !session ? '登录后读取主机票据' : admin ? `${orders.length} 封订单 · ${orders.filter(order => !order.stamp_open).length} 封未读` : pending && !pendingMatches ? '另有待确认请求 · 先核查原单' : pendingMatches ? '原请求待确认 · 点击沿用编号' : syncError ? '主机状态未确认 · 可重新同步' : !serving ? '当前配方尚无审核规格' : tickets && !tickets.serving_enabled ? '主机暂未开放点单' : tickets ? `可用 ${tickets.available} 张 · 主机时间核验` : '正在读取主机票据';
  return <Localized><section className={`ticket-dock ${admin ? 'is-host' : ''} ${queueOpen ? 'queue-open' : ''} ${reducedMotion ? 'reduce-motion' : ''}`} aria-label="票据与订单" data-testid="ticket-dock" onKeyDown={event => { if (queueOpen && event.key === 'Escape') { event.stopPropagation(); setQueueOpen(false); queueToggle.current?.focus(); } }}>
    <header><ArchiveLogo onDrag={onArchiveDrag} importSequence={archiveImportSequence} reducedMotion={reducedMotion}><img className="host-archive-logo" src="/assets/timer-logo.png" alt="拖出 TIMER 存档" draggable={false}/></ArchiveLogo><span className="dock-session-mark" aria-label={admin ? '主机邮票' : '票据与会话'} aria-live="polite">{admin ? '✉' : '◉'}</span><button ref={queueToggle} className="archive-queue-toggle" type="button" data-testid="archive-queue-toggle" aria-expanded={queueOpen} aria-controls="archive-queue-menu" onClick={() => setQueueOpen(open => !open)}><span>队列</span><b>{archiveQueue.length}</b><span aria-hidden="true">{queueOpen ? '▴' : '▾'}</span></button><button type="button" onClick={onManage} aria-label="管理会话和票据" title="管理会话和票据">↗</button></header>
    {queueOpen ? <ArchiveQueueMenu items={archiveQueue} onRemove={onArchiveRemove} onReorder={onArchiveReorder} onDragOut={onQueueArchiveDrag} reducedMotion={reducedMotion}/> : admin ? <div className="dock-stamps" aria-label="真实主机订单邮票">{orders.length ? orders.slice(0, 8).map(order => <Stamp order={order} key={order.id} busy={opening === order.id} onOpen={() => void open(order)} />) : <div className="dock-empty-stamps"><ArchiveLogo onDrag={onArchiveDrag} importSequence={archiveImportSequence} reducedMotion={reducedMotion}><img src="/assets/timer-logo.png" alt="TIMER" draggable={false}/></ArchiveLogo><span>等待真实订单<br/><small>设置关闭后继续同步</small></span></div>}</div> : <div className="dock-ticket-body">
      <ArchiveLogo onDrag={onArchiveDrag} importSequence={archiveImportSequence} reducedMotion={reducedMotion}><button type="button" className={`dock-logo ${ready && !acknowledging ? 'is-ready' : ''} ${pendingMatches ? 'is-retry' : ''} ${acknowledging ? 'is-confirmed' : ''}`} aria-label={pendingMatches ? '以原请求编号重试票据点单' : '使用票据提交当前审核配方一份'} disabled={!canSubmit} onClick={() => void submit()} data-state={acknowledging ? 'confirmed' : submitting ? 'submitting' : pendingMatches ? 'retry' : ready ? 'ready' : 'inactive'}>
        <img src="/assets/timer-logo.png" alt="TIMER 票据标识" /><span>{submitting ? '提交中' : acknowledging ? '已确认' : pendingMatches ? '原单重试' : ready ? '提交 1 份' : '未启用'}</span>
      </button></ArchiveLogo>
      <div className="dock-ticket-copy" title={`${explanation}；只有主机确认后才扣票并播放动画`}><strong data-i18n="verbatim">{session?.role === 'guest' ? serving?.name || recipeName(recipe,language) : 'TIMER'}</strong>{session?.role === 'guest' && <p>{pendingMatches ? '原单待确认' : tickets ? `${tickets.available} 张可用` : '同步中'}</p>}{ready && <small>1 份 / 1 票</small>}</div>
    </div>}
    <footer><span title={notice || error || syncError || explanation}>{error || notice || (session ? explanation : '')}</span><div>
      {app.local && app.remote && <button type="button" disabled={submitting} onClick={() => setActiveSession(channel === 'local' ? 'remote' : 'local')}>{channel === 'local' ? '远程客人' : '本机会话'}</button>}
      <button type="button" disabled={submitting} onClick={() => { setError(''); notifyTicketChange(); }} aria-label="重新同步主机票据与订单">↻</button>
    </div></footer>
    {error && <span className="dock-sr-only" role="alert">{error}</span>}{notice && <span className="dock-sr-only" role="status">{notice}</span>}
    {fallbackOrder && <OrderStampOverlay order={fallbackOrder} onClose={() => setFallbackOrder(null)} />}
  </section></Localized>;
}

export function OrderStampOverlay({ order, onClose }: { order: TicketOrder; onClose: () => void }) {
  const {t}=useI18n();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { const before = document.activeElement as HTMLElement | null; close.current?.focus(); return () => before?.focus(); }, []);
  const spec = jsonRecord(order.snapshot.serving_spec), physical = jsonRecord(order.snapshot.physical);
  const parts = Array.isArray(spec.parts) ? spec.parts.map(jsonRecord) : [], skus = Array.isArray(order.snapshot.sku_snapshot) ? order.snapshot.sku_snapshot.map(jsonRecord) : [];
  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  return <Localized><section className="order-stamp-overlay" role="region" aria-label="不可变订单快照" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <header><div><small>HOST RECEIPT / 只读邮票</small><h3 data-i18n="verbatim">{orderName(order)}</h3></div><button ref={close} type="button" onClick={onClose} aria-label="关闭订单快照">×</button></header>
    <p className="stamp-read-note">撕开仅供阅读。制作状态仍是「{statusLabels[order.status] || order.status}」，不会接单、再扣票或删除。</p>
    <dl><dt>客人</dt><dd data-i18n="verbatim">{guestName(order)}</dd><dt>订单</dt><dd>{order.id}</dd><dt>主机接收</dt><dd>{new Date(order.created_at * 1000).toLocaleString()}</dd><dt>版本</dt><dd>{String(spec.recipe_revision_id || '未提供')}</dd></dl>
    <h4>已冻结材料</h4><ul>{parts.map((part, index) => { const sku = skus.find(item => item.id === part.sku_id); return <li key={`${String(part.sku_id)}-${index}`}><span data-i18n="verbatim">{String(sku?.label || part.ingredient_id)}<small>SKU {String(part.sku_id)} · {String(part.stage)}</small></span><b>{typeof part.quantity_ml === 'number' ? `${part.quantity_ml} ml` : '未知'}</b></li>; })}</ul>
    <h4>调制步骤</h4><ol>{steps.map((step, index) => <li key={index} data-i18n="verbatim">{String(step)}</li>)}</ol>
    <p>客人备注：<span data-i18n="verbatim">{String(order.snapshot.guest_note || t('无'))}</span></p><p>杯型：<span data-i18n="verbatim">{String(spec.glass || t('未知'))}</span> · 冰：<span data-i18n="verbatim">{String(spec.ice || t('未知'))}</span></p>
    <p>成杯酒精度：{typeof physical.served_abv_fraction === 'number' ? `${(physical.served_abv_fraction * 100).toFixed(1)}%` : '资料不足'} · 热量：{typeof physical.kcal === 'number' ? `${physical.kcal} kcal` : '资料不足'}</p>
    <details><summary>目标、预测、过敏原与全部审计快照</summary><pre>{JSON.stringify(order.snapshot, null, 2)}</pre></details>
  </section></Localized>;
}
