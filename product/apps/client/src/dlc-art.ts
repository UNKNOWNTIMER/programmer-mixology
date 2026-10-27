import type { Recipe } from './types';
import type { GlassAppearance, GlassGarnish, GlassPalette } from './glass-appearance';
import profiles from './dlc-art-profiles.json';

export interface DlcArtProfile {
  recipe_id: string;
  signature: string;
  seed: number;
  variant: number;
  palette: GlassPalette;
  ice: GlassAppearance['ice'];
  foam: GlassAppearance['foam'];
  garnishes: GlassGarnish[];
  rim: boolean;
  bubbles: boolean;
  hot: boolean;
  layers: GlassPalette[];
  gradient: boolean;
}

/** Content identity shared with the native ICO renderer. Metadata, local IDs and
 * ingredient ordering are deliberately absent; serving cues remain part of it. */
export function dlcArtSignature(recipe: Recipe): string {
  const text = (value: string) => value.trim().replace(/\s+/g, ' ');
  const number = (value: number | null | undefined) => value == null ? null : Math.round(value * 1_000_000);
  const parts = recipe.ingredients.map(part => JSON.stringify([
    part.ingredient_id, number(part.quantity), part.quantity_range?.map(number) ?? null,
    part.unit, part.stage, part.optional,
  ])).sort();
  return JSON.stringify([
    text(recipe.name_en).toLowerCase(), text(recipe.name_zh), recipe.glass_template,
    recipe.method, parts, text(recipe.garnish_zh), recipe.steps_zh.map(text),
  ]);
}

export const DLC_ART_PROFILES = profiles.profiles as DlcArtProfile[];
const byContent = new Map(DLC_ART_PROFILES.map(profile => [profile.signature, profile]));

export function dlcRecipeId(recipe: Recipe): string | undefined {
  return byContent.get(dlcArtSignature(recipe))?.recipe_id;
}

export function dlcGlassAppearance(recipe: Recipe): GlassAppearance | undefined {
  const art = byContent.get(dlcArtSignature(recipe));
  if (!art) return undefined;
  return {
    design: 'xiaodong_notes', seed: art.seed, variant: art.variant,
    palette: art.palette, ice: art.ice, foam: art.foam, garnishes: [...art.garnishes],
    rim: art.rim, bubbles: art.bubbles, hot: art.hot, layers: [...art.layers], gradient: art.gradient,
  };
}

// The same 8 x 4 silhouette family used by native archive art, expressed in the
// character grid. These are glassware choices, never added recipe ingredients.
const contours: Record<string, readonly (readonly [number, readonly number[], boolean])[]> = {
  martini: [[7,[11,10,9,8,7,6,5,4,3,2],true],[10,[12,12,10,8,6,4,2],true],[5,[10,10,9,8,8,7,6,6,5,4,4,3,2,1],true],[7,[12,11,11,9,9,7,7,5,5,3,2],true]],
  coupe: [[8,[10,10,10,9,8,7,5,3,2],true],[11,[12,12,11,9,6,3,2],true],[7,[10,10,10,10,10,9,8,6,3,2],true],[8,[11,11,10,9,8,6,4,2],true]],
  flute: [[4,[4,4,4,4,4,4,4,4,4,4,3,3,3,3,2,2,1],true],[5,[3,4,5,5,5,5,5,5,5,4,4,4,3,3,2,1],true],[4,[7,7,6,5,5,4,4,3,3,3,3,2,2,2,2,2,1],true],[4,[5,5,5,5,5,4,4,4,4,3,3,3,3,2,2,2,2],true]],
  highball: [[5,[5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5],false],[5,[8,8,8,8,7,7,7,7,7,6,6,6,6,6,5,5,5,5,5,4,4],false],[5,[7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,6,5,5],false],[6,[6,6,6,7,7,7,8,8,8,8,8,8,8,7,7,6,6,6,5],false]],
  hurricane: [[5,[7,7,6,5,5,4,4,5,5,6,7,8,8,8,7,6,4,3,2],true],[4,[8,7,6,5,4,4,3,3,4,5,6,7,7,7,6,5,4,3,2],true],[5,[5,5,4,4,4,5,6,7,8,9,9,9,8,7,6,4,2],true],[5,[8,7,6,6,5,5,5,5,6,7,8,8,7,6,5,4,3,3,2],true]],
  goblet: [[6,[7,8,9,10,10,10,10,10,9,9,8,7,6,4,2],true],[6,[6,6,7,8,9,9,9,9,8,7,6,4,2],true],[5,[6,7,8,8,9,9,9,9,9,8,8,7,6,5,3,2],true],[7,[10,10,10,10,9,9,8,8,7,6,4,2],true]],
  mug: [[8,[7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7],false],[6,[5,5,5,5,5,5,5,5,5,5,5,4,4,4,3,2],true],[10,[6,7,8,8,9,9,9,9,9,9,8,8,7,6],false],[9,[8,8,8,7,7,7,7,6,6,6,6,5,5,5,5],false]],
  rocks: [[12,[9,9,9,9,9,9,9,9,9,9,9,9,9,9],false],[10,[10,10,10,9,9,9,8,8,8,7,7,7,6,6,6,6],false],[11,[7,8,9,10,10,10,10,10,10,10,9,8,7,7],false],[15,[11,11,11,11,10,10,9,9,8,8,8],false]],
};

export function dlcGlassContour(template: string, variant: number) {
  const [nativeTop, widths, stem] = (contours[template] ?? contours.rocks)[variant % 4];
  const top = Math.max(9, nativeTop * 1.7), bottom = stem ? Math.min(45, top + (widths.length - 1) * 1.8) : 53;
  const radius = (y: number) => {
    const offset = Math.max(0, Math.min(widths.length - 1, (y - top) / (bottom - top) * (widths.length - 1)));
    const lo = Math.floor(offset), hi = Math.min(widths.length - 1, lo + 1);
    return (widths[lo] * (1 - offset + lo) + widths[hi] * (offset - lo)) * 2.55;
  };
  return {top, bottom, liquid: top + 6, stem, radius};
}
