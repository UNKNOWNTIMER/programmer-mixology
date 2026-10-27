from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
def save(path,data):
    (ROOT/path).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def obj(properties, required=None):
    return {'type':'object','additionalProperties':False,'properties':properties,'required':list(properties) if required is None else required}
s={'type':'string'}; nullable_number={'type':['number','null'],'minimum':0}
ing=obj({
 'ingredient_id':{'type':'string','pattern':'^[a-z0-9_]+$'},'quantity':nullable_number,
 'unit':{'enum':['ml','oz','tsp','barspoon','dash','few_dashes','few_drops','splash','to_top','to_taste','whole','leaf','sprig','serving','cube','pinch','slice']},
 'optional':{'type':'boolean'},'stage':{'enum':['mix','top','float','rinse','garnish','finish']},
 'quantity_note':{'type':['string','null']},'allowed_alternatives':{'type':'array','items':s,'uniqueItems':True},
 'quantity_range':{'type':'array','items':{'type':'number','minimum':0},'minItems':2,'maxItems':2},
 'retained_ml':nullable_number},
 ['ingredient_id','quantity','unit','optional','stage','quantity_note','allowed_alternatives'])
source=obj({'kind':{'enum':['official_recipe','user_note']},'publisher':s,'url':{'type':['string','null']},
 'reference':s,'checked_on':{'type':'string','format':'date'},'method_provenance':{'enum':['source_paraphrase','editorial_template']}})
recipe=obj({'id':{'type':'string','pattern':'^(iba|note)_[a-z0-9_]+$'},'name_zh':s,'name_en':s,'variant':s,
 'family':s,'glass_template':{'enum':['rocks','coupe','highball','flute','martini','mug','goblet','hurricane']},
 'glass_template_provenance':{'const':'editorial_mapping'},'method':s,
 'ingredients':{'type':'array','items':ing,'minItems':1},'steps_zh':{'type':'array','items':s,'minItems':1},
 'garnish_zh':s,'notes_zh':s,'source':source,'preparation_review':{'const':'not_physically_tested'},
 'default_orderable':{'const':False},'needs_serving_configuration':{'const':True},'actual_user_rating':{'type':'null'},
 'prediction_profile_id':s})
schema=obj({'schema_version':{'const':'0.1.0'},'snapshot_date':{'type':'string','format':'date'},
 'recipe_count':{'type':'integer','minimum':1},'recipes':{'type':'array','items':recipe}})
schema.update({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'urn:pixelmix:seed-catalog:0.1.0',
 'title':'Seed catalog snapshot only; production revision schema must evolve separately'})
save('schemas/seed_catalog.schema.json',schema)
bps={'type':'array','items':{'type':'integer','minimum':0,'maximum':10000},'minItems':5,'maxItems':5,
 'description':'Business validator must additionally assert exact sum=10000.'}
sensory={'type':'array','items':{'type':'number','minimum':0,'maximum':10},'minItems':7,'maxItems':7}
profile=obj({'taste_bps':bps,'sensory_0_10':sensory})
profile['$schema']='https://json-schema.org/draft/2020-12/schema'
save('schemas/target_profile.schema.json',profile)
order=obj({'protocol_version':{'const':1},'request_id':{'type':'string','format':'uuid'},
 'recipe_revision_id':{'type':'string','minLength':1,'maxLength':100},
 'serving_spec_id':{'type':'string','minLength':1,'maxLength':100},
 'target_profile':profile,'units_count':{'const':1},'guest_note':{'type':'string','maxLength':300}})
order['$schema']='https://json-schema.org/draft/2020-12/schema'
order['description']='Server derives authenticated guest identity. A serving_spec_id is not proof of authorization; validate ownership/menu approval.'
save('schemas/order_request.schema.json',order)
choice=obj({'candidate_id':{'type':'string','pattern':'^[a-f0-9]{12}$'},
 'name_zh':{'type':'string','minLength':1,'maxLength':24},'name_en':{'type':'string','minLength':1,'maxLength':80}})
choice.update({'$schema':'https://json-schema.org/draft/2020-12/schema',
              'description':'Runtime must replace candidate_id constraints with an enum of the current validated candidates; reject markup/control characters.'})
save('schemas/model_choice.schema.json',choice)
save('agent/rules.v1.json',{'version':'reference-0.1.0','status':'engineering_heuristic_not_sensory_validation',
 'implemented_reference_families':['sour','highball','spirit_forward_limited'],
 'production_expansion_requires_review':['spritz','tropical','creamy','savory','milk_punch'],
 'rules':[
 {'id':'R01','severity':'error','rule':'Only approved food-grade ingredient IDs with reviewed SKUs.'},
 {'id':'R02','severity':'error','rule':'Hard exclusions and allergens override similarity score.'},
 {'id':'R03','severity':'error','rule':'Check stock, glass capacity and administrator ethanol ceiling.'},
 {'id':'R04','severity':'error','rule':'Carbonated ingredients are never shaken in a sealed shaker.'},
 {'id':'R05','severity':'error','rule':'Unknown ABV, dosing units, dilution or nutrition never become zero.'},
 {'id':'R06','severity':'error','rule':'Generated recipes need administrator review before guest ordering.'},
 {'id':'R07','severity':'warning','rule':'Source-specific preparation overrides family heuristics.'},
 {'id':'R08','severity':'error','rule':'Reject fire, nonfood chemicals and unapproved concentrates.'},
 {'id':'R09','severity':'error','rule':'LLM may select only current candidate IDs; amounts are recomputed.'},
 {'id':'R10','severity':'warning','rule':'Novelty and preference match are unvalidated indices, not taste guarantees.'}],
 'reference_dosing':{'sour_base_ml':[45,50,60],'sour_citrus_ml':[15,20,25],'sour_simple_syrup_ml':[10,15,20],
 'highball_base_ml':[30,45],'highball_mixer_ml':[90,120,150]},
 'note':'Reference implementation currently encodes these bounds in code. Production must load and version this ruleset with migrations/tests.'})
save('data/model_manifest.example.json',{'status':'NOT_DOWNLOADABLE_UNTIL_REVIEWED','allow_auto_download':False,
 'runtime':{'project':'ggml-org/llama.cpp','release_commit':None,'artifact_sha256':None},
 'candidates':[{'model_id':'Qwen/Qwen3.5-'+size,'official_card':'https://huggingface.co/Qwen/Qwen3.5-'+size,
   'proposed_quantization':'Q4_K_M','gguf_url':None,'gguf_sha256':None,'size_bytes':None,
   'license_review':'verify_official_card_and_quantized_artifact','backend_benchmarks':[]}
  for size in ['2B','4B','9B']]})
print('Wrote schemas and declarative rule/model contracts.')
