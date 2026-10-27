import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TasteControls, type ControlProps } from './Controls';
import { RecipeEditor } from './RecipeEditor';
import { initialRecipeDraft } from './recipe-editor-state';
import { tastePercentages } from './taste-display';
import type { Taste } from './types';

const noop=()=>{};
const props:ControlProps={target:{taste_bps:[3333,3333,3334,0,0],sensory_0_10:[5,5,5,5,5,5,5]},locked:[],onLock:noop,onBegin:noop,onEnd:noop,onCancel:noop,onTaste:noop,onSensory:noop,onPreset:noop};
describe('conserved whole taste percentages across the UI',()=>{
  it.each<Taste>([[3333,3333,3334,0,0],[1250,1250,1250,1250,5000],[1,1,1,1,9996],[0,10000,0,0,0]])('renders integer controls totaling 100 while keeping precise range values',(...taste)=>{
    const target={...props.target,taste_bps:taste as Taste},before=structuredClone(target);
    const html=renderToStaticMarkup(<TasteControls {...props} target={target} locked={[0]}/>);
    const shown=[...html.matchAll(/class="taste-number"[^>]*value="(\d+)"/g)].map(match=>Number(match[1]));
    expect(shown).toEqual(tastePercentages(taste));expect(shown).toHaveLength(5);expect(shown.reduce((a,b)=>a+b,0)).toBe(100);
    const precise=[...html.matchAll(/aria-valuenow="(\d+)"/g)].map(match=>Number(match[1]));
    expect(precise).toEqual(taste);expect(target).toEqual(before);
  });
  it('uses the same allocation for the custom recipe editor and its 100% total',()=>{
    const initial={...initialRecipeDraft(),taste_bps:[3333,3333,3334,0,0] as Taste};
    const html=renderToStaticMarkup(<RecipeEditor ingredients={[]} initial={initial} initialTarget={props.target} onSave={async()=>{}} onCancel={noop}/>);
    const tasteSection=html.split('class="recipe-editor-targets"')[1].split('recipe-editor-sensory')[0];
    const displayed=[...tasteSection.matchAll(/value="(\d+)"/g)].map(match=>Number(match[1]));
    expect(displayed).toEqual([33,33,34,0,0]);expect(initial.taste_bps).toEqual([3333,3333,3334,0,0]);
  });
  it('rejects invalid vectors instead of masking damaged data as a normal 100%',()=>{
    for(const taste of [[2000,2000,2000,2000,1999],[0,0,0,0,10001],[9999.5,.5,0,0,0]])expect(()=>tastePercentages(taste)).toThrow();
  });
});
