"""Independent read-only-in-data audit: exact 300 rows, preserved 112, provenance.
Writes only its evidence result. No HTTP or model calls.
"""
import collections
import hashlib
import json
import re
from pathlib import Path
P=Path(__file__).resolve().parents[1];R=P.parent
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
errors=[]
def check(x,message):
    if not x:errors.append(message)
first=read(P/'data/catalog/iba-completion-2026-09-21.json')
path=P/'data/catalog/community-188-2026-09-21.json';pack=read(path)
review=read(P/'data/catalog/community-source-review-2026-09-21.json')
docs={};preserved=0
for table,file in [('recipes','recipes.json'),('ingredients','ingredients.json'),('profiles','profiles.seed.json'),('sources','sources.json')]:
    old=read(R/'data'/file)[table]+first[table][table]
    docs[table]=read(P/'apps/client/public/seed'/file)[table]
    check(docs[table]==old+pack[table][table],f'public/native merge mismatch {table}')
    key='id' if table in ('recipes','ingredients') else 'recipe_id'
    check(len({x[key] for x in docs[table]})==len(docs[table]),f'duplicate {table} IDs')
    if table=='recipes':preserved=len(old)
check(sha(P/'data/catalog/iba-completion-2026-09-21.json')=='79c184b643a3a7d007571f204540efd469c3df1b202261488a82e57cbd6a9870','existing IBA pack changed')
recipes=docs['recipes'];new=pack['recipes']['recipes'];ids={r['id'] for r in recipes}
check(len(recipes)==300 and len(new)==188 and preserved==112,'exact recipe count mismatch')
check(len({r['name_en'].casefold() for r in recipes})==300,'duplicate drink names')
check(collections.Counter(r['source']['kind'] for r in recipes)=={'official_recipe':102,'user_note':10,'community_recipe':188},'wrong provenance distribution')
for table in ('profiles','sources'):check({x['recipe_id'] for x in docs[table]}==ids,f'{table} missing links')
ing={i['id'] for i in docs['ingredients']};checks={x['recipe_id']:x for x in review['checks']}
check(len(checks)==188,'missing source ledger')
for r in recipes:
    check(r['default_orderable'] is False and r['needs_serving_configuration'] is True and r['actual_user_rating'] is None,f'false order/review {r["id"]}')
    for part in r['ingredients']:
        check(part['ingredient_id'] in ing,f'missing ingredient {r["id"]}')
        if part['unit']=='unknown':check(part['quantity'] is None and bool(part['quantity_note']),f'fabricated unknown quantity {r["id"]}')
        if 'quantity_range' in part:check(part['quantity'] is None and len(part['quantity_range'])==2 and part['quantity_range'][0]<=part['quantity_range'][1],f'flattened range {r["id"]}')
for r in new:
    id=r['id'];entry=checks[id];source=r['source'];cdb_id=id[4:]
    check(source['url']==f'https://www.thecocktaildb.com/drink/{cdb_id}' and source['publisher']=='TheCocktailDB' and source['kind']=='community_recipe' and source['checked_on']=='2026-09-21',f'wrong source {id}')
    check(entry['lookup_url']==f'https://www.thecocktaildb.com/api/json/v1/1/lookup.php?i={cdb_id}',f'wrong API record {id}')
    check(bool(re.fullmatch('[0-9a-f]{64}',entry['response_sha256'])),f'missing HTTP digest {id}')
    digest=hashlib.sha256(json.dumps(r,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    check(digest==entry['facts_sha256'],f'reviewed fact hash mismatch {id}')
    check(len(r['ingredients'])==len(entry['ingredients']),f'source ingredient count changed {id}')
    for part,raw in zip(r['ingredients'],entry['ingredients']):
        check(raw['ingredient'] in part['quantity_note'],f'raw ingredient qualifier lost {id}')
        if raw['measure'] is None or not raw['measure'].strip():check(part['quantity'] is None,f'missing measure fabricated {id}')
        else:check(raw['measure'] in part['quantity_note'],f'raw measure lost {id}')
    check(bool(r['steps_zh']) and all(isinstance(s,str) and s.strip() for s in r['steps_zh']),f'empty paraphrase {id}')
for profile in docs['profiles']:
    taste=profile['taste_preference_bps'];sensory=profile['sensory_0_10']
    check(len(taste)==5 and sum(taste)==10000 and all(type(x)is int and 0<=x<=10000 for x in taste),f'invalid taste {profile["recipe_id"]}')
    check(len(sensory)==7 and all(0<=x<=10 for x in sensory),f'invalid sensory {profile["recipe_id"]}')
    check(profile['measured'] is False and profile['status']=='heuristic_unvalidated',f'false measurement {profile["recipe_id"]}')
    if profile['recipe_id'].startswith('cdb_'):check(profile['taste_intensity_0_10'] is None,f'unknown absolute intensity fabricated {profile["recipe_id"]}')
for i in docs['ingredients']:
    check(all(i[k] is None for k in ['abv_fraction','sugar_g_per_100ml','kcal_per_100ml','density_g_per_ml','acidity_g_per_l']),f'unknown physics fabricated {i["id"]}')
quotes=read(P/'apps/client/src/recipe-quotes.json')
check(set(quotes)==ids and len(set(quotes.values()))==300,'quotes not complete/unique')
check(all(isinstance(q,str) and q.strip() and '系统原创' not in q for q in quotes.values()),'quote missing or UI label leaked')
# A source-name mismatch alone is not enough to make a new drink. Detect equal
# normalized ingredient + dose lists even when names differ.
fingerprints=collections.defaultdict(list)
for r in recipes:
    key=tuple(sorted((x['ingredient_id'],str(x['quantity']),x['unit'],str(x.get('quantity_range'))) for x in r['ingredients'] if x['stage'] not in {'garnish','finish'}))
    fingerprints[key].append(r['id'])
duplicate_new=[group for group in fingerprints.values() if len(group)>1 and any(id.startswith('cdb_') for id in group)]
check(not duplicate_new,f'duplicate normalized formulas: {duplicate_new}')
byid={r['id']:r for r in new}
pink=next(i for i in byid['cdb_11936']['ingredients'] if i['stage']=='rinse')
check(pink['retained_ml'] is None,'Pink Gin rinse incorrectly counted as fully retained')
check(any(i.get('quantity_range')==[3,4] and i['quantity'] is None for i in byid['cdb_16250']['ingredients']),'Rum Runner range lost')
result=dict(status='FAIL' if errors else 'PASS',scope='offline normalization/provenance consistency; no physical tasting or remote recheck',recipes=300,preserved_recipes=112,new_recipes=188,official_IBA=102,private_notes=10,community_recipes=188,ingredients=len(ing),quotes=len(quotes),source_records_checked=len(checks),excluded_candidates=len(review['excluded_candidates']),unknown_unit_lines=sum(i['unit']=='unknown' for r in new for i in r['ingredients']),unknown_quantities=sum(i['quantity'] is None for r in new for i in r['ingredients']),duplicate_new_formulas=duplicate_new,pack_sha256=sha(path),errors=errors)
(P/'evidence').mkdir(parents=True,exist_ok=True)
(P/'evidence/catalog-300-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
raise SystemExit(bool(errors))
