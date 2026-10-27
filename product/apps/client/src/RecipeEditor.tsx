import { useRef, useState } from 'react';
import type { Ingredient, RecipeIngredient, Target } from './types';
import type { RecipeDraft } from './recipe-library';
import { FAMILY_LABELS, GLASS_LABELS, METHOD_LABELS, SENSORY_LABELS, TASTE_LABELS } from './domain';
import { Localized, useI18n } from './i18n';
import { emptyRecipeIngredient, initialRecipeDraft, prepareRecipeDraft, recipeDraftErrors, withCurrentTaste, withTastePercent } from './recipe-editor-state';
import './recipe-library.css';
import { tastePercentages } from './taste-display';

export interface RecipeEditorProps {ingredients:Ingredient[];initial?:RecipeDraft;initialTarget:Target;onSave:(draft:RecipeDraft)=>Promise<void>;onCancel:()=>void}
const STAGES:Record<string,string>={mix:'混合',top:'补足',float:'漂浮',rinse:'洗杯',finish:'点缀',garnish:'装饰',side:'另杯随附'};
const UNITS=['ml','cl','l','g','kg','dash','drop','tsp','tbsp','barspoon','oz','piece','slice','leaf','sprig','whole','cube','top_up','to_taste','unknown'];
const unitName=(unit:string)=>({piece:'个',slice:'片',leaf:'叶',sprig:'枝',whole:'整颗',cube:'块',top_up:'加满',to_taste:'适量',unknown:'未注明单位'} as Record<string,string>)[unit]||unit;
export function RecipeEditor({ingredients,initial,initialTarget,onSave,onCancel}:RecipeEditorProps){
  const {language,t}=useI18n(),[draft,setDraft]=useState(()=>initialRecipeDraft(initial)),[steps,setSteps]=useState(()=>initial?.steps_zh.join('\n')||''),[pending,setPending]=useState(false),[errors,setErrors]=useState<string[]>([]),[saveError,setSaveError]=useState(''),busy=useRef(false);
  const percentages=tastePercentages(draft.taste_bps);
  const patch=(values:Partial<RecipeDraft>)=>setDraft(current=>({...current,...values}));
  const partPatch=(index:number,values:Partial<RecipeIngredient>)=>setDraft(current=>({...current,ingredients:current.ingredients.map((part,i)=>i===index?{...part,...values}:part)}));
  const options=(labels:Record<string,string>,current:string)=>[...Object.entries(labels),...(!Object.hasOwn(labels,current)?[[current,current]]:[])].map(([value,label])=><option value={value} key={value} data-i18n="verbatim">{Object.hasOwn(labels,value)?t(label):label}</option>);
  async function save(event:React.FormEvent){
    event.preventDefault();if(busy.current)return;
    const prepared=prepareRecipeDraft(draft,steps),issues=recipeDraftErrors(prepared,ingredients);setErrors(issues);setSaveError('');if(issues.length)return;
    busy.current=true;setPending(true);
    try{await onSave(prepared);}catch(error){setSaveError(error instanceof Error?error.message:String(error));}finally{busy.current=false;setPending(false);}
  }
  return <Localized><form className="recipe-editor" aria-label="自定义酒谱编辑器" onSubmit={event=>void save(event)} noValidate onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy.current)onCancel();}}}>
    <header className="recipe-editor-header"><h2>{initial?'编辑配方草稿':'添加自定义酒谱'}</h2><button type="button" aria-label="取消编辑" disabled={pending} onClick={()=>{if(!busy.current)onCancel();}}>×</button></header>
    <fieldset className="recipe-editor-scroll" disabled={pending}>
      <div className="recipe-editor-grid">
        <label className="recipe-editor-field">中文酒名<input autoFocus aria-label="中文酒名" value={draft.name_zh} maxLength={160} onChange={e=>patch({name_zh:e.target.value})}/></label>
        <label className="recipe-editor-field">英文酒名<input aria-label="英文酒名" value={draft.name_en} maxLength={160} onChange={e=>patch({name_en:e.target.value})}/></label>
        <label className="recipe-editor-field">酒谱家族<select aria-label="酒谱家族" value={draft.family} onChange={e=>patch({family:e.target.value})}>{options(FAMILY_LABELS,draft.family)}</select></label>
        <label className="recipe-editor-field">杯型<select aria-label="编辑杯型" value={draft.glass_template} onChange={e=>patch({glass_template:e.target.value})}>{options(GLASS_LABELS,draft.glass_template)}</select></label>
        <label className="recipe-editor-field">调制方法<select aria-label="调制方法" value={draft.method} onChange={e=>patch({method:e.target.value})}>{options(METHOD_LABELS,draft.method)}</select></label>
      </div>
      <section className="recipe-editor-section"><div className="recipe-editor-target-heading"><h3>配料</h3><button type="button" disabled={draft.ingredients.length>=32} onClick={()=>patch({ingredients:[...draft.ingredients,emptyRecipeIngredient()]})}>＋ 添加配料</button></div>
        {!draft.ingredients.length&&<p className="recipe-editor-empty">从原料目录添加配料。</p>}
        <div className="recipe-editor-ingredients">{draft.ingredients.map((part,index)=><fieldset className="recipe-editor-ingredient" key={index}><legend>{t('配料')} {index+1}</legend><div className="recipe-editor-ingredient-grid">
          <label className="recipe-editor-field recipe-editor-ingredient-name">原料<select aria-label={`${t('原料')} ${index+1}`} value={part.ingredient_id} onChange={e=>partPatch(index,{ingredient_id:e.target.value,allowed_alternatives:[]})}><option value="">{t('选择原料…')}</option>{ingredients.map(ingredient=><option key={ingredient.id} value={ingredient.id} data-i18n="verbatim">{language==='en'?ingredient.name_en:ingredient.name_zh}</option>)}{part.ingredient_id&&!ingredients.some(i=>i.id===part.ingredient_id)&&<option value={part.ingredient_id} data-i18n="verbatim">{part.ingredient_id}</option>}</select></label>
          {part.quantity_range?<label className="recipe-editor-field">剂量范围<div className="recipe-editor-range"><input type="number" aria-label={`${t('剂量下限')} ${index+1}`} min={0} max={10000} step="any" value={part.quantity_range[0]} onChange={e=>partPatch(index,{quantity_range:[e.target.value===''?0:Number(e.target.value),part.quantity_range![1]]})}/><span>–</span><input type="number" aria-label={`${t('剂量上限')} ${index+1}`} min={0} max={10000} step="any" value={part.quantity_range[1]} onChange={e=>partPatch(index,{quantity_range:[part.quantity_range![0],e.target.value===''?0:Number(e.target.value)]})}/></div></label>:<label className="recipe-editor-field">剂量<input type="number" aria-label={`${t('剂量')} ${index+1}`} min={0} max={10000} step="any" placeholder={t('未量化')} value={part.quantity??''} onChange={e=>partPatch(index,{quantity:e.target.value===''?null:Number(e.target.value),quantity_range:undefined})}/></label>}
          <label className="recipe-editor-field">单位<select aria-label={`${t('单位')} ${index+1}`} value={part.unit} onChange={e=>partPatch(index,{unit:e.target.value})}>{[...UNITS,...(!UNITS.includes(part.unit)?[part.unit]:[])].map(unit=><option key={unit} value={unit}>{t(unitName(unit))}</option>)}</select></label>
          <label className="recipe-editor-field">制作阶段<select aria-label={`${t('制作阶段')} ${index+1}`} value={part.stage} onChange={e=>partPatch(index,{stage:e.target.value})}>{options(STAGES,part.stage)}</select></label>
          <label className="recipe-editor-field recipe-editor-ingredient-note">剂量备注<input aria-label={`${t('剂量备注')} ${index+1}`} value={part.quantity_note||''} maxLength={1000} onChange={e=>partPatch(index,{quantity_note:e.target.value||null})}/></label>
        </div><div className="recipe-editor-row-actions"><label><input type="checkbox" checked={part.optional} onChange={e=>partPatch(index,{optional:e.target.checked})}/>可选配料</label><button type="button" onClick={()=>partPatch(index,part.quantity_range?{quantity:part.quantity_range[0],quantity_range:undefined}:{quantity:null,quantity_range:[part.quantity||1,part.quantity||1]})}>{part.quantity_range?'使用单一剂量':'使用剂量范围'}</button><button type="button" aria-label={`${t('移除配料')} ${index+1}`} onClick={()=>patch({ingredients:draft.ingredients.filter((_,i)=>i!==index)})}>移除配料</button></div></fieldset>)}</div>
      </section>
      <label className="recipe-editor-field recipe-editor-section">制作步骤<textarea aria-label="制作步骤" placeholder="每行一个步骤" rows={5} value={steps} onChange={e=>setSteps(e.target.value)}/></label>
      <details className="recipe-editor-optional"><summary>装饰、备注与来源</summary><div className="recipe-editor-grid"><label className="recipe-editor-field">装饰<input aria-label="编辑装饰" value={draft.garnish_zh} maxLength={500} onChange={e=>patch({garnish_zh:e.target.value})}/></label><label className="recipe-editor-field">来源网址<input type="url" aria-label="来源网址" placeholder="https://" value={draft.source_url||''} maxLength={2000} onChange={e=>patch({source_url:e.target.value||null})}/></label></div><label className="recipe-editor-field">配方备注<textarea aria-label="配方备注" rows={3} maxLength={4000} value={draft.notes_zh} onChange={e=>patch({notes_zh:e.target.value})}/></label></details>
      <section className="recipe-editor-section"><div className="recipe-editor-target-heading"><h3>配方预测</h3><button type="button" onClick={()=>{try{setDraft(current=>withCurrentTaste(current,initialTarget));setErrors([]);}catch(error){setErrors([String(error instanceof Error?error.message:error)]);}}}>使用当前味觉</button></div><p className="recipe-editor-help">手动设定的配方预测，非实饮评价。</p><div className="recipe-editor-target-heading"><span>五味</span><b>Σ 100%</b></div><div className="recipe-editor-targets">{TASTE_LABELS.map((label,index)=><label className="recipe-editor-field" key={label}>{t(label)} %<input type="number" aria-label={`${t(label)} ${t('配方预测')}`} min={0} max={100} step={1} value={percentages[index]} onChange={e=>{if(e.target.value!=='')setDraft(current=>withTastePercent(current,index,Number(e.target.value)));}}/></label>)}</div><div className="recipe-editor-targets recipe-editor-sensory">{SENSORY_LABELS.map((label,index)=><label className="recipe-editor-field" key={label}>{t(label)}<input type="number" aria-label={`${t(label)} ${t('配方预测')}`} min={0} max={10} step={1} value={Math.round(draft.sensory_0_10[index])} onChange={e=>{if(e.target.value==='')return;const value=Number(e.target.value);if(!Number.isFinite(value))return;const sensory=[...draft.sensory_0_10] as RecipeDraft['sensory_0_10'];sensory[index]=Math.max(0,Math.min(10,Math.round(value)));patch({sensory_0_10:sensory});}}/></label>)}</div></section>
    </fieldset>
      {errors.length>0&&<ul className="recipe-editor-error" role="alert">{errors.map(error=><li key={error}>{t(error)}</li>)}</ul>}{saveError&&<p className="recipe-editor-error" role="alert">保存失败：<span data-i18n="verbatim">{saveError}</span></p>}
    <footer className="recipe-editor-footer"><button type="button" disabled={pending} onClick={()=>{if(!busy.current)onCancel();}}>取消</button><button type="submit" className="primary" disabled={pending}>{pending?'正在保存…':'保存自定义酒谱'}</button></footer>
  </form></Localized>;
}
export default RecipeEditor;
