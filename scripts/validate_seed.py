"""Strict basic business validation without third-party dependencies.
Full JSON Schema can additionally be exercised with a draft-2020-12 validator.
"""
from pathlib import Path
import json
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from reference.core import validate_bps,validate_sensory

def validate():
    data=json.loads((ROOT/'data/recipes.json').read_text(encoding='utf-8'))
    ingredients=json.loads((ROOT/'data/ingredients.json').read_text(encoding='utf-8'))['ingredients']
    profiles=json.loads((ROOT/'data/profiles.seed.json').read_text(encoding='utf-8'))['profiles']
    source_rows=json.loads((ROOT/'data/sources.json').read_text(encoding='utf-8'))['sources']
    recipes=data['recipes']; ids=[r['id'] for r in recipes]; iid={i['id'] for i in ingredients}
    assert len(ids)==len(set(ids))==data['recipe_count']==70
    assert len(iid)==len(ingredients)==101
    assert sum(r['source']['kind']=='official_recipe' for r in recipes)==60
    assert sum(r['source']['kind']=='user_note' for r in recipes)==10
    assert {p['recipe_id'] for p in profiles}==set(ids)
    assert len(source_rows)==70 and {s['recipe_id'] for s in source_rows}==set(ids)
    for r in recipes:
        assert r['name_zh'] and r['name_en'] and r['steps_zh']
        assert r['default_orderable'] is False and r['actual_user_rating'] is None
        assert r['preparation_review']=='not_physically_tested'
        if r['source']['kind']=='official_recipe':
            assert r['source']['url'].startswith('https://iba-world.com/iba-cocktail/')
        else: assert r['source']['url'] is None
        for i in r['ingredients']:
            assert i['ingredient_id'] in iid
            assert i['quantity'] is None or i['quantity']>0
            assert all(k in iid for k in i['allowed_alternatives'])
            if i['stage']=='rinse': assert 'retained_ml' in i
    for p in profiles:
        validate_bps(p['taste_preference_bps']); validate_sensory(p['sensory_0_10'])
        assert len(p['taste_intensity_0_10'])==5 and all(0<=x<=10 for x in p['taste_intensity_0_10'])
        assert p['status']=='heuristic_unvalidated' and p['measured'] is False
    return {'recipes':70,'official_versions':60,'personal_versions':10,'ingredient_types':101,
            'unvalidated_profiles':70,'source_records':70,'business_validation':'passed'}
if __name__=='__main__': print(json.dumps(validate(),ensure_ascii=False,indent=2))
