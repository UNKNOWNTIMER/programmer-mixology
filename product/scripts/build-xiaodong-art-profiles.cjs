// Reproducible, code-native editorial art selection for the supplied DLC.
// Reads the curated serving recipe; never rewrites catalog facts or original notes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),source=path.join(root,'data/dlc/xiaodong/catalog.json');
const catalog=JSON.parse(fs.readFileSync(source,'utf8'));
const seedIngredients=JSON.parse(fs.readFileSync(path.join(root,'apps/client/public/seed/ingredients.json'),'utf8')).ingredients;
const ingredients=new Map([...seedIngredients,...catalog.ingredients].map(i=>[i.id,`${i.id} ${i.name_zh} ${i.name_en}`]));
const normal=value=>value.trim().replace(/\s+/g,' '),number=value=>value==null?null:Math.round(value*1_000_000);
const signature=recipe=>JSON.stringify([normal(recipe.name_en).toLowerCase(),normal(recipe.name_zh),recipe.glass_template,recipe.method,recipe.ingredients.map(p=>JSON.stringify([p.ingredient_id,number(p.quantity),p.quantity_range?.map(number)??null,p.unit,p.stage,p.optional])).sort(),normal(recipe.garnish_zh),recipe.steps_zh.map(normal)]);
const seed=value=>{let hash=2166136261;for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619);return hash>>>0;};
const palette=text=>{
  if(/coffee|espresso|kahlua|cacao|chocolate|咖啡|可可|巧克力/i.test(text))return 'coffee';
  if(/cream|milk|advocaat|奶油|牛奶|奶酒|椰奶|椰乳|椰浆/i.test(text))return 'cream';
  if(/blue.curacao|蓝[橙柑]|蝶豆/i.test(text))return 'blue';
  if(/violette|紫罗兰/i.test(text))return 'violet';
  if(/midori|melon.liqueur|menthe.green|蜜瓜|绿薄荷/i.test(text))return 'green';
  if(/cassis|blackcurrant|黑加仑|黑醋栗|黑莓|桑葚/i.test(text))return 'cassis';
  if(/campari|red.wine|ruby.port|grenadine|tomato|cherry.heering|金巴利|红葡萄酒|石榴糖浆|番茄|樱桃利口/i.test(text))return 'ruby';
  if(/cranberry|raspberry|strawberry|sloe.gin|蔓越莓|覆盆子|草莓|黑刺李/i.test(text))return 'rose';
  if(/whisk|bourbon|cognac|brandy|aged.rum|dark.rum|sweet.vermouth|cola|威士忌|波本|干邑|白兰地|深色朗姆|黑朗姆|甜味美思|可乐|梅酒|乌梅/i.test(text))return 'amber';
  if(/orange.juice|pineapple|passion|peach|apple.juice|champagne|prosecco|aperol|橙汁|菠萝|百香果|桃|苹果汁|香槟|黄查特|阿佩罗/i.test(text))return 'gold';
  return 'clear';
};
const counts=new Map();
const profiles=catalog.recipes.map(recipe=>{
  const key=signature(recipe),steps=recipe.steps_zh.join('；');
  const garnish=recipe.garnish_zh.split(/也可|或/)[0].replace(/(?:柠檬|青柠|橙)皮油(?:（可选）)?/g,'');
  const serving=recipe.ingredients.filter(p=>!['garnish','rinse','side'].includes(p.stage));
  const text=serving.map(p=>ingredients.get(p.ingredient_id)||p.ingredient_id).join(' ');
  const facts=`${steps} ${garnish}`,iceSteps=steps.replace(/碎冰只在配方明确指定时使用/g,'');
  const garnishes=[];const add=(name,regexp)=>{if(regexp.test(garnish))garnishes.push(name);};
  add('twist',/柠檬皮|橙皮|青柠皮/);
  add('citrus',/(?:柠檬|青柠|橙|葡萄柚|柑橘)(?!皮|汁)[^，；。]{0,3}(?:角|片|轮)|半片橙/);
  add('olive',/橄榄/);add('cherry',/樱桃/);add('herb',/薄荷|罗勒/);add('sprig',/迷迭香|薰衣草/);
  add('dust',/肉豆蔻|可可|咖啡粉|巧克力/);add('beans',/咖啡豆/);add('pineapple',/菠萝/);
  add('berry',/草莓|黑莓|蓝莓|覆盆子|浆果|蔓越莓/);add('passion',/百香果/);add('cucumber',/黄瓜/);
  add('chili',/辣椒/);add('celery',/芹菜/);add('ginger',/姜/);add('grape',/葡萄(?!柚)/);
  const noIce=/不带冰|成杯不留冰|不加冰|无冰|滤入(?:预冷|冰镇)/.test(iceSteps)&&!/新冰|碎冰|连冰|杯中[^。；]{0,12}冰块/.test(iceSteps);
  const servingIce=!noIce&&(/新冰|碎冰|连冰|加满冰|补冰|杯中[^。；]{0,12}(?:冰块|加冰)|装(?:有|满)?冰|冰块[^。；]{0,4}杯|高球杯[^。；]{0,24}大冰块/.test(iceSteps)||(recipe.method==='blend'&&/冰/.test(iceSteps)));
  const ice=!servingIce?'none':/碎冰/.test(iceSteps)||recipe.method==='blend'?'crushed':/大(?:块|颗)?冰/.test(iceSteps)?'large':'cubes';
  const clarified=/絮凝|澄清咖啡/.test(steps);
  const foam=clarified?'none':/打发奶油|奶盖/.test(facts)?'cream':/蛋[白清]|egg.white|aquafaba|鹰嘴豆/i.test(text)||(/espresso|浓缩咖啡/i.test(text)&&recipe.method==='shake')||/形成泡沫|绵密泡沫/.test(steps)?'fine':'none';
  let layers=[],gradient=false;
  if(recipe.method==='layer'||(serving.some(p=>p.stage==='float')&&/最后沿吧勺背缓慢注入|逐层|分层倒入|分层注入|缓慢.{0,6}漂浮|吧匙.{0,8}分层/.test(steps))){
    layers=serving.filter(p=>p.stage==='float'&&p.unit==='ml').map(p=>palette(ingredients.get(p.ingredient_id)||p.ingredient_id)).reverse();
    layers.push(palette(serving.filter(p=>p.stage!=='float').map(p=>ingredients.get(p.ingredient_id)||p.ingredient_id).join(' ')));
    layers=layers.filter((p,i)=>i===0||p!==layers[i-1]).slice(0,5);
    if(layers.length<2)layers=[];
  }
  // These working recipes explicitly let dense grenadine settle. A finishing
  // pour is not a stable floating top layer; the illustration keeps the red base.
  if(/自然下沉/.test(steps)&&serving.some(p=>p.stage==='finish'&&/grenadine/.test(p.ingredient_id))){
    layers=[palette(serving.filter(p=>p.stage!=='finish').map(p=>ingredients.get(p.ingredient_id)||p.ingredient_id).join(' ')),'ruby'];
    gradient=true;
  }
  const count=counts.get(recipe.glass_template)||0;counts.set(recipe.glass_template,count+1);
  return {recipe_id:recipe.id,signature:key,seed:seed(key),variant:count%4,palette:clarified?'amber':palette(text),ice,foam,garnishes:garnishes.slice(0,3),rim:/盐边|盐口|糖边|糖口|糖杯口/.test(facts),bubbles:/soda|tonic|ginger.beer|ginger.ale|champagne|prosecco|sparkling|苏打|汤力|姜汁啤酒|姜汁汽水|香槟|气泡酒/i.test(text),hot:/热咖啡|热水|趁热|耐热杯/.test(steps),layers,gradient};
});
if(new Set(profiles.map(p=>p.signature)).size!==profiles.length)throw new Error('Duplicate DLC art contents');
const output={version:1,group_id:'xiaodong-notes-v1',source_sha256:catalog.group.source_sha256,catalog_sha256:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),scope:'AI-assisted editorial illustration of the final serving recipe. Glassware and colour are artistic; only explicit serving cues select literal garnish/ice/foam. Never measured colour or physical layering ratios.',profiles};
const destination=path.join(root,'apps/client/src/dlc-art-profiles.json');fs.writeFileSync(destination,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({path:destination,recipes:profiles.length,glass_families:Object.fromEntries(counts)}));
