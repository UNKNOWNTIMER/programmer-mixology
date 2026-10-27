import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { GeneratedTrial, Profile, Recipe, Target } from './types';

export interface ArchiveSnapshot { recipe: Recipe; profile: Profile; target: Target }
export interface SavedArchive { archive_id: string; path: string; sha256: string; icon_association: { registered: boolean; reason?: string; scope?: string } }
export interface ValidatedArchive { archive_id: string; sha256: string; snapshot: ArchiveSnapshot; personal: GeneratedTrial; target: Target; guest_orderable: false; authority_restored: false }
export interface ArchiveDragResult { status: 'dropped' | 'cancelled'; mode: 'copy' }
type NativeArchive = Omit<ValidatedArchive, 'personal'> & { personal: Omit<GeneratedTrial, 'created_at'> & { created_at: number } };
function validatedArchive(raw:NativeArchive):ValidatedArchive {
  if (raw.authority_restored !== false || raw.guest_orderable !== false || raw.personal.recipe.source.kind !== 'imported_snapshot' || raw.personal.recipe.default_orderable !== false || raw.personal.profile.measured !== false) throw Error('原生存档未通过个人快照权限边界。');
  return { ...raw, personal: { ...raw.personal, created_at: new Date(raw.personal.created_at * 1000).toISOString() } };
}
const requireNative = () => { if (!('__TAURI_INTERNALS__' in window)) throw Error('真实存档拖放仅在已安装的原生应用中可用。'); };
/** Creates a new immutable data file in the app's export cache; never replaces the source recipe. */
export async function saveArchive(snapshot: ArchiveSnapshot): Promise<SavedArchive> {
  requireNative(); return invoke('archive_save', { snapshot });
}
/** Call while the mouse is still held after a movement threshold. Copy goes through Windows OLE. */
export async function startArchiveDrag(archiveId: string): Promise<ArchiveDragResult> {
  requireNative(); return invoke('archive_start_drag', { archiveId });
}
/** Local path must be from a recent native drop, or one of this app's own saved archives. */
export async function importArchive(path: string): Promise<ValidatedArchive> {
  requireNative();
  return validatedArchive(await invoke<NativeArchive>('archive_import', { path }));
}
/** Windows CF_HDROP: Explorer pastes an actual file, never a textual path. */
export async function copyArchiveFile(archiveId:string):Promise<void> {
  requireNative();return invoke('archive_clipboard_copy',{archiveId});
}
export async function pasteArchiveFiles():Promise<ValidatedArchive[]> {
  requireNative();return (await invoke<NativeArchive[]>('archive_clipboard_paste')).map(validatedArchive);
}
/** This listens to real OS drop events, not HTML drag-and-drop transfer text or URLs. */
export type ArchiveDropRoute = (path:string) => (()=>Promise<void>) | undefined;
export async function listenArchiveDrop(onValidated: (archive: ValidatedArchive) => void, onError: (message: string) => void, routeDrop?:ArchiveDropRoute): Promise<UnlistenFn> {
  requireNative();
  let pending=Promise.resolve();
  return getCurrentWebviewWindow().onDragDropEvent(event => {
    if (event.payload.type !== 'drop') return;
    if (event.payload.paths.length !== 1) { onError('每次请拖入一个 .timermix 酒谱存档。'); return; }
    // Keep rapid successive drops in OS arrival order, including after a failed import.
    const path=event.payload.paths[0];
    // Capture the destination at drop time. A later dialog close must not send a
    // library import to the queue, and an external path's grant is consumed once.
    const routed=routeDrop?.(path);
    pending=pending.then(routed||(()=>importArchive(path).then(onValidated))).catch(error => onError(String(error)));
  });
}
