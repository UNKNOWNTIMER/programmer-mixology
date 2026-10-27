"""Independent offline relational/provenance audit of the shipped catalog pack.

Does not rewrite seed files and does not connect to the network. JSON Schema and
database upgrade behavior are additionally covered by cargo test pixelmix-catalog.
"""
import hashlib
import json
from pathlib import Path

root=Path(__file__).resolve().parents[2]
product=root/'product'
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
path=product/'data/catalog/iba-completion-2026-09-21.json'
pack=read(path)
review=read(product/'data/catalog/source-review-2026-09-21.json')
errors=[]
def check(condition,message):
    if not condition: errors.append(message)

base={}
combined={}
for table,file in [('recipes','recipes.json'),('ingredients','ingredients.json'),('profiles','profiles.seed.json'),('sources','sources.json')]:
    base[table]=read(root/'data'/file)[table]
    public_rows=read(product/'apps/client/public/seed'/file)[table]
    # This historical audit covers the immutable 70+42 prefix. The later
    # community pack has its own complete 300-row audit.
    combined[table]=public_rows[:len(base[table])+len(pack[table][table])]
    key='id' if table in ('recipes','ingredients') else 'recipe_id'
    ids=[r[key] for r in combined[table]]
    check(len(ids)==len(set(ids)),f'duplicate IDs in {table}')
    check(combined[table]==base[table]+pack[table][table],f'base-plus-pack mismatch in {table}')
    check(all(r in combined[table] for r in base[table]),f'base facts changed in {table}')
recipes=combined['recipes'];ingredient_ids={i['id'] for i in combined['ingredients']}
recipe_ids={r['id'] for r in recipes}
for table in ('profiles','sources'):
    check({r['recipe_id'] for r in combined[table]}==recipe_ids,f'{table} missing recipe links')
for r in recipes:
    check(r['default_orderable'] is False and r['needs_serving_configuration'] is True,f"unsafe orderability {r['id']}")
    check(r['actual_user_rating'] is None,f"seed fabricated review {r['id']}")
    for i in r['ingredients']:
        check(i['ingredient_id'] in ingredient_ids,f"unknown ingredient {r['id']}")
        check(all(a in ingredient_ids for a in i['allowed_alternatives']),f"unknown substitute {r['id']}")
        if i['unit']=='unknown':
            check(i['quantity'] is None and bool(i['quantity_note']),f"unknown unit was fabricated {r['id']}")
        if 'quantity_range' in i:
            check(i['quantity'] is None and i['quantity_range'][0]<=i['quantity_range'][1],f"range flattened {r['id']}")
for p in combined['profiles']:
    check(len(p['taste_preference_bps'])==5 and sum(p['taste_preference_bps'])==10000 and all(type(v) is int and 0<=v<=10000 for v in p['taste_preference_bps']),f"invalid taste {p['recipe_id']}")
    check(len(p['sensory_0_10'])==7 and all(0<=v<=10 for v in p['sensory_0_10']),f"invalid sensory {p['recipe_id']}")
    check(p['status']=='heuristic_unvalidated' and p['measured'] is False,f"false measurement {p['recipe_id']}")
for i in combined['ingredients']:
    check(all(i[field] is None for field in ['abv_fraction','sugar_g_per_100ml','kcal_per_100ml','density_g_per_ml','acidity_g_per_l']),f"unverified nutrition {i['id']}")
for r in pack['recipes']['recipes']:
    entries=[x for x in review['checks'] if x['recipe_id']==r['id']]
    digest=hashlib.sha256(json.dumps(r,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    check(len(entries)==1 and entries[0]['facts_sha256']==digest and entries[0]['source_url']==r['source']['url'],f"source review mismatch {r['id']}")
    check(r['source']['url'].startswith('https://iba-world.com/iba-cocktail/') and r['source']['checked_on']=='2026-09-21',f"invalid source {r['id']}")
check(len(pack['recipes']['recipes'])==42,'expected 42 appended source recipes')
check(sum(r['source']['kind']=='official_recipe' for r in recipes)==102,'expected 102 IBA references')
check(sum(r['source']['kind']=='user_note' for r in recipes)==10,'expected 10 preserved private notes')
result=dict(status='PASS' if not errors else 'FAIL',scope='offline structural consistency; not remote website recheck or physical tasting',
    recipe_count=len(recipes),added_recipes=len(pack['recipes']['recipes']),official_recipes=102,private_notes=10,
    ingredient_count=len(ingredient_ids),new_ingredients=len(pack['ingredients']['ingredients']),
    source_pages_checked=42,unknown_unit_lines=sum(i['unit']=='unknown' for r in recipes for i in r['ingredients']),
    side_serving_lines=sum(i['stage']=='side' for r in recipes for i in r['ingredients']),
    pack_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
    original_file_sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [root/'data'/name for name in ['recipes.json','ingredients.json','profiles.seed.json','sources.json']]},errors=errors)
dest=product/'evidence/catalog-extension-audit.json'
dest.parent.mkdir(parents=True,exist_ok=True)
dest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
raise SystemExit(bool(errors))
