"""Offline normalization of individually fetched public TheCocktailDB API facts.

No network and no model. Runs after fetch-community-recipes.ps1 and human editorial
review. Never rewrites either pre-existing immutable source pack or handoff data.
"""
import copy
import hashlib
import json
import re
import unicodedata
from fractions import Fraction
from pathlib import Path

P = Path(__file__).resolve().parents[1]
R = P.parent
DAY = '2026-09-21'
PACK = 'community-188-2026-09-21'
def read(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Existing Windows pack hashes identify CRLF bytes. Make regeneration equally
    # deterministic on every OS, independently of Python's platform newline mode.
    path.write_bytes((json.dumps(data, ensure_ascii=False, indent=2)+'\n').replace('\n','\r\n').encode('utf-8'))
def sha(data): return hashlib.sha256(data).hexdigest()
def norm(s): return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFKD', s).encode('ascii','ignore').decode().lower())

# Selection excludes near duplicates and unresolved source conflicts; it is not a
# claim that every other record was physically tested or belongs to the IBA list.
excluded = {
 '15567':'Unspecified batch measures and missing units',
 '11011':'Near duplicate After Dinner Cocktail with same principal ingredients',
 '17183':'Daiquiri family ratio/garnish variant omitted to avoid padding',
 '11060':'Near duplicate Affinity whisky/vermouth construction',
 '11251':'Sidecar ingredient set; ratio variant omitted',
 '16943':'Sex on the Beach ingredient set; ratio variant omitted',
 '14560':'Hot chocolate paired with vigorous shaking; unresolved hot preparation',
 '14107':'Instructions require shaking carbonated soda',
 '16134':'Instructions appear to shake ginger ale; omitted',
 '17228':'Generic gin/vermouth Martini variant omitted',
 '14584':'Unbounded optional vodka shots in source instructions',
 '178311':'Unreviewed fresh wormwood preparation and unspecified botanical dose',
 '178344':'Lemon juice absent from ingredients; honey versus honey vodka mismatch',
 '178366':'Lemon juice ingredient conflicts with lemonade instruction',
 '17239':'Missing gin and cherry volume/name conflicts in ingredient table',
 '13936':'Large high-proof batch with unquantified frozen mixes',
 '178353':'Ginger ingredient conflicts with ginger ale instruction',
 '17824':'Tonic ingredient conflicts with ginger ale instruction',
 '14978':'Unspecified bottle-size batch',
 '16273':'Water quantity contradicts conditional can-label instructions',
 '11472':'Waikiki Beachcomber same ingredient set; ratio-only variation omitted',
 '12766':'Cream Soda same spirit/mixer; garnish variation omitted',
 '13192':'Instructions shake all ingredients including carbonated soda',
 '13200':'Large batch blending beer; serving and safe preparation unresolved',
 '17267':'Soda quantity appears only in instructions; incomplete ingredient table',
 '178345':'Two-serving hot recipe with water absent from ingredient table',
 '11375':'Same normalized principal ingredients and doses as Almond Joy 11024',
 '178365':'Lemon peel ingredient conflicts with squeezed lemon wedge instruction',
 '178343':'All sauces in ingredient table conflict with alternative sauces in instructions',
}
ids=[str(x) for x in read(P/'data/catalog/community-shortlist.json')]
selected=[x for x in ids if x not in excluded]+['11025','11028','11243','12726','15006']
assert len(ids)==212 and len(set(ids))==212 and len(selected)==188
base={k:read(R/'data'/f) for k,f in [('recipes','recipes.json'),('ingredients','ingredients.json'),('profiles','profiles.seed.json'),('sources','sources.json')]}
first=read(P/'data/catalog/iba-completion-2026-09-21.json')
for k in base: base[k][k]+=first[k][k]
base['recipes']['recipe_count']=112
editorial={}
for suffix in ('a','b'):
    editorial.update(read(P/f'data/catalog/community-editorial-{suffix}.json'))
editorial.update(read(P/'data/catalog/community-editorial-replacements.json'))
for line in (P/'data/catalog/community-editorial-c.tsv').read_text(encoding='utf-8').splitlines():
    id,zh,steps,garnish,quote=line.split('\t')
    editorial[id]=dict(name_zh=zh,steps_zh=steps,garnish_zh=garnish,quote=quote)
assert all(x in editorial for x in selected)

known={norm(x['name_en']):x['id'] for x in base['ingredients']['ingredients']}
# Exact semantic synonyms only. Brands/styles not stated equivalent remain
# separate SKUs; original source names and modifiers survive in every row.
aliases={
 'light rum':'white_rum','fresh lime juice':'lime','lime juice':'lime','fresh lemon juice':'lemon','lemon juice':'lemon',
 'sweet vermouth':'sweet_vermouth','rosso vermouth':'sweet_vermouth','dry vermouth':'dry_vermouth',
 'apricot brandy':'apricot_brandy','scotch':'scotch','bourbon':'bourbon','rye whiskey':'rye',
 'pineapple juice':'pineapple','cranberry juice':'cranberry','grapefruit juice':'grapefruit',
 'angostura bitters':'angostura','bitters':'aromatic_bitters','benedictine':'benedictine','kahlua':'kahlua',
 'creme de cassis':'cassis','green creme de menthe':'creme_menthe_green','white creme de menthe':'creme_menthe_white',
 'carbonated water':'soda','soda water':'soda','club soda':'soda','honey':'raw_honey','whiskey':'whisky',
 'lime':'lime_fruit','lemon':'lemon_fruit','orgeat syrup':'orgeat','ginger':'fresh_ginger',
 'irish cream':'irish_cream','cream of coconut':'cdb_cream_of_coconut','sugar':'sugar','rum':'rum',
}
known.update({norm(k):v for k,v in aliases.items() if v!='cdb_cream_of_coconut'})
new_zh={
 '151 proof rum':'151度数朗姆酒（品牌看原文）','7-Up':'七喜汽水','Absolut Citron':'绝对柠檬伏特加',
 'Absolut Vodka':'绝对伏特加','Advocaat':'蛋黄利口酒','Amaro Montenegro':'黑山苦味利口酒',
 'Anis':'茴香酒 Anis','Anisette':'茴香利口酒 Anisette','Apple Schnapps':'苹果施纳普斯利口酒',
 'Applejack':'苹果杰克烈酒','Apricot Nectar':'杏桃果蜜饮料','Añejo rum':'陈年朗姆酒 Añejo',
 'Baileys irish cream':'百利爱尔兰奶油利口酒','Banana liqueur':'香蕉利口酒','Beer':'啤酒（类型未指定）',
 'Blackberries':'黑莓','Blackberry brandy':'黑莓白兰地（产品类型待确认）','Blended whiskey':'混合威士忌（产地未指定）',
 'Blood Orange':'血橙（形态待确认）','Blue Curacao':'蓝橙利口酒','Blueberries':'蓝莓',
 'Butterscotch schnapps':'太妃糖施纳普斯利口酒','Cherries':'樱桃','Cherry':'樱桃',
 'Cherry Grenadine':'樱桃石榴风味糖浆','Cherry Heering':'喜樱樱桃利口酒','Cherry brandy':'樱桃白兰地（产品类型待确认）',
 'Cinnamon':'肉桂','Coconut liqueur':'椰子利口酒','Coconut rum':'椰子朗姆酒','Cream':'奶油（类型未指定）',
 'Cream of coconut':'加糖椰子奶油 Cream of coconut','Creme De Banane':'香蕉奶油利口酒','Creme de Cacao':'可可利口酒（色泽看原文）',
 'Dark rum':'深色朗姆酒','Dubonnet Rouge':'红杜本内开胃酒','Egg':'鸡蛋','Galliano':'加利亚诺草本利口酒',
 'Gold tequila':'金色龙舌兰酒','Goldschlager':'金箔肉桂利口酒','Heavy cream':'厚奶油','Hot chocolate':'热巧克力',
 'Hpnotiq':'Hpnotiq 果味利口酒','Ice':'冰','Jack Daniels':'杰克丹尼威士忌','Jagermeister':'野格草本利口酒',
 'Kirschwasser':'樱桃蒸馏酒','Kiwi':'猕猴桃','Kummel':'莳萝葛缕子利口酒','Lavender':'薰衣草',
 'Lemon peel':'柠檬皮','Lemon vodka':'柠檬风味伏特加','Lemon-lime soda':'柠檬青柠汽水',
 'Lemonade':'柠檬饮料（含气性看产品）','Light cream':'淡奶油','Lime juice cordial':'青柠浓缩调味液','Lime peel':'青柠皮',
 'Malibu rum':'马利宝椰子朗姆酒','Maraschino cherry':'马拉斯奇诺樱桃','Melon liqueur':'蜜瓜利口酒',
 'Midori melon liqueur':'蜜多丽蜜瓜利口酒','Milk':'牛奶','Nutmeg':'肉豆蔻','Olive':'橄榄',
 'Orange peel':'橙皮','Orange spiral':'螺旋橙皮','Oreo cookie':'奥利奥饼干','Passion fruit juice':'百香果汁',
 'Passoa':'帕索百香果利口酒','Peach Bitters':'桃味苦精','Peach Vodka':'桃风味伏特加','Peach nectar':'桃果蜜饮料',
 'Pepper':'胡椒（品种未指定）','Pineapple':'菠萝','Pineapple Syrup':'菠萝糖浆','Pisang Ambon':'Pisang Ambon 香蕉利口酒',
 'Pomegranate juice':'石榴汁','Port':'波特酒（类型未指定）','Powdered sugar':'糖粉','Raspberry Vodka':'覆盆子伏特加',
 'Ricard':'里卡尔茴香酒','Rosemary':'迷迭香','Roses sweetened lime juice':'Rose’s 加糖青柠汁',
 'Ruby Port':'红宝石波特酒','Sambuca':'桑布卡茴香利口酒','Sarsaparilla':'沙士','Schweppes Russchian':'怡泉 Russchian 混饮汽水',
 'Sherry':'雪莉酒（类型看原文）','Sirup of roses':'玫瑰糖浆','Sloe gin':'黑刺李金酒','Sour mix':'酸甜调和液',
 'Southern Comfort':'南方安逸利口酒','Soy Sauce':'酱油','Spiced rum':'香料朗姆酒','Sprite':'雪碧汽水',
 'St. Germain':'圣日耳曼接骨木花利口酒','Strawberries':'草莓','Strawberry liqueur':'草莓利口酒',
 'Strawberry schnapps':'草莓施纳普斯利口酒','Sweet and sour':'酸甜调和液','Tea':'茶','Tia maria':'添万利咖啡利口酒',
 'Tonic water':'汤力水','Vanilla ice-cream':'香草冰淇淋','Vermouth':'味美思（类型未指定）','Whipped cream':'打发奶油',
 'Wine':'葡萄酒（类型看原文）','Hot Sauce':'辣椒酱（品牌未指定）',
 'Chocolate ice-cream':'巧克力冰淇淋','Wild Turkey':'野火鸡威士忌（具体产品待确认）',
}
zh_by_norm={norm(k):v for k,v in new_zh.items()}
new=[]
def ingredient_id(name):
    key=norm(name)
    if key in known:return known[key]
    id='cdb_'+re.sub('[^a-z0-9]+','_',unicodedata.normalize('NFKD',name).encode('ascii','ignore').decode().lower()).strip('_')
    assert key in zh_by_norm, f'Missing Chinese ingredient name: {name}'
    # No alcohol, nutrition, density or allergen-free claims are inferred.
    new.append(dict(id=id,name_en=name,name_zh=zh_by_norm[key],role='modifier',potential_allergens=['label_check'],
        allergen_status='incomplete_requires_SKU_and_garnish_review',abv_fraction=None,sugar_g_per_100ml=None,
        kcal_per_100ml=None,density_g_per_ml=None,acidity_g_per_l=None,sku_confirmation_required=True))
    known[key]=id
    return id

UNITS={'oz':'oz','cl':'ml','ml':'ml','dl':'ml','l':'ml','tsp':'tsp','tblsp':'tbsp','tbsp':'tbsp','dash':'dash','dashes':'dash','drops':'drop',
 'shot':'shot','shots':'shot','jigger':'jigger','jiggers':'jigger','part':'part','parts':'part','cup':'cup','cups':'cup','bottle':'bottle','glass':'glass',
 'scoops':'scoop','splash':'splash','splashes':'splash','gr':'g','sprigs':'sprig','sprig':'sprig','slice':'slice','slices':'slice','whole':'whole','cube':'cube','cubes':'cube','chunks':'piece'}
def number(s):return float(sum(Fraction(t) for t in s.strip().split()))
def measure_row(x, recipe):
    name=x['ingredient']; raw=x['measure']; m=(raw or '').strip(); lower=m.lower()
    row=dict(ingredient_id=ingredient_id(name),quantity=None,unit='unknown',optional=False,stage='mix',
        quantity_note=f"TheCocktailDB 原材料：{name}；原计量：{raw if raw is not None else '（未提供）'}。未指定单位/容量不推算。",allowed_alternatives=[])
    match=re.match(r'^(\d+(?:\.\d+)?(?:\s+\d+/\d+)?|\d+/\d+)\s*(?:-\s*(\d+(?:\.\d+)?))?\s+([a-zA-Z]+)\b',m)
    if match:
        amount,upper,unit=match.groups();u=UNITS.get(unit.lower())
        if u:
            factor={'cl':10,'dl':100,'l':1000}.get(unit.lower(),1)
            row['unit']=u
            if upper:row['quantity_range']=[number(amount)*factor,number(upper)*factor]
            else:row['quantity']=number(amount)*factor
    elif re.fullmatch(r'\d+(?:/\d+)?',m) and norm(name) in {'egg','eggwhite','eggyolk','cloves','cinnamon','oreocookie','olive','cherry','maraschinocherry','blackberries','strawberries','kiwi'}:
        row.update(quantity=number(m),unit='whole')
    if not match and lower in {'dash'}:row.update(quantity=None,unit='dash')
    if any(s in lower for s in ['top','fill with','full glass']):row.update(quantity=None,unit='to_top',stage='top')
    if 'garnish' in lower:row.update(quantity=None,unit='to_taste',stage='garnish')
    if norm(name) in {'nutmeg','orangepeel','lemonpeel','orangespiral','limepeel'}:row['stage']='garnish'
    instructions=recipe['strInstructions'].lower()
    if norm(name)=='mint' and 'except mint' in instructions:row['stage']='garnish'
    if norm(name) in {'gingerale','gingerbeer','sodawater','carbonatedwater','clubsoda','prosecco','champagne','tonicwater'}:row['stage']='top'
    if norm(name) in {'cherry','maraschinocherry','olive'} and ('garnish' in instructions or 'decorate' in instructions or 'except' in instructions):row['stage']='garnish'
    if ('slice' in lower or 'twist' in lower) and norm(name) in {'lemon','lime','orange'}:row['stage']='garnish'
    if 'juice of' in lower:row.update(quantity=None,unit='unknown',stage='mix')
    if recipe['idDrink']=='11936' and norm(name)=='bitters':row.update(stage='rinse',retained_ml=None)
    if recipe['idDrink']=='11462' and norm(name)=='galliano':row['stage']='float'
    if recipe['idDrink']=='12944' and norm(name)=='lemonpeel':
        row['stage']='mix'
        row['quantity_note']+='来源用于香料水煮制浸泡后过滤；不是杯口装饰。'
    if recipe['idDrink']=='11117' and norm(name)=='cherry':row['stage']='garnish'
    if recipe['idDrink']=='15226' and norm(name)=='cherries':row['stage']='garnish'
    if recipe['idDrink']=='15675' and norm(name)=='schweppesrusschian':row['stage']='top'
    return row

recipes=[];profiles=[];reviews=[];source_records={}
source_path=P/'data/catalog/community-source-records-2026-09-21.json'
saved_records=read(source_path)['records'] if source_path.exists() else {}
glass_map={'cocktail glass':'coupe','nick and nora glass':'coupe','martini glass':'martini','whiskey sour glass':'coupe','margarita glass':'goblet','wine glass':'goblet','white wine glass':'goblet','brandy snifter':'goblet','balloon glass':'goblet','old-fashioned glass':'rocks','whiskey glass':'rocks','irish coffee cup':'mug','coffee mug':'mug','punch bowl':'goblet','pitcher':'goblet','mason jar':'mug','champagne flute':'flute','pousse cafe glass':'flute','hurricane glass':'hurricane','beer mug':'mug','shot glass':'rocks'}
for id in selected:
    cache_path=P/f'.tools/catalog-research/{id}.json'
    cache=read(cache_path) if cache_path.exists() else saved_records[id]
    source_records[id]=cache
    record=cache['record']; e=editorial[id]
    ingredients=[measure_row(i,record) for i in record['ingredients']]
    words=record['strInstructions'].lower()
    method='blend' if 'blend' in words else 'shake' if 'shake' in words else 'stir' if 'stir' in words else 'build'
    if id=='13196':method='build'  # Source shakes bitters around the serving glass, not the drink in a shaker.
    names=' '.join(x['ingredient'].lower() for x in record['ingredients'])
    family='creamy' if any(n in names for n in ['cream','milk','egg']) else 'highball' if any(n in names for n in ['soda','tonic','ginger ale','ginger beer','lemonade']) else 'sour' if any(n in names for n in ['lemon','lime','sour','juice']) else 'spirit_forward'
    source=dict(kind='community_recipe',publisher='TheCocktailDB',url=cache['detail_url'],reference=f"idDrink {id}; API snapshot {DAY}; dateModified {record.get('dateModified') or 'unknown'}",checked_on=DAY,method_provenance='source_paraphrase')
    notes=f"TheCocktailDB 社区版本；原文杯型：{record['strGlass']}；原文酒精分类：{record['strAlcoholic']}。来源未给出酒精度和热量；预设向量未实测。原始计量逐行保留，shot/jigger/cup/part 等不换算为固定毫升。"
    if e.get('reject_reason'):notes+='来源复核备注：'+e['reject_reason']
    if e.get('review_note'):notes+='编辑复核备注：'+e['review_note']
    # Instructions can contain quantities/ingredients omitted by the table. Never
    # silently infer they were absent or invent a per-serving conversion.
    special={'178345':'来源步骤制成两杯，每杯加入200ml沸水；原料表未列水，不按单杯伪造剂量。','17267':'来源步骤另要求加入2份苏打水，原料表未列；此步骤事实保留在注释与转述中，发布前须确认成份表。','17825':'原文杯型字段写Coupe，但步骤用热杯；按热饮杯呈现。','12518':'原文杯型字段写Collins，但步骤用无冰葡萄酒杯；保留差异。','17245':'来源步骤额外提到柠檬角，原料表未列，量未知。','12944':'大批量配方，未给成杯份数；加热不能据此断言酒精被完全去除。','13020':'整壶批量配方，瓶容量与成杯份数未知。','11936':'苦精润杯后倒掉，实际残留量未知。','12107':'此来源把盐混入饮料，与常见盐杯口版不同，不静默换配方。'}
    if id in special:notes+=special[id]
    if id=='12726':notes+='来源为一批材料，可分为1大杯、2中杯或3小杯；不自动假定单杯容量。'
    glass=glass_map.get(record['strGlass'].lower(),'highball')
    if id in ('178345','17825','12944'):glass='mug'
    if id=='12518':glass='goblet'
    if id=='14029':glass='rocks'
    steps=e['steps_zh'] if isinstance(e['steps_zh'],list) else [e['steps_zh']]
    recipe=dict(id='cdb_'+id,name_en=record['strDrink'],name_zh=e['name_zh'],variant='TheCocktailDB 社区快照 2026-09-21',family=family,glass_template=glass,glass_template_provenance='editorial_mapping',method=method,ingredients=ingredients,steps_zh=steps,garnish_zh=e['garnish_zh'],notes_zh=notes,source=source,preparation_review='not_physically_tested',default_orderable=False,needs_serving_configuration=True,actual_user_rating=None,prediction_profile_id='cdb_'+id)
    recipes.append(recipe)
    taste,sensory={'sour':([4000,5000,1000,0,0],[4,6,4,0,3,0,5]),'highball':([5000,4000,1000,0,0],[3,5,3,5,4,0,4]),'creamy':([7000,2000,1000,0,0],[3,5,8,0,2,0,5]),'spirit_forward':([4000,0,6000,0,0],[7,7,5,0,1,0,7])}[family]
    if record['strAlcoholic']=='Non alcoholic':sensory[0]=0
    if id=='12726':taste,sensory=[1000,3000,500,2000,3500],[0,5,5,0,3,0,4]
    profiles.append(dict(recipe_id=recipe['id'],taste_axes=['sweet','sour','bitter','salty','umami'],taste_intensity_0_10=None,taste_preference_bps=taste,sensory_axes=['alcohol_heat','aroma','body','carbonation','cooling','spiciness','finish'],sensory_0_10=sensory,status='heuristic_unvalidated',confidence='low',origin='editorial_family_prior_community_pack_2026_09_21',measured=False,source_recipe_does_not_supply_these_scores=True,note_zh='编辑家族先验，仅供匹配冷启动；不是实测或社区评分，绝对五味强度未知。'))
    reviews.append(dict(recipe_id=recipe['id'],source_url=cache['detail_url'],lookup_url=cache['lookup_url'],retrieved_at=cache['retrieved_at'],response_sha256=cache['response_sha256'],publisher='TheCocktailDB',copyright_notice='© 2026 TheCocktailDB',name=record['strDrink'],source_glass=record['strGlass'],source_alcoholic=record['strAlcoholic'],source_modified_at=record.get('dateModified'),ingredients=record['ingredients'],source_instructions_sha256=sha(record['strInstructions'].encode('utf-8')),facts_sha256=sha(json.dumps(recipe,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8'))))
assert len(recipes)==188 and len(set(norm(r['name_en']) for r in recipes+base['recipes']['recipes']))==300
pack=dict(pack_id=PACK,pack_schema_version=1,checked_on=DAY,provenance=dict(publisher='TheCocktailDB',copyright_notice='© 2026 TheCocktailDB',source_kind='community_recipe',api_documentation='https://www.thecocktaildb.com/api.php',terms_url='https://www.thecocktaildb.com/terms_of_use.php',license_status='official_API_terms_observed; public_distribution_review_pending',content_scope='Individually selected recipe facts and independent Chinese paraphrases; no artwork',new_recipe_count=188),recipes=dict(schema_version='0.1.0',snapshot_date=DAY,recipe_count=188,recipes=recipes),ingredients=dict(schema_version='0.1.0',ingredients=new),profiles=dict(schema_version='0.1.0',status='heuristic_unvalidated',profiles=profiles),sources=dict(checked_on=DAY,sources=[dict(recipe_id=r['id'],**r['source']) for r in recipes]))
write(P/f'data/catalog/{PACK}.json',pack)
write(source_path,dict(publisher='TheCocktailDB',copyright_notice='© 2026 TheCocktailDB',scope='Selected API textual records used for offline reproducibility, no artwork; metadata is not instructions to execute',records=source_records))
write(P/'data/catalog/community-source-review-2026-09-21.json',dict(checked_on=DAY,checks=reviews,excluded_candidates=[dict(idDrink=k,reason=v) for k,v in excluded.items()]))
schema=read(P/'contracts/catalog-extension.schema.json');props=schema['properties']['recipes']['items']['properties']
props['id']['pattern']='^(iba|note|cdb)_[a-z0-9_]+$';props['source']['properties']['kind']['enum'].append('community_recipe')
props['ingredients']['items']['properties']['unit']['enum']+=['part','shot','jigger','cup','bottle','glass','scoop','g']
write(P/'contracts/catalog-community.schema.json',schema)
for key,file in [('recipes','recipes.json'),('ingredients','ingredients.json'),('profiles','profiles.seed.json'),('sources','sources.json')]:
    combined=copy.deepcopy(base[key]);combined[key]+=pack[key][key]
    if key=='recipes':combined['recipe_count']=300
    write(P/'apps/client/public/seed'/file,combined)
quotes=read(P/'apps/client/src/recipe-quotes.json')
quotes={r['id']:quotes[r['id']] for r in base['recipes']['recipes']}
quotes.update({'cdb_'+id:editorial[id]['quote'] for id in selected})
assert len(quotes)==300 and len(set(quotes.values()))==300 and all(quotes.values())
write(P/'apps/client/src/recipe-quotes.json',quotes)
print(json.dumps(dict(recipes=300,new_recipes=188,ingredients=149+len(new),new_ingredients=len(new),quotes=len(quotes),pack_sha256=sha((P/f'data/catalog/{PACK}.json').read_bytes())),ensure_ascii=False))
