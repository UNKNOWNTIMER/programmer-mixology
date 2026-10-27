import type { Taste } from './types';
import type { Language } from './i18n';
export const CONTROL_HINT_DELAY=1000;
export type ControlKind='taste'|'sensory';
const tasteHints:[string,string][]=[
 ['入口与回味的甜感强弱。调高表示更偏爱甜感；五味合计100%，是偏好权重，非原料比例。','Strength of sweetness on the first sip and in the finish. Raising this favors sweetness. The five tastes total 100% as preference weights, not ingredient ratios.'],
 ['入口的尖锐酸感与生津感。调高表示更偏爱酸感；五味合计100%，是偏好权重，非原料比例。','Sharp acidity on the first sip and its mouthwatering sensation. Raising this favors sourness. The five tastes total 100% as preference weights, not ingredient ratios.'],
 ['从入口至收尾的苦感强弱与持续感。调高表示更偏爱苦感；五味合计100%，是偏好权重，非原料比例。','Strength and persistence of bitterness from the first sip through the finish. Raising this favors bitterness. The five tastes total 100% as preference weights, not ingredient ratios.'],
 ['盐味在口中的显著程度。调高表示更偏爱咸感；五味合计100%，是偏好权重，非原料比例。','How noticeable saltiness feels on the palate. Raising this favors saltiness. The five tastes total 100% as preference weights, not ingredient ratios.'],
 ['圆润的鲜旨或旨味感。调高表示更偏爱鲜感；五味合计100%，是偏好权重，非原料比例。','Rounded, savory umami sensation. Raising this favors umami. The five tastes total 100% as preference weights, not ingredient ratios.'],
];
const sensoryHints:[string,string][]=[
 ['0偏向轻微酒精刺激，10偏向明显酒精刺激。这是主观感受目标，不是酒精度ABV或饮用量。','0 prefers little alcohol sensation; 10 prefers pronounced alcohol sensation. This subjective target is not ABV or a drinking allowance.'],
 ['0偏向含蓄，10偏向香气鲜明。这是香气表现的目标，不是香精剂量或质量评分。','0 prefers subtle aromas; 10 prefers pronounced aromas. This is an aroma target, not an extract dose or a quality score.'],
 ['0偏向轻盈，10偏向饱满厚实。这是口感厚度目标，不代表热量、糖量或实际黏度。','0 prefers light body; 10 prefers a full, rich body. This target does not represent calories, sugar dose or measured viscosity.'],
 ['0偏向无气泡，10偏向明显气泡刺激。是独立感受目标，不是碳酸含量实测。','0 prefers still drinks; 10 prefers pronounced fizz. This is an independent sensation target, not measured carbonation.'],
 ['0偏向无清凉感，10偏向明显清凉感。清凉感不等于饮料温度，也不是冰块数量。','0 prefers no cooling sensation; 10 prefers strong cooling. Cooling sensation is not drink temperature in °C or an ice quantity.'],
 ['0偏向无辣感，10偏向明显辛辣刺激。这是独立口感目标，不是辣椒剂量或酒精度。','0 prefers no heat; 10 prefers strong spicy heat. This independent target is not a chili dose or ABV.'],
 ['0偏向收尾短，10偏向余味持久。这是余韵目标，不以秒计，也不是好喝程度或实饮评分。','0 prefers a brief finish; 10 prefers lingering flavors. This target is not measured in seconds and is not a tasting or quality score.'],
];
export function controlHint(kind:ControlKind,axis:number,language:Language):string{return (kind==='taste'?tasteHints:sensoryHints)[axis]?.[language==='en'?1:0]||'';}

/** Repeated motion over the same control does not restart its one-second dwell. */
export function createDelayedHint<T>(reveal:(item:T)=>void,hide:()=>void,delay=CONTROL_HINT_DELAY){
 let timer:ReturnType<typeof setTimeout>|undefined,key:string|null=null,item:T|null=null;
 return {
  enter(nextKey:string,next:T){item=next;if(key===nextKey)return;clearTimeout(timer);hide();key=nextKey;timer=setTimeout(()=>{timer=undefined;if(item!==null)reveal(item);},delay);},
  leave(){clearTimeout(timer);timer=undefined;key=null;item=null;hide();},
  dispose(){clearTimeout(timer);timer=undefined;key=null;item=null;},
 };
}
/** The native preview sees at most one immutable, changed visual vector per paint frame. */
export function createTastePreviewPublisher(emit:(taste:Taste|null)=>void,schedule:(run:()=>void)=>number=run=>requestAnimationFrame(run),cancel:(id:number)=>void=id=>cancelAnimationFrame(id)){
 let frame:number|null=null,pending:Taste|null=null,lastKey:string|null=null;
 const flush=()=>{frame=null;const value=pending;pending=null;if(!value)return;const key=value.join(',');if(key!==lastKey){lastKey=key;emit([...value]);}};
 return {
  show(value:readonly number[]){if(value.length!==5||value.some(v=>!Number.isInteger(v)||v<0)||value.reduce((sum,v)=>sum+v,0)!==10000)return;pending=[...value] as Taste;if(frame===null)frame=schedule(flush);},
  hide(){if(frame!==null)cancel(frame);frame=null;pending=null;if(lastKey!==null){lastKey=null;emit(null);}},
 };
}
