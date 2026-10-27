import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: () => ({ onDragDropEvent: mocks.listen }) }));
import { copyArchiveFile, importArchive, listenArchiveDrop, pasteArchiveFiles, saveArchive, startArchiveDrag } from './archive-bridge';
import type { ArchiveSnapshot } from './archive-bridge';
describe('archive bridge client contract (IPC mocked here; native evidence is separate)', () => {
  afterEach(() => { vi.unstubAllGlobals(); mocks.invoke.mockReset(); mocks.listen.mockReset(); });
  it('browser preview cannot simulate native save, drag or Windows file clipboard', async () => {
    vi.stubGlobal('window', {});
    await expect(saveArchive({} as ArchiveSnapshot)).rejects.toThrow('原生');
    await expect(startArchiveDrag('id')).rejects.toThrow('原生');
    await expect(copyArchiveFile('id')).rejects.toThrow('原生');
    await expect(pasteArchiveFiles()).rejects.toThrow('原生');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('native drag accepts an archive ID and never passes arbitrary file paths to a generic plugin', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} }); mocks.invoke.mockResolvedValue({ status: 'cancelled', mode: 'copy' });
    expect(await startArchiveDrag('TEST-id')).toEqual({ status: 'cancelled', mode: 'copy' });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('archive_start_drag', { archiveId: 'TEST-id' });
  });
  it('refuses an imported authority flag or measured profile from a mismatched bridge response', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const raw = { authority_restored: false, guest_orderable: false, personal: { recipe: { source: { kind: 'imported_snapshot' }, default_orderable: false }, profile: { measured: false }, created_at: 1 } };
    mocks.invoke.mockResolvedValue(raw); expect((await importArchive('TEST')).personal.created_at).toBe('1970-01-01T00:00:01.000Z');
    mocks.invoke.mockResolvedValue({ ...raw, authority_restored: true }); await expect(importArchive('TEST')).rejects.toThrow('权限边界');
    mocks.invoke.mockResolvedValue({ ...raw, personal: { ...raw.personal, profile: { measured: true } } }); await expect(importArchive('TEST')).rejects.toThrow('权限边界');
  });
  it('only processes a one-file native drop, ignoring enter/over events', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} }); const ok = vi.fn(), error = vi.fn(), unlisten = vi.fn();
    mocks.listen.mockResolvedValue(unlisten); expect(await listenArchiveDrop(ok, error)).toBe(unlisten);
    const listener = mocks.listen.mock.calls[0][0]; listener({ payload: { type: 'enter', paths: ['x'] } }); expect(mocks.invoke).not.toHaveBeenCalled();
    listener({ payload: { type: 'drop', paths: ['x.timermix', 'y.timermix'] } }); expect(error).toHaveBeenCalledExactlyOnceWith('每次请拖入一个 .timermix 酒谱存档。'); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('serializes successive drops and continues after failure', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });const ok=vi.fn(),error=vi.fn();mocks.listen.mockResolvedValue(vi.fn());
    const raw={authority_restored:false,guest_orderable:false,personal:{recipe:{source:{kind:'imported_snapshot'},default_orderable:false},profile:{measured:false},created_at:1}};
    let release!:(value:unknown)=>void;
    mocks.invoke.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockRejectedValueOnce(Error('bad checksum')).mockResolvedValueOnce(raw);
    await listenArchiveDrop(ok,error);const listener=mocks.listen.mock.calls[0][0];
    for(const path of ['first.timermix','bad.timermix','legacy.pixelmix'])listener({payload:{type:'drop',paths:[path]}});
    await Promise.resolve();expect(mocks.invoke).toHaveBeenCalledTimes(1);release(raw);
    await vi.waitFor(()=>expect(ok).toHaveBeenCalledTimes(2));expect(error).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls.map(call=>call[1].path)).toEqual(['first.timermix','bad.timermix','legacy.pixelmix']);
  });
  it('routes a library drop once before queue import consumes its native path grant', async()=>{
    vi.stubGlobal('window',{__TAURI_INTERNALS__:{}});mocks.listen.mockResolvedValue(vi.fn());
    const ok=vi.fn(),error=vi.fn(),persist=vi.fn().mockResolvedValue(undefined);
    let libraryOpen=true;
    await listenArchiveDrop(ok,error,path=>libraryOpen?()=>persist(path):undefined);
    mocks.listen.mock.calls[0][0]({payload:{type:'drop',paths:['saved.timermix']}});
    libraryOpen=false;
    await vi.waitFor(()=>expect(persist).toHaveBeenCalledExactlyOnceWith('saved.timermix'));
    expect(mocks.invoke).not.toHaveBeenCalled();expect(ok).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
  });
  it('reports rejected library imports without falling back to queue or blocking the next drop',async()=>{
    vi.stubGlobal('window',{__TAURI_INTERNALS__:{}});mocks.listen.mockResolvedValue(vi.fn());
    const ok=vi.fn(),error=vi.fn(),persist=vi.fn().mockRejectedValueOnce(Error('library full')).mockResolvedValueOnce(undefined);
    await listenArchiveDrop(ok,error,path=>()=>persist(path));const listener=mocks.listen.mock.calls[0][0];
    for(const path of ['one.timermix','legacy.pixelmix'])listener({payload:{type:'drop',paths:[path]}});
    await vi.waitFor(()=>expect(persist).toHaveBeenCalledTimes(2));
    expect(error).toHaveBeenCalledExactlyOnceWith('Error: library full');expect(ok).not.toHaveBeenCalled();expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('copies only an own archive ID and pastes the native file list without a JavaScript path argument',async()=>{
    vi.stubGlobal('window',{__TAURI_INTERNALS__:{}});mocks.invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);
    await copyArchiveFile('TEST-owned-archive');expect(await pasteArchiveFiles()).toEqual([]);
    expect(mocks.invoke.mock.calls).toEqual([['archive_clipboard_copy',{archiveId:'TEST-owned-archive'}],['archive_clipboard_paste']]);
  });
  it('preserves clipboard order and repeated files without mutating native timestamps or frozen snapshots',async()=>{
    vi.stubGlobal('window',{__TAURI_INTERNALS__:{}});
    const raw=(id:string)=>({archive_id:id,sha256:`digest-${id}`,snapshot:{recipe:{id:`source-${id}`}},target:{taste_bps:[2000,2000,2000,2000,2000]},authority_restored:false,guest_orderable:false,personal:{recipe:{id:`archive-${id}`,source:{kind:'imported_snapshot'},default_orderable:false},profile:{measured:false},created_at:1}});
    const first=raw('one'),second=raw('two'),incoming=[first,second,first],before=structuredClone(incoming);mocks.invoke.mockResolvedValueOnce(incoming);
    const result=await pasteArchiveFiles();
    expect(result.map(item=>item.archive_id)).toEqual(['one','two','one']);expect(result.map(item=>item.personal.created_at)).toEqual(Array(3).fill('1970-01-01T00:00:01.000Z'));
    expect(result[0].snapshot).toEqual(first.snapshot);expect(result[2].target).toEqual(first.target);expect(result[0]).not.toBe(result[2]);expect(incoming).toEqual(before);
  });
  it('rejects a whole clipboard result when any later file crosses the authority boundary',async()=>{
    vi.stubGlobal('window',{__TAURI_INTERNALS__:{}});
    const good={authority_restored:false,guest_orderable:false,personal:{recipe:{source:{kind:'imported_snapshot'},default_orderable:false},profile:{measured:false},created_at:1}};
    for(const bad of [{...good,guest_orderable:true},{...good,authority_restored:true},{...good,personal:{...good.personal,recipe:{...good.personal.recipe,default_orderable:true}}},{...good,personal:{...good.personal,profile:{measured:true}}}]){
      const accepted=vi.fn();mocks.invoke.mockResolvedValueOnce([good,bad,good]);
      await expect(pasteArchiveFiles().then(accepted)).rejects.toThrow('权限边界');expect(accepted).not.toHaveBeenCalled();
    }
    expect(mocks.invoke.mock.calls.every(call=>call[0]==='archive_clipboard_paste'&&call.length===1)).toBe(true);
  });
  it('surfaces native clipboard errors and never retries with a guessed path or text clipboard fallback',async()=>{
    vi.stubGlobal('window',{__TAURI_INTERNALS__:{}});mocks.invoke.mockRejectedValueOnce(Error('剪贴板中没有.timermix酒谱文件')).mockRejectedValueOnce(Error('Windows剪贴板正在使用，请稍后重试'));
    await expect(pasteArchiveFiles()).rejects.toThrow('没有.timermix');await expect(copyArchiveFile('TEST-owned-archive')).rejects.toThrow('正在使用');
    expect(mocks.invoke.mock.calls).toEqual([['archive_clipboard_paste'],['archive_clipboard_copy',{archiveId:'TEST-owned-archive'}]]);
  });
});
