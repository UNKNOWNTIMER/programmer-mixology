import { Localized } from './i18n';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { native } from './bridge';

interface Config { executable:string; gguf:string; executable_sha256:string; gguf_sha256:string; model_id:string; reviewed_build:string; model_license:string; explicit_user_approval:boolean; context_tokens:number; gpu_layers:number; threads:number; startup_timeout_seconds:number; request_timeout_seconds:number }
export default function ModelPanel() {
  const [config,setConfig]=useState<Config>({executable:'',gguf:'',executable_sha256:'',gguf_sha256:'',model_id:'',reviewed_build:'',model_license:'',explicit_user_approval:false,context_tokens:4096,gpu_layers:0,threads:4,startup_timeout_seconds:60,request_timeout_seconds:45});
  const [status,setStatus]=useState<Record<string,unknown>>({running:false});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const refresh=async()=>{if(native)setStatus(await invoke('model_status'));};
  useEffect(()=>{void refresh().catch(e=>setError(String(e)));},[]);
  const stop=async()=>{try{await invoke('model_stop');await refresh();}catch(e){setError(String(e));}};
  const start=async()=>{setBusy(true);setError('');try{await invoke('model_start',{config});await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}};
  return <Localized><section aria-label="本地模型配置"><h3>本地模型 · 可选</h3><details className="model-recommendation"><summary>模型配置起点</summary><p>先按你的电脑内存、处理器与模型许可证选择 GGUF。以下仅提供可编辑的配置示例：4096 上下文、4 个 CPU 线程、不开启 GPU 卸载。运行前核对文件来源和校验值；显卡后端与实际推理速度需要在本机验证。</p><p>模型名称、许可、运行时版本与文件路径均由你填写。程序不附带或自动下载模型，也不将示例参数视为本机性能评测结果。</p><button className="outline-button" onClick={()=>setConfig({...config,context_tokens:4096,threads:4,gpu_layers:0,explicit_user_approval:false})}>填入起始参数</button></details><p className="notice">先准备经过许可与版本审核的 llama-server 和 GGUF 文件。这里不会下载模型。文件须与发布方校验值一致；当前尚未验证任何模型在本机的推理表现。CPU 默认起步，显卡后端取决于你审核的构建。</p>
    <div className="status-block"><strong>{busy?'正在校验文件并启动模型':status.running?'本地模型进程运行中':'本地模型未运行'}</strong><p>{status.running?`${String(status.model_id)} / ${String(status.reviewed_build)}`:'经典与规则模式可继续使用。'}</p></div>
    <form onSubmit={e=>{e.preventDefault();void start();}}>
      {([['executable','llama-server 完整路径'],['gguf','GGUF 完整路径'],['executable_sha256','运行时发布方 SHA-256'],['gguf_sha256','模型发布方 SHA-256'],['model_id','模型名称'],['reviewed_build','已审核的 llama.cpp 版本 / commit'],['model_license','已核对的模型许可证']] as const).map(([key,label])=><label className="model-field" key={key}>{label}<input required className="full-input" value={config[key]} onChange={e=>setConfig({...config,[key]:e.target.value})} maxLength={key.endsWith('sha256')?64:500} autoComplete="off"/></label>)}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12,margin:'16px 0'}}>{([['context_tokens','上下文 token',512,8192],['gpu_layers','GPU 卸载层数',0,200],['threads','CPU 线程',1,64],['startup_timeout_seconds','启动超时 / 秒',1,300],['request_timeout_seconds','命名超时 / 秒',1,120]] as const).map(([key,label,min,max])=><label key={key}>{label}<input required className="full-input" type="number" min={min} max={max} value={config[key]} onChange={e=>setConfig({...config,[key]:Number(e.target.value)})}/></label>)}</div>
      <label className="check-line"><input type="checkbox" checked={config.explicit_user_approval} onChange={e=>setConfig({...config,explicit_user_approval:e.target.checked})}/>我已核对文件来源、版本与许可证，授权运行上述本地文件</label>
      <div style={{display:'flex',gap:12,marginTop:16}}><button className="primary" type="submit" disabled={!native||busy||!!status.running||!config.explicit_user_approval}>校验并启动</button><button className="outline-button" type="button" disabled={!native} onClick={()=>void stop()}>停止 / 取消</button><button className="quiet" type="button" disabled={!native} onClick={()=>void refresh().catch(e=>setError(String(e)))}>刷新状态</button></div>
    </form>{error&&<p role="alert" className="notice">{error}</p>}<p className="fineprint">进程只监听本机随机端口；命名仅能选择已验证候选。停止操作会回收模型进程。此配置仅保留在当前窗口内存，关闭后需重新授权启动。</p>
  </section></Localized>;
}
