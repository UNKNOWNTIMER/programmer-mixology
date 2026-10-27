import { Localized } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Catalog, Recipe, Target } from './types';
import { NetworkPanel } from './NetworkPanel';
import { useAppSession, getAppSession, setLocalSession, notifyTicketChange } from './session-store';
import { captureOrder, readPendingOrder, acknowledgeOrder, type TicketOrder, type TicketStatus } from './ticket-state';
import './host-panel.css';

type Json = Record<string, unknown>;
interface Session { token: string; account_id: string; role: string; expires_at: number }
interface HostStatus { initialized: boolean; host_id: string; transport: string; lan_listening: boolean; admin_account_id?: string; admin_id?: string }
interface Order { id: string; guest_id: string; request_id: string; snapshot: Json; status: string; version: number; created_at: number; stamp_open: boolean }
interface MenuItem { id: string; recipe_revision_id: string; name: string }
const nativeHost = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const statusName: Record<string, string> = { received: '待接单', accepted: '已接单', mixing: '制作中', ready: '可领取', completed: '完成', rejected: '已拒绝', cancelled: '已取消' };
const nextStates: Record<string, string[]> = { received: ['accepted', 'rejected', 'cancelled'], accepted: ['mixing', 'rejected', 'cancelled'], mixing: ['ready'], ready: ['completed'] };
const print = (value: unknown) => JSON.stringify(value, null, 2);
const initialSku = print({ id: '', ingredient_id: '', label: '', provenance: '', stock_ml: null, abv_fraction: null, maximum_dose_ml: null, food_grade: false, allergens_reviewed: false, allergens: [], carbonated: false });

function StampButton({ opened, disabled, onOpen }: { opened: boolean; disabled: boolean; onOpen: () => void }) {
  const drag = useRef<{ x: number; width: number; distance: number } | null>(null);
  const suppressClick = useRef(false);
  const [distance, setDistance] = useState(0);
  return <Localized><button className="host-tear" disabled={disabled} aria-label={opened ? '重新打开订单' : '打开订单，也可拖动邮票边角超过宽度35%'}
    style={{ transform: distance ? `translateX(${Math.min(distance, 80)}px)` : undefined }}
    onPointerDown={event => { if (disabled) return; drag.current = { x: event.clientX, width: event.currentTarget.getBoundingClientRect().width, distance: 0 }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (!drag.current) return; drag.current.distance = Math.abs(event.clientX - drag.current.x); setDistance(drag.current.distance); }}
    onPointerUp={() => { const gesture = drag.current; drag.current = null; setDistance(0); if (!gesture) return; suppressClick.current = gesture.distance > 6; if (gesture.distance >= gesture.width * .35) onOpen(); }}
    onPointerCancel={() => { drag.current = null; setDistance(0); suppressClick.current = true; }}
    onClick={event => { if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; } suppressClick.current = false; onOpen(); }}>
    {opened ? '重新打开订单' : '撕开邮票 / 打开订单'}<span aria-hidden="true"> ↗</span>
  </button></Localized>;
}

export function HostPanel({ recipe, target, catalog }: { recipe?: Recipe; target?: Target; catalog?: Catalog }) {
  const [status, setStatus] = useState<HostStatus | null>(null);
  const session = useAppSession().local;
  const setSession = setLocalSession;
  const [account, setAccount] = useState(() => localStorage.getItem('pixelmix.host.account') || '');
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState('订单');
  const [orders, setOrders] = useState<Order[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [tickets, setTickets] = useState<TicketStatus | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestPassword, setGuestPassword] = useState('');
  const [guestId, setGuestId] = useState('');
  const [guestExcluded, setGuestExcluded] = useState('');
  const [guestEthanol, setGuestEthanol] = useState(24);
  const [invitation, setInvitation] = useState('');
  const [pairId, setPairId] = useState('');
  const [pairSecret, setPairSecret] = useState('');
  const [skuJson, setSkuJson] = useState(initialSku);
  const [specJson, setSpecJson] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [policyStart, setPolicyStart] = useState('18:00');
  const [policyEnd, setPolicyEnd] = useState('23:00');
  const [policyQuota, setPolicyQuota] = useState(1);
  const [policyZone, setPolicyZone] = useState('Asia/Shanghai');
  const [policyDate, setPolicyDate] = useState('');
  const [policyEnabled, setPolicyEnabled] = useState(true);
  const [refund, setRefund] = useState(false);
  const [selectedSpec, setSelectedSpec] = useState('');
  const [guestNote, setGuestNote] = useState('');
  const [orderConfirmed, setOrderConfirmed] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<Json | null>(null);
  const [confirmedNotFound, setConfirmedNotFound] = useState(false);
  const [search, setSearch] = useState('');
  const [management, setManagement] = useState<unknown>(null);
  const [hostBackup, setHostBackup] = useState<{ path: string; scope: string; verified: { committed_orders: number; outbox_events: number } } | null>(null);
  const busyRef = useRef(false);
  const admin = session?.role === 'admin';
  const call = <T,>(operation: string, payload: unknown = {}, token = session?.token) => invoke<T>('host_call', { operation, session: token || null, payload });
  const run = async (task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await task(); } catch (e) { setError(String(e)); } finally { busyRef.current = false; setBusy(false); }
  };
  async function refresh(token = session?.token, role = session?.role) {
    if (!token) return;
    const results = await Promise.all([call<Order[]>(role === 'admin' ? 'admin_orders' : 'orders', {}, token), call<MenuItem[]>('catalog', {}, token)]);
    const actualTickets = role === 'guest' ? await call<TicketStatus>('ticket_status', {}, token) : null;
    if (getAppSession().local?.token !== token) return;
    setOrders(results[0]); setMenu(results[1]);
    setTickets(actualTickets);
    notifyTicketChange();
  }
  useEffect(() => {
    if (!nativeHost) return;
    let active = true;
    call<HostStatus>('status').then(s => { if (active) { setStatus(s); if (!account && (s.admin_account_id || s.admin_id)) setAccount(s.admin_account_id || s.admin_id || ''); } }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!session) return;
    const delay = Math.max(0, session.expires_at * 1000 - Date.now());
    const timer = setTimeout(() => { setSession(null); setNotice('会话已到期，请重新登录。'); }, delay);
    return () => clearTimeout(timer);
  }, [session]);
  useEffect(() => {
    setTickets(null); setOrders([]); setMenu([]);
    if (!nativeHost || !session) return;
    try { const saved = readPendingOrder(localStorage, `pixelmix.pending-order.${session.account_id}`); setPendingOrder(saved as unknown as Json | null); if (saved) setSelectedSpec(saved.serving_spec_id); }
    catch (reason) { setError(String(reason)); }
    void refresh(session.token, session.role).catch(reason => setError(`会话仍有效，但主机列表未同步：${String(reason)}`));
  }, [session?.token]);
  function makeSpec() {
    if (!recipe) { setError('先选择一份经典酒谱。'); return; }
    const profile = catalog?.profiles.find(p => p.recipe_id === recipe.id);
    const revision = (recipe as Recipe & { recipe_revision_id?: string }).recipe_revision_id;
    if (!revision) { setError('当前酒谱缺少真实版本标识，不能建立可点规格。'); return; }
    setSpecJson(print({ id: `serving-${crypto.randomUUID()}`, recipe_revision_id: revision, name: recipe.name_zh,
      source_recipe: { source_id: recipe.id }, parts: recipe.ingredients.filter(p => !p.optional).map(p => ({ sku_id: '', ingredient_id: p.ingredient_id, quantity_ml: p.unit === 'ml' && !['rinse', 'garnish'].includes(p.stage) ? p.quantity : null, stage: p.stage })),
      steps: recipe.steps_zh, glass: recipe.glass_template, ice: '', dilution_ml: null, capacity_ml: null, max_ethanol_ml: null,
      predicted_profile: profile ? { taste_bps: profile.taste_preference_bps, sensory_0_10: profile.sensory_0_10 } : null,
      prediction_status: 'heuristic_unvalidated', generated: false, rules_version: null, model_version: null }));
    setReviewed(false); setNotice('已载入当前经典版本。请确认实际 SKU、留存剂量、冰型、杯量和操作上限；null 不会自动当零。');
  }
  async function authenticate() {
    if (!status?.initialized) {
      if (password !== repeatPassword) throw new Error('两次密码不同。');
      const id = await call<string>('bootstrap', { password });
      setAccount(id); localStorage.setItem('pixelmix.host.account', id);
      const next = await call<Session>('login', { account: id, password });
      setSession(next); setStatus(await call<HostStatus>('status')); setPassword(''); setRepeatPassword(''); await refresh(next.token, next.role);
      setNotice('主管理员已创建。账户 ID 已保存在本机，密码和会话密钥不写入浏览器存储。');
    } else {
      const next = await call<Session>('login', { account: account.trim(), password });
      setSession(next); localStorage.setItem('pixelmix.host.account', next.account_id); setPassword('');
      const savedPending = localStorage.getItem(`pixelmix.pending-order.${next.account_id}`);
      if (savedPending) { const restored = JSON.parse(savedPending) as Json; setPendingOrder(restored); setSelectedSpec(String(restored.serving_spec_id)); }
      await refresh(next.token, next.role); setNotice('已通过主机身份验证。');
    }
  }
  async function openStamp(order: Order) {
    await call('open_stamp', { order_id: order.id });
    setOrders(current => current.map(item => item.id === order.id ? { ...item, stamp_open: true } : item));
    setNotice('邮票已打开；扣票和订单状态未改变。');
  }
  async function submitOrder() {
    if (!target || !orderConfirmed) throw new Error('请先核对目标、材料与过敏原，并确认这次点单。');
    const spec = menu.find(s => s.id === selectedSpec); if (!spec && !pendingOrder) throw new Error('请选择主管理员已审核的菜单规格。');
    const key = `pixelmix.pending-order.${session!.account_id}`;
    const saved = readPendingOrder(localStorage, key);
    if (saved && saved.serving_spec_id !== selectedSpec) { setPendingOrder(saved as unknown as Json); setSelectedSpec(saved.serving_spec_id); throw new Error('工作台仍有未确认的原请求，已载入原配方；请核查并沿用该编号。'); }
    const captured = saved || captureOrder(localStorage, key, spec!, target, guestNote);
    setPendingOrder(captured as unknown as Json);
    setConfirmedNotFound(false);
    try {
      const result = await call<Order>('place_order', captured);
      acknowledgeOrder(localStorage, key, captured, result as TicketOrder); setPendingOrder(null); setOrderConfirmed(false); setNotice(`主机已提交订单 ${result.id}；票据事务已确认。`);
      try { await refresh(); } catch (e) { setError(`订单已确认，但列表刷新失败，请点击刷新。${String(e)}`); }
    } catch (e) { throw new Error(`点单未获确认。重试将使用相同请求 ID；也可查询原请求。${String(e)}`); }
  }
  if (!nativeHost) return <Localized><div className="host-panel"><p>账户、票据与主机订单需要在已安装的程序员调酒台原生应用中使用。</p><p className="host-muted">浏览器界面测试不会建立账户、扣票或模拟局域网成功。</p></div></Localized>;
  return <Localized><div className="host-panel" aria-busy={busy}>
    <div className="host-context"><strong>本机主机管理</strong><span>{status ? `主机 ${status.host_id.slice(0, 8)}` : '读取状态中'}</span></div>
    <p className="host-muted">本页调用本机权威数据库。局域网连接与两台设备点单需要单独验证；当前状态不代表远程设备已连接。</p>
    {error && <div role="alert" className="host-error">{error}</div>}
    {notice && <div role="status" className="host-notice">{notice}</div>}
    <details><summary>局域网主机与客人连接（默认关闭）</summary><NetworkPanel session={session || undefined} target={target} /></details>
    {!session ? <form className="host-stack" onSubmit={e => { e.preventDefault(); void run(authenticate); }}>
      <h3>{status?.initialized ? '登录主机账户' : '首次建立主管理员'}</h3>
      {status?.initialized && <label>账户 ID<input autoComplete="username" value={account} onChange={e => setAccount(e.target.value)} required /></label>}
      <label>{status?.initialized ? '密码或配对设备密钥' : '设置密码（至少12个字符）'}<input type="password" autoComplete={status?.initialized ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} minLength={12} maxLength={256} required /></label>
      {!status?.initialized && <label>再次输入密码<input type="password" autoComplete="new-password" value={repeatPassword} onChange={e => setRepeatPassword(e.target.value)} minLength={12} required /></label>}
      <button disabled={busy || !status} type="submit">{busy ? '正在验证…' : status?.initialized ? '登录' : '创建主管理员并登录'}</button>
      <p className="host-muted">没有默认密码。账户 ID 与密码请自行保管；会话15分钟到期。</p>
    </form> : <>
      <div className="host-context"><span>{admin ? '主管理员' : '客人'} · {session.account_id.slice(0, 8)}</span><button disabled={busy} onClick={() => void run(async () => { await call('logout'); setSession(null); setOrders([]); setPairSecret(''); setInvitation(''); setManagement(null); setPendingOrder(null); })}>退出登录</button></div>
      <nav className="host-tabs" aria-label="主机功能">{(admin ? ['订单', '账户与配对', '库存与菜单', '票据计划', '主机备份'] : ['点单', '订单']).map(tab => <button key={tab} aria-pressed={section === tab} onClick={() => setSection(tab)}>{tab}</button>)}</nav>
      {section === '主机备份' && admin && <section className="host-stack">
        <h3>备份主机账本</h3>
        <p>保存账户、库存、审核菜单、票据政策、已提交订单和事件记录；备份完成后会校验数据库完整性。</p>
        <p className="host-muted">此备份不含个人收藏、评价、设置和 TLS 主机身份。个人数据库须在全局设置中另行备份；TLS 身份仍位于本机数据目录的 host-identity 文件夹，私钥绑定当前 Windows 用户。</p>
        <button disabled={busy} onClick={() => void run(async () => { const result = await call<{ path: string; scope: string; verified: { committed_orders: number; outbox_events: number } }>('backup_host'); setHostBackup(result); setNotice('主机账本已完成一致性备份与完整性校验。'); })}>创建真实主机账本备份</button>
        {hostBackup && <div role="status"><p>已备份订单 {hostBackup.verified.committed_orders} 条，事件 {hostBackup.verified.outbox_events} 条。</p><label>备份文件路径<input readOnly value={hostBackup.path} onFocus={event => event.target.select()} /></label></div>}
        <p className="host-muted">恢复须先退出应用。离线恢复工具会校验备份并复制到新文件，始终拒绝覆盖原库；本页不会在线替换正在使用的订单数据库。跨 Windows 用户恢复 TLS 身份须重新配对。</p>
      </section>}
      {(section === '订单' || !admin && section !== '点单') && <section className="host-stack">
        <div className="host-context"><h3>订单邮票</h3><button disabled={busy} onClick={() => void run(() => refresh())}>刷新主机订单</button></div>
        <input aria-label="搜索订单" placeholder="酒名、客人或订单编号" value={search} onChange={e => setSearch(e.target.value)} />
        {admin && <label className="host-check"><input type="checkbox" checked={refund} onChange={e => setRefund(e.target.checked)} />拒绝 / 取消时退回一张票（不会自动补回已消耗库存）</label>}
        {!orders.length && <p className="host-muted">暂无已提交订单。邮票只来自数据库记录。</p>}
        {orders.filter(o => print(o).toLowerCase().includes(search.toLowerCase())).map(order => <article className={`host-stamp ${order.stamp_open ? 'host-stamp-open' : ''}`} key={order.id}>
          <div className="host-context"><strong data-i18n="verbatim">{String((order.snapshot.serving_spec as Json)?.name || order.id.slice(0, 8))}</strong><span>{statusName[order.status] || order.status} · v{order.version}</span></div>
          <p data-i18n="verbatim">{String((order.snapshot.guest as Json)?.display_name || order.guest_id.slice(0, 8))} · {new Date(order.created_at * 1000).toLocaleString()}</p>
          <StampButton opened={order.stamp_open} disabled={busy} onOpen={() => void run(() => openStamp(order))} />
          {order.stamp_open && <><details open><summary>已冻结的完整订单快照</summary><pre>{print(order.snapshot)}</pre></details>
            {admin && <div className="host-actions">{(nextStates[order.status] || []).map(next => <button disabled={busy} key={next} onClick={() => void run(async () => { await call('transition', { order_id: order.id, expected_version: order.version, next, refund: refund && ['rejected', 'cancelled'].includes(next) }); await refresh(); setNotice('主机已确认订单状态变更。'); })}>{statusName[next]}</button>)}</div>}</>}
        </article>)}
      </section>}
      {section === '账户与配对' && admin && <section className="host-stack">
        <h3>建立客人账户</h3><label>客人昵称<input value={guestName} onChange={e => setGuestName(e.target.value)} maxLength={64} /></label>
        <label>初始密码<input type="password" autoComplete="new-password" value={guestPassword} onChange={e => setGuestPassword(e.target.value)} minLength={12} maxLength={256} /></label>
        <button disabled={busy || !guestName || guestPassword.length < 12} onClick={() => void run(async () => { const id = await call<string>('create_guest', { display: guestName, password: guestPassword }); setGuestId(id); setGuestPassword(''); setNotice(`客人账户已建立：${id}`); })}>创建客人</button>
        <label>客人账户 ID<input value={guestId} onChange={e => setGuestId(e.target.value)} /></label>
        <label>该客人的原料 / 过敏原排除 ID（逗号分隔）<input value={guestExcluded} onChange={e => setGuestExcluded(e.target.value)} placeholder="如 gin,milk,egg" /></label>
        <label>管理员设定的单份乙醇操作上限（ml，不代表安全饮用量）<input type="number" min={0} max={100} step={0.1} value={guestEthanol} onChange={e => setGuestEthanol(Number(e.target.value))} /></label>
        <button disabled={busy || !guestId} onClick={() => void run(async () => { await call('set_guest_constraints', { guest_id: guestId, excluded: guestExcluded.split(/[,，]/).map(s => s.trim()).filter(Boolean), max_ethanol_ml: guestEthanol }); setNotice('客人硬性排除项与操作上限已由主机保存。'); })}>保存此客人的硬性限制</button>
        <button disabled={busy || !guestId} onClick={() => void run(async () => { await call('revoke_guest', { guest_id: guestId }); setNotice('该客人账户及现有会话已撤销。'); })}>撤销此客人权限</button>
        <h3>一次性配对邀请</h3><p className="host-muted">邀请5分钟有效且仅可使用一次；管理员核对设备后批准。请只向预期客人提供凭证。</p>
        <button disabled={busy} onClick={() => void run(async () => { setInvitation(await call<string>('invite')); setNotice('真实一次性邀请已创建。'); })}>创建5分钟邀请</button>
        {invitation && <label>邀请密钥（一次性）<input readOnly value={invitation} onFocus={e => e.target.select()} /></label>}
        <label>待批准的配对请求 ID<input value={pairId} onChange={e => setPairId(e.target.value)} /></label>
        <button disabled={busy || !pairId} onClick={() => void run(async () => { const result = await call<{ account_id: string; device_secret: string }>('approve_pair', { request_id: pairId }); setGuestId(result.account_id); setPairSecret(result.device_secret); setNotice('配对已由主管理员批准。设备密钥仅在当前页面显示。'); })}>核对设备后批准配对</button>
        {pairSecret && <label>该设备密钥<input readOnly type="password" value={pairSecret} onFocus={e => e.target.select()} /><button onClick={() => setPairSecret('')}>清除显示</button></label>}
        <button disabled={busy} onClick={() => void run(async () => { const [accounts, pairs, skus, policies] = await Promise.all([call('admin_accounts'), call('pending_pairs'), call('admin_skus'), call('admin_policies')]); setManagement({ accounts, pending_pairs: pairs, skus, policies }); })}>读取账户 / 待配对 / 库存清单</button>
        {management != null && <details open><summary>主管理员数据清单</summary><pre>{print(management)}</pre></details>}
      </section>}
      {section === '库存与菜单' && admin && <section className="host-stack">
        <h3>确认实际 SKU</h3><p className="host-muted">高级结构化编辑。ABV 使用0–1小数；库存与单份上限为 ml。空值必须由真实瓶身与库存确认，不能使用测试样本代替。</p>
        <textarea aria-label="SKU结构化数据" spellCheck={false} rows={14} value={skuJson} onChange={e => setSkuJson(e.target.value)} />
        <button disabled={busy} onClick={() => void run(async () => { await call('save_sku', JSON.parse(skuJson)); setNotice('SKU已通过主机字段校验并保存。'); })}>校验并保存 SKU</button>
        <h3>审核可点操作规格</h3><button onClick={makeSpec}>从当前经典版本创建待审核规格</button>
        <p className="host-muted">每份材料都需填入已保存的 sku_id。原始 dash、洗杯留存量等未知项保持 null，完成实际校准前不能上架。来源与版本由主机重新核对。</p>
        <textarea aria-label="可点操作规格结构化数据" spellCheck={false} rows={18} value={specJson} onChange={e => { setSpecJson(e.target.value); setReviewed(false); }} />
        <label className="host-check"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />我已核对实际材料、过敏原、剂量、步骤、容量与操作上限，并明确批准此规格供客人点单。</label>
        <button disabled={busy || !reviewed || !specJson} onClick={() => void run(async () => { await call('publish_spec', JSON.parse(specJson)); setReviewed(false); await refresh(); setNotice('主机已校验并发布该操作规格。'); })}>审核通过并上架</button>
        <h3>已审核菜单</h3>{!menu.length && <p className="host-muted">尚无已审核菜单；70份参考酒谱不会自动成为可点菜单。</p>}
        {menu.map(spec => <div className="host-context" key={spec.id}><span data-i18n="verbatim">{spec.name}<small>{spec.id}</small></span><button disabled={busy} onClick={() => void run(async () => { await call('unpublish', { spec_id: spec.id }); await refresh(); setNotice('已下架；历史订单快照保留。'); })}>下架</button></div>)}
      </section>}
      {section === '票据计划' && admin && <section className="host-stack">
        <h3>新建票据计划版本</h3><p className="host-muted">计划使用主机时间与 IANA 时区。新版本不会给同一服务日重复发票，既有订单保留原政策快照。</p>
        <label>时区<input value={policyZone} onChange={e => setPolicyZone(e.target.value)} /></label>
        <div className="host-columns"><label>开始时间<input type="time" value={policyStart} onChange={e => setPolicyStart(e.target.value)} /></label><label>结束时间<input type="time" value={policyEnd} onChange={e => setPolicyEnd(e.target.value)} /></label></div>
        <label>日期（留空为每日）<input type="date" value={policyDate} onChange={e => setPolicyDate(e.target.value)} /></label>
        <label>每位客人票额<input type="number" min={0} max={100} step={1} value={policyQuota} onChange={e => setPolicyQuota(Number(e.target.value))} /></label>
        <label className="host-check"><input type="checkbox" checked={policyEnabled} onChange={e => setPolicyEnabled(e.target.checked)} />启用此版本</label>
        <button disabled={busy} onClick={() => void run(async () => { const minutes = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; }; await call('save_policy', { version: crypto.randomUUID(), timezone: policyZone, start_minute: minutes(policyStart), end_minute: minutes(policyEnd), quota: policyQuota, enabled: policyEnabled, date: policyDate || null, effective_at: Math.floor(Date.now() / 1000) + 5 }); setNotice('新票据计划已保存，将在约5秒后生效；窗口外不发票。'); })}>保存新计划版本</button>
      </section>}
      {section === '点单' && !admin && <section className="host-stack">
        <div className="host-context"><h3>主机已审核菜单</h3><button disabled={busy} onClick={() => void run(() => refresh())}>查询票据与菜单</button></div>
        <p>主机确认可用票据：{tickets ? `${tickets.available} 张${tickets.serving_enabled ? '' : '（暂未开放点单）'}` : '尚未同步'}</p>
        <label>选择规格<select value={selectedSpec} disabled={!!pendingOrder} onChange={e => { setSelectedSpec(e.target.value); setOrderConfirmed(false); }}><option value="">请选择已审核规格</option>{menu.map(spec => <option data-i18n="verbatim" key={spec.id} value={spec.id}>{spec.name}</option>)}</select></label>
        {selectedSpec && <details><summary>核对已审核材料与完整操作规格</summary><pre>{print(menu.find(spec => spec.id === selectedSpec) || pendingOrder)}</pre></details>}
        <label>备注<input value={guestNote} maxLength={300} disabled={!!pendingOrder} onChange={e => setGuestNote(e.target.value)} /></label>
        <label className="host-check"><input type="checkbox" checked={orderConfirmed} onChange={e => setOrderConfirmed(e.target.checked)} />我已核对所选配方和材料、数量为1份，并向主管理员声明了过敏原与排除项。</label>
        <button disabled={busy || !orderConfirmed || !selectedSpec} onClick={() => void run(submitOrder)}>{pendingOrder ? '以原请求 ID 重试' : '提交真实订单'}</button>
        {pendingOrder && <><p className="host-muted">请求 ID：{String(pendingOrder.request_id)}。该请求已保存在本机，退出后重新登录仍使用同一编号。</p><button disabled={busy} onClick={() => void run(async () => {
          try { const found = await call<Order>('by_request', { request_id: pendingOrder.request_id }); const key = `pixelmix.pending-order.${session.account_id}`, saved = readPendingOrder(localStorage, key); if (!saved) throw Error('本机原请求已改变，请重新同步。'); acknowledgeOrder(localStorage, key, saved, found as TicketOrder); setPendingOrder(null); setConfirmedNotFound(false); await refresh(); setNotice(`已查到原订单 ${found.id}，不会重新扣票。`); }
          catch (e) { if (String(e) === 'record not found') { setConfirmedNotFound(true); setNotice('主机当前确认原请求尚无已提交记录。可以继续以原编号重试。'); } else throw e; }
        })}>查询原请求是否已提交</button>{confirmedNotFound && <p className="host-muted">主机尚无此请求记录。为避免与延迟中的原请求竞态，保留编号并重试。</p>}</>}
      </section>}
    </>}
  </div></Localized>;
}
