from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
import copy
import json
from pathlib import Path
import random
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from reference.core import allocate,redistribute_bps,match_index,estimate_abv,validate_bps
from reference.ticket_store import TicketStore
from reference.ascii_glass import TEMPLATES,render
from agent.reference_agent import generate,name_with_local_model
from scripts.validate_seed import validate
ROOT=Path(__file__).resolve().parents[1]

class TasteTests(unittest.TestCase):
    def test_proportional_example(self):
        self.assertEqual(redistribute_bps([4000,3000,2000,500,500],0,6000),[6000,2000,1334,333,333])
    def test_all_other_zero(self):
        self.assertEqual(redistribute_bps([10000,0,0,0,0],0,6000),[6000,1000,1000,1000,1000])
    def test_locked(self):
        p=[4000,3000,2000,500,500]
        r=redistribute_bps(p,0,9000,[1]); self.assertEqual(r,[7000,3000,0,0,0])
    def test_only_active_unlocked(self):
        p=[4000,3000,2000,500,500]
        self.assertEqual(redistribute_bps(p,0,0,[1,2,3,4]),p)
    def test_locked_selection_rejected(self):
        with self.assertRaises(ValueError): redistribute_bps([2000]*5,1,3000,[1])
    def test_clamp_negative(self):
        self.assertEqual(redistribute_bps([2000]*5,0,-100)[0],0)
    def test_nan_and_noninteger_rejected(self):
        for bad in [float('nan'),3.5,True]:
            with self.assertRaises(ValueError): redistribute_bps([2000]*5,0,bad)
    def test_bad_total(self):
        with self.assertRaises(ValueError): validate_bps([1,2,3,4,5])
    def test_stable_tie(self):
        self.assertEqual(allocate(2,[1,1,1]),[1,1,0])
    def test_gesture_anchor_reversible(self):
        p=[1234,4567,890,1234,2075]
        redistribute_bps(p,2,9999)
        self.assertEqual(redistribute_bps(p,2,p[2]),p)
    def test_ten_thousand_random_invariants(self):
        rng=random.Random(812)
        for _ in range(10000):
            p=allocate(10000,[rng.randint(0,10000) for _ in range(5)])
            axis=rng.randrange(5); locks={j for j in range(5) if j!=axis and rng.random()<.35}
            r=redistribute_bps(p,axis,rng.randint(-5000,15000),locks)
            self.assertEqual(sum(r),10000)
            self.assertTrue(all(isinstance(x,int) and x>=0 for x in r))
            self.assertTrue(all(r[j]==p[j] for j in locks))
    def test_matching_identity(self):
        p=[2000]*5;s=[5]*7
        self.assertEqual(match_index(p,s,p,s)['index'],100)
        self.assertFalse(match_index(p,s,p,s)['calibrated'])
    def test_matching_opposite(self):
        self.assertEqual(match_index([10000,0,0,0,0],[0]*7,[0,10000,0,0,0],[10]*7)['index'],0)
    def test_invalid_sensory(self):
        with self.assertRaises(ValueError): match_index([2000]*5,[11]*7,[2000]*5,[0]*7)
    def test_unknown_physical(self):
        r=estimate_abv([{'consumed_ml':None,'abv_fraction':.4}],10)
        self.assertIsNone(r['abv_fraction'])
    def test_unknown_dilution(self):
        self.assertIsNone(estimate_abv([{'consumed_ml':60,'abv_fraction':.4}],None)['abv_fraction'])
    def test_abv_known(self):
        r=estimate_abv([{'consumed_ml':60,'abv_fraction':.4},{'consumed_ml':30,'abv_fraction':0}],30)
        self.assertAlmostEqual(r['abv_fraction'],.2);self.assertEqual(r['ethanol_ml'],24)
    def test_invalid_abv(self):
        with self.assertRaises(ValueError): estimate_abv([{'consumed_ml':60,'abv_fraction':1.2}],0)

class TicketTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=TicketStore(Path(self.tmp.name)/'state.sqlite')
        self.store.issue('guest','day','policy',1,10,100)
        self.snapshot={'recipe_revision_id':'v1','ingredients':[{'id':'gin','ml':45}]}
    def tearDown(self): self.tmp.cleanup()
    def count(self,table):
        c=self.store.connect()
        try:return c.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]
        finally:c.close()
    def test_atomic_spend(self):
        r=self.store.place('guest','id1','day','policy',self.snapshot,20)
        self.assertEqual(r['status'],'received');self.assertEqual(self.count('orders'),1);self.assertEqual(self.count('outbox'),1)
    def test_ack_lost_retry_same_order(self):
        a=self.store.place('guest','id1','day','policy',self.snapshot,20)
        b=self.store.place('guest','id1','day','policy',self.snapshot,200)
        self.assertEqual(a['id'],b['id']);self.assertEqual(self.count('orders'),1)
    def test_reuse_key_changed_payload(self):
        self.store.place('guest','id1','day','policy',self.snapshot,20)
        with self.assertRaisesRegex(ValueError,'IDEMPOTENCY_CONFLICT'):
            self.store.place('guest','id1','day','policy',{'recipe_revision_id':'v2'},21)
    def test_new_request_no_ticket(self):
        self.store.place('guest','id1','day','policy',self.snapshot,20)
        with self.assertRaisesRegex(ValueError,'NO_VALID_TICKET'):
            self.store.place('guest','id2','day','policy',self.snapshot,21)
    def test_expired_ticket(self):
        with self.assertRaises(ValueError): self.store.place('guest','id1','day','policy',self.snapshot,100)
    def test_before_window(self):
        with self.assertRaises(ValueError): self.store.place('guest','id1','day','policy',self.snapshot,9)
    def test_reconnect_does_not_reissue(self):
        self.store.place('guest','id1','day','policy',self.snapshot,20)
        self.store.issue('guest','day','policy',1,10,100)
        with self.assertRaises(ValueError): self.store.place('guest','id2','day','policy',self.snapshot,21)
    def test_snapshot_is_immutable_copy(self):
        r=self.store.place('guest','id1','day','policy',self.snapshot,20)
        self.snapshot['ingredients'][0]['ml']=99
        self.assertEqual(json.loads(r['snapshot_json'])['ingredients'][0]['ml'],45)
    def test_twenty_devices_last_ticket(self):
        def submit(n):
            try:return self.store.place('guest',f'id{n}','day','policy',self.snapshot,20)['id']
            except ValueError:return None
        with ThreadPoolExecutor(max_workers=20) as pool: result=list(pool.map(submit,range(20)))
        self.assertEqual(sum(x is not None for x in result),1);self.assertEqual(self.count('orders'),1)
    def test_same_request_twenty_retries(self):
        def submit(_):return self.store.place('guest','same','day','policy',self.snapshot,20)['id']
        with ThreadPoolExecutor(max_workers=20) as pool: result=list(pool.map(submit,range(20)))
        self.assertEqual(len(set(result)),1);self.assertEqual(self.count('outbox'),1)
    def test_event_failure_rolls_back_spend(self):
        c=self.store.connect()
        c.execute("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'injected_failure'); END;")
        c.close()
        with self.assertRaises(sqlite3.IntegrityError): self.store.place('guest','id1','day','policy',self.snapshot,20)
        self.assertEqual(self.count('orders'),0)
        c=self.store.connect();spent=c.execute('SELECT spent FROM grants').fetchone()[0];c.close()
        self.assertEqual(spent,0)
    def test_identity_required(self):
        with self.assertRaises(ValueError):self.store.place('','id1','day','policy',self.snapshot,20)

class AgentAndDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.req=json.loads((ROOT/'data/example_agent_request.json').read_text())
        cls.result=generate(cls.req)
    def test_full_seed_business_validation(self):
        self.assertEqual(validate()['recipes'],70)
    def test_candidate_generation(self):
        self.assertGreater(self.result['candidate_count'],0)
        self.assertFalse(self.result['chosen']['guest_orderable'])
        self.assertFalse(self.result['model_used'])
    def test_generation_deterministic(self):
        self.assertEqual(self.result,generate(self.req))
    def test_all_candidate_hard_constraints(self):
        for c in self.result['candidates']:
            self.assertLessEqual(c['ethanol_ml'],24)
            self.assertEqual(sum(c['predicted']['taste_bps']),10000)
            self.assertTrue(all(i['ingredient_id'] in self.req['inventory'] for i in c['ingredients']))
            self.assertIsNone(c['served_kcal'])
    def test_extreme_umami_not_faked(self):
        req=copy.deepcopy(self.req);req['taste_bps']=[0,0,0,0,10000]
        self.assertEqual(generate(req)['status'],'nearest_only')
    def test_exclusions(self):
        req=copy.deepcopy(self.req);req['excluded_ingredients']=['gin','vodka','scotch','tequila','white_rum']
        self.assertEqual(generate(req)['status'],'no_feasible_candidate')
    def test_no_inventory(self):
        req=copy.deepcopy(self.req);req['inventory']={}
        self.assertEqual(generate(req)['status'],'no_feasible_candidate')
    def test_unknown_abv_rejected(self):
        req=copy.deepcopy(self.req);req['inventory']['gin']['abv_fraction']=None
        with self.assertRaises(ValueError):generate(req)
    def test_unreviewed_allergens_rejected(self):
        req=copy.deepcopy(self.req);req['inventory']['gin']['allergens_reviewed']=False
        with self.assertRaises(ValueError):generate(req)
    def test_remote_model_endpoint_rejected(self):
        with self.assertRaises(ValueError): name_with_local_model(self.result,'https://example.com/v1','x')
    def test_llm_invalid_candidate_rejected_with_mock(self):
        choice={'candidate_id':'not-in-list','name_zh':'测试','name_en':'Test'}
        api=json.dumps({'choices':[{'message':{'content':json.dumps(choice)}}]}).encode()
        with patch('agent.reference_agent.build_opener') as opener:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value=api
            with self.assertRaises(ValueError):name_with_local_model(self.result,'http://127.0.0.1:8080/v1','mock')
    def test_llm_markup_name_rejected_with_mock(self):
        choice={'candidate_id':self.result['candidates'][0]['candidate_id'],'name_zh':'<script>','name_en':'Test'}
        api=json.dumps({'choices':[{'message':{'content':json.dumps(choice)}}]}).encode()
        with patch('agent.reference_agent.build_opener') as opener:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value=api
            with self.assertRaises(ValueError):name_with_local_model(self.result,'http://127.0.0.1:8080/v1','mock')
    def test_ascii_all_templates(self):
        self.assertEqual(len(TEMPLATES),8)
        for key in TEMPLATES:
            text=render(key);self.assertTrue(text.isascii());self.assertGreater(len(text),10);self.assertEqual(text,render(key))
    def test_invalid_ascii_template(self):
        with self.assertRaises(ValueError):render('javascript:alert(1)')

if __name__=='__main__':unittest.main()
