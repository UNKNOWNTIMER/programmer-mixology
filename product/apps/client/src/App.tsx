import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adjustTaste, defaultState, loadCatalog, native, readState, writeState } from './bridge';
import { filterRecipes, ingredientName, matchIndex, METHOD_LABELS, requiredMissing, safeSourceUrl, validateTaste } from './domain';
import type { Catalog, Profile, Recipe, Taste, UserState } from './types';
import { Glass } from './Glass';
import { SensoryControls, TasteControls } from './Controls';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import BootMosaic from './BootMosaic';
import { matchTarget } from './live-match';
import { saveArchive, importArchive, startArchiveDrag, listenArchiveDrop, copyArchiveFile, pasteArchiveFiles, type ArchiveSnapshot, type ValidatedArchive } from './archive-bridge';
import { enqueueArchive, enqueueCurrentArchive, removeQueuedArchive, reorderQueuedArchive, ARCHIVE_QUEUE_LIMIT, type QueueChange } from './archive-queue';
import { archiveShortcut } from './archive-shortcuts';
import { RecipeDetails, useRecipeWindow } from './RecipeWindow';
import { trialView } from './trial-view';
import { TicketDock, OrderStampOverlay, type TicketOrder } from './TicketDock';
import type { ArchiveDragGesture } from './ArchiveLogo';
import { HostPanel } from './HostPanel';
import ModelPanel from './ModelPanel';
import StoragePanel from './StoragePanel';
import TrialPanel from './TrialPanel';
import { I18nProvider, Localized, translate, useI18n } from './i18n';
import { localizedRecipe } from './recipe-i18n';
import { displayQuantity } from './quantity-display';
import { TastePreview } from './TastePie';
import RecipeLibrary from './RecipeLibrary';
import { combineCatalog, emptyLibrary, importLibraryArchive, readLibrary, reconcileSelection, visibleCatalog, writeLibrary, type LibraryAction } from './recipe-library';
import { useCurrentState } from './useCurrentState';
import { persistLatestState, persistQueueChange } from './workbench-persistence';
import { appName, APP_NAME_EN, APP_VERSION, APP_DEVELOPER, PROJECT_URL } from './brand';
import { normalizeLanguage } from './language';

function Icon({name,size=18}:{name:string;size?:number}) {
  const paths:Record<string,React.ReactNode> = {
    search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
    settings:<><path d="M4 7h16M4 17h16M8 4v6M16 14v6"/><rect x="6" y="5" width="4" height="4"/><rect x="14" y="15" width="4" height="4"/></>,
    arrow:<path d="M5 12h14m-5-5 5 5-5 5"/>,
    heart:<path d="m12 20-8-8C-2 4 9 0 12 7c3-7 14-3 8 5Z"/>,
    undo:<><path d="M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12"/></>,
    shuffle:<><path d="M3 6h4l10 12h4M17 14l4 4-4 4M3 18h4l10-12h4M17 2l4 4-4 4"/></>,
    list:<><path d="M8 5h13M8 12h13M8 19h13M2 5h2M2 12h2M2 19h2"/></>,
    close:<path d="m5 5 14 14M5 19 19 5"/>,
    copy:<><path d="M8 3h13v13M3 8h13v13H3Z"/></>,
    check:<path d="m4 12 5 5L20 6"/>,
    plus:<path d="M12 4v16M4 12h16"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden="true">{paths[name] || paths.arrow}</svg>;
}
function SectionHead({title,aside}:{title:string;aside?:React.ReactNode}) { const {t}=useI18n(); return <div className="section-head"><h2>{t(title)}</h2>{aside}</div>; }
type Overlay = 'library'|'settings'|'review'|'source'|null;
interface Undo { selected:string; target:UserState['target']; locked:number[] }

export default function App() {
  const [baseCatalog,setBaseCatalog]=useState<Catalog|null>(null);
  const [library,setLibrary]=useState(emptyLibrary);
  const libraryCurrent=useRef(library),librarySaving=useRef(false);
  const [libraryBusy,setLibraryBusy]=useState(false);
  const [libraryImportedId,setLibraryImportedId]=useState('');
  libraryCurrent.current=library;
  const catalog=useMemo(()=>baseCatalog?combineCatalog(baseCatalog,library):null,[baseCatalog,library]);
  const availableCatalog=useMemo(()=>catalog?visibleCatalog(catalog,library):null,[catalog,library]);
  const [ui,setUi,current]=useCurrentState<UserState|null>(null);
  const language=normalizeLanguage(ui?ui.settings.language:localStorage.getItem('timer.language')),t=(text:string)=>translate(text,language);
  useEffect(()=>{document.documentElement.lang=language==='en'?'en':'zh-CN';document.title=appName(language);localStorage.setItem('timer.language',language);if(native)void getCurrentWindow().setTitle(appName(language)).catch(()=>{});},[language]);
  const [fatal,setFatal]=useState('');
  const [error,setError]=useState('');
  const [overlay,setOverlay,overlayCurrent]=useCurrentState<Overlay>(null);
  const [toast,setToast]=useState('');
  const [history,setHistory]=useState<Undo[]>([]);
  const [drawer,setDrawer]=useState(false);
  const [pinned,setPinned]=useState(false);
  const [servings,setServings]=useState(1);
  const [settingsTab,setSettingsTab]=useState('常规');
  const [inventorySearch,setInventorySearch]=useState('');
  const [reviewName,setReviewName]=useState('');
  const [reviewScore,setReviewScore]=useState(3);
  const [reviewNote,setReviewNote]=useState('');
  const [reviewConsent,setReviewConsent]=useState(false);
  const [saveStatus,setSaveStatus]=useState('正在读取');
  const [randomNearby,setRandomNearby]=useState(false);
  const [sliderMotion,setSliderMotion]=useState({id:0,enabled:false});
  const [archiveImportSequence,setArchiveImportSequence]=useState(0);
  const [queueSaving,setQueueSaving]=useState(false),queueSavingRef=useRef(false);
  const clipboardBusy=useRef(false);
  const [tastePreview,setTastePreview]=useState<Taste|null>(null);
  const motionVersion=useRef(0);
  const stopSliderMotion=useCallback(()=>setSliderMotion(m=>m.enabled?{...m,enabled:false}:m),[]);
  const [startup,setStartup]=useState<'logo'|'arriving'|'ready'>('logo'),[fontReady,setFontReady]=useState(false),[generating,setGenerating]=useState(false);
  const boot=startup==='logo',arrivedModules=useRef(new Set<EventTarget>());
  const generatingRef=useRef(false);
  const moduleDirections=useMemo(()=>{
    const delays=[0,35,70,105,140,175,210];
    for(let i=delays.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[delays[i],delays[j]]=[delays[j],delays[i]];}
    return delays.map(delay=>{const side=Math.floor(Math.random()*4);return {x:side===0?'-110vw':side===1?'110vw':'0px',y:side===2?'-110vh':side===3?'110vh':'0px',delay};});
  },[]);
  useEffect(()=>{
    if(startup==='ready'){performance.mark('timer:workbench-ready');return;}
    if(startup!=='arriving')return;
    // Keep the workbench usable if the window is minimized during module arrival.
    const fallback=setTimeout(()=>setStartup('ready'),1100);
    return()=>clearTimeout(fallback);
  },[startup]);
  useEffect(()=>{if(fatal&&native)void getCurrentWindow().show();},[fatal]);
  const [openedOrder,setOpenedOrder]=useState<TicketOrder|null>(null);
  useEffect(()=>{document.fonts.load('12px PixelMix').then(()=>setFontReady(true),()=>setFontReady(true));},[]);
  const gesture=useRef(false), gestureSnapshot=useRef<Undo|null>(null), adjustment=useRef(0);
  const hoverTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined), saveQueue=useRef(Promise.resolve());
  const persistencePaused=useRef(false),closing=useRef(false);
  useEffect(()=>{if(!native)return;let disposed=false,off:(()=>void)|undefined;void getCurrentWindow().onCloseRequested(event=>{event.preventDefault();void closeWindow();}).then(fn=>{if(disposed)fn();else off=fn;});return()=>{disposed=true;off?.();};},[]);
  const mainRef=useRef<HTMLElement>(null), dialogRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{ let alive=true; (async()=>{try{const c=await loadCatalog();if(!c.recipes.length)throw new Error('酒谱库为空'); const [stored,localLibrary]=await Promise.all([readState(),readLibrary()]); const initial=reconcileSelection(stored || defaultState(c),visibleCatalog(combineCatalog(c,localLibrary),localLibrary)); validateTaste(initial.target.taste_bps);if(initial.target.sensory_0_10.length!==7 || initial.target.sensory_0_10.some(v=>!Number.isFinite(v)||v<0||v>10))throw new Error('已保存的七维目标无效');if(alive){setBaseCatalog(c);setLibrary(localLibrary);setUi(initial);setSaveStatus(native?'已载入本机数据库':'浏览器测试存储');}}catch(e){if(alive)setFatal(String(e));}})();return()=>{alive=false};},[]);
  useEffect(()=>{
    if(!ui)return; const timer=setTimeout(()=>{
      if(gesture.current||persistencePaused.current)return;
      setSaveStatus('正在保存'); const snapshot=ui;
      saveQueue.current=saveQueue.current.then(async()=>{
        // A queued debounce must never overwrite a newer completed/reordered queue.
        if(snapshot!==current.current||persistencePaused.current)return false;
        await writeState(snapshot);return true;
      }).then(written=>{if(written)setSaveStatus(native?'已保存到本机':'已保存 · 测试存储');}).catch(e=>{setSaveStatus('保存失败');setError(`本机保存失败：${String(e)}。当前修改仍在内存。`);});
    },350); return()=>clearTimeout(timer);
  },[ui]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(t);},[toast]);
  useEffect(()=>{ const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){dismissOverlay();setDrawer(false);setPinned(false);}}; window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useEffect(()=>{
    const el=dialogRef.current;if(!overlay||!el)return;const previous=document.activeElement as HTMLElement|null;
    const focusable=()=>Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex="0"]'));
    focusable()[0]?.focus();const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const list=focusable();const first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};el.addEventListener('keydown',trap);return()=>{el.removeEventListener('keydown',trap);previous?.focus();};
  },[overlay]);
  const activeTrial=useMemo(()=>ui?.generatedTrials?.find(t=>t.recipe.id===ui.selected),[ui?.selected,ui?.generatedTrials]);
  const recipe=useMemo(()=>activeTrial?.recipe||availableCatalog?.recipes.find(r=>r.id===ui?.selected)||availableCatalog?.recipes[0],[availableCatalog,ui?.selected,activeTrial]);
  useEffect(()=>{if(availableCatalog)setUi(u=>u?reconcileSelection(u,availableCatalog):u);},[availableCatalog]);
  const profile=useMemo(()=>activeTrial?.profile||catalog?.profiles.find(p=>p.recipe_id===recipe?.id),[catalog,recipe,activeTrial]);
  const feasible=useMemo(()=>availableCatalog&&ui?filterRecipes(availableCatalog,'',ui.inventory,ui.excluded,ui.inventoryOnly):[],[availableCatalog,ui?.inventory,ui?.excluded,ui?.inventoryOnly]);
  const ranked=useMemo(()=>catalog&&ui?feasible.map(r=>({recipe:r,score:matchIndex(ui.target,catalog.profiles.find(p=>p.recipe_id===r.id))})).sort((a,b)=>(b.score??-1)-(a.score??-1)):[],[catalog,feasible,ui?.target]);
  const remember=useCallback(()=>{const u=current.current;if(!u)return;const snap={selected:u.selected,target:structuredClone(u.target),locked:[...u.locked]};gestureSnapshot.current=snap;setHistory(h=>[...h.slice(-39),snap]);},[]);
  const begin=useCallback(()=>{stopSliderMotion();if(!gesture.current){remember();gesture.current=true;}},[remember,stopSliderMotion]);
  const end=useCallback(()=>{gesture.current=false;setUi(u=>u?{...u}:u);},[]);
  const cancel=useCallback(()=>{stopSliderMotion();adjustment.current++;gesture.current=false;if(gestureSnapshot.current)setUi(u=>u?{...u,...gestureSnapshot.current!}:u);setHistory(h=>h.slice(0,-1));},[stopSliderMotion]);
  const changeTaste=useCallback(async(anchor:Taste,axis:number,value:number)=>{
    const u=current.current;if(!u)return;const seq=++adjustment.current;
    try {const next=await adjustTaste(anchor,axis,value,u.locked);validateTaste(next);if(seq===adjustment.current)setUi(v=>v?matchTarget(v,{...v.target,taste_bps:next},availableCatalog):v);} catch(e){setError(`五味修改未应用：${String(e)}`);}
  },[availableCatalog]);
  function selectRecipe(r:Recipe,loadTarget=false,animate=loadTarget) {if(!catalog||!ui)return;adjustment.current++;remember();setSliderMotion({id:++motionVersion.current,enabled:animate});const p=catalog.profiles.find(p=>p.recipe_id===r.id)||ui.generatedTrials?.find(t=>t.recipe.id===r.id)?.profile;setUi(u=>u?{...u,selected:r.id,...(loadTarget&&p?{target:{taste_bps:[...p.taste_preference_bps],sensory_0_10:[...p.sensory_0_10]},locked:[]}: {})}:u);dismissOverlay();setServings(1);setToast(loadTarget?'已载入配方预测 · 可撤销':'已切换酒谱 · 你的目标保持不变');}
  function undo() {const last=history.at(-1);if(!last)return;stopSliderMotion();adjustment.current++;setUi(u=>u&&availableCatalog?reconcileSelection({...u,...last},availableCatalog):u);setHistory(h=>h.slice(0,-1));setToast('已撤销上一次操作');}
  function update(patch:Partial<UserState>) {setUi(u=>u?{...u,...patch}:u);}
  function toggleList(key:'inventory'|'excluded'|'favorites',id:string){if(!ui)return;update({[key]:ui[key].includes(id)?ui[key].filter(v=>v!==id):[...ui[key],id]});}
  function saveDraft(){if(!ui||!recipe)return;update({drafts:[...ui.drafts,{id:crypto.randomUUID(),created_at:new Date().toISOString(),recipe:structuredClone(recipe),target:structuredClone(ui.target)}]});setToast('已保存本机点单草稿；未提交订单、未扣票');}
  async function copyRecipe(){if(!recipe||!catalog)return;try{const view=localizedRecipe(recipe,language);await navigator.clipboard.writeText(`${recipe.name_zh} / ${recipe.name_en}\n${view.ingredients.map(i=>{const ingredient=catalog.ingredients.find(item=>item.id===i.ingredient_id),amount=displayQuantity(i,ingredient,servings,language);return `${language==='en'?ingredient?.name_en||i.ingredient_id:ingredient?.name_zh||i.ingredient_id} ${amount.text} [${i.stage}]${amount.note?` (${amount.note})`:''}${i.quantity_note?` (${i.quantity_note})`:''}`;}).join('\n')}\n${view.steps_zh.join('\n')}\n${t('来源')}：${recipe.source.url || recipe.source.reference}\n${t('份数')}：${servings}`);setToast('配方和来源已复制');}catch(e){setError(`复制失败：${String(e)}`);}}

  function randomRecipe(){const pool=(randomNearby?ranked.slice(0,Math.min(10,ranked.length)):ranked).filter(r=>r.recipe.id!==recipe?.id);if(!pool.length){setToast('当前库存与排除限制下，没有其他可选酒谱');return;}const r=new Uint32Array(1);crypto.getRandomValues(r);selectRecipe(pool[r[0]%pool.length].recipe,true,true);}
  async function submitReview(){if(!current.current||!recipe||!catalog||!reviewName.trim()||!reviewConsent)return;const review={id:crypto.randomUUID(),recipe_id:recipe.id,recipe_revision_id:recipe.recipe_revision_id || `${recipe.id}@${catalog.schema_version}:${catalog.seed_sha256||recipe.source.checked_on}`,user_name:reviewName.trim(),score:reviewScore,note:reviewNote.trim(),tasted_at:new Date().toISOString(),consent:true,snapshot:structuredClone(recipe)};try{setUi(state=>state?{...state,reviews:[...state.reviews,review]}:state);saveQueue.current=saveQueue.current.then(()=>persistLatestState(()=>current.current,writeState));await saveQueue.current;dismissAfterAsync();setReviewNote('');setReviewConsent(false);setToast('实饮评价已保存到此酒谱版本');}catch(e){setError(`评价保存失败：${String(e)}`);}}
  function acceptTrial(result:Record<string,unknown>) {
    if(!catalog)return;const t=trialView(result,catalog);remember();setUi(u=>u?{...u,selected:t.recipe.id,generatedTrials:[...(u.generatedTrials||[]).slice(-3),t]}:u);dismissAfterAsync();setToast(result.model_used?'已生成试调 · 待审核':'规则试调 · 模型未参与');
  }
  async function generateFromWorkbench(){
    if(!ui||!catalog||generatingRef.current)return;
    if(!ui.settings.aiMode)return;
    if(!native){setError('浏览器预览不运行模型。请在原生应用中生成。');return;}
    if(!Object.keys(ui.trialInventory||{}).length){setSettingsTab('规则试调');setOverlay('settings');setToast('先核对实际原料与标签，再生成试调');return;}
    generatingRef.current=true;setGenerating(true);
    try{const result=await invoke<Record<string,unknown>>('generate_trial',{request:{taste_bps:[...ui.target.taste_bps],sensory_0_10:[...ui.target.sensory_0_10],inventory:structuredClone(ui.trialInventory),excluded_ingredients:[...ui.excluded],max_ethanol_ml:24,maximum_pre_dilution_liquid_ml:240},useModel:true});if(!result.chosen){setError(String(result.reason||'现有原料下没有可行候选'));return;}acceptTrial(result);if(result.fallback_reason)setToast(`规则试调 · ${String(result.fallback_reason)}`);}catch(e){setError(`生成未完成：${String(e)}`);}finally{generatingRef.current=false;setGenerating(false);}
  }
  useEffect(()=>{
    if(!native)return;let disposed=false,unlisten:(()=>void)|undefined;
    void listenArchiveDrop(archive=>{
      if(disposed)return;
      acceptArchives([archive]);
    },reason=>{if(!disposed)setError(`存档未载入：${reason}`);},path=>{
      if(overlayCurrent.current!=='library'&&!document.querySelector('.empty-library-workbench'))return;
      const editing=!!document.querySelector('.recipe-editor');
      return async()=>{
        if(editing||document.querySelector('.recipe-editor'))throw Error('请先保存或取消正在编辑的配方，再拖入存档。');
        if(disposed)return;
        await addLibraryArchive(path);
      };
    }).then(off=>{if(disposed)off();else unlisten=off;}).catch(e=>setError(String(e)));
    return()=>{disposed=true;unlisten?.();};
  },[remember]);
  function acceptArchives(archives:ValidatedArchive[]){
    if(!current.current||closing.current||persistencePaused.current||queueSavingRef.current)throw Error('队列正在保存，请稍后重试。');
    let next=current.current,activated=false;
    // Validate the complete batch against capacity before changing any UI state.
    for(const archive of archives){const change=enqueueArchive(next,archive);next=change.state;activated||=change.activated;}
    setUi(next);
    if(activated){adjustment.current++;gesture.current=false;setHistory([]);setSliderMotion({id:++motionVersion.current,enabled:true});dismissAfterAsync();setServings(1);}
    setArchiveImportSequence(n=>n+1);
  }
  async function commitQueueChange(operation:(state:UserState)=>QueueChange){
    if(!current.current||closing.current||persistencePaused.current||queueSavingRef.current)throw Error('队列正在保存，请稍后重试。');
    queueSavingRef.current=true;setQueueSaving(true);
    try{
      const pending=saveQueue.current.catch(()=>{}).then(()=>persistQueueChange(()=>current.current,setUi,operation,writeState));
      saveQueue.current=pending.then(()=>{},()=>{});
      const change=await pending;
      if(change.activated){adjustment.current++;gesture.current=false;setHistory([]);setSliderMotion({id:++motionVersion.current,enabled:true});setServings(1);dismissOverlay();}
    }catch(e){setError(`队列修改失败：${String(e)}`);throw e;}
    finally{queueSavingRef.current=false;setQueueSaving(false);}
  }
  async function removeArchive(id:string){await commitQueueChange(state=>removeQueuedArchive(state,id));}
  async function reorderArchive(id:string,beforeId:string|null){await commitQueueChange(state=>reorderQueuedArchive(state,id,beforeId));}
  async function copyMainArchive(){
    if(!recipe||!profile||!current.current)return;
    const saved=await saveArchive({recipe:structuredClone(recipe),profile:structuredClone(profile),target:structuredClone(current.current.target)});
    await copyArchiveFile(saved.archive_id);setToast('酒谱文件已复制');
  }
  useEffect(()=>{
    if(!native||startup!=='ready')return;
    const key=(event:KeyboardEvent)=>{
      if(overlayCurrent.current||closing.current||persistencePaused.current)return;
      const element=event.target instanceof Element?event.target:null;
      const editing=!!element?.closest('input:not([type="range"]):not([type="checkbox"]),textarea,select,[contenteditable="true"],[role="textbox"]');
      const action=archiveShortcut(event,editing,!!window.getSelection()?.toString());if(!action)return;
      event.preventDefault();if(clipboardBusy.current)return;clipboardBusy.current=true;
      void (action==='copy'?copyMainArchive():pasteArchiveFiles().then(acceptArchives)).catch(e=>setError(`${action==='copy'?'复制':'粘贴'}酒谱失败：${String(e)}`)).finally(()=>{clipboardBusy.current=false;});
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[recipe,profile,startup]);
  async function queueCurrentDrink(){
    if(!native||!recipe||!profile||!current.current||queueSavingRef.current||closing.current||persistencePaused.current)return;
    if((current.current.archiveQueue?.length||0)>=ARCHIVE_QUEUE_LIMIT){setError(`制作队列已满（${ARCHIVE_QUEUE_LIMIT} 杯），请先完成或移除一杯。`);return;}
    // Capture the clicked drink before awaiting IPC. A later slider/recipe change
    // must never rewrite this serving or get overwritten by its arrival.
    const snapshot={recipe:structuredClone(recipe),profile:structuredClone(profile),target:structuredClone(current.current.target)};
    queueSavingRef.current=true;setQueueSaving(true);
    try{
      const saved=await saveArchive(snapshot),validated=await importArchive(saved.path);
      if(closing.current||persistencePaused.current||!current.current)throw Error('当前正在恢复数据，请稍后加入队列。');
      const change=enqueueCurrentArchive(current.current,validated);
      setUi(change.state);
      // The new queue entry and its original recipe/target are real SQLite data.
      // Existing debounced edits share this ordered writer, so newer edits win.
      const pending=saveQueue.current.catch(()=>{}).then(()=>writeState(change.state));
      saveQueue.current=pending.catch(()=>{});
      await pending;
      setArchiveImportSequence(n=>n+1);setToast('已加入制作队列');
    }catch(e){setError(`加入制作队列失败：${String(e)}`);}
    finally{queueSavingRef.current=false;setQueueSaving(false);}
  }
  async function dragSnapshot(snapshot:ArchiveSnapshot,gesture:ArchiveDragGesture){
    try{if(gesture.signal.aborted)return;const saved=await saveArchive(structuredClone(snapshot));if(gesture.signal.aborted)return;if(!saved.icon_association.registered)setError(`存档已保存，图标关联失败：${saved.icon_association.reason}`);if(!gesture.handoff())return;const result=await startArchiveDrag(saved.archive_id);if(result.status==='dropped')setToast('酒谱存档已拖出');}catch(e){if(!gesture.signal.aborted)setError(`存档拖出失败：${String(e)}`);}
  }
  async function dragArchive(gesture:ArchiveDragGesture){
    if(!recipe||!profile||!current.current)return;
    await dragSnapshot({recipe,profile,target:structuredClone(current.current.target)},gesture);
  }
  async function dragLibraryArchive(recipe:Recipe,profile:Profile|undefined,gesture:ArchiveDragGesture){
    if(!profile)return;
    await dragSnapshot({recipe,profile,target:{taste_bps:[...profile.taste_preference_bps],sensory_0_10:[...profile.sensory_0_10]}},gesture);
  }
  async function dragQueueArchive(id:string,gesture:ArchiveDragGesture){
    const entry=current.current?.archiveQueue?.find(item=>item.id===id);if(!entry)return;
    const original=entry.personal.audit.original_snapshot as ArchiveSnapshot|undefined;
    await dragSnapshot({recipe:original?.recipe||entry.personal.recipe,profile:original?.profile||entry.personal.profile,target:entry.target},gesture);
  }
  useRecipeWindow({recipe,language,ingredients:catalog?.ingredients||[],open:drawer&&!overlay,pinned,servings,setServings,onEnter:()=>clearTimeout(hoverTimer.current),onLeave:()=>{if(!pinned)hoverTimer.current=setTimeout(()=>setDrawer(false),280);},onPin:()=>setPinned(p=>!p),onClose:()=>{setDrawer(false);setPinned(false);},onError:setError});
  function dismissOverlay(){if(librarySaving.current)return;setOverlay(null);}
  function dismissAfterAsync(){if(librarySaving.current)return;setOverlay(value=>value==='library'?value:null);}
  async function addLibraryArchive(path:string){
    if(closing.current||persistencePaused.current)throw Error('程序正在关闭或恢复数据。');
    if(librarySaving.current)throw Error('酒谱修改正在保存。');
    librarySaving.current=true;setLibraryBusy(true);
    try{
      const result=await importLibraryArchive(libraryCurrent.current,path);
      libraryCurrent.current=result.library;setLibrary(result.library);
      adjustment.current++;setHistory([]);
      setUi(u=>u?{...u,selected:result.added_id}:u);
      setLibraryImportedId(result.added_id);setOverlay('library');
      setArchiveImportSequence(n=>n+1);
    }catch(e){
      try{const fresh=await readLibrary();libraryCurrent.current=fresh;setLibrary(fresh);}catch{/* Preserve the original import error. */}
      throw e;
    }finally{librarySaving.current=false;setLibraryBusy(false);}
  }
  async function applyLibraryChange(action:LibraryAction){
    if(closing.current||persistencePaused.current)throw new Error(language==='en'?'The app is closing or restoring data.':'程序正在关闭或恢复数据。');
    if(librarySaving.current)throw new Error(language==='en'?'A library change is still saving.':'酒谱修改正在保存。');
    librarySaving.current=true;setLibraryBusy(true);
    try{
      const before=libraryCurrent.current;
      const next=await writeLibrary(before,action);
      libraryCurrent.current=next;setLibrary(next);adjustment.current++;setHistory([]);
      if(action.action==='create'){
        const ids=new Set(before.custom.map(e=>e.recipe.id));
        const created=next.custom.find(e=>!ids.has(e.recipe.id));
        if(created)setUi(u=>u?{...u,selected:created.recipe.id}:u);
      }
    }catch(e){
      // A stale revision never overwrites another writer. Refresh for a deliberate retry.
      try{const fresh=await readLibrary();libraryCurrent.current=fresh;setLibrary(fresh);}catch{/* Keep current library visible; original error remains actionable. */}
      throw e;
    }finally{librarySaving.current=false;setLibraryBusy(false);}
  }
  async function closeWindow(){if(closing.current||librarySaving.current||queueSavingRef.current)return;closing.current=true;try{persistencePaused.current=true;await saveQueue.current;if(current.current)await writeState(current.current);if(native)await getCurrentWindow().destroy();}catch(e){closing.current=false;persistencePaused.current=false;setError(`关闭前保存失败：${String(e)}`);}}
  if(fatal)return <I18nProvider language={language}><Localized><div className="fatal"><div className="brand-mark">PM</div><h1>本机资料未能载入</h1><p>应用没有用空白数据替代你的酒谱库。</p><pre>{fatal}</pre><button className="primary" onClick={()=>location.reload()}>重新读取</button><p>现有资料不会因为重新读取而被删除。</p></div></Localized></I18nProvider>;
  if(!catalog||!ui)return <BootMosaic ready={false} animate={true} onDone={()=>{}}/>;
  if(!recipe)return <I18nProvider language={language}><Localized><div lang={language} className={`app ${ui.settings.reducedMotion?'reduced-motion':''}`} style={{'--font-scale':ui.settings.fontScale} as React.CSSProperties}>
    <header className="pixel-titlebar" data-tauri-drag-region><span className="app-title" data-tauri-drag-region>{appName(language)}</span><div><button aria-label="关闭窗口" disabled={!native||libraryBusy||queueSaving} onClick={()=>void closeWindow()}>×</button></div></header>
    <main className="empty-library-workbench" data-startup-phase={startup} inert={startup!=='ready'}><h2>{language==='en'?'Recipe library':'经典酒谱库'}</h2><p>{language==='en'?'No visible recipes. Add a recipe, or restore one from Hidden or Deleted.':'暂无可显示的酒谱。添加一杯，或从“已隐藏”“已删除”中恢复。'}</p><RecipeLibrary catalog={catalog} library={library} state={ui} onApply={applyLibraryChange} onSelect={selectRecipe} onRecipeDrag={native?dragLibraryArchive:undefined} importedRecipeId={libraryImportedId} importBusy={libraryBusy}/></main>
    {boot&&<BootMosaic ready={fontReady} animate={!ui.settings.reducedMotion&&ui.settings.startupAnimation!==false} onDone={animated=>setStartup(animated?'arriving':'ready')} onError={setFatal}/>}
    {error&&<div className="error-banner" role="alert">{error}<button onClick={()=>setError('')}>×</button></div>}
  </div></Localized></I18nProvider>;
  const match=matchIndex(ui.target,profile), favorite=ui.favorites.includes(recipe.id), missing=requiredMissing(recipe,ui.inventory);
  const deviated=profile&&(ui.target.taste_bps.some((v,i)=>v!==profile.taste_preference_bps[i])||ui.target.sensory_0_10.some((v,i)=>v!==profile.sensory_0_10[i]));
  const reviews=ui.reviews.filter(r=>r.recipe_id===recipe.id && r.recipe_revision_id===(recipe.recipe_revision_id || `${recipe.id}@${catalog.schema_version}:${catalog.seed_sha256||recipe.source.checked_on}`));
  const controls={target:ui.target,profile,locked:ui.locked,motion:{id:sliderMotion.id,enabled:sliderMotion.enabled&&!ui.settings.reducedMotion},onInterruptMotion:stopSliderMotion,onBegin:begin,onEnd:end,onCancel:cancel,onTaste:changeTaste,onSensory:(axis:number,value:number)=>setUi(u=>{if(!u)return u;const sensory=[...u.target.sensory_0_10] as UserState['target']['sensory_0_10'];sensory[axis]=value;return matchTarget(u,{...u.target,sensory_0_10:sensory},availableCatalog);}),onLock:(axis:number)=>{stopSliderMotion();adjustment.current++;update({locked:ui.locked.includes(axis)?ui.locked.filter(v=>v!==axis):[...ui.locked,axis]});},onPreset:()=>selectRecipe(recipe,true)};
  const displayRecipe=localizedRecipe(recipe,language);
  return <I18nProvider language={language}><Localized><div lang={language} className={`app ${ui.settings.reducedMotion?'reduced-motion':''}`} style={{'--font-scale':ui.settings.fontScale} as React.CSSProperties}>
    <header className="pixel-titlebar" data-tauri-drag-region><span className="app-title" data-tauri-drag-region>{appName(language)}</span><div><span className={`save-led ${saveStatus.includes('失败')?'failed':''}`} title={saveStatus}/><button aria-label="最小化窗口" disabled={!native} onClick={()=>void getCurrentWindow().minimize()}>−</button><button aria-label="关闭窗口" disabled={!native||libraryBusy||queueSaving} onClick={()=>void closeWindow()}>×</button></div></header>
    <main id="workbench" data-startup-phase={startup} className={boot?'boot-underlay':startup==='arriving'?'modules-arrive':''} ref={mainRef} inert={startup!=='ready'} aria-label="调酒工作台" onAnimationStart={event=>{if(startup==='arriving'&&event.animationName==='module-arrival')performance.mark(`timer:module-start:${(event.target as HTMLElement).getAttribute('aria-label')}`);}} onAnimationEnd={event=>{if(startup!=='arriving'||event.animationName!=='module-arrival')return;performance.mark(`timer:module-end:${(event.target as HTMLElement).getAttribute('aria-label')}`);arrivedModules.current.add(event.target);if(arrivedModules.current.size===7)setStartup('ready');}}>
      <div className="workspace">
        <section className="panel name-panel" style={{'--enter-x':moduleDirections[0].x,'--enter-y':moduleDirections[0].y,'--enter-delay':`${moduleDirections[0].delay}ms`} as React.CSSProperties} aria-label="酒名"><button data-i18n="verbatim" className="recipe-title" data-long-title={recipe.name_zh.length>9||recipe.name_en.length>30} title={`${recipe.name_zh} / ${recipe.name_en}`} onClick={()=>setOverlay('library')}><h1>{language==='en'?recipe.name_en:recipe.name_zh}</h1><span>{language==='en'?recipe.name_zh:recipe.name_en}</span></button><div className="recipe-tags"><span>{METHOD_LABELS[recipe.method]||recipe.method}</span><button className="text-link" onClick={()=>setOverlay('source')} aria-label="查看来源与版本" title="查看来源与版本">↗</button>{activeTrial&&<span className="trial-badge" title={activeTrial.audit.model_used?'本地模型辅助命名，待实作审核':'纯规则候选，模型未参与'}>{recipe.source.kind==='imported_snapshot'?'个人存档':activeTrial.audit.model_used?'AI 试调':'规则试调'}</span>}</div></section>
        <section className="panel recipe-panel" style={{'--enter-x':moduleDirections[1].x,'--enter-y':moduleDirections[1].y,'--enter-delay':`${moduleDirections[1].delay}ms`} as React.CSSProperties} aria-label="配料表" onMouseEnter={()=>{clearTimeout(hoverTimer.current);hoverTimer.current=setTimeout(()=>setDrawer(true),240);}} onMouseLeave={()=>{clearTimeout(hoverTimer.current);if(!pinned)hoverTimer.current=setTimeout(()=>setDrawer(false),220);}}>
          <SectionHead title="配料" aside={<span className="tiny-corner">{recipe.ingredients.length}</span>}/><button className="recipe-preview" onClick={()=>{setPinned(!pinned);setDrawer(!pinned);}} aria-expanded={drawer} aria-label="固定或关闭配方抽屉"><div>{recipe.ingredients.slice(0,5).map((i,n)=><div className="ingredient-line" key={`${i.ingredient_id}-${n}`}><span data-i18n="verbatim">{language==='en'?catalog.ingredients.find(ingredient=>ingredient.id===i.ingredient_id)?.name_en||i.ingredient_id:ingredientName(catalog.ingredients,i.ingredient_id)}</span><b data-i18n="verbatim" title={[displayQuantity(i,catalog.ingredients.find(ingredient=>ingredient.id===i.ingredient_id),1,language).text,displayQuantity(i,catalog.ingredients.find(ingredient=>ingredient.id===i.ingredient_id),1,language).note,i.quantity_note].filter(Boolean).join(' ')}>{i.quantity===null&&!i.quantity_range?(language==='en'?'Unspec.':'待定'):displayQuantity(i,catalog.ingredients.find(ingredient=>ingredient.id===i.ingredient_id),1,language).text}</b></div>)}</div><span className="recipe-open"><span>←</span>配方与步骤{pinned?' ▣':''}</span></button>
        </section>
        <section className="panel engine-panel" style={{'--enter-x':moduleDirections[2].x,'--enter-y':moduleDirections[2].y,'--enter-delay':`${moduleDirections[2].delay}ms`} as React.CSSProperties} aria-label="设置与生成"><div className="engine-actions"><button className="square-action" aria-label="打开设置" title="设置" onClick={()=>setOverlay('settings')}><Icon name="settings" size={25}/><span>设置</span></button><button className="square-action generate-action" aria-label="AI匹配" title={ui.settings.aiMode?'按当前目标匹配并生成待审核试调':'在设置中启用 AI 模式；拖动滑杆可实时匹配经典酒谱'} disabled={generating||!ui.settings.aiMode} onClick={()=>void generateFromWorkbench()}><span className={generating?'pixel-spin':''}>{generating?'◌':ui.settings.aiMode?'✦':'↗'}</span><span>{generating?'匹配中':'匹配'}</span></button><button type="button" className="square-action enqueue-current-action" aria-label="将当前酒加入制作队列" aria-busy={queueSaving} title={native?'将当前酒加入制作队列':'在桌面应用中加入制作队列'} disabled={!native||!profile||queueSaving} onClick={()=>void queueCurrentDrink()}><Icon name="plus" size={25}/><span>队列</span></button><button className="icon-button undo" aria-label="撤销" title="撤销" onClick={undo} disabled={!history.length}><Icon name="undo"/></button></div></section>
        <section className="panel ticket-panel" style={{'--enter-x':moduleDirections[3].x,'--enter-y':moduleDirections[3].y,'--enter-delay':`${moduleDirections[3].delay}ms`} as React.CSSProperties} aria-label="票据与局域网"><TicketDock recipe={recipe} target={ui.target} reducedMotion={ui.settings.reducedMotion} onManage={()=>{setSettingsTab('主机');setOverlay('settings');}} onOpenOrder={setOpenedOrder} onArchiveDrag={native?dragArchive:undefined} archiveQueue={(ui.archiveQueue||[]).map(entry=>({id:entry.id,name:language==='en'?entry.personal.recipe.name_en:entry.personal.recipe.name_zh}))} onArchiveRemove={removeArchive} onArchiveReorder={reorderArchive} onQueueArchiveDrag={native?dragQueueArchive:undefined} archiveImportSequence={archiveImportSequence}/></section>
        <section className="panel taste-panel" style={{'--enter-x':moduleDirections[4].x,'--enter-y':moduleDirections[4].y,'--enter-delay':`${moduleDirections[4].delay}ms`} as React.CSSProperties} aria-label="五味偏好"><div className="taste-axis-labels"><span>0%</span><span data-testid="taste-sum" title="五味按内部10000基点合计100%；各项显示取整，不是原料体积比例">Σ 100%</span><span>100%</span></div><TasteControls {...controls} onTastePreview={setTastePreview} presets={feasible.flatMap(r=>{const p=catalog.profiles.find(p=>p.recipe_id===r.id);return p?[{recipe_id:r.id,name_zh:r.name_zh,name_en:r.name_en,profile:p}]:[];})} onSelectPreset={id=>{const r=feasible.find(r=>r.id===id);if(r)selectRecipe(r,true);}}/></section>
        <section className="panel sensory-panel" style={{'--enter-x':moduleDirections[5].x,'--enter-y':moduleDirections[5].y,'--enter-delay':`${moduleDirections[5].delay}ms`} as React.CSSProperties} aria-label="风味维度"><SensoryControls {...controls}/></section>
        <section className="panel glass-panel" style={{'--enter-x':moduleDirections[6].x,'--enter-y':moduleDirections[6].y,'--enter-delay':`${moduleDirections[6].delay}ms`} as React.CSSProperties} aria-label="酒杯"><div className="glass-actions" role="group" aria-label="酒谱工具"><button type="button" className="icon-button" aria-label="打开经典酒谱库" title="酒谱库" onClick={()=>setOverlay('library')}><Icon name="list"/></button><button type="button" className={`icon-button favorite ${favorite?'selected':''}`} onClick={()=>toggleList('favorites',recipe.id)} aria-label={favorite?'取消收藏':'收藏此酒谱'} title={favorite?'取消收藏':'收藏此酒谱'} aria-pressed={favorite}><Icon name="heart"/></button></div><Glass onArchiveDrag={native?dragArchive:undefined} quoteKey={(activeTrial?.audit.original_snapshot as {recipe?:Recipe}|undefined)?.recipe?.id} recipe={recipe} ingredients={catalog.ingredients} profile={profile} target={ui.target}/><div className="glass-tools"><button className="random-control" aria-label="随机酒谱" title="随机酒谱" onClick={randomRecipe} disabled={!feasible.length}>↻</button><label className="nearby-control" title="只从当前口味最接近的10种酒中随机"><input type="checkbox" checked={randomNearby} onChange={e=>setRandomNearby(e.target.checked)}/>附近</label><button aria-label="记录实饮评价" className="compact-rating" onClick={()=>setOverlay('review')} title={`偏好匹配 ${match===null?'未知':match.toFixed(1)}，不是实饮评价；已有 ${reviews.length} 条实饮记录`}><span>匹配</span><b>{match===null?'—':match>=90?'S':match>=80?'A':match>=65?'B':match>=45?'C':'D'}</b><small>{match===null?'':match.toFixed(0)}</small></button></div>{openedOrder&&<OrderStampOverlay order={openedOrder} onClose={()=>setOpenedOrder(null)}/>}</section>
      </div>
    </main>
    <TastePreview taste={overlay===null&&startup==='ready'?tastePreview:null} language={language}/>
    {boot&&<BootMosaic ready={fontReady} animate={!ui.settings.reducedMotion&&ui.settings.startupAnimation!==false} onDone={animated=>setStartup(animated?'arriving':'ready')} onError={setFatal}/>}
    {drawer&&!native&&<div className="recipe-drawer" onMouseEnter={()=>clearTimeout(hoverTimer.current)} onMouseLeave={()=>{if(!pinned)hoverTimer.current=setTimeout(()=>setDrawer(false),260);}}><RecipeDetails recipe={recipe} ingredients={catalog.ingredients} pinned={pinned} servings={servings} onServings={setServings} onPin={()=>setPinned(!pinned)} onClose={()=>{setDrawer(false);setPinned(false);}} onCopy={()=>void copyRecipe()}/></div>}
    {overlay&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)dismissOverlay();}}><div className={`modal ${overlay==='library'?'library-modal':''}`} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="modal-header"><div><span className="eyebrow">{APP_NAME_EN} / {overlay.toUpperCase()}</span><h2 id="dialog-title">{{library:'经典酒谱库',settings:'工作台设置',review:'记录实饮评价',source:'来源与版本'}[overlay]}</h2></div><button className="icon-button" disabled={libraryBusy} onClick={dismissOverlay} aria-label="关闭对话框"><Icon name="close"/></button></div>
      {overlay==='library'&&<RecipeLibrary catalog={catalog} library={library} state={ui} onApply={applyLibraryChange} onSelect={selectRecipe} onRecipeDrag={native?dragLibraryArchive:undefined} importedRecipeId={libraryImportedId} importBusy={libraryBusy}/>}
      {overlay==='source'&&<div className="modal-body"><span className="badge">{recipe.source.kind === 'official_recipe' ? 'IBA 参考网页快照' : recipe.source.kind==='community_recipe'?'社区来源酒谱':recipe.source.kind==='imported_snapshot'?'个人存档':recipe.source.kind==='personal_recipe'?(language==='en'?'Personal recipe':'自定义酒谱'):activeTrial?'待审核试调':'用户原始笔记'}</span><h3 data-i18n="verbatim">{recipe.name_zh} / {recipe.name_en}</h3><dl className="details"><dt>配方版本</dt><dd data-i18n="verbatim">{displayRecipe.variant}</dd>{displayRecipe.notes_zh&&<><dt>配方说明</dt><dd data-i18n="verbatim">{displayRecipe.notes_zh}</dd></>}<dt>发布方</dt><dd data-i18n="verbatim">{recipe.source.publisher}</dd><dt>快照核对日期</dt><dd>{recipe.source.checked_on}</dd><dt>数据版本</dt><dd>{catalog.schema_version} / {recipe.id}</dd><dt>方法来源</dt><dd>{recipe.source.method_provenance === 'source_paraphrase' ? '根据来源转述' : recipe.source.method_provenance==='user_defined'?(language==='en'?'User-defined':'用户填写'):'编辑模板，未实作验证'}；杯型为编辑映射</dd><dt>实作验证</dt><dd>尚未完成</dd><dt>感官数据</dt><dd>{recipe.source.kind==='personal_recipe'?(language==='en'?'User-defined recipe prediction':'用户填写的配方预测'):activeTrial?'调酒规则预测，尚未实饮验证':'配方预测，非实测；来源未提供这些分数'}</dd><dt>客人点单</dt><dd>当前参考版本未审核，不可点单</dd></dl><p className="source-url">{safeSourceUrl(recipe.source.url)?<a data-i18n="verbatim" href={recipe.source.url!} target="_blank" rel="noreferrer" onClick={e=>{if(native){e.preventDefault();void openUrl(recipe.source.url!).catch(err=>setError(`打开来源失败：${String(err)}`));}}}>{recipe.source.url} ↗</a>:<>{t('来源记录：')}<span data-i18n="verbatim">{recipe.source.reference}</span>{t('（没有外部网页链接）')}</>}</p><p className="notice">原料原始单位保留。未知剂量、融冰、热量与 SKU 标签保持未知。</p>{activeTrial&&<details><summary>生成规则与校验记录</summary><pre>{JSON.stringify(activeTrial.audit,null,2)}</pre></details>}{catalog.seed_sha256&&<p className="hash">种子 SHA-256<br/>{catalog.seed_sha256}</p>}</div>}
      {overlay==='review'&&<form className="modal-body review-form" onSubmit={e=>{e.preventDefault();void submitReview();}}><p className="notice">仅记录你已经完成的真实品尝。评价绑定当前配方快照，不改变配方预测，不移植到其他版本。</p><label>评价者昵称<input required maxLength={40} value={reviewName} onChange={e=>setReviewName(e.target.value)}/></label><fieldset><legend>我的实饮评分</legend><div className="rating-input">{[1,2,3,4,5].map(n=><button type="button" className={reviewScore===n?'selected':''} key={n} onClick={()=>setReviewScore(n)} aria-pressed={reviewScore===n}>{n}</button>)}</div></fieldset><label>品尝记录（可选）<textarea maxLength={1000} rows={4} value={reviewNote} onChange={e=>setReviewNote(e.target.value)} placeholder="实际 SKU、温度、融冰情况，以及你的感受"/></label><label className="check-line"><input required type="checkbox" checked={reviewConsent} onChange={e=>setReviewConsent(e.target.checked)}/>我已真实品尝，同意将本条评价保存在本机</label><button type="submit" className="primary" disabled={!reviewConsent||!reviewName.trim()}>保存此版本的评价</button>{reviews.length>0&&<div className="saved-reviews"><h3>本版本已有记录</h3>{reviews.map(r=><article key={r.id}><strong data-i18n="verbatim">{r.user_name} · {r.score}/5</strong><small>{new Date(r.tasted_at).toLocaleString()}</small><p data-i18n="verbatim">{r.note||t('没有补充说明')}</p></article>)}</div>}</form>}
      {overlay==='settings'&&<><div className="settings-tabs">{['常规','库存与排除','规则试调','主机','模型与网络','本机草稿','关于'].map(tab=><button className={settingsTab===tab?'active':''} key={tab} onClick={()=>setSettingsTab(tab)}>{tab}</button>)}</div><div className="modal-body settings-body">
        {settingsTab==='常规'&&<><label className="setting-row"><div><strong>{language==='en'?'Language':'语言'}</strong><small>中文 / English</small></div><select aria-label={language==='en'?'Language':'语言'} value={language} onChange={e=>update({settings:{...ui.settings,language:e.target.value==='en'?'en':'zh'}})}><option value="zh">中文</option><option value="en">English</option></select></label><label className="setting-row"><div><strong>AI 模式</strong><small>匹配按钮生成试调；未配置模型时明确回退规则</small></div><input type="checkbox" aria-label="AI模式" checked={ui.settings.aiMode||false} onChange={e=>update({settings:{...ui.settings,aiMode:e.target.checked}})}/></label><label className="setting-row"><div><strong>LOGO 启动动画</strong><small>下次启动生效</small></div><input type="checkbox" checked={ui.settings.startupAnimation!==false} onChange={e=>update({settings:{...ui.settings,startupAnimation:e.target.checked}})}/></label><label className="setting-row"><div><strong>减少动态效果</strong><small>仅控制本软件的启动、滑块和标签动画</small></div><input type="checkbox" checked={ui.settings.reducedMotion} onChange={e=>update({settings:{...ui.settings,reducedMotion:e.target.checked}})}/></label><label className="setting-row"><div><strong>文字大小</strong><small>Fusion Pixel / OFL-1.1</small></div><select value={ui.settings.fontScale} onChange={e=>update({settings:{...ui.settings,fontScale:Number(e.target.value)}})}><option value={1.25}>标准（125%）</option><option value={1.1}>110%</option><option value={1}>100%</option></select></label><div className="setting-row"><div><strong>声音</strong><small>当前版本无声音，默认安静</small></div><span>关闭</span></div><div className="notice">支持中文与English；配料优先显示ml/g，原量和容量换算约定保留在详情中。</div><h3>数据与运行环境</h3><p>{catalog.recipes.length} 份酒谱；来源与未验证预测见每份配方详情。</p><p>{native?'Tauri 本机应用 · 状态由 Rust 写入 SQLite':'浏览器 UI 测试模式 · 使用 localStorage；未接入原生 SQLite'}</p><p className="fineprint">仅本机保存 · 不上传评价或私有数据 · 没有自动下载模型</p><StoragePanel beforeBackup={async()=>{await saveQueue.current;await writeState(current.current!);}} beforeRestore={async()=>{persistencePaused.current=true;await saveQueue.current;await writeState(current.current!);}} afterFailedRestore={()=>{persistencePaused.current=false;setUi(u=>u?{...u}:u);}}/></>}
        {settingsTab==='关于'&&<section className="about-panel"><img src="/assets/timer-logo.png" alt="TIMER"/><h3>{appName(language)}</h3><dl className="details"><dt>{language==='en'?'Version':'版本'}</dt><dd>V{APP_VERSION}</dd><dt>{language==='en'?'Developer':'开发者'}</dt><dd>{APP_DEVELOPER}</dd><dt>GitHub</dt><dd><a href={PROJECT_URL} target="_blank" rel="noreferrer" onClick={e=>{if(native){e.preventDefault();void openUrl(PROJECT_URL).catch(err=>setError(String(err)));}}}>UNKNOWNTIMER/programmer-mixology ↗</a></dd></dl></section>}
        {settingsTab==='规则试调'&&<TrialPanel catalog={catalog} target={ui.target} excluded={ui.excluded} inventory={ui.trialInventory||{}} onInventory={v=>update({trialInventory:v})} onGenerated={acceptTrial}/>}
{settingsTab==='主机'&&<HostPanel recipe={recipe} target={ui.target} catalog={catalog}/>}
{settingsTab==='库存与排除'&&<><label className="check-line"><input type="checkbox" checked={ui.inventoryOnly} onChange={e=>update({inventoryOnly:e.target.checked})}/>只显示类型库存齐备的酒谱</label><p className="notice">此处仅记录原料类型是否可用，仍需核对实际 SKU、品牌、容量、过敏原与装饰；未完成前不能视为可供客人点单。</p><input className="full-input" aria-label="搜索库存原料" placeholder="筛选原料…" value={inventorySearch} onChange={e=>setInventorySearch(e.target.value)}/><div className="inventory-header"><span>原料</span><span>有库存</span><span>排除</span></div><div className="inventory-list">{catalog.ingredients.filter(i=>`${i.name_zh} ${i.name_en}`.toLowerCase().includes(inventorySearch.toLowerCase())).map(i=><div key={i.id}><label><strong>{language==='en'?i.name_en:i.name_zh}</strong><small>{language==='en'?i.name_zh:i.name_en}</small></label><input type="checkbox" aria-label={`${i.name_zh}有库存`} checked={ui.inventory.includes(i.id)} onChange={()=>toggleList('inventory',i.id)}/><input type="checkbox" aria-label={`排除${i.name_zh}`} checked={ui.excluded.includes(i.id)} onChange={()=>toggleList('excluded',i.id)}/></div>)}</div></>}
        {settingsTab==='模型与网络'&&<><ModelPanel/><div className="status-block"><strong>经典模式 / 已启用</strong><p>{catalog.recipes.length} 份本机来源酒谱、偏好排序与库存排除，不依赖模型。</p></div><div className="status-block"><strong>本地模型 / 默认关闭</strong><p>模型真实状态见上方受控适配面板。经典匹配始终可用，未主动下载模型。</p></div><div className="status-block"><strong>局域网 / 会话与订单入口</strong><p>在「主机」页面展开局域网连接，查看实际连接状态。点单必须通过认证、票据授权和菜单审核；工作台草稿不会扣票。</p><button className="text-link" onClick={()=>setSettingsTab('主机')}>打开主机与客人端 ↗</button></div><p className="fineprint">主机服务与移动真机配对的接入、验证状态以随附构建报告为准；当前界面没有把离线草稿显示为成功订单。</p></>}
        {settingsTab==='本机草稿'&&<><h3>最近试调</h3>{ui.generatedTrials?.length?[...ui.generatedTrials].reverse().map(t=><article className="draft-record" key={t.recipe.id}><button data-i18n="verbatim" className="text-link" onClick={()=>selectRecipe(t.recipe)}>{t.recipe.name_zh} / {t.recipe.name_en} ↗</button><small>{new Date(t.created_at).toLocaleString()} · 待审核</small></article>):<p>还没有生成试调。</p>}<h3>保存当前配方</h3><button className="outline-button" onClick={saveDraft}>保存本机草稿</button><p className="notice">以下记录是不可变的本机酒谱与目标快照。它们没有发送给主机，没有订单号、票据或扣票记录。</p>{ui.drafts.length?[...ui.drafts].reverse().map(d=><article className="draft-record" key={d.id}><strong data-i18n="verbatim">{d.recipe.name_zh}</strong><span>未提交</span><small>{new Date(d.created_at).toLocaleString()}</small><details><summary>展开快照</summary><pre>{JSON.stringify(d,null,2)}</pre></details></article>):<p className="empty-results">还没有点单草稿。</p>}</>}
      </div></>}
    </div></div>}
    <span className="workbench-announcement" role="status" aria-live="polite" aria-atomic="true">{t(toast)}</span>
    {error&&<div className="error-banner" role="alert"><span>{t(error)}</span><button onClick={()=>setError('')} aria-label="关闭错误">×</button></div>}
  </div></Localized></I18nProvider>;
}






