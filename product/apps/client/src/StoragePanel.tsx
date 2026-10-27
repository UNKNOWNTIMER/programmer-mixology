import { Localized, useI18n } from './i18n';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { native } from './bridge';
export default function StoragePanel({beforeBackup,beforeRestore,afterFailedRestore}:{beforeBackup:()=>Promise<void>;beforeRestore:()=>Promise<void>;afterFailedRestore:()=>void}){
  const {t}=useI18n();
  const [files,setFiles]=useState<string[]>([]),[info,setInfo]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState('');
  async function act(fn:()=>Promise<void>){setBusy(true);try{await fn();}catch(e){setInfo(`操作失败：${String(e)}`);}finally{setBusy(false);}}
  return <Localized><div className="storage-panel"><h3>个人酒谱与偏好备份</h3><p className="fineprint">使用原生 SQLite 备份接口，包含个人酒谱、偏好、收藏、评价与草稿；不含主机订单、账户或身份。恢复前先保存当前资料并创建备份。</p><div className="storage-actions"><button className="outline-button" disabled={!native||busy} onClick={()=>void act(async()=>{await beforeBackup();const path=await invoke<string>('backup_create');setInfo(`已创建备份：${path}`);setFiles(await invoke('backup_list'));})}>创建一致性备份</button><button className="outline-button" disabled={!native||busy} onClick={()=>void act(async()=>setFiles(await invoke('backup_list')))}>读取备份列表</button><button className="outline-button" disabled={!native||busy} onClick={()=>void act(async()=>setInfo(JSON.stringify(await invoke('diagnostics'),null,2)))}>本机诊断</button></div>{files.length>0&&<><label className="setting-row">选择恢复点<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">请选择…</option>{files.map(f=><option key={f} value={f}>{f}</option>)}</select></label><button className="outline-button" disabled={!selected||busy} onClick={()=>{if(window.confirm(t('将先备份当前个人酒谱与偏好，再恢复所选个人资料备份并重新读取工作台。不会恢复主机订单、账户或身份。继续？')))void act(async()=>{try{await beforeRestore();await invoke('backup_create');await invoke('backup_restore',{name:selected});location.reload();}catch(e){afterFailedRestore();throw e;}});}}>备份当前资料并恢复所选备份</button></>}{!native&&<p className="fineprint">原生备份与诊断只在 Tauri 应用中可用。</p>}{info&&<pre className="diagnostics-output" role="status">{info}</pre>}</div></Localized>;
}


