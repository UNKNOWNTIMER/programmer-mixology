"""Rebuild the hand-curated recipe snapshot. No scraping, network, or dependencies.
Recipe facts: original Chinese paraphrases of the attributed source pages.
Sensory vectors: deliberately separate, unvalidated editorial priors, not measurements.
"""
from pathlib import Path
import json
from fractions import Fraction
ROOT = Path(__file__).resolve().parents[1]
STAMP = '2026-09-21'

def dump(name, data):
    p = ROOT / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

# id | Chinese label | English label | role | potential allergen flags (not an exhaustive assurance)
RAW_ING = '''cognac|干邑白兰地|Cognac|spirit|
brandy|白兰地|Brandy|spirit|
creme_cacao_brown|棕色可可利口酒|Brown crème de cacao|liqueur|label_check
creme_cacao_white|白色可可利口酒|White crème de cacao|liqueur|label_check
cream|鲜奶油|Fresh cream|cream|milk
campari|金巴利苦味开胃酒|Campari|bitter_liqueur|label_check
sweet_vermouth|红色甜味美思|Sweet red vermouth|fortified_wine|sulfites_possible
soda|苏打水|Soda water|carbonated|
gin|金酒|Gin|spirit|botanical_label_check
apricot_brandy|杏子白兰地利口酒|Apricot brandy liqueur|liqueur|label_check
calvados|卡尔瓦多斯苹果白兰地|Calvados|spirit|
maraschino|马拉斯奇诺樱桃利口酒|Maraschino liqueur|liqueur|label_check
lemon|新鲜黄柠檬汁|Fresh lemon juice|acid|
creme_violette|紫罗兰利口酒|Crème de violette|liqueur|label_check
honey_syrup|蜂蜜糖浆|Honey syrup|sweetener|
orange_juice|橙汁|Orange juice|juice|
prosecco|普罗塞克起泡酒|Prosecco|sparkling_wine|sulfites_possible
peach_puree|白桃果泥|White peach purée|fruit|
white_rum|白朗姆酒|White rum|spirit|
triple_sec|橙味利口酒|Triple sec|liqueur|label_check
vodka|伏特加|Vodka|spirit|
coffee_liqueur|咖啡利口酒|Coffee liqueur|liqueur|label_check
kahlua|甘露咖啡利口酒|Kahlúa|liqueur|label_check
tomato_juice|番茄汁|Tomato juice|juice|
worcestershire|伍斯特调味汁|Worcestershire sauce|seasoning|fish_possible
hot_sauce|辣椒调味汁|Tabasco-style hot sauce|seasoning|label_check
celery_salt|芹菜盐|Celery salt|seasoning|celery
black_pepper|黑胡椒|Black pepper|seasoning|
bourbon|波本威士忌|Bourbon whiskey|spirit|
rye|黑麦威士忌|Rye whiskey|spirit|
sugar_syrup|糖浆（原出处未统一浓度）|Sugar syrup|sweetener|
simple_syrup|普通糖浆（配制浓度需登记）|Simple syrup|sweetener|
blackberry_liqueur|黑莓利口酒|Crème de mûre|liqueur|label_check
cachaca|卡莎萨甘蔗酒|Cachaça|spirit|
lime_fruit|整颗青柠|Whole lime|fruit|
sugar|细白砂糖|Fine white sugar|sweetener|
dry_vermouth|干味美思|Dry vermouth|fortified_wine|sulfites_possible
raspberry_syrup|覆盆子糖浆|Raspberry syrup|sweetener|
egg_white|蛋清|Egg white|foam|egg
cointreau|君度橙味利口酒|Cointreau|liqueur|label_check
lillet_blanc|利莱白开胃酒|Lillet Blanc|aperitif_wine|sulfites_possible
absinthe|苦艾酒|Absinthe|spirit|botanical_label_check
citron_vodka|柠檬风味伏特加|Citron vodka|spirit|label_check
lime|新鲜青柠汁|Fresh lime juice|acid|
cranberry|蔓越莓汁|Cranberry juice|juice|
cola|可乐|Cola|carbonated|
goslings_rum|高斯林朗姆酒|Goslings rum|spirit|
ginger_beer|姜汁啤酒（核对是否含酒精）|Ginger beer|carbonated|label_check
espresso|浓缩咖啡|Espresso|coffee|
champagne|香槟|Champagne|sparkling_wine|sulfites_possible
amaretto|阿玛雷托杏仁风味利口酒|Amaretto|liqueur|nut_label_check
raspberry_liqueur|覆盆子利口酒|Raspberry liqueur|liqueur|label_check
pineapple|菠萝汁|Pineapple juice|juice|
basil|罗勒叶|Basil leaves|herb|
creme_menthe_green|绿色薄荷利口酒|Green crème de menthe|liqueur|label_check
fernet|费尔奈特苦味利口酒|Fernet|bitter_liqueur|botanical_label_check
ginger_ale|姜汁汽水|Ginger ale|carbonated|
angostura|安格斯图拉芳香苦精|Angostura aromatic bitters|bitters|botanical_label_check
irish_whiskey|爱尔兰威士忌|Irish whiskey|spirit|
hot_coffee|热咖啡|Hot coffee|coffee|
blackstrap_rum|黑糖蜜朗姆酒|Blackstrap rum|spirit|
demerara_syrup|德梅拉拉糖浆|Demerara syrup|sweetener|
white_wine|干白葡萄酒|Dry white wine|wine|sulfites_possible
cassis|黑加仑利口酒|Crème de cassis|liqueur|label_check
green_chartreuse|绿色查特酒|Green Chartreuse|liqueur|botanical_label_check
tequila|龙舌兰酒|Tequila|spirit|
jamaican_rum|牙买加琥珀色朗姆酒|Amber Jamaican rum|spirit|
martinique_molasses_rum|马提尼克糖蜜朗姆酒|Martinique molasses rum|spirit|
orange_curacao|橙味库拉索利口酒|Orange Curaçao|liqueur|label_check
orgeat|欧夏杏仁糖浆|Orgeat|sweetener|tree_nuts_possible
orange_bitters|橙味苦精|Orange bitters|bitters|botanical_label_check
mint|薄荷|Mint|herb|
mezcal|梅斯卡尔|Mezcal|spirit|
yellow_chartreuse|黄色查特酒|Yellow Chartreuse|liqueur|botanical_label_check
aperol|阿佩罗开胃酒|Aperol|bitter_liqueur|label_check
red_wine|红葡萄酒|Red wine|wine|sulfites_possible
aged_rum|陈年朗姆酒|Aged rum|spirit|
sugar_cube|方糖|Sugar cube|sweetener|
water|饮用水|Water|water|
salt|食盐|Salt|seasoning|
grapefruit_soda|粉红西柚汽水|Pink grapefruit soda|carbonated|
amaro_nonino|诺尼诺苦味利口酒|Amaro Nonino|bitter_liqueur|botanical_label_check
blended_scotch|调和苏格兰威士忌|Blended Scotch whisky|spirit|
islay_scotch|艾雷岛苏格兰威士忌|Islay Scotch whisky|spirit|
fresh_ginger|鲜姜|Fresh ginger|seasoning|
coconut_cream|椰子乳脂／椰子浓浆（核对甜度）|Coconut cream|cream|label_check
pisco|皮斯科白兰地|Pisco|spirit|
amargo_bitters|阿玛戈苦精|Amargo bitters|bitters|botanical_label_check
scotch|苏格兰威士忌|Scotch whisky|spirit|
drambuie|杜林标利口酒|Drambuie|liqueur|label_check
peychaud|佩乔苦精|Peychaud's bitters|bitters|botanical_label_check
cherry_sangue_morlacco|桑格莫拉科樱桃利口酒|Cherry Sangue Morlacco|liqueur|label_check
benedictine|廊酒|Bénédictine D.O.M.|liqueur|botanical_label_check
grenadine|红石榴糖浆|Grenadine|sweetener|
apple_juice|苹果汁|Apple juice|juice|
maple_syrup|枫糖浆|Maple syrup|sweetener|
apple_cider|苹果西打（是否含酒精待核对）|Apple cider|juice|label_check
rum|朗姆酒（类型未指定）|Rum, unspecified|spirit|
irish_cream|爱尔兰奶油利口酒|Irish cream liqueur|liqueur|milk
semi_rich_syrup|半浓糖浆|Semi-rich syrup|sweetener|
whisky|威士忌（类型未指定）|Whisky, unspecified|spirit|'''
ING = {}
for line in RAW_ING.splitlines():
    key, zh, en, role, allergy = line.split('|')
    ING[key] = dict(id=key, name_zh=zh, name_en=en, role=role,
        potential_allergens=[x for x in allergy.split(',') if x],
        allergen_status='incomplete_requires_SKU_and_garnish_review',
        abv_fraction=None, sugar_g_per_100ml=None, kcal_per_100ml=None,
        density_g_per_ml=None, acidity_g_per_l=None,
        sku_confirmation_required=True)

# ingredient tokens: id:amount[:unit], '?' preserves unknown. Alternatives and original units stay intact.
def ingredients(spec):
    out=[]
    for token in spec.split(';'):
        bits=token.split(':'); key,qty=bits[:2]; unit=bits[2] if len(bits)>2 else 'ml'
        q=None if qty=='?' else float(qty)
        if q is not None and q.is_integer(): q=int(q)
        out.append(dict(ingredient_id=key, quantity=q, unit=unit, optional=False,
                        stage='mix', quantity_note=None, allowed_alternatives=[]))
    return out

REC=[]
def add(slug,zh,en,family,glass,method,spec,steps,garnish='',note='',personal=False):
    r=dict(id=('note_' if personal else 'iba_')+slug.replace('-','_'),name_zh=zh,name_en=en,
           variant='个人笔记版本' if personal else 'IBA 参考版本（网页快照）',
           family=family, glass_template=glass, glass_template_provenance='editorial_mapping',
           method=method, ingredients=ingredients(spec), steps_zh=steps.split('|'),
           garnish_zh=garnish or '原出处未指定／无', notes_zh=note,
           source=dict(kind='user_note' if personal else 'official_recipe',
               publisher='用户原始鸡尾酒笔记' if personal else 'International Bartenders Association',
               url=None if personal else f'https://iba-world.com/iba-cocktail/{slug}/',
               reference='conversation:original-cocktail-catalogue' if personal else slug,
               checked_on=STAMP, method_provenance='editorial_template' if personal else 'source_paraphrase'),
           preparation_review='not_physically_tested', default_orderable=False,
           needs_serving_configuration=True, actual_user_rating=None,
           prediction_profile_id=('note_' if personal else 'iba_')+slug.replace('-','_'))
    REC.append(r)

add('alexander','亚历山大','Alexander','creamy','coupe','shake','cognac:30;creme_cacao_brown:30;cream:30','材料加冰摇匀。|滤入预冷鸡尾酒杯。','表面刨少量肉豆蔻。')
add('americano','美式鸡尾酒','Americano','spritz','rocks','build','campari:30;sweet_vermouth:30;soda:?:splash','杯中放冰，加入金巴利和甜味美思。|加少量苏打水，轻轻拌匀。','半片橙子与柠檬皮。')
add('angel-face','天使之颜','Angel Face','spirit_forward','coupe','shake','gin:30;apricot_brandy:30;calvados:30','三种酒加冰摇和。|滤入冰镇鸡尾酒杯。',note='本参考版本明确摇和；不可被“全酒精配方一律搅拌”覆盖。')
add('aviation','飞行','Aviation','sour','coupe','shake','gin:45;maraschino:15;lemon:15;creme_violette:1:barspoon','全部材料加冰摇和。|滤入预冷鸡尾酒杯。','樱桃可选。')
add('bees-knees','蜜蜂之膝','Bee’s Knees','sour','coupe','shake','gin:52.5;honey_syrup:2:tsp;lemon:22.5;orange_juice:22.5','先将蜂蜜糖浆和两种果汁混匀。|加入金酒与冰块摇和，再滤入杯中。','柠檬皮或橙皮，可选。','此 IBA 网页版本含橙汁；与常见不含橙汁版本并存，不擅自删除。')
add('bellini','贝利尼','Bellini','spritz','flute','stir_gently','prosecco:100;peach_puree:50','将桃泥与起泡酒放入加冰的调酒杯，轻柔混合。|滤入预冷笛形杯。')
add('between-the-sheets','床笫之间','Between the Sheets','sour','coupe','shake','white_rum:30;cognac:30;triple_sec:30;lemon:20','全部材料加冰摇和。|滤入预冷鸡尾酒杯。')
add('black-russian','黑俄罗斯','Black Russian','spirit_forward','rocks','build','vodka:50;coffee_liqueur:20','在加冰的古典杯中加入伏特加和咖啡利口酒。|轻轻搅匀。')
add('bloody-mary','血腥玛丽','Bloody Mary','savory','highball','stir_gently','vodka:45;tomato_juice:90;lemon:15;worcestershire:2:dash;hot_sauce:?:to_taste;celery_salt:?:to_taste;black_pepper:?:to_taste','材料在调酒杯中加冰轻柔混合。|移入饮用杯；加冰饮用可选高球杯。','芹菜与柠檬，可选。','调味材料及装饰需要额外过敏原核对。')
add('boulevardier','花花公子','Boulevardier','spirit_forward','coupe','stir','bourbon:45;campari:30;sweet_vermouth:30','材料在调酒杯中加冰搅拌。|滤入冰镇鸡尾酒杯。','橙皮；柠檬皮可选。','基酒允许黑麦威士忌替代；替换后另存版本。')
add('bramble','荆棘','Bramble','sour','rocks','shake','gin:50;lemon:25;sugar_syrup:12.5;blackberry_liqueur:15','金酒、柠檬汁和糖浆加冰摇和。|滤入装碎冰的杯中，最后环绕淋入黑莓利口酒。','柠檬片与黑莓，可选。')
add('caipirinha','凯匹林纳','Caipirinha','sour','rocks','muddle_build','cachaca:60;lime_fruit:1:whole;sugar:4:tsp','青柠切角，与糖在杯中轻捣。|加入碎裂冰及卡莎萨，轻轻混合。')
add('cardinale','红衣主教','Cardinale','spirit_forward','coupe','stir','gin:40;dry_vermouth:20;campari:10','材料加冰搅拌至冷。|滤入鸡尾酒杯。','柠檬皮。')
add('clover-club','三叶草俱乐部','Clover Club','sour','coupe','shake','gin:45;raspberry_syrup:15;lemon:15;egg_white:?:few_drops','材料加冰充分摇和。|滤入冰镇鸡尾酒杯。','新鲜覆盆子。','原页蛋清仅写数滴，不自动改成一整颗；商用配制另行确认。')
add('corpse-reviver-2','亡者复苏二号','Corpse Reviver #2','sour','coupe','shake','gin:30;cointreau:30;lillet_blanc:30;lemon:30;absinthe:1:dash','材料加冰摇和。|滤入冰镇鸡尾酒杯。','橙皮。')
add('cosmopolitan','大都会','Cosmopolitan','sour','coupe','shake','citron_vodka:40;cointreau:15;lime:15;cranberry:30','材料加冰摇和。|滤入较大的鸡尾酒杯。','柠檬皮卷。')
add('cuba-libre','自由古巴','Cuba Libre','highball','highball','build','white_rum:50;cola:120;lime:10','高球杯装冰，加入朗姆酒与青柠汁。|倒入可乐并轻轻混合。','青柠角。')
add('daiquiri','戴吉利','Daiquiri','sour','coupe','shake','white_rum:60;lime:20;sugar:2:barspoon','先将细糖与液体充分混合溶解。|加入冰块摇和，滤入预冷鸡尾酒杯。')
add('dark-n-stormy','黑暗暴风雨','Dark ’N’ Stormy','highball','highball','build_float','goslings_rum:60;ginger_beer:100','高球杯装冰，先倒入姜汁啤酒。|将朗姆酒缓缓淋在上层。','青柠角或片。','本参考页指定 Goslings，青柠为装饰而非配方中的青柠汁。')
add('dry-martini','干马天尼','Dry Martini','spirit_forward','martini','stir','gin:60;dry_vermouth:10','金酒与干味美思加冰搅拌。|滤入冰镇马天尼杯。','挤柠檬皮油；也可按客人要求用绿橄榄。')
add('espresso-martini','浓缩咖啡马天尼','Espresso Martini','sourless_shaken','coupe','shake','vodka:50;kahlua:30;sugar_syrup:10;espresso:1:serving','所有材料加冰摇和。|滤入预冷鸡尾酒杯。','三颗咖啡豆。','浓缩咖啡原页按一份计量，毫升数需在调制版本中确定。')
add('french-75','法国75','French 75','spritz','flute','shake_top','gin:30;lemon:15;sugar_syrup:15;champagne:60','前三种材料加冰摇和后滤入笛形杯。|加入香槟，轻轻混合；香槟不进入摇壶。')
add('french-connection','法国连接','French Connection','spirit_forward','rocks','build','cognac:35;amaretto:35','古典杯装冰，倒入两种酒。|轻轻搅匀。')
add('french-martini','法式马天尼','French Martini','sourless_shaken','coupe','shake','vodka:45;raspberry_liqueur:15;pineapple:15','材料加冰摇和。|滤入预冷鸡尾酒杯。','挤少量柠檬皮油。','此网页菠萝汁为15 ml，勿以其他流行版本覆盖。')
add('garibaldi','加里波第','Garibaldi','highball','highball','build','campari:45;orange_juice:120','高球杯加冰，加入金巴利与橙汁。|轻轻混合。','橙角。')
add('gin-basil-smash','罗勒金酒司马殊','Gin Basil Smash','sour','coupe','shake','gin:60;lemon:22.5;sugar_syrup:22.5;basil:10:leaf','材料加冰有力摇和。|滤入冰镇鸡尾酒杯。')
add('gin-fizz','金酒菲士','Gin Fizz','highball','highball','shake_top','gin:45;lemon:30;simple_syrup:10;soda:?:splash','金酒、柠檬汁和糖浆加冰摇和。|滤入薄壁杯，最后加入少量苏打水。','柠檬片，柠檬皮可选。','来源指定成杯不留冰。')
add('grasshopper','蚱蜢','Grasshopper','creamy','coupe','shake','creme_cacao_white:20;creme_menthe_green:20;cream:20','材料加冰短时摇和。|滤入预冷鸡尾酒杯。','薄荷叶，可选。')
add('hanky-panky','汉基潘基','Hanky Panky','spirit_forward','coupe','stir','gin:45;sweet_vermouth:45;fernet:7.5','全部材料加冰搅拌。|滤入预冷鸡尾酒杯。','橙皮。')
add('horses-neck','马颈','Horse’s Neck','highball','highball','build','cognac:40;ginger_ale:120;angostura:1:dash','杯中放冰，加入干邑和姜汁汽水，轻轻混合。|可按需要加芳香苦精。','较长的螺旋柠檬皮。')
add('irish-coffee','爱尔兰咖啡','Irish Coffee','hot','mug','build_float','irish_whiskey:50;hot_coffee:120;cream:50;sugar:1:tsp','预热咖啡杯，将热咖啡、威士忌和糖混合至糖溶解。|沿匙背缓慢加入冰凉奶油，使其停留在表面。')
add('john-collins','约翰·柯林斯','John Collins','highball','highball','build','gin:45;lemon:30;simple_syrup:15;soda:60','全部液体加入装冰高球杯。|轻轻混合，避免使苏打水过度消泡。','柠檬片与鸡尾酒樱桃。')
add('jungle-bird','丛林鸟','Jungle Bird','tropical','rocks','shake','blackstrap_rum:45;campari:22.5;pineapple:45;lime:15;demerara_syrup:15','材料加冰摇和。|滤入装冰古典杯。','菠萝角。')
add('kir','基尔','Kir','wine','goblet','build','white_wine:90;cassis:10','先在杯中倒入黑加仑利口酒。|再加入干白葡萄酒。')
add('last-word','最后的话','Last Word','sour','coupe','shake','gin:22.5;green_chartreuse:22.5;maraschino:22.5;lime:22.5','材料加冰摇和。|滤入冰镇鸡尾酒杯。')
add('lemon-drop-martini','柠檬滴马天尼','Lemon Drop Martini','sour','martini','shake','vodka:30;triple_sec:20;lemon:15','材料加冰摇和。|滤入冰镇鸡尾酒杯。')
add('long-island-iced-tea','长岛冰茶','Long Island Iced Tea','highball','highball','build','vodka:15;tequila:15;white_rum:15;gin:15;cointreau:15;lemon:25;simple_syrup:30;cola:?:to_top','在装冰高球杯中加入酒、柠檬汁与糖浆。|最后补入可乐并轻轻混合。','柠檬片，可选。','此参考版本糖浆30 ml，采用兑和；与聊天中的家用摇和版本不同。')
add('mai-tai','迈泰','Mai-Tai','tropical','rocks','shake','jamaican_rum:30;martinique_molasses_rum:30;orange_curacao:15;orgeat:15;lime:30;simple_syrup:7.5','材料加冰摇和。|倒入双份古典杯，也可使用高球杯。','菠萝条、薄荷与青柠皮。','来源特别使用马提尼克糖蜜朗姆酒，不自动等同农业朗姆。')
add('manhattan','曼哈顿','Manhattan','spirit_forward','coupe','stir','rye:50;sweet_vermouth:20;angostura:1:dash','材料加冰搅拌。|滤入预冷鸡尾酒杯。','鸡尾酒樱桃。')
add('margarita','玛格丽特','Margarita','sour','coupe','shake','tequila:50;triple_sec:20;lime:15','材料加冰摇和。|滤入预冷鸡尾酒杯。','可做半圈盐边。','来源要求100%龙舌兰原料酒；杯边盐不等于酒体溶解盐浓度。')
add('martinez','马丁内斯','Martinez','spirit_forward','coupe','stir','gin:45;sweet_vermouth:45;maraschino:1:barspoon;orange_bitters:2:dash','材料加冰搅拌。|滤入预冷鸡尾酒杯。','柠檬皮。')
add('mimosa','含羞草','Mimosa','spritz','flute','build','orange_juice:75;prosecco:75','先将橙汁倒入笛形杯。|加入起泡酒，轻轻混合。','橙皮卷，可选。')
add('mojito','莫吉托','Mojito','highball','highball','muddle_build','white_rum:45;lime:20;mint:6:sprig;sugar:2:tsp;soda:?:to_top','将薄荷、青柠汁和糖轻柔混合，加入少许苏打水。|放冰及朗姆酒，用剩余苏打水补足后轻轻混匀。','薄荷枝与青柠片。','原页写6枝薄荷，不是6片叶；使用时须定义实际份量。')
add('moscow-mule','莫斯科骡子','Moscow Mule','highball','mug','build','vodka:45;ginger_beer:120;lime:10','在骡子杯或古典杯中配合冰块加入材料。|轻轻混合。','青柠片。','原出处指定Smirnoff伏特加；SKU记录保留品牌。')
add('naked-and-famous','赤裸与名流','Naked and Famous','sour','coupe','shake','mezcal:22.5;yellow_chartreuse:22.5;aperol:22.5;lime:22.5','材料加冰摇和。|滤入预冷鸡尾酒杯。')
add('negroni','内格罗尼','Negroni','spirit_forward','rocks','build','gin:30;campari:30;sweet_vermouth:30','预冷古典杯并放冰，加入三种酒。|轻轻搅匀。','半片橙子。')
add('new-york-sour','纽约酸','New York Sour','sour','rocks','shake_float','rye:60;simple_syrup:22.5;lemon:30;egg_white:?:few_drops;red_wine:15','除红葡萄酒外的材料加冰摇和。|滤入装冰古典杯，再沿匙背缓慢淋上红酒。','柠檬皮或橙皮，以及樱桃。','威士忌可选波本；来源红酒选西拉或马尔贝克。')
add('old-cuban','老古巴','Old Cuban','spritz','coupe','shake_top','mint:?:leaf;aged_rum:45;lime:22.5;simple_syrup:30;angostura:2:dash;champagne:60','除起泡酒外的材料加冰摇和。|滤入鸡尾酒杯，再加入干型起泡酒。','薄荷枝。','薄荷为6–8片叶；香槟可换普罗塞克。')
add('old-fashioned','古典','Old Fashioned','spirit_forward','rocks','build','bourbon:45;sugar_cube:1:cube;angostura:?:few_dashes;water:?:few_dashes','方糖在杯中以苦精和少量水润湿并捣至溶解。|加入冰块及威士忌，轻轻混合。','橙片或橙皮与樱桃。','基酒可选黑麦威士忌；方糖及dash须在操作规格中校准。')
add('paloma','帕洛玛','Paloma','highball','highball','build','tequila:50;lime:5;salt:1:pinch;grapefruit_soda:100','高球杯中混合龙舌兰、青柠汁和盐，加入冰。|倒入西柚汽水，轻轻混合。','青柠片。','来源要求100%龙舌兰原料酒。')
add('paper-plane','纸飞机','Paper Plane','sour','coupe','shake','bourbon:30;amaro_nonino:30;aperol:30;lemon:30','全部材料加冰摇和。|滤入预冷鸡尾酒杯。')
add('penicillin','盘尼西林','Penicillin','sour','rocks','shake_float','blended_scotch:60;islay_scotch:7.5;lemon:22.5;honey_syrup:22.5;fresh_ginger:?:slice','在摇壶内捣鲜姜；加入除艾雷岛威士忌外的材料及冰摇和。|细滤入装冰古典杯，最后漂浮艾雷岛威士忌。','糖渍姜。','来源为2–3片约硬币大小鲜姜；漂浮酒指定Lagavulin 16。')
add('pina-colada','椰林飘香','Piña Colada','tropical','hurricane','blend','white_rum:50;coconut_cream:30;pineapple:50','材料与冰一同放入搅拌机打匀。|倒入较大的酒杯。','菠萝片与鸡尾酒樱桃。','椰子原料的脂肪和糖差异大；不可把椰奶与甜椰浆无提示互换。')
add('pisco-sour','皮斯科酸','Pisco Sour','sour','goblet','shake','pisco:60;lemon:30;simple_syrup:20;egg_white:1:whole;amargo_bitters:?:few_dashes','除装饰苦精外的材料加冰摇和。|滤入冰镇杯中，最后点上苦精。','少量阿玛戈苦精。')
add('rusty-nail','锈钉','Rusty Nail','spirit_forward','rocks','build','scotch:45;drambuie:25','古典杯中加入冰块和两种酒。|轻轻搅匀。','柠檬皮。')
add('sazerac','萨泽拉克','Sazerac','spirit_forward','rocks','stir_rinse','cognac:50;absinthe:10;sugar_cube:1:cube;peychaud:2:dash','用苦艾酒润洗并冷却古典杯。|其余材料另行加冰搅拌；倒掉饮用杯内的冰及多余苦艾酒，再滤入调好的酒液。','柠檬皮。','苦艾酒10 ml是洗杯投入量，不是全部饮用留存量；留存量未知。')
add('sidecar','边车','Sidecar','sour','coupe','shake','cognac:50;triple_sec:20;lemon:20','材料加冰摇和。|滤入预冷鸡尾酒杯。')
add('singapore-sling','新加坡司令','Singapore Sling','tropical','hurricane','shake','gin:30;cherry_sangue_morlacco:15;cointreau:7.5;benedictine:7.5;pineapple:120;lime:15;grenadine:10;angostura:1:dash','全部材料加冰摇和。|滤入飓风杯。','菠萝与马拉斯奇诺樱桃。','此网页樱桃酒为Cherry Sangue Morlacco；不冒充用户笔记中的Heering版本。')
add('spritz','斯普利兹','Spritz','spritz','goblet','build','prosecco:90;aperol:60;soda:?:splash','葡萄酒杯中放冰，加入普罗塞克及阿佩罗。|加入少量苏打水，轻轻混合。','橙片。')
add('whiskey-sour','威士忌酸','Whiskey Sour','sour','rocks','shake','bourbon:45;lemon:25;sugar_syrup:20;egg_white:?:few_drops','材料加冰摇和；使用蛋清时充分摇匀。|滤入饮用杯，也可使用装冰的古典杯。','半片橙子与樱桃，也可橙皮。','蛋清可选；参考版本与聊天60/30/15版本不同。')

add('appletini','苹果马天尼','Appletini','sour','martini','shake','vodka:45;apple_juice:45;lime:5;maple_syrup:5','材料加冰摇和。|滤入预冷杯中。',personal=True)
add('el-diablo','魔鬼','El Diablo','highball','highball','shake_top','tequila:45;cassis:15;lime:15;ginger_beer:90','前三种材料加冰摇和，滤入装冰高球杯。|最后加入姜汁啤酒，轻轻混合。',note='姜汁汽水为原笔记允许的替代品；不同品牌甜度需重估。',personal=True)
add('chimayo','奇马约','Chimayó','sour','rocks','shake','tequila:45;apple_juice:30;cassis:10;lemon:15','材料加冰摇和。|滤入饮用杯。',note='原笔记也写苹果西打；是否含酒精取决于产品，不能自动设为0%。',personal=True)
add('godfather','教父','Godfather','spirit_forward','rocks','stir','scotch:60;amaretto:15','两种酒加冰搅拌。|滤入放有新冰块的古典杯。',personal=True)
add('not-so-dark-but-stormy','不那么黑暗的暴风雨','Not So Dark, But Stormy','highball','highball','build','rum:30;lime:15;ginger_beer:150','高球杯装冰，加入朗姆酒与青柠汁。|加入姜汁啤酒，轻轻混合。',personal=True)
add('espresso-cream','浓缩咖啡马天尼·奶油笔记版','Espresso Martini — notebook cream variant','sourless_shaken','coupe','shake','coffee_liqueur:30;vodka:30;espresso:30;irish_cream:7.5','全部材料加冰摇和。|滤入预冷鸡尾酒杯。',personal=True)
add('bramble-cassis','荆棘·黑加仑替代版','Bramble — cassis variant','sour','rocks','shake','gin:45;lemon:22.5;semi_rich_syrup:15;cassis:15','金酒、柠檬汁和糖浆加冰摇和。|滤入装碎冰的杯中，再淋上黑加仑利口酒。',personal=True)
add('margarita-notebook','玛格丽特·笔记版','Margarita — notebook variant','sour','coupe','shake','tequila:2:oz;triple_sec:1:oz;lime:1:oz','材料加冰摇和。|滤入预冷杯中，可做半边盐口。',note='原文以oz计量；必须先确定量杯制式，不能无提示按精确30 ml换算。',personal=True)
add('daiquiri-notebook','戴吉利·笔记版','Daiquiri — notebook variant','sour','coupe','shake','white_rum:50;lime:25;sugar_syrup:10','材料加冰摇和。|滤入冰镇杯中。','青柠轮。',personal=True)
add('old-fashioned-simple','古典·简化笔记版','Old Fashioned — simplified notebook variant','spirit_forward','rocks','stir','whisky:60;simple_syrup:15;angostura:4:dash','材料加冰搅拌至冰冷。|滤入放有新冰块的古典杯。',personal=True)

BY={r['id']:r for r in REC}
def modify(rid, iid, **kw):
    next(i for i in BY[rid]['ingredients'] if i['ingredient_id']==iid).update(kw)
# Keep sequence semantics machine-readable, not only prose.
for r in REC:
    for i in r['ingredients']:
        if ING[i['ingredient_id']]['role'] in ('carbonated','sparkling_wine'):
            i['stage']='top'
modify('iba_boulevardier','bourbon',allowed_alternatives=['rye'])
modify('iba_new_york_sour','rye',allowed_alternatives=['bourbon'])
modify('iba_old_fashioned','bourbon',allowed_alternatives=['rye'])
modify('iba_old_cuban','champagne',allowed_alternatives=['prosecco'])
modify('iba_horses_neck','angostura',optional=True,stage='finish')
modify('iba_whiskey_sour','egg_white',optional=True)
modify('iba_bramble','blackberry_liqueur',stage='float')
modify('note_bramble_cassis','cassis',stage='float')
modify('iba_dark_n_stormy','goslings_rum',stage='float')
modify('iba_new_york_sour','red_wine',stage='float',quantity_note='西拉或马尔贝克')
modify('iba_irish_coffee','cream',stage='float')
modify('iba_penicillin','islay_scotch',stage='float',quantity_note='来源指定Lagavulin 16')
modify('iba_penicillin','fresh_ginger',quantity_note='2–3片约硬币大小的鲜姜',quantity_range=[2,3])
modify('iba_old_cuban','mint',quantity_note='6–8片叶',quantity_range=[6,8])
modify('iba_pisco_sour','amargo_bitters',stage='garnish')
modify('iba_sazerac','absinthe',stage='rinse',retained_ml=None)
modify('note_el_diablo','ginger_beer',allowed_alternatives=['ginger_ale'])
modify('note_chimayo','apple_juice',allowed_alternatives=['apple_cider'])

TASTE_AXES=['sweet','sour','bitter','salty','umami']
SENSORY_AXES=['alcohol_heat','aroma','body','carbonation','cooling','spiciness','finish']
# Family prototypes used only as edit-starting values. These do not come from IBA.
PROTO={
 'sour':([5,7,1,0,0],[5,6,4,0,1,0,5]),
 'spirit_forward':([4,0,4,0,0],[7,7,5,0,1,0,7]),
 'highball':([5,4,1,0,0],[3,5,3,7,2,0,4]),
 'spritz':([4,3,3,0,0],[3,5,3,7,2,0,4]),
 'creamy':([7,0,1,0,0],[3,6,8,0,1,0,6]),
 'savory':([2,4,1,5,7],[3,5,5,0,1,4,6]),
 'hot':([4,0,4,0,0],[5,7,6,0,0,0,7]),
 'wine':([5,4,1,0,0],[3,5,3,0,1,0,4]),
 'tropical':([7,5,1,0,0],[4,7,6,0,2,0,6]),
 'sourless_shaken':([6,2,2,0,0],[4,6,5,0,1,0,5])}
OVERRIDE={
'iba_negroni':([5,0,8,0,0],[7,7,5,0,1,0,8]),
'iba_dry_martini':([1,0,2,0,0],[8,8,3,0,1,0,7]),
'iba_angel_face':([6,2,1,0,0],[7,7,5,0,1,0,6]),
'iba_black_russian':([6,0,4,0,0],[7,6,6,0,1,0,7]),
'iba_espresso_martini':([5,2,6,0,0],[5,8,5,0,1,0,7]),
'iba_hanky_panky':([5,0,7,0,0],[7,8,5,0,1,1,8]),
'iba_mojito':([5,5,1,0,0],[3,7,3,7,5,0,4]),
'iba_paloma':([4,5,3,2,0],[3,6,3,7,2,0,5]),
'iba_penicillin':([5,6,1,0,0],[6,8,4,0,1,5,8]),
'iba_pina_colada':([8,3,0,0,0],[3,7,8,0,2,0,6]),
'iba_grasshopper':([8,0,1,0,0],[3,7,8,0,6,0,6]),
'iba_jungle_bird':([6,5,6,0,0],[5,7,5,0,1,0,7]),
'note_appletini':([5,4,0,0,0],[4,5,3,0,1,0,4]),
'note_godfather':([6,0,1,0,0],[7,7,5,0,1,0,7]),
'note_not_so_dark_but_stormy':([5,4,1,0,0],[2,5,3,7,2,4,4]),
'note_el_diablo':([6,5,1,0,0],[3,6,3,7,2,4,5])}
def bps(v):
    f=[Fraction(str(x)) for x in v]; s=sum(f)
    z=[x*10000/s for x in f]; base=[int(x) for x in z]
    for j in sorted(range(5),key=lambda j:(-(z[j]-base[j]),j))[:10000-sum(base)]: base[j]+=1
    return base
PROFILES=[]
for r in REC:
    t,s=OVERRIDE.get(r['id'],PROTO[r['family']])
    PROFILES.append(dict(recipe_id=r['id'],taste_axes=TASTE_AXES,taste_intensity_0_10=t,
        taste_preference_bps=bps(t), sensory_axes=SENSORY_AXES,sensory_0_10=s,
        status='heuristic_unvalidated', confidence='low',
        origin='editorial_family_prior_plus_selected_overrides',
        measured=False, source_recipe_does_not_supply_these_scores=True,
        note_zh='仅供交互和排序冷启动，不是实测，不可宣称人类味觉贡献比例或精确口味。'))

dump('data/ingredients.json',{'schema_version':'0.1.0','ingredients':list(ING.values())})
dump('data/recipes.json',{'schema_version':'0.1.0','snapshot_date':STAMP,'recipe_count':len(REC),'recipes':REC})
dump('data/profiles.seed.json',{'schema_version':'0.1.0','status':'heuristic_unvalidated','profiles':PROFILES})
dump('data/sources.json',{'checked_on':STAMP,'sources':[dict(recipe_id=r['id'],**r['source']) for r in REC],
    'rights_note':'仅摘录配料事实并独立中文改写操作，不包含原站图文、品牌图片或字体。引用不等于商业数据库再分发授权；公开发版需完成权利审查。'})
# A readable companion catalogue, not a second untraceable dataset.
rows=['# 首批酒谱索引\n','60份IBA参考版本 + 10份个人笔记版本。全部未经本项目实体试调；口味先验另存。\n',
      '|序号|中文名|英文名|来源类型|配料（保留原量纲）|','|---:|---|---|---|---|']
for n,r in enumerate(REC,1):
    items=[]
    for i in r['ingredients']:
        q=i['quantity']; q='待定' if q is None else str(q)
        items.append(f"{ING[i['ingredient_id']]['name_zh']} {q} {i['unit']}")
    rows.append(f"|{n}|{r['name_zh']}|{r['name_en']}|{r['source']['kind']}|{'；'.join(items)}|")
(ROOT/'docs/酒谱索引.md').write_text('\n'.join(rows)+'\n',encoding='utf-8')
print(f'Built {len(REC)} recipes, {len(ING)} ingredient types, {len(PROFILES)} unvalidated profiles.')
if __name__=='__main__':
    assert len(REC)==70
