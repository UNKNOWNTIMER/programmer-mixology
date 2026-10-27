"""Deterministic, offline editorial build of the 42 individually checked IBA pages.

No HTTP calls. Original handoff data are read only. The compact facts below were
checked against the source URLs on 2026-09-21; see offline-sources.md for caveats.
"""
import copy
import hashlib
import json
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[1]
ROOT = PRODUCT.parent
CHECKED = '2026-09-21'
PACK = 'iba-completion-2026-09-21'
def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))
def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

base = {key: read(ROOT / 'data' / file) for key, file in [('recipes','recipes.json'),('ingredients','ingredients.json'),('profiles','profiles.seed.json'),('sources','sources.json')]}
new_ingredients = []
def ingredient(id, en, zh, role, allergens=()):
    new_ingredients.append(dict(id=id, name_en=en, name_zh=zh, role=role,
        potential_allergens=list(allergens), allergen_status='incomplete_requires_SKU_and_garnish_review',
        abv_fraction=None, sugar_g_per_100ml=None, kcal_per_100ml=None, density_g_per_ml=None,
        acidity_g_per_l=None, sku_confirmation_required=True))

for args in [
    ('aromatic_bitters','Aromatic bitters, unspecified','芳香苦精（品牌未指定）','bitters',('label_check',)),
    ('cuban_aguardiente','Cuban aguardiente','古巴甘蔗烈酒','spirit'),
    ('raw_honey','Raw honey','原蜜','sweetener'),
    ('old_tom_gin','Old Tom gin','老汤姆金酒','spirit'),
    ('grand_marnier','Grand Marnier','柑曼怡橙味利口酒','liqueur'),
    ('falernum','Falernum','法勒南香料利口酒／糖浆（以SKU确认）','modifier',('nuts','label_check')),
    ('cuban_rum','Cuban rum, unspecified','古巴朗姆酒（陈年类型未指定）','spirit'),
    ('passion_fruit_syrup','Passion fruit syrup','百香果糖浆','sweetener'),
    ('grapefruit','Grapefruit juice','西柚汁','juice'),
    ('havana_profundo','Havana Club Ron Profundo','哈瓦那俱乐部 Profundo 朗姆酒','spirit'),
    ('havana_smoky','Havana Club Ron Smoky','哈瓦那俱乐部 Smoky 朗姆酒','spirit'),
    ('frangelico','Frangelico','榛果利口酒 Frangelico','liqueur',('nuts',)),
    ('passion_fruit_puree','Passion fruit purée','百香果果泥','fruit'),
    ('jamaican_overproof_white_rum','Jamaican overproof white rum','牙买加高度白朗姆酒','spirit'),
    ('peach_brandy','Peach brandy','桃白兰地（类型需SKU确认）','liqueur'),
    ('honey_mix','Honey mix, ratio unspecified','蜂蜜混合液（比例未指定）','sweetener'),
    ('pineapple_chunks','Pineapple chunks','菠萝块','fruit'),
    ('cloves','Cloves','丁香','spice'),
    ('sugar_cane_juice','Sugar cane juice','甘蔗汁','juice'),
    ('vanilla_vodka','Vanilla vodka','香草伏特加','spirit'),
    ('passion_fruit_liqueur','Passion fruit liqueur','百香果利口酒','liqueur'),
    ('vanilla_sugar','Vanilla sugar','香草糖','sweetener'),
    ('tawny_port','Red tawny port wine','茶色波特酒','wine',('sulfites',)),
    ('egg_yolk','Egg yolk','蛋黄','protein',('egg',)),
    ('cynar','Cynar','朝鲜蓟苦味利口酒 Cynar','liqueur'),
    ('orange_flower_water','Orange flower water','橙花水','modifier'),
    ('vanilla_extract','Vanilla extract','香草精','modifier',('label_check',)),
    ('cherry_brandy_luxardo','Cherry Brandy Luxardo','Luxardo 樱桃白兰地利口酒','liqueur'),
    ('sparkling_wine','Sparkling wine, unspecified','起泡葡萄酒（类型未指定）','wine',('sulfites',)),
    ('peach_schnapps','Peach schnapps','桃味施纳普斯利口酒','liqueur'),
    ('amontillado_sherry','Amontillado sherry','阿蒙蒂亚多雪莉酒','wine',('sulfites',)),
    ('palo_cortado','Palo Cortado sherry','帕罗科塔多雪莉酒','wine',('sulfites',)),
    ('orange_fruit','Orange','橙子','fruit'),
    ('lemon_fruit','Lemon','黄柠檬','fruit'),
    ('elderflower_cordial','Elderflower cordial','接骨木花浓缩调味液','modifier'),
    ('red_chili','Red chili pepper','红辣椒','spice'),
    ('creme_menthe_white','White crème de menthe','白色薄荷利口酒','liqueur'),
    ('martinique_agricole_rum','Rhum Martinique agricole','马提尼克农业朗姆酒','spirit'),
    ('allspice_st_elizabeth','St. Elizabeth allspice dram','圣伊丽莎白多香果利口酒','liqueur'),
    ('agave_nectar','Agave nectar','龙舌兰蜜','sweetener'),
    ('white_grappa','White smooth grappa','柔和白格拉帕','spirit'),
    ('chamomile_cordial','Chamomile cordial','洋甘菊浓缩调味液','modifier'),
    ('jamaican_dark_rum','Jamaican dark rum','牙买加深色朗姆酒','spirit'),
    ('jamaican_rum_unspecified','Jamaican rum, type unspecified','牙买加朗姆酒（类型未指定）','spirit'),
    ('puerto_rican_gold_rum','Gold Puerto Rican rum','波多黎各金朗姆酒','spirit'),
    ('demerara_rum','Demerara rum, strength unspecified','德梅拉拉朗姆酒（酒精度未指定）','spirit'),
    ('donns_mix','Donn’s Mix','Donn混合液（西柚与肉桂糖浆）','modifier'),
    ('pernod','Pernod','保乐茴香酒','spirit'),
]:
    ingredient(*args)

def i(id, q, unit='ml', note=None, stage='mix', optional=False, alternatives=(), range=None, retained=False):
    row = dict(ingredient_id=id,quantity=q,unit=unit,optional=optional,stage=stage,
               quantity_note=note,allowed_alternatives=list(alternatives))
    if range is not None: row['quantity_range']=list(range)
    if retained: row['retained_ml']=None
    return row
recipes=[]
def r(slug,en,zh,family,glass,method,items,steps,garnish='来源未指定装饰。',notes=''):
    id='iba_'+slug.replace('-','_')
    source=dict(kind='official_recipe',publisher='International Bartenders Association',
        url=f'https://iba-world.com/iba-cocktail/{slug}/',reference=slug,checked_on=CHECKED,method_provenance='source_paraphrase')
    recipes.append(dict(id=id,name_en=en,name_zh=zh,variant='IBA 参考版本（2026-09-21 增量核对）',family=family,
        glass_template=glass,glass_template_provenance='editorial_mapping',method=method,ingredients=items,
        steps_zh=steps,garnish_zh=garnish,notes_zh=notes,source=source,preparation_review='not_physically_tested',
        default_orderable=False,needs_serving_configuration=True,actual_user_rating=None,prediction_profile_id=id))
S=['将所列混合材料与冰摇匀。','滤入预冷鸡尾酒杯。']
T=['将材料放入加冰的调酒杯，搅拌至冷。','滤入预冷鸡尾酒杯。']
r('brandy-crusta','Brandy Crusta','白兰地克鲁斯塔','sour','coupe','stir',[
    i('brandy',52.5),i('maraschino',7.5,note='来源指定 Luxardo。'),i('orange_curacao',1,'barspoon'),i('lemon',15),i('simple_syrup',1,'barspoon'),i('aromatic_bitters',2,'dash')],
    ['用橙或柠檬润湿杯沿并蘸细白糖；把果皮卷置杯内。','混合材料与冰在调酒杯中拌匀，滤入准备好的细身鸡尾酒杯。'],
    '糖口与橙／柠檬皮；来源未量化糖与果皮用量。')
r('canchanchara','Canchanchara','坎昌恰拉','sour','rocks','build',[
    i('cuban_aguardiente',60),i('lime',15),i('raw_honey',15),i('water',50)],
    ['先将蜂蜜、水和青柠汁混合，润遍杯底和内壁。','加碎冰与甘蔗烈酒，自底向上充分搅匀。'],'青柠角。',
    '原料栏写 Cuban Aguardiente；步骤泛称 rum。本条遵守原料栏，保留这一措辞差异，不替换成普通朗姆酒。')
r('casino','Casino','卡西诺','sour','rocks','shake',[i('old_tom_gin',40),i('maraschino',10,note='来源指定 Luxardo。'),i('lemon',10),i('orange_bitters',2,'dash')],
    ['所有材料加冰摇匀。','滤入预冷并放冰的古典杯。'],'柠檬皮与马拉斯奇诺樱桃。')
r('champagne-cocktail','Champagne Cocktail','香槟鸡尾酒','spritz','flute','build',[
    i('champagne',90,note='预冷。',stage='top'),i('cognac',10),i('angostura',2,'dash'),i('grand_marnier',None,'few_drops',optional=True),i('sugar_cube',1,'cube')],
    ['在大香槟杯内放方糖，滴上苦精并加入干邑；可选添加几滴柑曼怡。','缓缓注入冷香槟。'],'橙皮与马拉斯奇诺樱桃。')
r('chartreuse-swizzle','Chartreuse Swizzle','查特搅和','tiki','highball','swizzle',[
    i('green_chartreuse',45),i('pineapple',30),i('lime',22.5),i('falernum',15)],
    ['材料倒入高杯，加入小颗粒冰。','用搅棒或吧勺迅速搅和，再补满小颗粒冰。'],'薄荷叶与现磨肉豆蔻。')
r('dons-special-daiquiri','Don’s Special Daiquiri','唐氏特调戴吉利','tiki','goblet','blend',[
    i('jamaican_rum',30,note='来源指定 Gold Jamaican Rum。'),i('cuban_rum',15),i('passion_fruit_syrup',15),i('lime',15),i('honey_syrup',15)],
    ['材料与碎冰在奶昔搅拌机中短暂搅打。','倒入有脚的 copo 杯，再补碎冰。'],'半颗百香果。')
r('fernandito','Fernandito','费尔南迪托','highball','rocks','build',[
    i('fernet',50,note='来源指定 Fernet Branca。'),i('cola',None,'to_top',stage='top')],
    ['在双份古典杯内加冰和 Fernet Branca。','用可乐补满，轻轻拌匀。'])
r('grand-margarita','Grand Margarita','柑曼怡玛格丽特','sour','rocks','shake',[
    i('tequila',45,note='来源要求 100% agave。'),i('grand_marnier',30),i('lime',15)],
    ['古典杯做海盐杯口并放冰。','混合材料在加冰摇壶中用力摇约10秒，滤入杯中。'],'青柠片；海盐杯口用量未指定。')
r('hemingway-special','Hemingway Special','海明威特调','sour','coupe','shake',[
    i('rum',60),i('grapefruit',40),i('maraschino',15,note='来源指定 Luxardo。'),i('lime',15,note='原文 Fresh Lime，液体用量以 ml 记录。')],S)
r('iba-tiki','IBA Tiki','IBA 提基','tiki','hurricane','shake',[
    i('havana_profundo',30),i('havana_smoky',30),i('amaretto',15),i('frangelico',5),i('maraschino',5,'drop',note='来源指定 Luxardo；滴的体积未校准。'),
    i('passion_fruit_puree',30),i('pineapple',None,'unknown',note='原文数字为90，未写单位；不得自动假定ml。'),i('lime',None,'unknown',note='原文数字为30，未写单位；不得自动假定ml。'),i('fresh_ginger',1,'slice',note='一薄片，未指定厚度或重量。')],
    ['在摇壶内轻压一薄片姜，再加入其他材料。','加冰用力摇匀，滤入装小颗粒冰的预冷提基杯。'],'柑橘与脱水菠萝片。',
    '原页两种果汁缺计量单位，必须经人工来源复核及ServingSpec确认后才能用于精确配制；不填入推测剂量。')
r('illegal','Illegal','非法','sour','coupe','shake',[
    i('mezcal',30,note='来源指定 Espadin。'),i('jamaican_overproof_white_rum',15),i('falernum',15),i('maraschino',1,'barspoon',note='来源指定 Luxardo。'),i('lime',22.5),i('simple_syrup',15),i('egg_white',None,'few_drops',optional=True)],
    ['混合材料加冰用力摇匀。','滤入预冷鸡尾酒杯；也可盛入放冰的陶杯。'])
r('mary-pickford','Mary Pickford','玛丽·毕克馥','tiki','coupe','shake',[
    i('white_rum',45),i('pineapple',45),i('maraschino',7.5,note='来源指定 Luxardo。'),i('grenadine',5)],S)
r('mint-julep','Mint Julep','薄荷朱利普','spirit_forward','mug','muddle',[
    i('bourbon',60),i('mint',4,'sprig'),i('sugar',1,'tsp',note='来源指定粉状糖。'),i('water',2,'tsp')],
    ['在不锈钢朱利普杯中轻压薄荷、糖和水。','填入碎冰并加波本，充分搅拌至杯外结霜。'],'一枝薄荷。')
r('missionarys-downfall','Missionary’s Downfall','传教士的没落','tiki','goblet','blend',[
    i('white_rum',30),i('peach_brandy',15),i('lime',15),i('honey_mix',30),i('mint',10,'leaf'),i('pineapple_chunks',None,'piece',note='来源为3至4块；块大小未指定。',range=(3,4))],
    ['全部材料与半杯碎冰一起搅打。','盛入大型鸡尾酒杯。'],'薄荷枝与菠萝片。','半杯碎冰的杯容量及蜂蜜混合液比例未给定。')
r('monkey-gland','Monkey Gland','猴腺','sour','coupe','shake',[
    i('gin',45,note='来源指定 Dry Gin。'),i('orange_juice',45),i('absinthe',1,'tbsp'),i('grenadine',1,'tbsp')],S,
    notes='本次页面写的是1汤匙苦艾酒和1汤匙红石榴糖浆，保留当前页面版本；不改成其他常见版本的dash。汤匙容量须在ServingSpec校准。')
r('paradise','Paradise','天堂','sour','coupe','shake',[i('gin',30),i('apricot_brandy',20),i('orange_juice',15)],S)
r('pisco-punch','Pisco Punch','皮斯科潘趣','sour','goblet','shake',[
    i('pisco',60),i('pineapple',22.5),i('simple_syrup',15),i('lemon',15),i('white_wine',30,stage='top'),i('cloves',3,'piece')],
    ['将丁香与普通糖浆轻压，加入白葡萄酒以外的其余材料后充分摇和。','双重过滤入大高脚杯，最后加入白葡萄酒并轻拌。'])
r('planters-punch','Planters Punch','种植园潘趣','tiki','rocks','build',[
    i('jamaican_rum_unspecified',45),i('lime',15),i('sugar_cane_juice',30)],
    ['将材料倒入小平底杯或传统陶杯。','按口味使用水、冰或鲜果汁稀释，具体量须单独确认。'],'橙皮。','稀释方式和数量由来源保留为按口味调整，未加入固定体积。')
r('porn-star-martini','Porn Star Martini','激情之星马天尼','sour','martini','shake',[
    i('vanilla_vodka',50),i('passion_fruit_liqueur',20),i('passion_fruit_puree',50),i('vanilla_sugar',2,'barspoon'),i('champagne',50,stage='side',note='另杯随附，不能与其他材料一起摇和或算作同一杯体积。')],
    ['香槟留作另杯；其余材料加冰摇匀。','双重过滤入预冷的大鸡尾酒杯，旁边另配50ml香槟。'],'百香果壳和糖（装饰量未指定）。')
r('porto-flip','Porto Flip','波特翻转','creamy','coupe','shake',[i('brandy',15),i('tawny_port',45),i('egg_yolk',10)],S,'现磨肉豆蔻。')
r('rabo-de-galo','Rabo de Galo','公鸡尾','spirit_forward','rocks','build',[
    i('cachaca',60),i('sweet_vermouth',20,note='来源指定 Cinzano Rosso。'),i('cynar',15),i('angostura',2,'drop',optional=True)],
    ['材料放入古典杯，加冰。','短暂搅拌至混合。'],'扭转橙皮。')
r('ramos-fizz','Ramos Fizz','拉莫斯菲士','creamy','highball','shake',[
    i('gin',45),i('lime',15),i('lemon',15),i('sugar_syrup',30),i('cream',60),i('egg_white',30),i('orange_flower_water',3,'dash'),i('vanilla_extract',2,'drop'),i('soda',None,'to_top',stage='top')],
    ['除苏打水外的材料加冰摇约2分钟，双重过滤到中间容器。','把滤出的液体倒回摇壶，不加冰用力摇约1分钟。','滤入高杯，再用苏打水补满。'])
r('remember-the-maine','Remember the Maine','铭记缅因号','spirit_forward','coupe','stir',[
    i('rye',60),i('sweet_vermouth',22.5),i('cherry_brandy_luxardo',15),i('absinthe',7.5,stage='rinse',note='润杯后倒掉；实际残留量未知，不能将7.5ml全部计入成杯。',retained=True)],
    ['苦艾酒在浅碟杯内旋转润杯后倒掉。','其余材料加入约四分之三杯冰的调酒杯，搅冷后滤入已润杯的浅碟杯。'],'柠檬皮。')
r('russian-spring-punch','Russian Spring Punch','俄罗斯春日潘趣','spritz','highball','shake',[
    i('vodka',25),i('lemon',25),i('cassis',15),i('sugar_syrup',10),i('sparkling_wine',None,'to_top',stage='top')],
    ['起泡酒以外的材料加冰摇匀，滤入预冷且装冰的高杯。','用起泡酒补满。'],'黑莓；可另加柠檬片。')
r('sea-breeze','Sea Breeze','海风','highball','highball','build',[i('vodka',40),i('cranberry',120),i('grapefruit',30)],
    ['把所有材料直接注入装冰的高杯。'],'橙皮与樱桃。')
r('sex-on-the-beach','Sex on the Beach','性感沙滩','highball','highball','build',[
    i('vodka',40),i('peach_schnapps',20),i('orange_juice',40),i('cranberry',40)],['在装冰的高杯内直接混合各项材料。'],'半片橙。')
r('sherry-cobbler','Sherry Cobbler','雪莉考布勒','sour','mug','shake',[
    i('amontillado_sherry',45),i('palo_cortado',45),i('sugar',1,'tsp',note='超细糖或颗粒白糖。'),i('orange_fruit',0.5,'slice',note='半个圆片，切成两份四分之一圆片。'),i('lemon_fruit',0.5,'slice',note='半个圆片，切成两份四分之一圆片。')],
    ['两种雪莉、糖和橙／柠檬片加冰快速摇匀。','滤入盛碎冰的朱利普杯。'],'鲜浆果、各四分之一圆片的橙与柠檬，并配吸管。')
r('south-side','South Side','南区','sour','coupe','shake',[
    i('gin',60,note='来源指定 London dry Gin。'),i('lemon',30),i('simple_syrup',15),i('mint',None,'leaf',note='原文5/6叶，按5至6叶区间保留。',range=(5,6)),i('egg_white',None,'few_drops',optional=True)],
    ['材料加冰摇匀；使用蛋清时需更用力摇和。','双重过滤入预冷鸡尾酒杯。'],'薄荷枝。')
r('spicy-fifty','Spicy Fifty','香辣五十','sour','coupe','shake',[
    i('vanilla_vodka',50),i('elderflower_cordial',15),i('lime',15),i('honey_syrup',10,note='来源指定 Monin。'),i('red_chili',2,'slice',note='薄片，厚度和辣度未指定。')],
    ['各项材料加冰充分摇匀。','双重过滤入预冷鸡尾酒杯。'],'一枚红辣椒（大小未指定）。')
r('stinger','Stinger','毒刺','spirit_forward','martini','stir',[i('cognac',50),i('creme_menthe_white',20)],T,'可选薄荷叶。')
r('suffering-bastard','Suffering Bastard','受苦的混蛋','highball','highball','shake',[
    i('cognac',30,note='来源允许干邑或白兰地。',alternatives=('brandy',)),i('gin',30),i('lime',15),i('angostura',2,'dash'),i('ginger_beer',None,'to_top',stage='top')],
    ['姜汁啤酒以外的材料加冰摇匀。','不滤冰，整壶倒入柯林斯杯或原式陶杯，再补姜汁啤酒。'],'薄荷枝；可选橙片。')
r('tequila-sunrise','Tequila Sunrise','龙舌兰日出','highball','highball','build',[
    i('tequila',45),i('orange_juice',90),i('grenadine',15,stage='finish')],
    ['在盛冰的高杯中倒入龙舌兰和橙汁。','最后加入红石榴糖浆形成渐层，不搅拌。'],'半片橙或橙皮。')
r('three-dots-and-a-dash','Three Dots and a Dash','三点一划','tiki','goblet','blend',[
    i('martinique_agricole_rum',45),i('aged_rum',15,note='来源指定 Blended Aged Rum。'),i('falernum',7.5),i('allspice_st_elizabeth',7.5),i('lime',15,note='原页排版把上一条多香果与本条文字连在同一行；两个数值各自保留。'),i('orange_juice',15),i('honey_syrup',15),i('angostura',2,'dash')],
    ['材料与来源标注的12盎司碎冰短暂搅打。','倒入带脚 copo 杯，再补碎冰。'],'三颗樱桃和一条矩形菠萝块。','来源未注明碎冰盎司是质量还是体积，不擅自换算成克或毫升。')
r('tipperary','Tipperary','蒂珀雷里','spirit_forward','martini','stir',[
    i('irish_whiskey',50),i('sweet_vermouth',25),i('green_chartreuse',15),i('angostura',2,'dash')],T,'橙片。')
r('tommys-margarita','Tommy’s Margarita','汤米玛格丽特','sour','rocks','shake',[
    i('tequila',60,note='来源要求100% agave。'),i('lime',30),i('agave_nectar',30)],
    ['材料加冰摇匀，滤入预冷并装冰的古典杯。'],'青柠片。')
r('trinidad-sour','Trinidad Sour','特立尼达酸酒','sour','coupe','shake',[
    i('angostura',45,note='来源明确45ml，并非dash。'),i('orgeat',30),i('lemon',22.5),i('rye',15)],S)
r('tuxedo','Tuxedo','燕尾服','spirit_forward','martini','stir',[
    i('old_tom_gin',30),i('dry_vermouth',30),i('maraschino',0.5,'barspoon',note='来源指定 Luxardo。'),i('absinthe',0.25,'barspoon'),i('orange_bitters',3,'dash')],T,'樱桃和柠檬皮。')
r('ve-n-to','Ve.N.To','威恩托','sour','rocks','shake',[
    i('white_grappa',45),i('lemon',22.5),i('honey_mix',15,note='蜂蜜混合液中的水可按来源注释换成洋甘菊浸泡液；比例未指定。'),i('chamomile_cordial',15),i('egg_white',None,'few_drops',optional=True)],
    ['材料加冰用力摇匀。','滤入预冷、盛冰的小平底杯。'],'柠檬皮与白葡萄。')
r('vesper','Vesper','薇斯珀','spirit_forward','martini','shake',[i('gin',45),i('vodka',15),i('lillet_blanc',7.5)],S,'柠檬皮。')
r('vieux-carre','Vieux Carré','老广场','spirit_forward','coupe','stir',[
    i('rye',30),i('cognac',30),i('sweet_vermouth',30),i('benedictine',1,'barspoon'),i('peychaud',2,'dash')],T,'橙皮与马拉斯奇诺樱桃。')
r('white-lady','White Lady','白色佳人','sour','coupe','shake',[i('gin',40),i('triple_sec',30),i('lemon',20)],S)
r('zombie','Zombie','僵尸','tiki','highball','blend',[
    i('jamaican_dark_rum',45),i('puerto_rican_gold_rum',45),i('demerara_rum',30),i('lime',20),i('falernum',15),i('donns_mix',15,note='来源配比为2份新鲜黄色西柚与1份肉桂糖浆；糖浆浓度未指定。'),i('grenadine',1,'tsp'),i('angostura',1,'dash'),i('pernod',6,'drop')],
    ['全部材料与170克碎冰放入电动搅拌机。','脉冲搅打数秒，倒入高平底杯。'],'薄荷叶。','来源未给德梅拉拉朗姆酒的酒精度；不因其他版本常用高度酒而补写。')

assert len(recipes)==42
all_ids={x['id'] for x in base['ingredients']['ingredients']+new_ingredients}
assert len(all_ids)==len(base['ingredients']['ingredients'])+len(new_ingredients)
assert not {x['id'] for x in recipes} & {x['id'] for x in base['recipes']['recipes']}
assert all(i['ingredient_id'] in all_ids for r in recipes for i in r['ingredients'])
# Explicit editorial family priors; these are not facts supplied by IBA.
priors={
 'sour':([4,5,1,0,0],[5,6,4,0,3,0,5]),
 'spirit_forward':([4,0,6,0,0],[7,7,5,0,1,0,7]),
 'tiki':([6,3,1,0,0],[5,7,6,0,3,1,6]),
 'highball':([5,4,1,0,0],[3,5,3,4,4,0,4]),
 'spritz':([5,2,3,0,0],[3,6,3,7,4,0,4]),
 'creamy':([7,2,1,0,0],[3,5,8,1,2,0,5]),
}
profiles=[]
for recipe in recipes:
    taste,sensory=priors[recipe['family']]
    taste=list(taste);sensory=list(sensory)
    # Structural ingredient evidence informs an editorial estimate, not a measured score.
    if not any(i['ingredient_id'] in {'soda','cola','ginger_beer','champagne','sparkling_wine'} for i in recipe['ingredients']):
        sensory[3]=0
    if recipe['id']=='iba_spicy_fifty': sensory[5]=7
    if recipe['id']=='iba_mint_julep': sensory[4]=7
    profiles.append(dict(recipe_id=recipe['id'],taste_axes=['sweet','sour','bitter','salty','umami'],
        taste_intensity_0_10=taste,taste_preference_bps=[x*1000 for x in taste],
        sensory_axes=['alcohol_heat','aroma','body','carbonation','cooling','spiciness','finish'],sensory_0_10=sensory,
        status='heuristic_unvalidated',confidence='low',origin='editorial_family_prior_with_structural_overrides_extension_2026_09_21',measured=False,
        source_recipe_does_not_supply_these_scores=True,note_zh='新增资料使用编辑性家族先验，仅供排序冷启动；不是实测、用户评价或IBA提供的感官评分。'))
pack=dict(pack_id=PACK,pack_schema_version=1,checked_on=CHECKED,
    provenance=dict(publisher='International Bartenders Association',index_url='https://iba-world.com/cocktails/all-cocktails/',
        index_pages=6,official_list_count=102,new_recipe_count=42,license_status='not_granted_or_verified',
        attribution_requirements='保留逐条来源URL、出版社、查阅日期及独立转述标记；其他许可义务待权利人确认。',
        commercial_review_status='pending',content_scope='配料事实、独立中文步骤转述；未复制图片、视频、历史长文或网站数据库。'),
    recipes=dict(schema_version='0.1.0',snapshot_date=CHECKED,recipe_count=len(recipes),recipes=recipes),
    ingredients=dict(schema_version='0.1.0',ingredients=new_ingredients),
    profiles=dict(schema_version='0.1.0',status='heuristic_unvalidated',profiles=profiles),
    sources=dict(checked_on=CHECKED,sources=[dict(recipe_id=r['id'],**r['source']) for r in recipes]))
write(PRODUCT/'data/catalog'/f'{PACK}.json',pack)
review=dict(checked_on=CHECKED,scope='42新增配方页面逐页实查；旧60份IBA事实未在本次逐条复核，保留原有查阅元数据。',
    verification_method='IBA官网六页目录与各配方详情页，通过浏览工具逐页读取。未下载网站图片或正文整页。',
    checks=[dict(recipe_id=r['id'],source_url=r['source']['url'],checked_on=CHECKED,
        facts_sha256=hashlib.sha256(json.dumps(r,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
        facts_hash_scope='规范化单份SourceRecipe JSON；不是远程网页内容哈希。',
        editorial_review='source_fact_transcription_checked_not_physically_tested') for r in recipes])
write(PRODUCT/'data/catalog/source-review-2026-09-21.json',review)
# Separate product-owned schema: handoff schema is retained byte-for-byte.
schema=read(ROOT/'schemas/seed_catalog.schema.json')
fields=schema['properties']['recipes']['items']['properties']['ingredients']['items']['properties']
fields['unit']['enum'] += ['tbsp','drop','piece','unknown']
fields['stage']['enum'] += ['side']
write(PRODUCT/'contracts/catalog-extension.schema.json',schema)
for key,file in [('recipes','recipes.json'),('ingredients','ingredients.json'),('profiles','profiles.seed.json'),('sources','sources.json')]:
    combined=copy.deepcopy(base[key]);combined[key]+=pack[key][key]
    if key=='recipes': combined['recipe_count']=len(combined[key])
    write(PRODUCT/'apps/client/public/seed'/file,combined)
print(json.dumps(dict(pack_id=PACK,added=len(recipes),total=70+len(recipes),ingredients=len(all_ids),
    added_ids=[r['id'] for r in recipes],pack_sha256=hashlib.sha256((PRODUCT/'data/catalog'/f'{PACK}.json').read_bytes()).hexdigest()),ensure_ascii=False,indent=2))
