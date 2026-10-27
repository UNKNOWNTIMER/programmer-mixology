import { useSyncExternalStore } from 'react';

export interface AppSession { token: string; account_id: string; role: string; expires_at: number }
export interface RemoteAppSession { account_id: string; role: string; expires_at: number }
export interface HostIdentity { protocol_version: number; host_id: string; address: string; certificate_pem: string; certificate_sha256: string }
export interface SessionSnapshot { local: AppSession | null; remote: RemoteAppSession | null; remoteIdentity: HostIdentity | null; active: 'local' | 'remote' }
let state: SessionSnapshot = { local: null, remote: null, remoteIdentity: null, active: 'local' };
const listeners = new Set<() => void>();
let localExpiry: ReturnType<typeof setTimeout> | undefined;
let remoteExpiry: ReturnType<typeof setTimeout> | undefined;
function change(next: SessionSnapshot) { state = next; for (const listener of listeners) listener(); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
export function getAppSession() { return state; }
export function setLocalSession(session: AppSession | null) {
  clearTimeout(localExpiry);
  change({ ...state, local: session, active: session ? 'local' : state.remote ? 'remote' : 'local' });
  if (session) localExpiry = setTimeout(() => { if (state.local?.token === session.token) setLocalSession(null); }, Math.max(0, session.expires_at * 1000 - Date.now()));
}
export function setRemoteSession(session: RemoteAppSession | null) {
  clearTimeout(remoteExpiry);
  // The Rust guest adapter owns its token. Do not copy a remote bearer token into this UI store.
  const publicSession = session ? { account_id: session.account_id, role: session.role, expires_at: session.expires_at } : null;
  change({ ...state, remote: publicSession, active: session ? 'remote' : state.local ? 'local' : 'remote' });
  if (session) remoteExpiry = setTimeout(() => { if (state.remote?.account_id === session.account_id && state.remote.expires_at === session.expires_at) setRemoteSession(null); }, Math.max(0, session.expires_at * 1000 - Date.now()));
}
export function setRemoteIdentity(identity: HostIdentity | null) {
  if (identity?.host_id !== state.remoteIdentity?.host_id || identity?.address !== state.remoteIdentity?.address || identity?.certificate_sha256 !== state.remoteIdentity?.certificate_sha256) setRemoteSession(null);
  change({ ...state, remoteIdentity: identity });
}
export function setActiveSession(active: 'local' | 'remote') { change({ ...state, active }); }
export function useAppSession() { return useSyncExternalStore(subscribe, getAppSession, getAppSession); }
export const TICKET_SYNC_EVENT = 'pixelmix-ticket-sync';
export function notifyTicketChange() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(TICKET_SYNC_EVENT)); }

// This module deliberately does not read or write localStorage/sessionStorage. Accounts and
// credentials exist in RAM for the app lifetime; closing a settings panel does not log out.
