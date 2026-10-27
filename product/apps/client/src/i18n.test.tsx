import { describe,it,expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider,Localized,translate } from './i18n';
import { localizedRecipe,ingredientName,recipeTranslationSignature } from './recipe-i18n';
import recipes from '../public/seed/recipes.json';
import english from './recipe-english.json';
import quotes from './recipe-quotes.en.json';
import type { Recipe, Catalog } from './types';
import TrialPanel from './TrialPanel';
import { ArchiveQueueMenu } from './ArchiveQueueMenu';
import { OrderStampOverlay, type TicketOrder } from './TicketDock';
import { RecipeDetails } from './RecipeWindow';
import { GlassDetails } from './GlassDetails';
import { ArchiveLogo } from './ArchiveLogo';
import type { Profile } from './types';
const catalog=recipes.recipes as unknown as Recipe[];
const chinese=/[\u3400-\u9fff]/;
describe('bilingual presentation without source mutation',()=>{
 it('defaults to English, preserves explicit Chinese, and translates nested display text',()=>{
   const defaultHtml=renderToStaticMarkup(<Localized><button title="打开设置">设置</button></Localized>);expect(defaultHtml).toContain('Open settings');expect(defaultHtml).toContain('Settings');expect(defaultHtml).not.toMatch(chinese);
   expect(renderToStaticMarkup(<I18nProvider language="zh"><Localized><button title="打开设置">设置</button></Localized></I18nProvider>)).toContain('设置');
   const html=renderToStaticMarkup(<I18nProvider language="en"><Localized><section><button title="打开设置">设置</button><p>本地模型未运行</p></section></Localized></I18nProvider>);
   expect(html).toContain('title="Open settings"');expect(html).toContain('Local model stopped');expect(html).not.toMatch(chinese);
 });
 it('preserves form values, keys, raw audit JSON and explicitly original user content',()=>{
   const html=renderToStaticMarkup(<I18nProvider language="en"><Localized><section><input value="设置" readOnly/><p data-i18n="verbatim">目标：私人酒谱</p><pre>{'{"订单":"未知"}'}</pre><button data-key="设置">设置</button></section></Localized></I18nProvider>);
   expect(html).toContain('value="设置"');expect(html).toContain('目标：私人酒谱');expect(html).toContain('订单');expect(html).toContain('data-key="设置"');expect(html).toContain('Settings');
 });
 it('translates dynamic known UI fragments but leaves unknown prose unchanged',()=>{
   expect(translate('主机已确认 · abc123','en')).toBe('Host confirmed · abc123');
   expect(translate('南风吹过陌生街道','en')).toBe('南风吹过陌生街道');
   expect(translate('设置','zh')).toBe('设置');
 });
 it('provides complete guarded English display records for all 300 built-ins',()=>{
   expect(catalog).toHaveLength(300);
   for(const source of catalog){const before=JSON.stringify(source);const result=localizedRecipe(source,'en');
     expect(result,source.id).not.toBe(source);expect(result.steps_zh.join(' '),source.id).not.toMatch(chinese);expect(result.garnish_zh,source.id).not.toMatch(chinese);expect(result.notes_zh,source.id).not.toMatch(chinese);
     expect(result.ingredients.map(p=>p.quantity_note).join(' '),source.id).not.toMatch(chinese);
     expect(result.source).toBe(source.source);expect(result.default_orderable).toBe(source.default_orderable);expect(result.preparation_review).toBe(source.preparation_review);
     expect(result.ingredients.map(({quantity_note,...p})=>p)).toEqual(source.ingredients.map(({quantity_note,...p})=>p));
     expect(result.name_zh).toBe(source.name_zh);expect(result.name_en).toBe(source.name_en);expect(JSON.stringify(source)).toBe(before);
     expect((english as Record<string,{signature:string}>)[source.id].signature).toBe(recipeTranslationSignature(source));
   }
 });
 it('never applies built-in translations to unknown or changed imported content',()=>{
   const source=catalog[0];expect(localizedRecipe(source,'zh')).toBe(source);
   const changed={...source,steps_zh:['私人新步骤']};expect(localizedRecipe(changed,'en')).toBe(changed);
   const dose={...source,ingredients:source.ingredients.map((p,i)=>i?{...p}:{...p,quantity:99})};expect(localizedRecipe(dose,'en')).toBe(dose);
   const unknown={...source,id:'personal-new'};expect(localizedRecipe(unknown,'en')).toBe(unknown);
 });
 it('has 300 distinct English quotations and retains explicit source corrections',()=>{
   expect(Object.keys(quotes)).toHaveLength(300);expect(new Set(Object.values(quotes)).size).toBe(300);expect(Object.values(quotes).join('')).not.toMatch(chinese);
   expect(english.cdb_11029.steps.join(' ')).toContain('heat resistance');expect(english.cdb_178354.steps.join(' ')).toContain('food-grade identification');expect(english.cdb_12726.steps.join(' ')).toContain('full batch');
 });
 it('renders the English trial panel without modifying stock or mounting invalid hooks',()=>{
   const html=renderToStaticMarkup(<I18nProvider language="en"><TrialPanel catalog={{recipes:[],ingredients:[],profiles:[],sources:[],schema_version:'test'} as Catalog} target={{taste_bps:[2000,2000,2000,2000,2000],sensory_0_10:[5,5,5,5,5,5,5]}} excluded={[]} inventory={{}} onInventory={()=>{}}/></I18nProvider>);
   expect(html).toContain('Confirm actual SKU');expect(html).not.toMatch(chinese);
 });
 it('preserves private archive names in actual queue text, tooltips and accessible action names',()=>{
   const html=renderToStaticMarkup(<I18nProvider language="en"><ArchiveQueueMenu items={[{id:'private',name:'目标酒馆的奶油'}]} onRemove={()=>{}}/></I18nProvider>);
   expect(html).toContain('title="目标酒馆的奶油"');expect(html).toContain('aria-label="Done目标酒馆的奶油"');expect(html).toContain('Mixing');expect(html).not.toContain('Target酒馆');
 });
 it('preserves guest names, notes and custom labels in the actual immutable-order view',()=>{
   const order:TicketOrder={id:'order',guest_id:'guest',request_id:'request',status:'received',version:1,created_at:1,stamp_open:true,snapshot:{guest:{display_name:'目标客人'},guest_note:'目标是少加糖',serving_spec:{name:'奶油私存',glass:'目标杯',ice:'原料是我的冰',parts:[{sku_id:'custom',ingredient_id:'custom',quantity_ml:15,stage:'mix'}],steps:['目标是先搅拌']},sku_snapshot:[{id:'custom',label:'来源奶油'}]}};
   const before=JSON.stringify(order),html=renderToStaticMarkup(<I18nProvider language="en"><OrderStampOverlay order={order} onClose={()=>{}}/></I18nProvider>);
   for(const original of ['目标客人','目标是少加糖','奶油私存','目标杯','原料是我的冰','来源奶油','目标是先搅拌'])expect(html).toContain(original);
   expect(html).toContain('Guest note:');expect(html).toContain('Frozen ingredients');expect(html).not.toContain('Target是少加糖');expect(JSON.stringify(order)).toBe(before);
 });
 it('preserves unknown recipe prose and source identity in the actual recipe drawer',()=>{
   const recipe:Recipe={...catalog[0],id:'personal-display',name_zh:'奶油私存',name_en:'Private 目标',steps_zh:['目标是少加糖'],garnish_zh:'原料不是装饰',notes_zh:'来源是我的笔记',source:{...catalog[0].source,url:null,publisher:'目标酒馆',reference:'订单个人笔记'}};
   const before=JSON.stringify(recipe),html=renderToStaticMarkup(<I18nProvider language="en"><RecipeDetails recipe={recipe} ingredients={[]} pinned={false} servings={1} onServings={()=>{}} onPin={()=>{}} onClose={()=>{}}/></I18nProvider>);
   for(const original of ['奶油私存','Private 目标','目标是少加糖','原料不是装饰','来源是我的笔记','目标酒馆','订单个人笔记'])expect(html).toContain(original);
   expect(html).toContain('Steps');expect(html).toContain('Source');expect(html).not.toContain('Target酒馆');expect(JSON.stringify(recipe)).toBe(before);
 });
 it('selects the supplied English ingredient name with a stable fallback',()=>{
   expect(ingredientName(undefined,'en','missing')).toBe('missing');
 });
 it('shows the new archive extension in Chinese and English without rewriting imported data',()=>{
   for(const language of ['zh','en'] as const){
     const html=renderToStaticMarkup(<I18nProvider language={language}><ArchiveLogo><span data-i18n="verbatim">私人存档</span></ArchiveLogo></I18nProvider>);
     expect(html).toContain('.timermix');expect(html).not.toContain('.pixelmix');expect(html).toContain('私人存档');
     expect(html).toContain(language==='en'?'Drag TIMER out to save this recipe':'拖出 TIMER 保存当前酒谱');
   }
   expect(translate('每次请拖入一个 .timermix 酒谱存档。','en')).toBe('Drop one .timermix recipe archive at a time.');
 });
 it('labels recipe predictions separately from user targets in both languages without rewriting source profiles',()=>{
   const recipe=catalog[0],profile:Profile={recipe_id:recipe.id,taste_preference_bps:[1000,2000,3000,4000,0],sensory_0_10:[1,2,3,4,5,6,7],taste_intensity_0_10:null,status:'heuristic_unvalidated',measured:false,note_zh:'原始先验记录'};
   const target={taste_bps:[8000,1000,500,300,200] as [number,number,number,number,number],sensory_0_10:[1,2,3,4,5,6,7] as [number,number,number,number,number,number,number]},before=JSON.stringify({recipe,profile,target});
   for(const language of ['zh','en'] as const){const html=renderToStaticMarkup(<I18nProvider language={language}><GlassDetails kind="profile" recipe={recipe} ingredients={[]} profile={profile} target={target} onClose={()=>{}}/></I18nProvider>);
     expect(html).not.toContain('先验');expect(html).not.toContain('Prior');expect(html).toContain(language==='en'?'Recipe prediction':'配方预测');expect(html).toContain('class="glass-callout-target">80%');expect(html).toContain('class="glass-callout-prior">10%');if(language==='en')expect(html).not.toMatch(chinese);
   }
   expect(JSON.stringify({recipe,profile,target})).toBe(before);
 });
});
