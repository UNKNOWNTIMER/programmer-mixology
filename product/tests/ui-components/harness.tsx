import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Glass} from '../../apps/client/src/Glass';
import {TasteControls,SensoryControls} from '../../apps/client/src/Controls';
import {redistribute} from '../../apps/client/src/domain';
import type {Recipe,Profile,Ingredient,Target} from '../../apps/client/src/types';
import recipesData from '../../apps/client/public/seed/recipes.json';
import profilesData from '../../apps/client/public/seed/profiles.seed.json';
import ingredientsData from '../../apps/client/public/seed/ingredients.json';
import '../../apps/client/src/styles.css';
import './harness.css';
const recipes=recipesData.recipes as unknown as Recipe[],profiles=profilesData.profiles as unknown as Profile[],ingredients=ingredientsData.ingredients as Ingredient[];
function Harness(){
 const [selected,setSelected]=useState('iba_dry_martini'),recipe=recipes.find(r=>r.id===selected)||recipes.find(r=>r.glass_template==='martini')!,profile=profiles.find(p=>p.recipe_id===recipe.id)!;
 const [target,setTarget]=useState<Target>({taste_bps:[4000,3000,2000,500,500],sensory_0_10:[4,8,5,1,2,0,7]}),[locked,setLocked]=useState<number[]>([]);
 const anchor=useRef(target),[history,setHistory]=useState<Target[]>([]);
 const common={target,profile,locked,onLock:(axis:number)=>setLocked(a=>a.includes(axis)?a.filter(v=>v!==axis):[...a,axis]),onBegin:()=>{anchor.current=structuredClone(target);setHistory(h=>[...h,target]);},onEnd:()=>{},onCancel:()=>setTarget(anchor.current),onTaste:(a:Target['taste_bps'],i:number,v:number)=>setTarget(t=>({...t,taste_bps:redistribute(a,i,v,locked)})),onSensory:(i:number,v:number)=>setTarget(t=>{const s=[...t.sensory_0_10] as Target['sensory_0_10'];s[i]=v;return {...t,sensory_0_10:s};}),onPreset:()=>setTarget({taste_bps:profile.taste_preference_bps,sensory_0_10:profile.sensory_0_10})};
 return <><div className="test-controls"><select aria-label="测试杯型" value={recipe.glass_template} onChange={e=>setSelected(recipes.find(r=>r.glass_template===e.target.value)!.id)}>{['highball','rocks','martini','coupe','flute','hurricane','mug','goblet'].map(g=><option key={g}>{g}</option>)}</select><button onClick={()=>{const last=history.at(-1);if(last){setTarget(last);setHistory(h=>h.slice(0,-1));}}}>测试撤销</button><output data-testid="target">{JSON.stringify(target)}</output><span data-testid="selected">{recipe.id}</span></div><div className="test-glass"><Glass recipe={recipe} ingredients={ingredients} profile={profile} target={target}/></div><div className="test-taste"><TasteControls {...common} presets={recipes.map(r=>({recipe_id:r.id,name_zh:r.name_zh,name_en:r.name_en,profile:profiles.find(p=>p.recipe_id===r.id)!}))} onSelectPreset={id=>{setSelected(id);const p=profiles.find(p=>p.recipe_id===id)!;setTarget({taste_bps:p.taste_preference_bps,sensory_0_10:p.sensory_0_10});}}/></div><div className="test-sensory"><SensoryControls {...common}/></div></>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
