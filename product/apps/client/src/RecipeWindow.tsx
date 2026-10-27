import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { native } from './bridge';
import { GLASS_LABELS, ingredientName } from './domain';
import { formatEstimate } from './estimates';
import { estimateDisplayDrink } from './assisted-estimates';
import type { Ingredient, Recipe } from './types';
import { I18nProvider, Localized, useI18n, type Language } from './i18n';
import { localizedRecipe } from './recipe-i18n';
import { displayQuantity } from './quantity-display';
import { notebookDetails } from './dlc-notebook';
import './recipe-window.css';

interface Payload { recipe:Recipe; ingredients:Ingredient[]; pinned:boolean; servings:number; language?:Language }
interface Actions { onEnter:()=>void; onLeave:()=>void; onPin:()=>void; onClose:()=>void; setServings:(value:number)=>void; onError:(reason:string)=>void }
export function useRecipeWindow(props:Actions&{recipe?:Recipe;ingredients:Ingredient[];open:boolean;pinned:boolean;servings:number;language?:Language}) {
  const current=useRef(props);current.current=props;
  const queue=useRef(Promise.resolve());
  useEffect(()=>{
    if(!native)return;
    let disposed=false,off:(()=>void)|undefined,unmove:(()=>void)|undefined;
    void listen<{kind:string;value?:number}>('recipe-window-action',({payload})=>{
      const p=current.current;
      if(payload.kind==='enter')p.onEnter();else if(payload.kind==='leave')p.onLeave();
      else if(payload.kind==='pin')p.onPin();else if(payload.kind==='close')p.onClose();
      else if(payload.kind==='servings'&&[1,2,3,4,6,8].includes(payload.value||0))p.setServings(payload.value!);
    }).then(fn=>{if(disposed)fn();else off=fn;});
    void getCurrentWindow().onMoved(()=>{if(current.current.open)void invoke('recipe_window_position').catch(e=>current.current.onError(String(e)));}).then(fn=>{if(disposed)fn();else unmove=fn;});
    return()=>{disposed=true;off?.();unmove?.();};
  },[]);
  useEffect(()=>{
    if(!native)return;
    const payload:Payload|null=props.open&&props.recipe?{recipe:props.recipe,ingredients:props.ingredients.filter(i=>props.recipe!.ingredients.some(p=>p.ingredient_id===i.id)),pinned:props.pinned,servings:props.servings,language:props.language||'zh'}:null;
    queue.current=queue.current.then(()=>invoke<void>('recipe_window_update',{payload})).catch(e=>current.current.onError(`配料窗口：${String(e)}`));
  },[props.open,props.recipe,props.ingredients,props.pinned,props.servings,props.language]);
}
export function RecipeDetails({recipe,ingredients,pinned,servings,onServings,onPin,onClose,onCopy}:{recipe:Recipe;ingredients:Ingredient[];pinned:boolean;servings:number;onServings:(n:number)=>void;onPin:()=>void;onClose:()=>void;onCopy?:()=>void}) {
  const {language,t}=useI18n(),view=localizedRecipe(recipe,language),estimates=estimateDisplayDrink(recipe,ingredients,language),[copied,setCopied]=useState('');
  const name=(id:string)=>language==='en'?ingredients.find(i=>i.id===id)?.name_en||id:ingredientName(ingredients,id);
  const amount=(part:Recipe['ingredients'][number])=>displayQuantity(part,ingredients.find(i=>i.id===part.ingredient_id),servings,language);
  const notebook=notebookDetails(recipe);
  async function copy(){try{await navigator.clipboard.writeText(`${recipe.name_zh} / ${recipe.name_en}\n${view.ingredients.map(i=>`${name(i.ingredient_id)} ${amount(i).text}${i.quantity_note?` (${t('原配方备注')}: ${i.quantity_note})`:''}`).join('\n')}\n${view.steps_zh.join('\n')}\n${recipe.source.url||recipe.source.reference}`);setCopied('已复制');}catch(e){setCopied(`复制失败：${String(e)}`);}}
  return <Localized><section className="recipe-details" role="region" aria-label="完整配方抽屉">
    <header className="drawer-header"><div><h2 data-i18n="verbatim">{language==='en'?recipe.name_en:recipe.name_zh}</h2><small data-i18n="verbatim">{language==='en'?recipe.name_zh:recipe.name_en}</small></div><div><button aria-label={pinned?'取消固定':'固定配方'} onClick={onPin}>{pinned?'▣':'□'}</button><button aria-label="关闭配方" onClick={onClose}>×</button></div></header>
    <div className="drawer-scroll"><div className="serving-row"><label>份数 <select aria-label="显示份数" value={servings} onChange={e=>onServings(Number(e.target.value))}>{[1,2,3,4,6,8].map(n=><option key={n} value={n}>{n} 份</option>)}</select></label><button onClick={onCopy||(()=>void copy())}>复制</button></div>{copied&&<p role="status">{t(copied)}</p>}
      {[...new Set(recipe.ingredients.map(i=>i.stage))].map(stage=><section className="stage-group" key={stage}><h3>{({mix:'配料',top:'补足',float:'漂浮',rinse:'洗杯',finish:'点缀',garnish:'装饰',side:'另杯随附'} as Record<string,string>)[stage]||stage}</h3>{view.ingredients.filter(i=>i.stage===stage).map((i,n)=><div className="drawer-ingredient" key={`${i.ingredient_id}-${n}`}><strong><span data-i18n="verbatim">{name(i.ingredient_id)}</span>{i.optional?'（可选）':''}</strong><b title={amount(i).note||undefined}>{amount(i).text}</b>{i.quantity_note&&<p data-i18n="verbatim">{servings>1&&t('原配方备注：')}{i.quantity_note}</p>}</div>)}</section>)}
      <details className="unit-conversions"><summary>{language==='en'?'Source units & conversions':'原量与单位换算'}</summary>{recipe.ingredients.map((part,index)=>amount(part).note&&<p key={index}>{name(part.ingredient_id)}: {amount(part).note}</p>)}</details><h3>步骤</h3><ol className="steps">{view.steps_zh.map((s,i)=><li key={i} data-i18n="verbatim">{s}</li>)}</ol>
      {estimates.mainDrinkOnly&&<p className="fineprint" data-i18n="verbatim">{language==='en'?'Main drink estimates · foam excluded':'主酒估算 · 泡沫另计'}</p>}
      <dl className="details"><dt>杯型</dt><dd>{GLASS_LABELS[recipe.glass_template]||recipe.glass_template}</dd><dt>装饰</dt><dd data-i18n="verbatim">{view.garnish_zh||'—'}</dd><dt>成杯 / 份</dt><dd title={estimates.assumptions.join('\n')}>{formatEstimate(estimates.servedVolumeMl,'ml',language)}</dd><dt>酒精度</dt><dd title={estimates.assumptions.join('\n')}>{formatEstimate(estimates.abvPercent,'%',language)}</dd><dt>热量 / 份</dt><dd title={estimates.assumptions.join('\n')}>{formatEstimate(estimates.caloriesKcal,'kcal',language)}</dd></dl>
      {notebook?<section className="notebook-details">
        {notebook.experiences.length>0&&<><h3>{language==='en'?"Xiaodong’s notes":'小董的笔记'}</h3>{notebook.experiences.map((line,index)=><p key={index} data-i18n="verbatim">{line}</p>)}</>}
        {notebook.extraNotes.map((line,index)=><p key={index} data-i18n="verbatim">{line}</p>)}
        {notebook.stories.length>0&&<details><summary>{language==='en'?'Notebook story':'笔记故事'}</summary>{notebook.stories.map((line,index)=><p key={index} data-i18n="verbatim">{line}</p>)}</details>}
        <details><summary>{language==='en'?'Working recipe notes':'工作配方记录'}</summary>{[...notebook.workingNotes,...notebook.sourceNotes].map((line,index)=><p key={index} data-i18n="verbatim">{line}</p>)}</details>
      </section>:view.notes_zh&&<p data-i18n="verbatim">{view.notes_zh}</p>}<details><summary>来源</summary><p data-i18n="verbatim">{recipe.source.publisher}</p><p data-i18n="verbatim" className="source-url">{recipe.source.url||recipe.source.reference}</p><p>{recipe.source.checked_on}</p></details>
    </div>
  </section></Localized>;
}
export function RecipePopupWindow(){
  const [payload,setPayload]=useState<Payload|null>(null),[error,setError]=useState('');
  const action=(kind:string,value?:number)=>void emitTo('main','recipe-window-action',{kind,value});
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();action('close');}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[]);
  useEffect(()=>{
    let disposed=false,off:(()=>void)|undefined,eventsReceived=0;
    void (async()=>{
      const unlisten=await listen<Payload>('recipe-window-data',event=>{eventsReceived++;setPayload(event.payload);});
      if(disposed){unlisten();return;}off=unlisten;
      const version=eventsReceived,initial=await invoke<Payload|null>('recipe_window_payload');
      if(!disposed&&eventsReceived===version)setPayload(initial);
      await document.fonts.load('12px PixelMix');
      requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!disposed)void invoke('recipe_window_ready').catch(e=>setError(String(e)));}));
    })().catch(e=>setError(String(e)));
    return()=>{disposed=true;off?.();};
  },[]);
  return <I18nProvider language={payload?.language||'zh'}><div className="recipe-popup-shell" onMouseEnter={()=>action('enter')} onMouseLeave={()=>action('leave')}>{payload&&<RecipeDetails {...payload} onServings={n=>action('servings',n)} onPin={()=>action('pin')} onClose={()=>action('close')}/>} {error&&<p role="alert">{error}</p>}</div></I18nProvider>;
}
