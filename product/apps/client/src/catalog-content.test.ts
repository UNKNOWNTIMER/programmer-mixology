import { expect, it } from 'vitest';
import recipes from '../public/seed/recipes.json';
import profiles from '../public/seed/profiles.seed.json';
import quotes from './recipe-quotes.json';
import { safeSourceUrl } from './domain';

it('ships exactly 300 sourced recipes and one unique editorial quote for each', () => {
  expect(recipes.recipe_count).toBe(300);
  expect(recipes.recipes).toHaveLength(300);
  expect(Object.keys(quotes).sort()).toEqual(recipes.recipes.map(r => r.id).sort());
  expect(new Set(Object.values(quotes)).size).toBe(300);
  expect(Object.values(quotes).every(q => q.trim() && !q.includes('系统原创'))).toBe(true);
  const community = recipes.recipes.filter(r => r.source.kind === 'community_recipe');
  expect(community).toHaveLength(188);
  for (const recipe of community) {
    expect(safeSourceUrl(recipe.source.url)).toBe(`https://www.thecocktaildb.com/drink/${recipe.id.slice(4)}`);
    expect(recipe.default_orderable).toBe(false);
    expect(recipe.actual_user_rating).toBeNull();
  }
});

it('keeps community absolute strength unknown while supplying explicit unvalidated matching priors', () => {
  const community = profiles.profiles.filter(p => p.recipe_id.startsWith('cdb_'));
  expect(community).toHaveLength(188);
  for (const profile of community) {
    expect(profile.taste_intensity_0_10).toBeNull();
    expect(profile.taste_preference_bps.reduce((sum, n) => sum + n, 0)).toBe(10000);
    expect(profile.taste_preference_bps.every(Number.isInteger)).toBe(true);
    expect(profile.sensory_0_10).toHaveLength(7);
    expect(profile.measured).toBe(false);
    expect(profile.status).toBe('heuristic_unvalidated');
  }
});
