import { useEffect, useRef, useState } from 'react';
import { native } from './bridge';
import { FAMILY_LABELS, GLASS_LABELS } from './domain';
import { useI18n } from './i18n';
import RecipeEditor from './RecipeEditor';
import { ArchiveDragButton } from './ArchiveDragButton';
import type { ArchiveDragGesture } from './archive-drag';
import { disabledDlcRecipeIds, libraryRecipes, recipeDraft, type LibraryAction, type LibraryScope, type LibraryState, type RecipeDraft } from './recipe-library';
import type { Catalog, Recipe, Profile, UserState } from './types';
import './recipe-library.css';

export default function RecipeLibrary({catalog,library,state,onApply,onSelect,onRecipeDrag,importedRecipeId='',importBusy=false}: {
  catalog:Catalog;library:LibraryState;state:UserState;
  onApply:(action:LibraryAction)=>Promise<void>;onSelect:(recipe:Recipe)=>void;
  onRecipeDrag?:(recipe:Recipe,profile:Profile|undefined,gesture:ArchiveDragGesture)=>Promise<void>;
  importedRecipeId?:string;importBusy?:boolean;
}) {
  const {language,t}=useI18n(),en=language==='en';
  const [scope,setScope]=useState<LibraryScope>(importedRecipeId?'custom':'visible'),[search,setSearch]=useState(''),[favoritesOnly,setFavoritesOnly]=useState(false);
  const [editor,setEditor]=useState<{id?:string;draft?:RecipeDraft}|null>(null),[confirm,setConfirm]=useState<Recipe|null>(null);
  const [saving,setBusy]=useState(false),[error,setError]=useState(''),busy=saving||importBusy;
  const pending=useRef(false),manager=useRef<HTMLDivElement>(null),returnFocus=useRef<string|null>(null);
  useEffect(()=>{if(editor||returnFocus.current===null)return;const id=returnFocus.current;returnFocus.current=null;const trigger=id==='add'?manager.current?.querySelector<HTMLButtonElement>('[data-testid=library-add]'):Array.from(manager.current?.querySelectorAll<HTMLDivElement>('.library-row')||[]).find(row=>row.dataset.recipeId===id)?.querySelector<HTMLButtonElement>('[data-action=edit], [data-action=copy]');(trigger||manager.current?.querySelector<HTMLButtonElement>('[data-testid=library-add]'))?.focus();},[editor]);
  useEffect(()=>{if(!importedRecipeId)return;setScope('custom');setSearch('');setFavoritesOnly(false);setConfirm(null);setError('');},[importedRecipeId]);
  useEffect(()=>{if(!importedRecipeId||scope!=='custom')return;const frame=requestAnimationFrame(()=>{const row=Array.from(manager.current?.querySelectorAll<HTMLElement>('.library-row')||[]).find(el=>el.dataset.recipeId===importedRecipeId);row?.scrollIntoView({block:'nearest'});row?.querySelector<HTMLButtonElement>('.library-select')?.focus({preventScroll:true});});return()=>cancelAnimationFrame(frame);},[importedRecipeId,scope]);
  const listed=libraryRecipes(catalog,library,scope,search,state,favoritesOnly);
  const customIds=new Set(library.custom.map(e=>e.recipe.id));
  const groups=catalog.dlc_groups||[],groupIds=new Set(groups.flatMap(group=>group.recipe_ids)),disabledIds=new Set(disabledDlcRecipeIds(catalog,library));
  const edit=(r:Recipe,copy=false)=>{returnFocus.current=r.id;setError('');setEditor({id:copy?undefined:r.id,draft:recipeDraft(r,catalog.profiles.find(p=>p.recipe_id===r.id))});};
  async function apply(action:LibraryAction) {
    if(pending.current)throw new Error(en?'A library change is still saving.':'酒谱修改正在保存。');
    pending.current=true;setBusy(true);setError('');
    try{await onApply(action);setConfirm(null);}finally{pending.current=false;setBusy(false);}
  }
  async function act(action:LibraryAction){try{await apply(action);}catch(e){setError(String(e));}}
  function recipeRow(r:Recipe){
    const personal=customIds.has(r.id),hidden=library.hidden.includes(r.id),deleted=library.deleted.includes(r.id),disabled=disabledIds.has(r.id),name=en?r.name_en:r.name_zh;
    return <div className={`library-row ${r.id===state.selected?'selected':''}`} key={r.id} data-recipe-id={r.id} data-hidden={hidden} data-deleted={deleted} data-imported={r.id===importedRecipeId} data-dlc-disabled={disabled}>
      <ArchiveDragButton type="button" className="library-select" disabled={hidden||deleted||disabled||busy} onClick={()=>onSelect(r)} onArchiveDrag={native&&onRecipeDrag?gesture=>onRecipeDrag(r,catalog.profiles.find(p=>p.recipe_id===r.id),gesture):undefined} title={native&&onRecipeDrag?`${name} · ${en?'Drag to save .timermix':'拖出保存 .timermix'}`:name}><div><strong data-i18n="verbatim">{name}<span>{state.favorites.includes(r.id)?' ♡':''}</span></strong><small data-i18n="verbatim">{en?r.name_zh:r.name_en}</small></div><span>{t(FAMILY_LABELS[r.family]||r.family)}</span><span>{t(GLASS_LABELS[r.glass_template]||r.glass_template)}</span></ArchiveDragButton>
      <div className="library-row-actions" role="group" aria-label={`${name} ${en?'actions':'操作'}`}>
        {personal&&<span className="library-kind">{en?'Custom':'自定义'}</span>}
        {hidden&&<span className="library-kind">{en?'Hidden':'已隐藏'}</span>}
        {deleted?<button type="button" data-action="restore" disabled={busy||!native} onClick={()=>void act({action:'restore',id:r.id})}>{en?'Restore':'恢复'}</button>:<>
          <button type="button" data-action={personal?'edit':'copy'} disabled={busy||!native} onClick={()=>edit(r,!personal)}>{personal?(en?'Edit':'编辑'):(en?'Copy':'复制添加')}</button>
          <button type="button" data-action={hidden?'show':'hide'} disabled={busy||!native} onClick={()=>void act({action:hidden?'show':'hide',id:r.id})}>{hidden?(en?'Show':'显示'):(en?'Hide':'隐藏')}</button>
          <button type="button" data-action="delete" disabled={busy||!native} onClick={()=>{setConfirm(r);setError('');}}>{en?'Delete':'删除'}</button>
        </>}
      </div>
    </div>;
  }
  if(editor)return <RecipeEditor key={editor.id||'new'} ingredients={catalog.ingredients} initial={editor.draft} initialTarget={state.target} onCancel={()=>setEditor(null)} onSave={async draft=>{await apply({action:editor.id?'update':'create',id:editor.id,draft});setEditor(null);setScope('custom');setSearch('');setFavoritesOnly(false);}}/>;
  return <div className="library-manager" data-testid="library-manager" ref={manager}>
    <div className="library-management-toolbar">
      <div role="group" aria-label={en?'Library views':'酒谱分类'}>{(['visible','custom','hidden','deleted'] as const).map((key,i)=><button key={key} type="button" data-testid={`library-tab-${key}`} aria-pressed={scope===key} className={scope===key?'active':''} onClick={()=>{setScope(key);setSearch('');setFavoritesOnly(false);setConfirm(null);}}>{(en?['Library','My recipes','Hidden','Deleted']:['酒谱','自定义','已隐藏','已删除'])[i]}</button>)}</div>
      <button type="button" className="primary" data-testid="library-add" disabled={busy||!native} onClick={()=>{returnFocus.current='add';setEditor({});setError('');}}>{en?'+ Add':'+ 添加酒谱'}</button>
    </div>
    {!native&&<p className="notice">{en?'Open the desktop app to manage your local library.':'请在桌面应用中管理本机酒谱。'}</p>}
    {native&&<p className="library-drop-hint">{en?'Drop a .timermix file here to add a personal recipe': '拖入 .timermix，添加到自定义'}</p>}
    <div className="library-search"><span aria-hidden="true">⌕</span><input aria-label={en?'Search recipes':'搜索酒谱'} value={search} onChange={e=>setSearch(e.target.value)} placeholder={en?'Name, ingredient or family…':'酒名、原料或家族…'}/><button type="button" className={`filter-toggle ${favoritesOnly?'active':''}`} aria-pressed={favoritesOnly} onClick={()=>setFavoritesOnly(!favoritesOnly)}>{en?'Favorites':'仅收藏'} {state.favorites.length}</button></div>
    {scope==='visible'&&<div className="family-filters">{[['','全部'],['sour','酸型'],['spirit_forward','烈酒型'],['spritz','气泡'],['creamy','奶油']].map(([id,label])=><button type="button" className={search===id?'active':''} key={id} onClick={()=>setSearch(id)}>{t(label)}</button>)}<span>{listed.length} / {catalog.recipes.length}</span></div>}
    {error&&<p role="alert" className="notice">{error}</p>}
    {confirm&&<div className="library-confirm" role="alertdialog" aria-label={en?'Delete recipe':'删除酒谱'}><strong data-i18n="verbatim">{en?confirm.name_en:confirm.name_zh}</strong><p>{en?'Move this recipe to Deleted? You can restore it later.':'将这杯酒移到“已删除”？之后可以恢复。'}</p><div><button type="button" data-testid="library-cancel-delete" disabled={busy} onClick={()=>setConfirm(null)}>{en?'Cancel':'取消'}</button><button type="button" className="danger" data-testid="library-confirm-delete" disabled={busy} onClick={()=>void act({action:'delete',id:confirm.id})}>{en?'Delete':'删除'}</button></div></div>}
    <div className="library-list">{scope==='custom'?<>
      {listed.filter(r=>!groupIds.has(r.id)).map(recipeRow)}
      {groups.map(group=>{const enabled=!(library.disabled_groups||[]).includes(group.id),ids=new Set(group.recipe_ids),groupRecipes=listed.filter(r=>ids.has(r.id));return <section key={group.id} className="library-dlc-group" data-testid="library-dlc-group" data-group-id={group.id} data-enabled={enabled}>
        <header><div><strong data-i18n="verbatim">{en?group.name_en:group.name_zh}</strong><small>DLC · <span data-i18n="verbatim">{group.author}</span> · {groupRecipes.length}/{group.recipe_ids.length}</small></div><button type="button" data-testid="library-dlc-toggle" aria-pressed={enabled} aria-label={`${en?'Enable':'启用'} ${en?group.name_en:group.name_zh}`} disabled={busy||!native} onClick={()=>void act({action:'set_group_enabled',id:group.id,enabled:!enabled})}><span aria-hidden="true">{enabled?'■':'□'}</span> {en?(enabled?'Enabled':'Disabled'):(enabled?'已启用':'未启用')}</button></header>
        <details open><summary>{en?'Recipes':'组内酒谱'}</summary>{groupRecipes.map(recipeRow)}</details>
        {!!group.appendix?.length&&<details className="library-dlc-appendix"><summary>{en?'Notebook appendix':'笔记附录'}</summary>{group.appendix.map((entry,index)=><article key={index} data-i18n="verbatim"><strong>{entry.title_zh}</strong><p>{entry.text_zh}</p></article>)}</details>}
      </section>;})}
    </>:listed.map(recipeRow)}{!listed.length&&scope!=='custom'&&<p className="empty-results" data-testid="library-empty">{en?'No recipes in this view.':'当前分类没有符合条件的酒谱。'}</p>}</div>
    {busy&&<p role="status">{en?'Saving…':'正在保存…'}</p>}
  </div>;
}
