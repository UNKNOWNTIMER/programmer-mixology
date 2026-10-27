import { useId } from 'react';
import type { Ingredient, Profile, Recipe, Target } from './types';
import { GLASS_LABELS, ingredientName, TASTE_LABELS } from './domain';
import { compositionFacts } from './glass-art';
import { formatEstimate } from './estimates';
import { estimateDisplayDrink } from './assisted-estimates';
import './glass-callout.css';
import {Localized,useI18n} from './i18n';
import {displayQuantity} from './quantity-display';
import {localizedRecipe} from './recipe-i18n';

export type GlassDetailKind = 'composition' | 'facts' | 'profile';
export interface GlassDetailsProps {
  kind:GlassDetailKind;
  recipe:Recipe;
  ingredients:Ingredient[];
  profile?:Profile;
  target?:Target;
  onClose:()=>void;
}

const TITLES:Record<GlassDetailKind,string>={composition:'配料',facts:'资料',profile:'味觉'};
const percent=(basisPoints:number)=>`${Number((basisPoints/100).toFixed(2))}%`;

/** Read-only content shared by the native auxiliary surface and the browser callout. */
export function GlassDetails({kind,recipe,ingredients,profile,target,onClose}:GlassDetailsProps) {
  const {language}=useI18n(),titleId=useId(),view=localizedRecipe(recipe,language),facts=compositionFacts(recipe,ingredients),estimates=estimateDisplayDrink(recipe,ingredients,language);
  const name=(id:string)=>language==='en'?ingredients.find(i=>i.id===id)?.name_en||id:ingredientName(ingredients,id);
  const estimateNotes=[...estimates.reasons,...estimates.assumptions].join('\n');
  const compositionNote=(facts.assumedConversion?(language==='en'?'U.S. volume convention; ':'按美制容量换算；'):'')+(facts.incomplete
    ?'含未知或非毫升剂量；占比只含已知毫升项，未计融冰，不是五味比例。'
    :'原配方毫升项占比，未计融冰，不是五味比例。');
  return <Localized><section className="glass-callout-card" data-kind={kind} aria-labelledby={titleId}>
    <header className="glass-callout-header">
      <h2 id={titleId} title={kind==='composition'?compositionNote:kind==='profile'?'用户目标与配方预测独立；预测不是真实评价。':undefined}>{TITLES[kind]}</h2>
      <button type="button" className="glass-callout-close" aria-label="关闭杯图资料" onClick={onClose}>×</button>
    </header>
    <div className="glass-callout-body">
      <p className="glass-callout-recipe" title={recipe.name_en}>{language==='en'?recipe.name_en:recipe.name_zh}</p>
      {kind==='composition'&&<>
        <ul className="glass-callout-ingredients">
          {view.ingredients.map((part,index)=>{
            const known=facts.parts.find(item=>item.part_index===index),amount=displayQuantity(part,ingredients.find(i=>i.id===part.ingredient_id),1,language);
            return <li key={`${part.ingredient_id}-${index}`}>
              <span className="glass-callout-ingredient-name">{name(part.ingredient_id)}{part.optional&&<small>可选</small>}</span>
              <b className="glass-callout-quantity" title={[amount.note,part.quantity_note].filter(Boolean).join(' ')}>{amount.text}</b>
              {known&&<small className="glass-callout-share" title={compositionNote}>{known.percent!.toFixed(1)}%</small>}
            </li>;
          })}
        </ul>
      </>}
      {kind==='facts'&&<>
        {estimates.mainDrinkOnly&&<p className="fineprint" data-i18n="verbatim">{language==='en'?'Main drink estimates · foam excluded':'主酒估算 · 泡沫另计'}</p>}
        <dl className="glass-callout-facts">
          <dt>酒精度</dt><dd title={estimateNotes}>{formatEstimate(estimates.abvPercent,'%',language)}</dd>
          <dt>热量</dt><dd title={estimateNotes}>{formatEstimate(estimates.caloriesKcal,'kcal',language)}</dd>
          <dt>成杯 / 份</dt><dd title={estimateNotes}>{formatEstimate(estimates.servedVolumeMl,'ml',language)}</dd>
          <dt>已知原液</dt><dd title={compositionNote}>{facts.assumedConversion?'≈':''}{Number(facts.knownMl.toFixed(2))} ml{facts.incomplete&&<small>不完整</small>}</dd>
          <dt>杯型</dt><dd>{GLASS_LABELS[recipe.glass_template]||recipe.glass_template}</dd>
        </dl>
      </>}
      {kind==='profile'&&(profile&&target?<>
        <table className="glass-callout-profile" aria-label="用户五味目标与配方预测">
          <thead><tr><th scope="col">五味</th><th scope="col" className="glass-callout-target">目标</th><th scope="col" className="glass-callout-prior" title="配方预测，不是真实评价">配方</th></tr></thead>
          <tbody>{TASTE_LABELS.map((name,index)=><tr key={name}>
            <th scope="row">{name}</th>
            <td className="glass-callout-target">{percent(target.taste_bps[index])}</td>
            <td className="glass-callout-prior">{percent(profile.taste_preference_bps[index])}</td>
          </tr>)}</tbody>
        </table>
      </>:<p className="glass-callout-empty">{!profile?'暂无配方预测':'暂无用户目标'}</p>)}
    </div>
  </section></Localized>;
}
