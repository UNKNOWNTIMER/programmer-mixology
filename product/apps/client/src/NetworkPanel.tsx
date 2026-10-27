import { Localized } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Target } from './types';
import { useAppSession, getAppSession, setRemoteIdentity, setRemoteSession as updateRemoteSession, notifyTicketChange } from './session-store';
import { captureOrder, readPendingOrder, acknowledgeOrder, type TicketOrder, type TicketStatus } from './ticket-state';

interface Identity { protocol_version: number; host_id: string; address: string; certificate_pem: string; certificate_sha256: string }
interface NetworkStatus { running: boolean; identity?: Identity }
interface RemoteSession { account_id: string; role: string; expires_at: number }
interface MenuSpec { id: string; recipe_revision_id: string; name: string; [key: string]: unknown }
interface Ticket { window_id: string; quota: number; spent: number; starts: number; expires: number }
interface RemoteOrder extends TicketOrder {}
interface Pending { protocol_version: 1; request_id: string; recipe_revision_id: string; serving_spec_id: string; target_profile: Target; units_count: 1; guest_note: string }
const native = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function NetworkPanel({ session, target }: { session?: { token: string; role: string }; target?: Target }) {
  const [status, setStatus] = useState<NetworkStatus>({ running: false });
  const [address, setAddress] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [identityJson, setIdentityJson] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const appSession = useAppSession();
  const connected = appSession.remoteIdentity, setConnected = setRemoteIdentity;
  const remoteSession = appSession.remote, setRemoteSession = updateRemoteSession;
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [name, setName] = useState('');
  const [device, setDevice] = useState('');
  const [pairResult, setPairResult] = useState<unknown>(null);
  const [menu, setMenu] = useState<MenuSpec[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketStatus, setTicketStatus] = useState<TicketStatus | null>(null);
  const [orders, setOrders] = useState<RemoteOrder[]>([]);
  const [selected, setSelected] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const guestCall = <T,>(operation: string, payload: unknown = {}) => invoke<T>('guest_call', { operation, payload });
  const storageKey = (hostId = connected?.host_id, accountId = remoteSession?.account_id) => `pixelmix.remote-pending.${hostId}.${accountId}`;
  async function run(task: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await task(); } catch (e) { setError(String(e)); } finally { lock.current = false; setBusy(false); }
  }
  async function refresh() {
    const original = getAppSession();
    const [nextMenu, nextTickets, nextOrders] = await Promise.all([guestCall<MenuSpec[]>('catalog'), guestCall<TicketStatus>('ticket_status'), guestCall<RemoteOrder[]>('orders')]);
    const current = getAppSession();
    if (current.remote?.account_id !== original.remote?.account_id || current.remoteIdentity?.host_id !== original.remoteIdentity?.host_id || current.remote?.expires_at !== original.remote?.expires_at) return;
    setMenu(nextMenu); setTicketStatus(nextTickets); setTickets(nextTickets.tickets); setOrders(nextOrders);
    notifyTicketChange();
  }
  useEffect(() => { if (native) invoke<NetworkStatus>('network_host_status').then(setStatus).catch(e => setError(String(e))); }, []);
  useEffect(() => {
    if (!remoteSession) return;
    const timer = setTimeout(() => { setRemoteSession(null); setPassword(''); setNotice('远程客人会话已到期，请重新登录。'); }, Math.max(0, remoteSession.expires_at * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [remoteSession]);
  useEffect(() => {
    setTicketStatus(null); setTickets([]); setOrders([]); setMenu([]);
    if (!native || !remoteSession || !connected) return;
    try { const saved = readPendingOrder(localStorage, storageKey()); setPending(saved); if (saved) setSelected(saved.serving_spec_id); }
    catch (reason) { setError(String(reason)); }
    void refresh().catch(reason => setError(`远程会话尚未同步：${String(reason)}`));
  }, [remoteSession?.account_id, remoteSession?.expires_at, connected?.host_id]);
  async function login() {
    if (!connected) throw new Error('先确认主机身份并连接。');
    const result = await guestCall<RemoteSession>('login', { account: account.trim(), password });
    setPassword(''); setRemoteSession(result);
    const saved = localStorage.getItem(storageKey(connected.host_id, result.account_id));
    if (saved) { const original = JSON.parse(saved) as Pending; setPending(original); setSelected(original.serving_spec_id); } else { setPending(null); }
    await refresh(); setNotice('已通过远程主机身份验证，菜单和票据来自该主机。');
  }
  async function submit() {
    if (!target || !connected || !remoteSession || !confirmed) throw new Error('请先核对材料、数量与过敏原并确认本次点单。');
    const spec = menu.find(s => s.id === selected); if (!spec && !pending) throw new Error('请选择主机已审核的操作规格。');
    const saved = readPendingOrder(localStorage, storageKey());
    if (saved && saved.serving_spec_id !== selected) { setPending(saved); setSelected(saved.serving_spec_id); throw new Error('工作台已有未确认请求，已载入原配方；请核查并沿用该编号。'); }
    const captured: Pending = saved || captureOrder(localStorage, storageKey(), spec!, target, note);
    setPending(captured);
    let accepted: RemoteOrder;
    try { accepted = await guestCall<RemoteOrder>('place_order', captured); }
    catch (e) { throw new Error(`未获得主机提交确认；原请求已保存在本机，重试不会更换编号。${String(e)}`); }
    acknowledgeOrder(localStorage, storageKey(), captured, accepted); setPending(null); setConfirmed(false); setNotice(`远程主机已确认订单 ${accepted.id}，扣票已提交。`);
    try { await refresh(); } catch (e) { setError(`订单已经确认，票据或列表刷新暂时失败。${String(e)}`); }
  }
  if (!native) return <Localized><p className="host-muted">局域网安全连接仅在原生客户端可用，浏览器预览不会启动服务。</p></Localized>;
  return <Localized><div className="host-panel" aria-busy={busy}>
    <p className="host-muted">默认关闭。启用时只监听明确填写的本机私网或回环地址；应用不会修改防火墙。主机身份、证书指纹和配对凭证需要由双方核对。</p>
    {error && <div role="alert" className="host-error">{error}</div>}{notice && <div role="status" className="host-notice">{notice}</div>}
    <div className="host-context"><strong>主机网络：{status.running ? '正在监听' : '关闭'}</strong><button disabled={busy} onClick={() => void run(async () => setStatus(await invoke<NetworkStatus>('network_host_status')))}>读取真实网络状态</button></div>
    {session?.role === 'admin' && <section className="host-stack">
      <label>本机监听地址和端口<input placeholder="例如 192.168.1.10:39761" value={address} onChange={e => { setAddress(e.target.value); setEnabled(false); }} disabled={status.running} /></label>
      <p className="host-muted">127.0.0.1 只供本机连接验证；其他设备需要主机真实私网 IP。更换 IP 后请重新核对配对身份。</p>
      <label className="host-check"><input type="checkbox" checked={enabled} disabled={status.running} onChange={e => setEnabled(e.target.checked)} />我明确启用此地址的局域网客人服务。</label>
      <div className="host-actions"><button disabled={busy || !enabled || !address || status.running} onClick={() => void run(async () => { const identity = await invoke<Identity>('network_host_start', { session: session.token, address: address.trim(), explicitlyEnabled: true }); setStatus({ running: true, identity }); setNotice('TLS主机监听已启动。其他设备是否可达仍需实际连接验证。'); })}>启用 TLS 主机</button>
        <button disabled={busy || !status.running} onClick={() => void run(async () => { await invoke('network_host_stop', { session: session.token }); setStatus({ running: false }); setEnabled(false); setNotice('主机监听已停止。'); })}>停止主机监听</button></div>
    </section>}
    {status.identity && <section className="host-stack"><label>主机公开身份（可复制给客人）<textarea readOnly rows={8} value={pretty(status.identity)} onFocus={e => e.target.select()} /></label><label>需单独核对的 SHA-256 证书指纹<input readOnly value={status.identity.certificate_sha256} onFocus={e => e.target.select()} /></label><p className="host-muted">此处只显示公开证书，不显示主机私钥或账户密码。</p></section>}
    <section className="host-stack">
      <h3>作为客人连接另一主机</h3>
      {!connected ? <>
        <label>粘贴主机公开身份 JSON<textarea rows={7} value={identityJson} onChange={e => setIdentityJson(e.target.value)} spellCheck={false} /></label>
        <label>从主机当面或可信渠道核对的证书指纹<input value={fingerprint} onChange={e => setFingerprint(e.target.value)} placeholder="64位十六进制 SHA-256" maxLength={64} /></label>
        <button disabled={busy || !identityJson || fingerprint.length !== 64} onClick={() => void run(async () => { const identity = JSON.parse(identityJson) as Identity; await guestCall('connect', { identity, confirmed_fingerprint: fingerprint.trim() }); setConnected(identity); setNotice('已完成固定证书校验并收到主机健康响应；尚未登录。'); })}>确认指纹并连接</button>
      </> : <><div className="host-context"><span>已连接 {connected.address} · {connected.host_id.slice(0, 8)}</span><button disabled={busy} onClick={() => void run(async () => { await guestCall('disconnect'); setConnected(null); setRemoteSession(null); setPassword(''); setOrders([]); setMenu([]); setTickets([]); setPending(null); setNotice('已断开连接，尚未确认的订单请求保留在本机。'); })}>断开客人连接</button></div>
        {!remoteSession ? <>
          <details><summary>新设备：发送配对申请</summary><div className="host-stack"><label>一次性邀请码<input type="password" autoComplete="off" value={invite} onChange={e => setInvite(e.target.value)} /></label><label>客人昵称<input value={name} maxLength={64} onChange={e => setName(e.target.value)} /></label><label>设备名称<input value={device} maxLength={100} onChange={e => setDevice(e.target.value)} /></label>
            <button disabled={busy || !invite || !name || !device} onClick={() => void run(async () => { const result = await guestCall('request_pair', { invite, name, device }); setPairResult(result); setInvite(''); setNotice('配对申请已送达。请让主管理员核对请求，再提供已批准的账户 ID 与设备密钥。'); })}>发送配对申请</button>{pairResult != null && <pre>{pretty(pairResult)}</pre>}</div></details>
          <form className="host-stack" onSubmit={event => { event.preventDefault(); void run(login); }}><label>已批准的客人账户 ID<input value={account} autoComplete="username" required onChange={e => setAccount(e.target.value)} /></label><label>密码或设备密钥<input type="password" autoComplete="current-password" value={password} required onChange={e => setPassword(e.target.value)} /></label><button disabled={busy} type="submit">登录远程客人账户</button></form>
        </> : <>
          <div className="host-context"><strong>客人 {remoteSession.account_id.slice(0, 8)}</strong><button disabled={busy} onClick={() => void run(refresh)}>同步菜单、票据与订单</button></div>
          <p>主机确认可用票据：{ticketStatus ? `${ticketStatus.available} 张${ticketStatus.serving_enabled ? '' : '（暂未开放点单）'}` : '尚未同步'}</p>
          {!tickets.length ? <p className="host-muted">当前主机没有向此账户发放票据。请检查计划与服务窗口。</p> : tickets.map(ticket => <p key={ticket.window_id}>票据 {ticket.quota - ticket.spent}/{ticket.quota} · {new Date(ticket.starts * 1000).toLocaleString()} 至 {new Date(ticket.expires * 1000).toLocaleString()}（以主机判断有效性）</p>)}
          <label>已审核菜单<select value={selected} disabled={!!pending} onChange={e => { setSelected(e.target.value); setConfirmed(false); }}><option value="">选择一份操作规格</option>{menu.map(spec => <option data-i18n="verbatim" value={spec.id} key={spec.id}>{spec.name}</option>)}</select></label>
          {selected && <details open><summary>核对真实材料、步骤与审核规格</summary><pre>{pretty(menu.find(spec => spec.id === selected) || pending)}</pre></details>}
          <label>给调酒师的备注<input maxLength={300} value={note} disabled={!!pending} onChange={e => setNote(e.target.value)} /></label>
          <label className="host-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对所选材料、数量为1份，已向主机声明过敏原与排除项，并确认提交此订单。</label>
          <button disabled={busy || !confirmed || !selected || !target} onClick={() => void run(submit)}>{pending ? '重试原订单请求' : '向主机提交订单'}</button>
          {pending && <><p className="host-muted">请求 ID：{pending.request_id}。请求与目标快照已保存，网络重试与重启后重连沿用此编号。</p><button disabled={busy} onClick={() => void run(async () => { const original = await guestCall<RemoteOrder>('by_request', { request_id: pending.request_id }); acknowledgeOrder(localStorage, storageKey(), pending, original); setPending(null); setConfirmed(false); setNotice(`已查询到主机确认订单 ${original.id}。`); try { await refresh(); } catch (e) { setError(`订单已确认，列表同步失败：${String(e)}`); } })}>查询原请求是否已提交</button></>}
          <h3>主机已提交订单</h3>{!orders.length && <p className="host-muted">此客人暂无已提交订单。</p>}{orders.map(order => <details key={order.id}><summary data-i18n="verbatim">{String((order.snapshot.serving_spec as Record<string, unknown>)?.name || order.id.slice(0, 8))} · {order.status}</summary><pre>{pretty(order)}</pre></details>)}
        </>}
      </>}
    </section>
  </div></Localized>;
}
