import { describe, expect, it } from 'vitest';
import { trialView } from './trial-view';
import golden from '../../../tests/fixtures/trial-result-golden.json';
import recipeData from '../public/seed/recipes.json';
import ingredientData from '../public/seed/ingredients.json';
import profileData from '../public/seed/profiles.seed.json';
import sourceData from '../public/seed/sources.json';
import type { Catalog } from './types';

const catalog = { schema_version: recipeData.schema_version, recipes: recipeData.recipes,
  ingredients: ingredientData.ingredients, profiles: profileData.profiles, sources: sourceData.sources } as unknown as Catalog;
// Deliberately untyped transport values let tests inject shapes JSON/Rust would reject.
type Wire = Record<string, any>;
function result(name: keyof typeof golden = 'sour'): Wire { return structuredClone(golden[name]); }
function deepFreeze(value: unknown) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
}

describe('Rust generation output to review-only UI contract', () => {
  it.each([
    ['sour', 'coupe', 'shake'],
    ['highball', 'highball', 'build'],
    ['spirit_forward', 'rocks', 'stir'],
  ] as const)('accepts actual %s engine output without inventing physical facts', (family, glass, method) => {
    const input = result(family), before = structuredClone(input);
    deepFreeze(input);
    const view = trialView(input, catalog);
    expect(input).toEqual(before);
    expect(view.recipe.glass_template).toBe(glass);
    expect(view.recipe.method).toBe(method);
    expect(view.recipe.ingredients.map(({ ingredient_id, quantity, unit, stage, optional }) =>
      ({ ingredient_id, quantity, unit, stage, optional }))).toEqual(input.chosen.ingredients);
    expect(view.recipe.steps_zh).toEqual(input.chosen.steps_zh);
    expect(view.recipe.default_orderable).toBe(false);
    expect(view.recipe.needs_serving_configuration).toBe(true);
    expect(view.recipe.preparation_review).toBe('requires_bartender_review');
    expect(view.recipe.source.kind).toBe('generated_trial');
    expect(view.recipe.source.url).toBeNull();
    expect(view.recipe.garnish_zh).toBe(''); // No invented garnish in the ASCII glass.
    expect(view.profile.taste_intensity_0_10).toBeNull();
    expect(view.profile.status).toBe('heuristic_unvalidated');
    expect(view.profile.measured).toBe(false);
    expect(view.profile.taste_preference_bps.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(view.profile.recipe_id).toBe(view.recipe.id);
    expect((view.audit.chosen as Wire).served_abv_fraction).toBeNull();
    expect((view.audit.chosen as Wire).served_kcal).toBeNull();
    expect(view.recipe.notes_zh).toContain('测试库存');
    expect(view.recipe).not.toHaveProperty('served_abv_fraction');
    expect(view).not.toHaveProperty('target');
  });

  it('accepts the actual Rust model-choice branch as names and selection only', () => {
    const selected = result('model_selected');
    const view = trialView(selected, catalog);
    expect(selected.model_used).toBe(true);
    expect(view.recipe.name_zh).toBe('契约测试试调');
    expect(view.recipe.source.publisher).toContain('辅助选择与命名');
    expect(selected.chosen.ingredients).toEqual(golden.sour.chosen.ingredients);
    expect(view.recipe.default_orderable).toBe(false);
    expect(view.profile.taste_preference_bps).toEqual(selected.chosen.predicted.taste_bps);
  });

  it('keeps an unreachable requested target separate from the nearest prediction', () => {
    const input = result('nearest_only'), view = trialView(input, catalog);
    expect(view.audit.status).toBe('nearest_only');
    expect(view.audit.target).toEqual(input.target);
    expect(view.profile.taste_preference_bps).not.toEqual(input.target.taste_bps);
    expect(view.recipe.notes_zh).toContain('不能实现当前目标');
  });

  it('accepts controller fallback metadata without claiming a model ran', () => {
    const input = result();
    input.fallback_reason = '本地模型未启动，已使用规则候选。';
    input.model_fallback_reason = input.fallback_reason;
    input.model_audit = { model_used: false, fallback_reason: input.fallback_reason };
    const view = trialView(input, catalog);
    expect(view.recipe.source.publisher).toBe('本地规则引擎');
    expect(view.audit.fallback_reason).toBe(input.fallback_reason);
  });

  it('freezes history by copying recipe arrays and the audit result independently', () => {
    const input = result(), view = trialView(input, catalog);
    input.chosen.ingredients[0].quantity = 999;
    input.chosen.steps_zh[0] = 'changed after import';
    input.target.taste_bps[0] = 9999;
    expect(view.recipe.ingredients[0].quantity).not.toBe(999);
    expect(view.recipe.steps_zh[0]).not.toBe('changed after import');
    expect(view.audit.target).toEqual(golden.sour.target);
    view.recipe.ingredients[0].quantity = 1;
    expect((view.audit.chosen as Wire).ingredients[0].quantity).toBe(golden.sour.chosen.ingredients[0].quantity);
  });
});

describe('untrusted or malformed trial result rejection', () => {
  it('rejects the actual no-feasible-candidate result', () => {
    expect(() => trialView(result('no_feasible_candidate'), catalog)).toThrow('未收到可载入');
  });
  it.each([NaN, Infinity, -Infinity, -1, 0, 500, 45.5, '45', null])('rejects invalid dose %s', quantity => {
    const input = result(); input.chosen.ingredients[0].quantity = quantity;
    expect(() => trialView(input, catalog)).toThrow('剂量');
  });
  it.each([
    ['catalog-only ingredient', (r: Wire) => { r.chosen.ingredients[0].ingredient_id = 'falernum'; }],
    ['unknown ingredient', (r: Wire) => { r.chosen.ingredients[0].ingredient_id = 'industrial_alcohol'; }],
    ['duplicate ingredient', (r: Wire) => { r.chosen.ingredients[1] = structuredClone(r.chosen.ingredients[0]); }],
    ['unrecognized unit', (r: Wire) => { r.chosen.ingredients[0].unit = 'oz'; }],
    ['optional dose', (r: Wire) => { r.chosen.ingredients[0].optional = true; }],
    ['missing stage', (r: Wire) => { delete r.chosen.ingredients[0].stage; }],
    ['extra ingredient authority', (r: Wire) => { r.chosen.ingredients[0].execute = 'command'; }],
    ['wrong family envelope', (r: Wire) => { r.chosen.ingredients[0].quantity = 180; }],
    ['unsupported family', (r: Wire) => { r.chosen.family = 'milk_punch'; }],
    ['orderable flag', (r: Wire) => { r.chosen.guest_orderable = true; }],
    ['approved review flag', (r: Wire) => { r.chosen.review_status = 'approved'; }],
    ['fabricated ABV', (r: Wire) => { r.chosen.served_abv_fraction = 0.2; }],
    ['fabricated zero calories', (r: Wire) => { r.chosen.served_kcal = 0; }],
    ['missing prediction', (r: Wire) => { delete r.chosen.predicted; }],
    ['wrong taste sum', (r: Wire) => { r.chosen.predicted.taste_bps = [1, 2, 3, 4, 5]; }],
    ['fractional basis points', (r: Wire) => { r.chosen.predicted.taste_bps = [4000.5, 3999.5, 1000, 1000, 0]; }],
    ['wrong sensory length', (r: Wire) => { r.chosen.predicted.sensory_0_10 = [0]; }],
    ['coerced sensory number', (r: Wire) => { r.chosen.predicted.sensory_0_10[0] = '5'; }],
    ['nonfinite sensory', (r: Wire) => { r.chosen.predicted.sensory_0_10[0] = NaN; }],
    ['false measured prior', (r: Wire) => { r.chosen.predicted.status = 'measured'; }],
    ['missing steps', (r: Wire) => { delete r.chosen.steps_zh; }],
    ['empty steps', (r: Wire) => { r.chosen.steps_zh = []; }],
    ['markup step', (r: Wire) => { r.chosen.steps_zh[0] = '<script>alert(1)</script>'; }],
    ['unknown provenance anchor', (r: Wire) => { r.chosen.anchor_recipe_ids = ['invented_iba_recipe']; }],
    ['unknown top-level schema', (r: Wire) => { r.debit_ticket = true; }],
    ['incorrect model flag', (r: Wire) => { r.model_used = 'true'; }],
    ['empty model name', (r: Wire) => { r.model_used = true; r.model_name = ''; }],
    ['unvalidated physical result', (r: Wire) => { r.physical_validation_required = false; }],
    ['mismatched candidate count', (r: Wire) => { r.candidate_count = 0; }],
    ['invalid target', (r: Wire) => { r.target.taste_bps = [0, 0, 0, 0, 0]; }],
  ] as const)('rejects %s', (_label, mutate) => {
    const input = result(); mutate(input);
    expect(() => trialView(input, catalog)).toThrow(Error);
  });

  it('rejects carbonated material moved into the shaking/mixing stage', () => {
    const input = result('highball');
    input.chosen.ingredients.find((i: Wire) => i.ingredient_id === 'soda').stage = 'mix';
    expect(() => trialView(input, catalog)).toThrow('气泡材料');
  });
  it('rejects names that smuggle markup or exceed the Rust choice bounds', () => {
    for (const name of ['<img src=x>', '', '测'.repeat(25), 'name\ncommand']) {
      const input = result('model_selected'); input.chosen.name_zh = name;
      expect(() => trialView(input, catalog)).toThrow('文字内容');
    }
  });
  it('rejects an unknown candidate or changed valid dose after model selection', () => {
    const unknown = result('model_selected'); unknown.chosen.candidate_id = 'ffffffffffff';
    expect(() => trialView(unknown, catalog)).toThrow('命名分支');
    const modified = result('model_selected'); modified.chosen.ingredients[0].quantity =
      modified.chosen.ingredients[0].quantity === 45 ? 50 : 45;
    expect(() => trialView(modified, catalog)).toThrow('命名分支');
  });
  it('accepts semantically identical candidate objects with different property ordering', () => {
    const input = result('model_selected');
    input.chosen.predicted = Object.fromEntries(Object.entries(input.chosen.predicted).reverse());
    expect(trialView(input, catalog).recipe.default_orderable).toBe(false);
  });
  it('rejects non-object roots and candidates with a descriptive Error', () => {
    for (const malformed of [null, [], 'result']) {
      expect(() => trialView(malformed as unknown as Record<string, unknown>, catalog)).toThrow('结构无效');
    }
    const input = result(); input.chosen = null;
    expect(() => trialView(input, catalog)).toThrow('结构无效');
  });
});
