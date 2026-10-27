import type { Catalog, GeneratedTrial, Profile, Recipe, RecipeIngredient, Sensory, Taste } from './types';
import { validateTaste } from './domain';

type JsonObject = Record<string, unknown>;
const BASES = ['gin', 'vodka', 'white_rum', 'tequila', 'bourbon', 'scotch', 'blended_scotch'];
const CARBONATED = ['soda', 'ginger_beer', 'ginger_ale', 'cola'];
const OTHER = ['lemon', 'lime', 'simple_syrup', 'amaretto'];
const CANDIDATE_KEYS = ['candidate_id', 'family', 'ingredients', 'steps_zh', 'anchor_recipe_ids', 'predicted',
  'preference_match', 'ethanol_ml', 'served_abv_fraction', 'served_kcal', 'physical_note', 'review_status',
  'guest_orderable', 'contains_test_fixture'];

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown): JsonObject {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), '试调结果结构无效');
  return value as JsonObject;
}
function onlyKeys(value: JsonObject, keys: string[]) {
  requireValue(Object.keys(value).every(key => keys.includes(key)), '试调结果包含未授权字段');
}
function text(value: unknown, maximum: number): string {
  requireValue(typeof value === 'string' && value.trim().length > 0 && [...value].length <= maximum &&
    !/[\u0000-\u001f\u007f<>]/u.test(value), '试调文字内容无效');
  return value;
}
function vector(value: unknown, length: number, maximum: number): number[] {
  requireValue(Array.isArray(value) && value.length === length &&
    value.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= maximum), '试调预测向量无效');
  return value;
}
function prediction(value: unknown): { taste: Taste; sensory: Sensory } {
  const p = object(value);
  const taste = vector(p.taste_bps, 5, 10000);
  validateTaste(taste);
  return { taste, sensory: vector(p.sensory_0_10, 7, 10) as Sensory };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const obj = value as JsonObject;
    return '{' + Object.keys(obj).sort().map(key => JSON.stringify(key) + ':' + canonical(obj[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function parseCandidate(value: unknown, catalog: Catalog, named: boolean) {
  const c = object(value);
  onlyKeys(c, named ? [...CANDIDATE_KEYS, 'name_zh', 'name_en'] : CANDIDATE_KEYS);
  const candidateId = text(c.candidate_id, 12);
  requireValue(/^[a-f0-9]{12}$/.test(candidateId), '试调候选ID无效');
  requireValue(c.guest_orderable === false && c.review_status === 'requires_bartender_review', '试调必须待审核且不可供客人点单');
  requireValue(c.served_abv_fraction === null && c.served_kcal === null, '未验证的成杯酒精度与热量必须未知');
  requireValue(typeof c.contains_test_fixture === 'boolean', '试调缺少测试库存标记');
  const p = object(c.predicted);
  onlyKeys(p, ['taste_bps', 'sensory_0_10', 'status']);
  requireValue(p.status === 'heuristic_unvalidated', '试调预测不得冒充实测');
  const predicted = prediction(p);
  const family = text(c.family, 40);
  requireValue(['sour', 'highball', 'spirit_forward'].includes(family), '规则库尚不支持此试调家族');
  requireValue(Array.isArray(c.ingredients) && c.ingredients.length >= 2 && c.ingredients.length <= 3, '试调原料数量无效');
  const seen = new Set<string>();
  const parts: RecipeIngredient[] = c.ingredients.map(raw => {
    const i = object(raw);
    onlyKeys(i, ['ingredient_id', 'quantity', 'unit', 'stage', 'optional']);
    const id = text(i.ingredient_id, 64);
    requireValue([...BASES, ...CARBONATED, ...OTHER].includes(id) && catalog.ingredients.some(v => v.id === id) && !seen.has(id),
      '试调原料不在受控白名单、缺少目录记录或重复');
    seen.add(id);
    requireValue(typeof i.quantity === 'number' && Number.isFinite(i.quantity) &&
      Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 180 && i.unit === 'ml', '试调原料剂量无效');
    requireValue(i.optional === false && (i.stage === 'mix' || i.stage === 'top'), '试调原料阶段或可选标记无效');
    requireValue(CARBONATED.includes(id) ? i.stage === 'top' : i.stage === 'mix', '气泡材料只能最后加入');
    return { ingredient_id: id, quantity: i.quantity, unit: 'ml', optional: false, stage: i.stage,
      quantity_note: null, allowed_alternatives: [] };
  });
  // UI defence in depth for the current audited physical envelopes. Rust remains
  // authoritative for stock, labels, exclusions, capacity and ethanol ceilings.
  const dose = (id: string, minimum: number, maximum: number) =>
    parts.some(i => i.ingredient_id === id && i.quantity! >= minimum && i.quantity! <= maximum);
  const base = parts.find(i => BASES.includes(i.ingredient_id));
  requireValue(base && parts.filter(i => BASES.includes(i.ingredient_id)).length === 1, '试调基酒结构无效');
  if (family === 'sour') {
    requireValue(parts.length === 3 && dose(base.ingredient_id, 30, 60) &&
      (dose('lemon', 10, 30) || dose('lime', 10, 30)) && dose('simple_syrup', 5, 25), '酸型试调剂量超出规则范围');
  } else if (family === 'highball') {
    requireValue(dose(base.ingredient_id, 15, 45) && CARBONATED.some(id => dose(id, 60, 180)) &&
      (parts.length === 2 || dose('lime', 10, 15)), '高球试调剂量超出规则范围');
  } else {
    requireValue(parts.length === 2 && ['scotch', 'blended_scotch', 'bourbon'].includes(base.ingredient_id) &&
      [45, 60].includes(base.quantity!) && (dose('amaretto', 10, 10) || dose('amaretto', 15, 15)), '烈酒型试调剂量超出规则范围');
  }
  const volume = parts.reduce((sum, i) => sum + i.quantity!, 0);
  requireValue(typeof c.ethanol_ml === 'number' && Number.isFinite(c.ethanol_ml) &&
    c.ethanol_ml >= 0 && c.ethanol_ml <= 100 && c.ethanol_ml <= volume, '试调乙醇输入值无效');
  requireValue(Array.isArray(c.steps_zh) && c.steps_zh.length > 0 && c.steps_zh.length <= 12, '试调步骤无效');
  const steps = c.steps_zh.map(step => text(step, 500));
  requireValue(Array.isArray(c.anchor_recipe_ids) && c.anchor_recipe_ids.length > 0 && c.anchor_recipe_ids.length <= 12, '试调来源锚点无效');
  const anchors = c.anchor_recipe_ids.map(id => text(id, 80));
  requireValue(anchors.every(id => catalog.recipes.some(r => r.id === id)), '试调引用未知酒谱锚点');
  const physicalNote = text(c.physical_note, 1000);
  const match = object(c.preference_match);
  requireValue(typeof match.index === 'number' && Number.isFinite(match.index) && match.index >= 0 &&
    match.index <= 100 && match.calibrated === false, '试调匹配指数不能冒充校准评分');
  if (named) { text(c.name_zh, 24); text(c.name_en, 80); }
  return { raw: c, candidateId, predicted, family, parts, steps, anchors, physicalNote };
}

export function trialView(result: Record<string, unknown>, catalog: Catalog): GeneratedTrial {
  const input = object(result);
  onlyKeys(input, ['status', 'target', 'reason', 'chosen', 'candidates', 'candidate_count', 'model_used',
    'rules_version', 'rules_sha256', 'physical_validation_required', 'model_name', 'model_audit',
    'model_fallback_reason', 'fallback_reason']);
  requireValue(input.status === 'experimental_candidate' || input.status === 'nearest_only', '未收到可载入的试调候选');
  requireValue(typeof input.model_used === 'boolean' && input.physical_validation_required === true, '试调校验状态无效');
  const target = object(input.target);
  onlyKeys(target, ['taste_bps', 'sensory_0_10']);
  prediction(target); // Retained only in audit; it never becomes the user's current target.
  const version = text(input.rules_version, 80);
  requireValue(typeof input.rules_sha256 === 'string' && /^[a-f0-9]{64}$/.test(input.rules_sha256), '试调规则版本校验值无效');
  const reason = text(input.reason, 2000);
  requireValue(Array.isArray(input.candidates) && input.candidates.length > 0 && input.candidates.length <= 8 &&
    Number.isInteger(input.candidate_count) && Number(input.candidate_count) >= input.candidates.length, '试调候选集合无效');
  const candidates = input.candidates.map(c => parseCandidate(c, catalog, false));
  requireValue(new Set(candidates.map(c => c.candidateId)).size === candidates.length, '试调候选ID重复');
  const chosen = parseCandidate(input.chosen, catalog, true);
  const selected = candidates.find(c => c.candidateId === chosen.candidateId);
  requireValue(selected && CANDIDATE_KEYS.every(key => canonical(selected.raw[key]) === canonical(chosen.raw[key])),
    '命名分支更改了规则候选的配方或校验事实');
  const modelName = input.model_used ? text(input.model_name, 160) : '';
  const mapping = chosen.family === 'highball' ? ['highball', 'build'] : chosen.family === 'sour' ? ['coupe', 'shake'] : ['rocks', 'stir'];
  const id = 'trial-' + crypto.randomUUID(), created = new Date().toISOString();
  const fixtureNotice = chosen.raw.contains_test_fixture ? '含算法测试库存，不能视为真实酒瓶标签或已调制结果。' : '';
  const recipe: Recipe = {
    id, recipe_revision_id: version + ':' + chosen.candidateId + ':' + id,
    name_zh: chosen.raw.name_zh as string, name_en: chosen.raw.name_en as string, variant: 'experimental',
    family: chosen.family, glass_template: mapping[0], method: mapping[1], ingredients: chosen.parts,
    steps_zh: [...chosen.steps], garnish_zh: '', notes_zh: '待调酒师实作审核。' + fixtureNotice + reason + ' ' + chosen.physicalNote,
    source: { kind: 'generated_trial', publisher: input.model_used ? '本地模型辅助选择与命名：' + modelName : '本地规则引擎',
      url: null, reference: '规则 ' + version + '；候选 ' + chosen.candidateId + '；锚点 ' + chosen.anchors.join(', '),
      checked_on: created.slice(0, 10), method_provenance: 'validated_rule' },
    preparation_review: 'requires_bartender_review', default_orderable: false, needs_serving_configuration: true,
    prediction_profile_id: 'prior:' + id,
  };
  const profile: Profile = { recipe_id: id, taste_preference_bps: [...chosen.predicted.taste],
    sensory_0_10: [...chosen.predicted.sensory], taste_intensity_0_10: null, status: 'heuristic_unvalidated', measured: false,
    note_zh: '规则预测，未经试饮验证；味觉强度未知，未用于排名。' };
  return { recipe, profile, created_at: created, audit: structuredClone(input) };
}
