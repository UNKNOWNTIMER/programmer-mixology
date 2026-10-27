"""Deterministic editorial working versions of the supplied notes, never measurements.

The extracted DOCX remains immutable. Original quantities, unresolved labels,
source experiences and newly inferred working choices are stored separately.
"""
from __future__ import annotations
import hashlib
import json
import math
import re
from pathlib import Path

OUT=Path(__file__).resolve().parent
PRODUCT=OUT.parents[2]
SOURCE=json.loads((OUT/'preliminary-records.json').read_text(encoding='utf-8'))
SEED=json.loads((PRODUCT/'apps/client/public/seed/ingredients.json').read_text(encoding='utf-8'))['ingredients']
KNOWN={row['id']:row for row in SEED}
EXTRACT=json.loads((OUT/'extracted.json').read_text(encoding='utf-8'))
NEW={}
def ingredient(key,zh,en,role,allergens=()):
    ident='dlc_xd_'+key
    NEW[ident]={'id':ident,'name_zh':zh,'name_en':en,'role':role,'potential_allergens':list(allergens),
        'allergen_status':'incomplete_requires_SKU_and_garnish_review','abv_fraction':None,'sugar_g_per_100ml':None,
        'kcal_per_100ml':None,'density_g_per_ml':None,'acidity_g_per_l':None,'sku_confirmation_required':True}
    return ident

for args in [
('tequila_premix','龙舌兰预调液（组成待核对）','Tequila premix, composition unconfirmed','prepared_mix'),
('white_vermouth','白味美思（甜度未注明）','White vermouth, sweetness unspecified','fortified_wine',('sulfites',)),
('suze','Suze 龙胆风味酒','Suze gentian aperitif','bitter_liqueur'),
('americano_aperitif','Americano（笔记原料，身份未确认）','Americano ingredient, identity unresolved','aperitif'),
('cucumber','黄瓜','Cucumber','fresh_produce'),
('chartreuse_unspecified','Chartreuse 草本利口酒（颜色未注明）','Chartreuse, variant unspecified','herbal_liqueur'),
('rosemary_syrup','迷迭香糖浆（糖度待核对）','Rosemary syrup, concentration unconfirmed','syrup'),
('green_grapes','青葡萄','Green grapes','fruit'),
('burgundy_cremant','勃艮第干型起泡酒','Crémant de Bourgogne Brut','sparkling_wine',('sulfites',)),
('aquafaba','熟鹰嘴豆液 Aquafaba','Cooked chickpea aquafaba','foam',('chickpea',)),
('lemon_slice','黄柠檬片','Lemon slice','garnish'),
('fructose_preparation','果糖制剂（原文45ml，浓度待核对）','Fructose preparation, concentration unresolved','sweetener'),
('overproof_rum','高度朗姆酒（酒精度未注明）','Overproof rum, strength unspecified','spirit'),
('coconut_milk','椰奶 Coconut Milk（非甜椰浆）','Coconut milk, not cream of coconut','milk',('coconut',)),
('black_rum','Black Rum（笔记泛名）','Black rum, notebook label','spirit'),
('rich_syrup','浓糖浆（糖水比未注明）','Rich syrup, ratio unspecified','syrup'),
('gold_rum','金朗姆酒（产地未注明）','Gold rum, origin unspecified','spirit'),
('japanese_whisky','日本威士忌（具体产品待核对）','Japanese whisky, product unconfirmed','spirit'),
('oloroso_sherry','Oloroso 雪莉酒','Oloroso sherry','fortified_wine',('sulfites',)),
('rich_demerara','浓德梅拉拉糖浆（比例逐杯看注释）','Rich Demerara syrup, see recipe ratio','syrup'),
('spicy_pineapple_soda','辛辣菠萝汽水（产品未注明）','Spicy pineapple soda, product unspecified','mixer'),
('telska_unresolved','telska（原文身份未确认）','telska, unresolved source ingredient','spirit'),
('ginger_juice','鲜姜汁','Fresh ginger juice','juice'),
('single_malt_scotch','单一麦芽苏格兰威士忌','Single malt Scotch whisky','spirit'),
('walnut_liqueur','Nux Alpina 核桃利口酒','Nux Alpina walnut liqueur','liqueur',('tree_nut',)),
('woodford_whisky','Woodford Reserve 威士忌（具体产品未注明）','Woodford Reserve whiskey, product unspecified','spirit'),
('averna','Averna 苦味利口酒','Averna amaro','bitter_liqueur'),
('green_tea_shochu','Mizu 绿茶烧酎','Mizu green tea shochu','spirit'),
('umeshu','梅酒（产品未注明）','Umeshu, product unspecified','liqueur'),
('mugicha','冰镇麦茶','Chilled mugicha barley tea','tea',('barley',)),
('ume_su','Ume-su（成分与酒精度待核对）','Ume-su, composition and alcohol unverified','prepared_mix'),
('grapefruit_peel','西柚皮','Grapefruit peel','garnish'),
('sanbitter','Sanbitter 红色苦味汽水','Sanbitter red bitter soda','mixer'),
('stappi','Stappi 红色苦味汽水','Stappi red bitter soda','mixer'),
('coconut_vodka','椰子伏特加','Coconut vodka','spirit'),
('preserved_plum','九制话梅','Preserved plum','fruit'),
('salted_lemon_soda','海之盐柠檬汽水（产品待核对）','Salted lemon soda, product unconfirmed','mixer'),
('yuzu_salt','柚子盐','Yuzu salt','seasoning'),
('fireball','Fireball 肉桂风味酒（以瓶标为准）','Fireball cinnamon spirit, check label','liqueur'),
('hawthorn','山楂原料（形态未注明）','Hawthorn ingredient, form unspecified','fruit'),
('plum_tea_campari','salt plum hoijicha campari（复合原料待核对）','salt plum hoijicha campari, unresolved compound','prepared_mix'),
('green_tea_umeshu','绿茶梅酒（产品未注明）','Green tea umeshu, product unspecified','liqueur'),
('intense_umeshu','风味较浓的梅酒（产品未定）','Fuller-flavoured umeshu, product unspecified','liqueur'),
('matured_milk_coffee','冷萃咖啡（编辑澄清拿铁建议）','Cold brew coffee, editorial suggestion','coffee'),
('melon_ball','蜜瓜球','Melon ball','garnish'),
('candied_ginger','糖渍姜','Candied ginger','garnish'),
('chocolate_garnish','巧克力装饰（类型未注明）','Chocolate garnish, type unspecified','garnish',('milk_label_check',)),
('cinnamon_syrup','肉桂糖浆（编辑建议）','Cinnamon syrup, editorial suggestion','syrup'),
]: ingredient(*args)

# The 146 names in the document's ingredient index, mapped at category level.
# Brands stay in quantity notes. Null composition is never filled from a brand name.
INDEX_IDS='''tequila cassis lime ginger_beer ginger_ale lemon apple_cider apple_juice triple_sec dlc_xd_tequila_premix vodka maple_syrup lime_fruit sugar coffee_liqueur espresso irish_cream cdb_milk vodka cdb_sloe_gin dry_vermouth lemon gin campari sweet_vermouth dlc_xd_white_vermouth dlc_xd_suze old_tom_gin simple_syrup soda dlc_xd_americano_aperitif lillet_blanc absinthe cointreau cdb_st_germain dlc_xd_cucumber mint gin dry_vermouth cdb_cherry_heering gin orgeat falernum passion_fruit_syrup dlc_xd_chartreuse_unspecified dlc_xd_rosemary_syrup semi_rich_syrup blackberry_liqueur honey_syrup dlc_xd_green_grapes grenadine pineapple benedictine angostura lemon_fruit gin cdb_cherry_brandy dlc_xd_burgundy_cremant gin cognac cdb_sloe_gin apricot_brandy cdb_sloe_gin egg_white dlc_xd_aquafaba dlc_xd_lemon_slice dlc_xd_fructose_preparation rum cdb_dark_rum dlc_xd_overproof_rum amaretto white_rum sugar_syrup dlc_xd_coconut_milk cdb_blue_curacao cdb_lime_juice_cordial dlc_xd_black_rum blackstrap_rum amaretto dlc_xd_rich_syrup cdb_amaro_montenegro cynar cdb_st_germain cdb_spiced_rum dlc_xd_gold_rum amaretto dlc_xd_japanese_whisky dlc_xd_oloroso_sherry orange_fruit dlc_xd_rich_demerara orange_bitters bourbon whisky bourbon red_wine grapefruit amaro_nonino aperol dlc_xd_spicy_pineapple_soda whisky rye scotch cdb_powdered_sugar amaretto blended_scotch dlc_xd_telska_unresolved dlc_xd_ginger_juice dlc_xd_single_malt_scotch scotch dlc_xd_walnut_liqueur dlc_xd_woodford_whisky sweet_vermouth orange_juice dlc_xd_averna soda champagne cognac peychaud peach_schnapps dlc_xd_green_tea_shochu cdb_midori_melon_liqueur lime dlc_xd_umeshu dlc_xd_mugicha dlc_xd_ume_su cdb_strawberries cdb_orange_peel dlc_xd_grapefruit_peel dlc_xd_sanbitter dlc_xd_stappi cdb_pineapple dlc_xd_coconut_vodka lemon_fruit dlc_xd_preserved_plum dlc_xd_salted_lemon_soda cdb_sprite dlc_xd_yuzu_salt salt sugar lemon_fruit dlc_xd_fireball dlc_xd_hawthorn dlc_xd_plum_tea_campari maraschino dlc_xd_green_tea_umeshu dlc_xd_intense_umeshu'''.split()
index_table=next(b for b in EXTRACT['blocks'] if b['type']=='table' and b['rows'][0][0]['text']=='原料名称')
assert len(INDEX_IDS)==len(index_table['rows'])-1==146
ALIASES={row[0]['text']:ident for row,ident in zip(index_table['rows'][1:],INDEX_IDS)}
assert all(ident in KNOWN or ident in NEW for ident in ALIASES.values())

def row_parts(name):
    # The prose conjunction is a mutually exclusive source choice, never additive.
    return [p.strip() for p in re.split(r' 或 ',name)]

def choose(r,row):
    options=row_parts(row['name_raw'])
    # Prefer a known named aperitif over an unresolved "Americano" product; choose
    # aquafaba where allowed, without pretending it is equal to a whole egg white.
    selected=next((p for p in options if 'Lillet Blanc' in p),None) or next((p for p in options if 'Aquafaba' in p),None) or options[0]
    if selected not in ALIASES: raise ValueError((r['number'],selected))
    return ALIASES[selected],options,selected

def amount(r,row,ident):
    raw=row['amount_raw'];note=[];unit='ml';q=None;qr=None;n=r['number']
    if n==56 and 'Aquafaba' in row['name_raw']:
        return 15,'ml',None,['工作版选择15 ml熟鹰嘴豆液；另一源选项是一枚蛋的蛋清，单位不等同，本次不混用。']
    if '洗杯' in raw:
        q=2;note.append('本次编辑估值：原文洗杯未定量，先量2 ml润洗杯壁并倒出多余酒液；实际残留未知。')
    elif n==32 and '比例单位' in raw:
        q=30 if ident=='gin' else 60;note.append('本次编辑估值：原图0.25:0.5只给比例，选30 ml:60 ml工作量，保持1:2；不认定原图容量基准。')
    elif '补满' in raw or '补顶' in raw:
        q={4:120,17:90,21:60,23:90,30:60,32:90,35:90,38:90,53:225,75:90,78:30}.get(n,90)
        note.append(f'本次编辑估值：原文“{raw}”，选{q} ml作为工作起点；实际按冰量和杯量调整。')
        if n==53:note.append('原注5:1方向不明；工作建议解释为苏打:威士忌5:1，不宣称为原作者已确认比例。')
    elif '用量未记' in raw or '适量' in raw:
        q={31:1,54:1,61:30,86:15,89:15,92:20,93:15}.get(n,15)
        if n==31:unit='dash'
        elif n==54:q=10;unit='g'
        elif n==86 and ident=='grenadine':q=5
        elif n==89 and ident in ['lime_fruit','lemon_fruit']:q=.5;unit='piece'
        elif n==89:q=22.5
        elif n==92:q=30 if ident=='dlc_xd_fireball' else 20
        elif n==93:q={'bourbon':30,'tequila':15,'dlc_xd_plum_tea_campari':20,'maraschino':7.5}[ident]
        if n==31:note.append('整理文字将剂量记为未定；本次实际查看内嵌image1.jpeg，底部可读1 dash Angostura，依原图补入。')
        else:note.append(f'本次编辑估值：源用量未定，工作版采用{q:g} {unit}；不是酒吧复刻或实测剂量。')
        if n==54:note.append('原方法是一小块橙肉，本工作版按10 g取用，不是整枚橙子。')
        if n==92 and ident=='dlc_xd_hawthorn':note.append('源山楂形态未明；本工作版明确选择可直接食用的山楂汁／细浆20 ml，不把鲜果、果干或糖浆按同剂量等同替换。')
    elif '单位未记' in raw or re.search(r'\bmk\b',raw):
        q=float(re.match(r'[\d.]+',raw).group())
        if n==64:q=30;note.append('本次编辑估值：原文数字1缺单位，工作版按1 oz约30 ml试配；原文不代表已确认的1 oz。')
        else:note.append(f'本次编辑估值：保留原数字{q:g}，将原缺单位／mk暂按ml试配，须以原作者复核为准。')
    elif 'shot' in raw:
        value=re.match(r'[\d./]+',raw).group();q=(float(value.split('/')[0])/float(value.split('/')[1]) if '/' in value else float(value))*30
        note.append('本次编辑换算：工作量杯暂按1 shot=30 ml；未校准源量杯，原比例保留，不作精确单位事实。')
    elif '喷' in raw:
        q=1.6;note.append('本次编辑估值：原8喷暂按每喷0.2 ml配洗杯用量；喷头未校准，残留体积未知。')
    else:
        span=re.match(r'(?:约)?([\d.]+)[–—-]([\d.]+)',raw)
        if span:qr=[float(span[1]),float(span[2])]
        else:
            match=re.match(r'(?:约)?([\d.]+)',raw)
            if not match:raise ValueError((n,raw))
            q=float(match[1])
        if '吧勺' in raw:unit='barspoon'
        elif '茶匙' in raw:unit='tsp'
        elif 'dash' in raw:unit='dash'
        elif '片' in raw:unit='leaf' if ident=='mint' else 'slice'
        elif '颗' in raw or ' 个' in raw:unit='piece'
        if '原' in raw and 'oz' in raw:note.append('ml为所供整理文档的约值，沿用其1 oz约30 ml展示约定，保留原oz文字，不宣称精密换算。')
    return q,unit,qr,note

def p(ident,q,unit='ml',stage='mix',optional=False,note='本次编辑建议用量；源文档未提供这份完整配方。',qr=None):
    result={'ingredient_id':ident,'quantity':q,'unit':unit,'optional':optional,'stage':stage,'quantity_note':note,'allowed_alternatives':[]}
    if qr is not None:result['quantity_range']=qr
    return result

def effective_weight(part):
    # Relative modelling weights, not nutrition/volume conversions.
    q=part['quantity'] if part['quantity'] is not None else sum(part.get('quantity_range',[1,1]))/2
    return q*{'ml':1,'dash':.8,'drop':.04,'tsp':5,'barspoon':5,'leaf':.35,'slice':2,'piece':4}.get(part['unit'],1)

def taste_signature(ident):
    if ident in {'lemon','lime'}:return [1,95,3,0,0]
    if ident in {'lime_fruit','lemon_fruit','dlc_xd_lemon_slice'}:return [1,55,5,0,0]
    if ident in {'campari','cynar','dlc_xd_suze','dlc_xd_averna','amaro_nonino','cdb_amaro_montenegro','dlc_xd_sanbitter','dlc_xd_stappi'}:return [28,4,68,0,1]
    if ident=='dlc_xd_plum_tea_campari':return [28,10,50,12,2]
    if ident in {'angostura','peychaud','orange_bitters'}:return [8,0,90,0,0]
    if ident in {'espresso','dlc_xd_matured_milk_coffee'}:return [4,12,68,0,5]
    if ident=='coffee_liqueur':return [65,2,32,0,1]
    if ident in {'cdb_milk','cream','dlc_xd_coconut_milk','irish_cream'}:return [50,0,0,1,12]
    if ident in {'egg_white','dlc_xd_aquafaba'}:return [1,0,0,1,8]
    if ident=='dlc_xd_ume_su':return [30,55,2,6,2]
    if ident in {'dlc_xd_umeshu','dlc_xd_green_tea_umeshu','dlc_xd_intense_umeshu'}:return [66,25,7,0,2]
    if ident=='dlc_xd_hawthorn':return [28,67,3,0,1]
    if ident in {'cassis','blackberry_liqueur','cdb_sloe_gin','cdb_cherry_heering','apricot_brandy','cdb_cherry_brandy'}:return [64,24,8,0,0]
    if ident in {'orange_juice','pineapple','apple_juice','apple_cider','cranberry','grapefruit'}:
        return {'orange_juice':[55,35,3,0,0],'pineapple':[61,32,0,0,1],'apple_juice':[65,24,0,0,0],'apple_cider':[50,35,3,0,0],'cranberry':[25,65,7,0,0],'grapefruit':[23,58,18,0,0]}[ident]
    if any(token in ident for token in ['syrup','sugar','fructose','orgeat','grenadine','demerara']):return [94,0,0,0,0]
    if ident in {'salt','dlc_xd_yuzu_salt'}:return [0,0,0,95,0]
    if ident in {'soda','water'}:return [0,0,0,0,0]
    if ident in {'ginger_beer','ginger_ale','dlc_xd_spicy_pineapple_soda','cdb_tonic_water'}:return [45,6,22 if ident=='cdb_tonic_water' else 3,0,0]
    if ident in {'dlc_xd_cucumber','mint','cdb_rosemary','dlc_xd_green_grapes'}:return [12,3,3,0,3]
    if ident in {'sweet_vermouth','dlc_xd_white_vermouth'}:return [48,12,25,0,0]
    if ident=='dry_vermouth':return [12,16,22,0,0]
    if ident in {'red_wine','champagne','sparkling_wine','dlc_xd_burgundy_cremant','dlc_xd_oloroso_sherry'}:return [12,40,12,0,3]
    role=(NEW.get(ident) or KNOWN.get(ident) or {}).get('role','')
    if role in {'liqueur','herbal_liqueur','bitter_liqueur'} or any(t in ident for t in ['liqueur','curacao','cointreau','triple_sec','amaretto','maraschino','falernum','benedictine','chartreuse','st_germain']):return [67,3,15,0,1]
    if ident in {'cdb_pineapple','cdb_strawberries'}:return [50,30,0,0,0]
    if 'ginger' in ident:return [1,3,3,0,0]
    return [8,0,5,0,0]

def spirit_weight(ident):
    if ident=='dlc_xd_telska_unresolved':return .8
    if 'overproof' in ident or ident=='absinthe':return 1.25
    # Exact categories prevent "ginger" from being mistaken for "gin".
    role=(NEW.get(ident) or KNOWN.get(ident) or {}).get('role','')
    if role=='spirit' or ident in {'cdb_dark_rum','cdb_spiced_rum','old_tom_gin','blended_scotch','islay_scotch'}:return 1
    if ident in {'cdb_sloe_gin','apricot_brandy','cdb_cherry_brandy','cdb_malibu_rum'}:return .45
    if any(t in ident for t in ['vermouth','wine','champagne','cremant','sherry']):return .35
    return .45 if sum(taste_signature(ident))>0 and ((NEW.get(ident) or KNOWN.get(ident) or {}).get('role','') in {'liqueur','herbal_liqueur','bitter_liqueur'} or ident in {'campari','cassis','cointreau','triple_sec','maraschino','falernum','benedictine','absinthe'}) else 0

def normalize(weights):
    total=sum(weights)
    exact=[x*10000/total for x in weights];base=[math.floor(x) for x in exact]
    for index in sorted(range(5),key=lambda i:-(exact[i]-base[i]))[:10000-sum(base)]:base[index]+=1
    return base

def predict(ident,parts,method,glass):
    active=[part for part in parts if part['stage'] not in {'garnish','rinse','side'}]
    weights=[0.,0.,0.,0.,0.];total=sum(effective_weight(p) for p in active)
    for part in active:
        for axis,v in enumerate(taste_signature(part['ingredient_id'])):weights[axis]+=v*effective_weight(part)
    taste=normalize(weights)
    ids=' '.join(part['ingredient_id'] for part in active)
    alcohol=min(9,round(2+7*sum(effective_weight(p)*spirit_weight(p['ingredient_id']) for p in active)/max(total,1)))
    active_ids={part['ingredient_id'] for part in active}
    botanical=int(bool(active_ids & {'gin','old_tom_gin'}))+sum(token in ids for token in ['chartreuse','vermouth','st_germain','benedictine','rosemary','tea'])
    aromatic=min(10,4+min(3,len(active)//2)+min(2,botanical)+(1 if any(t in ids for t in ['islay','ginger','fireball']) else 0))
    creamy=any(t in ids for t in ['milk','cream','egg_white','aquafaba'])
    sweet_load=sum(effective_weight(p)*taste_signature(p['ingredient_id'])[0] for p in active)/max(total,1)/100
    body=min(9,round(2+sweet_load*5+(2 if creamy else 0)+(1 if method=='blend' else 0)))
    carbon=sum(effective_weight(p) for p in active if any(t in p['ingredient_id'] for t in ['soda','ginger_beer','ginger_ale','champagne','cremant','tonic','sanbitter','stappi']))/max(total,1)
    bubbles=min(9,round(carbon*10))
    cooling=min(9,5+(2 if glass in {'highball','rocks','hurricane','goblet'} else 0)+(1 if 'mint' in ids else 0))
    heat=min(8,round(sum(effective_weight(p) for p in active if any(t in p['ingredient_id'] for t in ['ginger','fireball','spicy','cinnamon']))/max(total,1)*12))
    finish=min(10,3+round(taste[2]/10000*5)+round(alcohol/4)+min(2,botanical)+(1 if 'islay' in ids else 0))
    sensory=[alcohol,aromatic,body,bubbles,cooling,heat,finish]
    note=('本次编辑模型推断，源笔记没有数值感官测量，非实饮评价。五味按配方中甜味材料、柑橘／果汁、苦味酒、盐味及乳／豆类的相对贡献归一为10000基点；'
          '不是原料体积比例。七维分别依据：酒精感=基酒类别与非酒精补顶的相对权重（不是ABV）；香气=植物／果香原料多样性；酒体=糖与乳／泡沫材料；气泡=明确含气补顶；'
          '清凉感=冷制法、成杯冰与薄荷；辣感=姜／肉桂／辛辣材料；味韵=苦味、草本和烟熏的预计持续感。'
          f'本杯计算原料ID：{ids}。未核产品与单位的工作估值会影响结果。')
    return {'recipe_id':ident,'taste_axes':['sweet','sour','bitter','salty','umami'],'taste_intensity_0_10':None,'taste_preference_bps':taste,
        'sensory_axes':['alcohol_heat','aroma','body','carbonation','cooling','spiciness','finish'],'sensory_0_10':sensory,'status':'heuristic_unvalidated',
        'origin':'editorial_recipe_rules_v1','measured':False,'source_recipe_does_not_supply_these_scores':True,'note_zh':note}

def main():
    recipes=[];profiles=[];editorial={};assumed_count=0
    source_sha=SOURCE['source_sha256']
    for r in SOURCE['records']:
        n=r['number']
        if n==87:continue
        ident='dlc_xd_'+r['source_id'][3:].replace('-','_')
        parts,assumptions,choices=build_parts(r)
        method,glass,family=style(r,parts)
        if r['missing_individual_method']:assumptions.append('逐杯调制方法缺失；本次按原料结构补为冷制法工作建议，尚未实际试调。')
        else:assumptions.append('调制流程按原笔记明确要点整理，并补齐未写出的冷却／过滤／入杯操作；来源原句独立保留。')
        assumptions.append(f'工作杯型采用{glass}；原记录未明确到该模板的部分属于编辑选择，不等于原酒吧杯型。')
        if n in {36,51,82}:assumptions.append('保留原文较大剂量，不私自缩量；列表视为一批工作配方，实际分杯份数与杯容量待确认。')
        if n==88:assumptions.append('原透明拿铁体验没有材料；本次仅建议一份咖啡奶酒澄清试配，过滤损耗与清澈程度未知，不是原酒吧复刻。')
        if n==97:assumptions.append('Kaminari两张照片与名字关系不明；本次自主建议金酒接骨木花柠檬泡沫酸酒，未从照片推断原料。')
        garnish='；'.join(text.split('装饰：',1)[1] for text in r['serving_record_source'] if '装饰：' in text) or '未另指定装饰'
        # Preserve the named flame motif only as a title; never invent ignition steps.
        runtime_steps=steps(r,parts,method,glass)
        src_amounts='；'.join(f"{x['name_raw']} {x['amount_raw']}" for x in r['ingredients_source']) or '源记录无配料表'
        notes='\n'.join([
            f"小董调酒笔记 DLC｜作者：小董｜记录{n:03d}｜{r['source_id']}。",
            f"原始类别：{r['status_source']}。酒语：{r['quote_zh']}",
            '源配料文字：'+src_amounts,
            *['原笔记体验／背景：'+text for text in r['experience_or_history_source']],
            *['原文文学背景：'+text for text in r['literary_background_zh']],
            *['原整理疑项：'+text for text in safe_source(r)],
            '本次编辑补全：'+'；'.join(assumptions),
            f"来源：TIMER_调酒笔记_详细清单与酒语.docx；SHA-256 {source_sha}；正文块{r['source']['body_block_start']}–{r['source']['body_block_end']}。",
            '原文星号不是实饮评分；预测为未验证编辑推断，所有工作版待试调，不自动进入客人菜单。',
        ])
        recipe={'id':ident,'recipe_revision_id':'dlc-xd-v1:'+hashlib.sha256(json.dumps({'parts':parts,'steps':runtime_steps,'notes':notes},ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:24],
            'name_zh':r['name_zh'],'name_en':r['name_en'],'variant':'小董笔记／本次编辑工作版','family':family,'glass_template':glass,
            'glass_template_provenance':'source_cue_or_editorial_working_choice','method':method,'ingredients':parts,'steps_zh':runtime_steps,'garnish_zh':garnish,'notes_zh':notes,
            'source':{'kind':'user_note_dlc','publisher':'小董','url':None,'reference':f"{r['source_id']}；{r['original_document_locator_as_quoted']}；所供DOCX SHA-256 {source_sha}",
                      'checked_on':'2026-09-22','method_provenance':'source_plus_editorial_completion'},
            'preparation_review':'not_physically_tested','default_orderable':False,'needs_serving_configuration':True,'prediction_profile_id':ident}
        recipes.append(recipe);profiles.append(predict(ident,parts,method,glass))
        editorial[ident]={'source_record':r,'source_quote_zh':r['quote_zh'],'source_literary_background_zh':r['literary_background_zh'],
            'source_record_kind':r['record_kind_source'],'working_version':{'assumptions_zh':assumptions,'branch_decisions':choices,'method':method,'glass':glass,
                'ingredient_quantity_notes':[x['quantity_note'] for x in parts], 'suggested_from_no_ingredient_record':n in SUGGESTED},
            'actual_user_rating':None,'measured':False,'art_hint':{'name_theme':r['name_zh'],'source_serving':r['serving_record_source'],'editorial_method':method,'glass_basis':'来源明确要点与编辑工作杯型，非照片推断'}}
        assumed_count+=bool(assumptions)
    dessert=next(r for r in SOURCE['records'] if r['number']==87)
    dessert_text='\n'.join([dessert['name_en'], '原始类别：'+dessert['status_source'],
        *[f"{p['name_raw']}：{p['amount_raw']}（{p['note_raw']}）" for p in dessert['ingredients_source']],
        *dessert['method_record_source'],*dessert['serving_record_source'],*dessert['review_notes_source'],
        '酒语：'+dessert['quote_zh'],'出处：'+dessert['original_document_locator_as_quoted'],
        '所供DOCX SHA-256 '+source_sha,'这是源笔记甜食资料，不是工作台鸡尾酒，不生成味觉或营养预测。'])
    catalog={'group':{'id':'xiaodong-notes-v1','name_zh':'小董调酒笔记','name_en':'Xiaodong’s Mixing Notes','author':'小董','version':'1.0',
        'recipe_ids':[r['id'] for r in recipes],'source_sha256':source_sha,'appendix':[{'title_zh':'087 酒鬼话梅小菠萝｜源甜食笔记','text_zh':dessert_text}]},
        'recipes':recipes,'profiles':profiles,'ingredients':list(NEW.values())}
    assert len(recipes)==96 and len(set(catalog['group']['recipe_ids']))==96
    assert all(sum(p['taste_preference_bps'])==10000 and all(type(x) is int and x>=0 for x in p['taste_preference_bps']) for p in profiles)
    assert all(len(p['sensory_0_10'])==7 and all(0<=x<=10 for x in p['sensory_0_10']) for p in profiles)
    assert all(x['ingredient_id'] in KNOWN or x['ingredient_id'] in NEW for r in recipes for x in r['ingredients'])
    assert all(len(r['notes_zh'])<=8000 and all(len(x['quantity_note'])<=1000 for x in r['ingredients']) for r in recipes)
    assert '洗涤剂' not in json.dumps(catalog,ensure_ascii=False)
    assert not any(word in json.dumps([recipe['steps_zh'] for recipe in recipes],ensure_ascii=False) for word in ['点火','燃烧','点燃'])
    (OUT/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf-8')
    (OUT/'editorial.json').write_text(json.dumps(editorial,ensure_ascii=False,indent=2),encoding='utf-8')
    mapping=[{'source_name':name,'working_ingredient_id':ident,'existing_seed':ident in KNOWN,'status':'category_mapping_preserves_source_brand_in_recipe_note' if ident in KNOWN else 'new_DLC_definition_composition_unknown'} for name,ident in ALIASES.items()]
    (OUT/'ingredient-mapping-suggestions.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2),encoding='utf-8')
    summary={'recipes':len(recipes),'source_records':97,'appendix_records':1,'new_ingredient_definitions':len(NEW),'source_ingredient_names':len(ALIASES),
        'unique_taste_vectors':len({tuple(p['taste_preference_bps']) for p in profiles}),'unique_sensory_vectors':len({tuple(p['sensory_0_10']) for p in profiles}),
        'runtime_ingredient_rows':sum(len(r['ingredients']) for r in recipes),'catalog_sha256':hashlib.sha256((OUT/'catalog.json').read_bytes()).hexdigest()}
    (OUT/'generation-report.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False))


# Deliberately explicit working suggestions for name-only and unrecorded experiences.
# They carry their own editorial provenance and never claim to reproduce a venue.
SUGGESTED={
1:[('tequila',45),('orange_juice',90),('grenadine',15,'ml','finish')],
2:[('tequila',45),('lime',20),('cassis',10),('soda',90,'ml','top')],
18:[('gin',45),('cdb_tonic_water',120,'ml','top')],
33:[('campari',30),('sweet_vermouth',30),('soda',90,'ml','top')],
42:[('white_rum',45),('dry_vermouth',22.5),('orange_curacao',7.5),('grenadine',5)],
44:[('cdb_malibu_rum',45),('pineapple',90),('orange_juice',30),('grenadine',10,'ml','finish')],
45:[('cdb_malibu_rum',45),('pineapple',60),('cranberry',60)],
52:[('cdb_dark_rum',30),('white_rum',30),('dlc_xd_overproof_rum',10),('lime',22.5),('grapefruit',20),('dlc_xd_cinnamon_syrup',10),('falernum',7.5),('grenadine',5)],
83:[('coffee_liqueur',15),('irish_cream',15,'ml','float'),('grand_marnier',15,'ml','float')],
84:[('grenadine',10),('orange_juice',20),('cdb_blue_curacao',10,'ml','float'),('vodka',15,'ml','float')],
85:[('grenadine',10),('creme_menthe_green',10,'ml','float'),('orange_curacao',10,'ml','float'),('brandy',10,'ml','float')],
88:[('vodka',30),('coffee_liqueur',15),('dlc_xd_matured_milk_coffee',45),('cdb_milk',30),('lemon',10),('simple_syrup',5)],
90:[('blended_scotch',45),('lemon',22.5),('honey_syrup',15),('dlc_xd_ginger_juice',7.5),('islay_scotch',7.5,'ml','float')],
91:[('islay_scotch',45),('lemon',22.5),('simple_syrup',15),('dlc_xd_aquafaba',15)],
96:[('bourbon',45),('dlc_xd_umeshu',15),('angostura',2,'dash')],
97:[('gin',40),('lemon',20),('cdb_st_germain',15),('dlc_xd_aquafaba',15)],
}

def build_parts(r):
    n=r['number'];assumptions=[];decisions=[];parts=[]
    if n in SUGGESTED:
        assumptions.append('源条目没有配料表；全部材料、剂量、杯型与步骤均为本次编辑建议，不代表小董已制作、已试饮或原酒吧复刻。')
        suggested=[p(*values) for values in SUGGESTED[n]]
        if n in {1,44}:
            suggested[-1]['quantity_note']+='编辑日出渐变意图：石榴糖浆在末尾加入，向底部自然下沉，不是顶部漂浮层。'
        return suggested,assumptions,decisions
    for row in r['ingredients_source']:
        ident,options,chosen=choose(r,row);q,unit,qr,inferred=amount(r,row,ident)
        stage='rinse' if '洗杯' in row['note_raw'] or '洗杯' in row['amount_raw'] else 'float' if '漂浮' in row['note_raw'] else 'top' if ident in {'soda','ginger_beer','ginger_ale','champagne','dlc_xd_spicy_pineapple_soda','dlc_xd_burgundy_cremant','dlc_xd_sanbitter','dlc_xd_stappi'} else 'mix'
        if n==26 and ident in {'blackberry_liqueur','cassis'}:stage='float'
        if n==86 and ident=='irish_cream':stage='float'
        if n==86 and ident=='grenadine':stage='garnish'
        optional='可选' in row['note_raw']
        note=f"原材料：{row['name_raw']}；原用量：{row['amount_raw']}；{row['note_raw']}。"
        if len(options)>1:
            decision=f"本工作版选择{chosen}；源备选为{' 或 '.join(options)}，不同时加入。"
            note+=decision;decisions.append({'source_name':row['name_raw'],'selected':chosen,'alternatives_source':options,'reason':'明确一个工作分支，不合并剂量或混用不同单位。'})
        note+=' '.join(inferred)
        if n==86:note+='本次冷饮工作版建议橙酒先入杯、奶油酒沿勺背后加，最后加入红石榴糖浆点缀；源文未记录制法。'
        assumptions.extend(inferred)
        parts.append(p(ident,q,unit,stage,optional,note,qr))
    if n==40:
        parts.append(p('simple_syrup',10,note='本次编辑建议新增10 ml普通糖浆，以平衡原两项高度朗姆30 ml与青柠22.5 ml；不认定原文继承上一配方。'))
        assumptions.append('在原两项30 ml高度朗姆和22.5 ml青柠不变基础上，另加10 ml糖浆作编辑平衡建议；未继承其他横渡太平洋材料。')
    if n==95:
        parts.extend([p('whisky',30,note='本次编辑建议继承试验1的30 ml威士忌以形成完整工作版；原计划未重述，不作为源事实。'),p('campari',15,note='本次编辑建议继承试验1的15 ml Campari；原计划未重述，不作为源事实。')])
        assumptions.append('将计划已明确的Maraschino7.5、浓梅酒30、绿茶梅酒30保留；仅工作版建议继承试验1威士忌30和Campari15，原计划仍为未执行。')
    return parts,assumptions,decisions

BUILD={1,2,3,4,8,18,23,33,44,45,47,53,74,79,80}
STIR={15,16,20,22,42,54,55,61,62,63,65,67,68,69,71,72,73,75,76,81,93,94,95,96}
SHAKE_TOP={17,21,30,32,34,35,60,64,78,82}
LAYER={83,84,85,86}
HIGHBALL={1,2,3,4,8,17,18,21,23,33,35,38,44,45,47,53,60,64,74,77,78,79,80,82}
ROCKS={10,15,16,26,29,54,55,56,58,61,62,63,65,69,76,81,83,84,85,86,88,90,91,92,93,94,95,96}
MARTINI={9,12,19,22,46,71,72,73}
def style(r,parts):
    n=r['number']
    method='build' if n in BUILD else 'stir' if n in STIR else 'shake_top' if n in SHAKE_TOP else 'layer' if n in LAYER else 'blend' if n in {24,43} else 'muddle_build' if n==38 else 'muddle' if n in {10,29} else 'shake_float' if n in {26,56,90} else 'shake'
    glass='highball' if n in HIGHBALL else 'rocks' if n in ROCKS else 'martini' if n in MARTINI else 'flute' if n in {34,75} else 'hurricane' if n in {30,31,32,43,51,52} else 'goblet' if n==24 else 'coupe'
    family='coffee' if n in {12,88} else 'creamy' if n in {13,83} else 'tiki' if n in {24,39,40,43,48,50,51,52} else 'sparkling' if n in {34,75} else 'spirit_forward' if n in STIR or n in LAYER else 'highball' if n in BUILD or n in {60,64,78,82} else 'sour'
    return method,glass,family

def safe_source(r):
    # Quarantined source safety material stays in extracted.json only, outside
    # the runtime drink/Agent fields. The source DOCX is preserved unchanged.
    return [text for text in r['review_notes_source'] if not any(token in text for token in ['洗涤剂','点火','Flaming'])]

def steps(r,parts,method,glass):
    n=r['number'];garnish='；'.join(r['serving_record_source'])
    if n in {10,24,29,38,48,53,54,71,72,75,76,77,78,82}:
        source=' '.join(r['method_record_source'])
        result=[text.strip() for text in re.split(r'(?:^|\s)\d+\.\s*',source) if text.strip()]
        if n in {10,29,54,77,82}:result.append('按选定杯型预冷；本工作版建议加入新冰或滤入预冷杯，具体冰量随器具调整。')
        if n==82:result.insert(0,'本次补全：轻压草莓与黄瓜使其出汁；保留原60 ml Peychaud’s苦精，先核对产品和本批服务份数。')
        if n==24:result.insert(0,'本次补全：工作版搅打冰量先取约90 g，按设备和口感调整；原文只说明与冰搅打。')
        return result
    if n==88:return ['本次编辑建议为澄清咖啡奶酒试配，不是容阙原吧台配方。预冷材料和干净容器。','将伏特加、咖啡利口酒、冷萃咖啡、糖浆与柠檬汁混合，再缓慢倒入牛奶。','静置形成絮凝后用食品级滤纸过滤，必要时回滤首段，过滤损耗与澄清程度以实际操作为准。','冷却后倒入放有新冰的古典杯；不把原液总量当作过滤后的成杯体积。']
    result=[]
    if any(part['stage']=='rinse' for part in parts):result.append('预冷杯子，用所列苦艾酒润洗杯壁，倒出多余液体；残留体积未实测。')
    if method=='layer':
        result=['预冷材料与小杯。将混合阶段材料倒入杯中。','将标为漂浮的材料按配料表顺序沿吧勺背缓慢注入；源文件未给完整操作，这是一份冷饮编辑建议。','不同品牌密度会影响视觉层次；不要把示意色带理解为永久分层。']
        if n==86:result.append('最后将所列5 ml红石榴糖浆缓慢注入奶油酒表面作为点缀；下沉路径以实际产品为准。')
        return result
    if method=='stir':result.extend(['在调酒杯中加入所列混合阶段原料，再加足量冰块。','用吧勺搅拌至充分冰冷，滤去调制用冰。'])
    elif method=='build':result.extend(['预冷服务杯，加入新冰。','先加入非含气的混合阶段材料，轻轻搅合。'])
    elif method=='blend':result.extend(['将原料与约100 g冰放入食品用搅拌机；冰量是本次编辑起点。','短时搅打至均匀，倒入预冷杯。'])
    else:
        if any(p['ingredient_id']=='dlc_xd_aquafaba' or p['ingredient_id']=='egg_white' for p in parts):result.append('混合阶段若采用蛋清，请使用适合生食的巴氏杀菌产品；本工作版按列出的具体泡沫材料量取，不与另一源选项混加。')
        result.extend(['将混合阶段原料加入摇壶，加入足量冰块。','充分摇匀至壶壁冰冷；含气补顶材料和漂浮材料不放入摇壶。','滤去调制用冰后入预冷杯。'])
    if glass in {'highball','rocks','hurricane','goblet'} and method not in {'build','blend'}:result.append('本工作版以新冰服务；碎冰只在配方明确指定时使用。')
    if n==26:result.append('按原笔记在古典杯中放入碎冰，莓果利口酒最后淋在表面。')
    elif any(p['stage']=='float' for p in parts):result.append('将漂浮阶段材料最后沿吧勺背缓慢注入，不搅散整杯。')
    if any(p['stage']=='top' for p in parts):result.append('最后加入补顶阶段材料，轻轻提拉搅合以保留气泡；估量补满值可随杯中冰量调整。')
    if n in {1,44}:result.append('最后沿杯壁缓缓注入石榴糖浆，静置使其向杯底自然下沉，形成上方金色、下方红色的日出渐变，不搅匀；具体色界以实际材料为准。')
    if n==20:result.append('按原笔记No ice作为成杯不留冰的工作解释；仅在调酒杯中加冰，滤去后饮用。')
    if n in {32,89}:result.insert(0,'先将所列分数／半枚柑橘榨汁，只取当次实际榨出的汁加入摇壶；果皮果肉滤出，出汁率未知，不将整块果实直接代作液体量。')
    if n==7:result.insert(0,'按源笔记将杯口半边润湿后蘸盐，再制作酒液。')
    if n==13:result.append('按源笔记以食品用巧克力点缀；原文未给装饰剂量。')
    if n==92:result.insert(0,'本工作版山楂选用可直接食用的汁或细浆；原笔记形态未明，先核对食品材料，不按毫升量取果干或整果。')
    if n==66:result.insert(0,'原文telska原料身份未明，先核对实际瓶标；7.5 ml仅是本次单位补全，不代表已识别品牌。')
    if n==93:result.insert(0,'原文salt plum hoijicha campari属于身份未确认的复合项，先确认其实际产品；本版不编造茶浸渍工艺。')
    return result

if __name__=='__main__':main()
