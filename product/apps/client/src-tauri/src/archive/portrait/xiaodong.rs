//! Explicit, content-addressed art profiles for the Xiaodong notebook DLC.
//! Neither archive IDs nor local-library IDs participate in this identity.
use super::{shape, Colour};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::OnceLock};

#[derive(Deserialize)]
pub(super) struct Profile {
    pub recipe_id: String,
    signature: String,
    seed: u32,
    variant: usize,
    palette: String,
    ice: String,
    foam: String,
    garnishes: Vec<String>,
    rim: bool,
    bubbles: bool,
    hot: bool,
    layers: Vec<String>,
    gradient: bool,
}

fn text(value: &Value) -> String {
    value
        .as_str()
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn number(value: &Value) -> Value {
    value
        .as_f64()
        .filter(|n| n.is_finite())
        .map(|n| json!((n * 1_000_000.).round() as i64))
        .unwrap_or(Value::Null)
}

pub(super) fn signature(recipe: &Value) -> Option<String> {
    let mut parts = recipe["ingredients"]
        .as_array()?
        .iter()
        .map(|part| {
            serde_json::to_string(&json!([
                part["ingredient_id"],
                number(&part["quantity"]),
                part["quantity_range"]
                    .as_array()
                    .map(|r| r.iter().map(number).collect::<Vec<_>>()),
                part["unit"],
                part["stage"],
                part["optional"]
            ]))
            .expect("JSON value")
        })
        .collect::<Vec<_>>();
    parts.sort();
    Some(
        serde_json::to_string(&json!([
            text(&recipe["name_en"]).to_lowercase(),
            text(&recipe["name_zh"]),
            recipe["glass_template"],
            recipe["method"],
            parts,
            text(&recipe["garnish_zh"]),
            recipe["steps_zh"]
                .as_array()?
                .iter()
                .map(text)
                .collect::<Vec<_>>()
        ]))
        .expect("JSON value"),
    )
}

fn profiles() -> &'static HashMap<String, Profile> {
    static PROFILES: OnceLock<HashMap<String, Profile>> = OnceLock::new();
    PROFILES.get_or_init(|| {
        #[derive(Deserialize)]
        struct Document {
            profiles: Vec<Profile>,
        }
        let data: Document =
            serde_json::from_str(include_str!("../../../../src/dlc-art-profiles.json"))
                .expect("compiled DLC art profiles");
        data.profiles
            .into_iter()
            .map(|profile| (profile.signature.clone(), profile))
            .collect()
    })
}

pub(super) fn appearance(recipe: &Value) -> Option<&'static Profile> {
    profiles().get(&signature(recipe)?)
}

fn palette(name: &str) -> Colour {
    match name {
        "gold" => [207, 177, 76, 255],
        "amber" => [176, 110, 55, 255],
        "ruby" => [167, 53, 66, 255],
        "rose" => [197, 113, 128, 255],
        "violet" => [146, 124, 181, 255],
        "blue" => [61, 157, 180, 255],
        "green" => [137, 175, 74, 255],
        "cream" => [216, 200, 161, 255],
        "coffee" => [113, 70, 46, 255],
        "cassis" => [143, 48, 111, 255],
        _ => [161, 187, 166, 255],
    }
}
fn lighten(mut c: Colour, by: u8) -> Colour {
    for value in &mut c[..3] {
        *value = value.saturating_add(by);
    }
    c
}
fn dim(mut c: Colour) -> Colour {
    for value in &mut c[..3] {
        *value = (*value as u16 * 3 / 5) as u8;
    }
    c
}
const BACK: Colour = [7, 18, 27, 255];
const FRAME: Colour = [53, 77, 91, 255];
const GLASS: Colour = [167, 204, 207, 255];
const LIGHT: Colour = [222, 235, 222, 255];
const SHADOW: Colour = [62, 104, 122, 255];
const FOAM: Colour = [234, 225, 202, 255];
const LEAF: Colour = [114, 165, 98, 255];
const GOLD: Colour = [224, 178, 69, 255];
const FRUIT: Colour = [191, 65, 85, 255];
const ICE: Colour = [146, 192, 208, 255];

struct Tile {
    size: usize,
    data: Vec<Colour>,
}
impl Tile {
    fn dot(&mut self, x: f64, y: f64, c: Colour) {
        let xx = (x * self.size as f64 / 64.).round() as i32;
        let yy = (y * self.size as f64 / 64.).round() as i32;
        if xx >= 0 && yy >= 0 && xx < self.size as i32 && yy < self.size as i32 {
            self.data[yy as usize * self.size + xx as usize] = c;
        }
    }
    fn line(&mut self, a: (f64, f64), b: (f64, f64), c: Colour) {
        let steps = ((a.0 - b.0).abs().max((a.1 - b.1).abs()) * 2.).ceil() as usize;
        for i in 0..=steps {
            let t = if steps == 0 {
                0.
            } else {
                i as f64 / steps as f64
            };
            self.dot(a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t, c);
        }
    }
    fn ellipse(&mut self, x: f64, y: f64, rx: f64, ry: f64, c: Colour) {
        for i in 0..120 {
            let a = i as f64 / 120. * std::f64::consts::TAU;
            self.dot(x + rx * a.cos(), y + ry * a.sin(), c);
        }
    }
}

fn master(profile: &Profile, template: &str, size: usize) -> Vec<Colour> {
    let mut tile = Tile {
        size,
        data: vec![[0; 4]; size * size],
    };
    let glass = shape(template, profile.variant);
    let top = glass.top as f64 * 2.;
    let bottom = (glass.top + glass.half.len() as i32 - 1) as f64 * 2.;
    let radius = |y: f64| {
        let row = ((y - top) / 2.).clamp(0., glass.half.len() as f64 - 1.);
        let i = row.floor() as usize;
        let j = (i + 1).min(glass.half.len() - 1);
        let t = row - i as f64;
        (glass.half[i] as f64 * (1. - t) + glass.half[j] as f64 * t) * 2.
    };
    let surface = top + 5.;
    let liquid = palette(&profile.palette);
    for yy in 0..size {
        for xx in 0..size {
            let x = xx as f64 * 64. / size as f64;
            let y = yy as f64 * 64. / size as f64;
            if (3. ..=60.).contains(&x) && (3. ..=60.).contains(&y) {
                tile.data[yy * size + xx] = if x < 5. || x > 58. || y < 5. || y > 58. {
                    FRAME
                } else {
                    BACK
                };
            }
            if y >= surface && y <= bottom && (x - 32.).abs() < radius(y) - 1. {
                let mut colour = if profile.gradient && profile.layers.len() > 1 {
                    let a = palette(&profile.layers[0]);
                    let b = palette(profile.layers.last().unwrap());
                    let t = (((y - surface) / (bottom - surface + 1.) - 0.12) / 0.76).clamp(0., 1.);
                    [
                        (a[0] as f64 * (1. - t) + b[0] as f64 * t).round() as u8,
                        (a[1] as f64 * (1. - t) + b[1] as f64 * t).round() as u8,
                        (a[2] as f64 * (1. - t) + b[2] as f64 * t).round() as u8,
                        255,
                    ]
                } else if profile.layers.len() > 1 {
                    let layer = (((y - surface) / (bottom - surface + 1.)
                        * profile.layers.len() as f64) as usize)
                        .min(profile.layers.len() - 1);
                    palette(&profile.layers[layer])
                } else {
                    liquid
                };
                let grain = (xx as u32).wrapping_mul(374761393)
                    ^ (yy as u32).wrapping_mul(668265263)
                    ^ profile.seed;
                if x > 32. + radius(y) - 5. || y > bottom - 3. {
                    colour = dim(colour);
                } else if x < 32. - radius(y) + 5. || grain % 43 == 0 {
                    colour = lighten(colour, 23);
                }
                tile.data[yy * size + xx] = colour;
            }
        }
    }
    // Both the tiny tile and the larger master retain an uninterrupted silhouette.
    for yy in 0..=(bottom - top) as usize {
        let y = top + yy as f64;
        let r = radius(y);
        tile.dot(32. - r, y, LIGHT);
        tile.dot(32. + r, y, SHADOW);
        if yy > 4 && yy + 3 < (bottom - top) as usize {
            tile.dot(34. - r, y, GLASS);
        }
    }
    tile.ellipse(32., top, radius(top), 2., GLASS);
    tile.line(
        (32. - radius(top) * 0.7, top - 1.),
        (32. + radius(top) * 0.2, top - 1.),
        LIGHT,
    );
    let surface_colour = profile
        .layers
        .first()
        .map(|name| palette(name))
        .unwrap_or(liquid);
    tile.ellipse(
        32.,
        surface,
        radius(surface) - 2.,
        1.3,
        lighten(surface_colour, 27),
    );
    if profile.foam != "none" {
        let r = radius(surface) - 3.;
        tile.line((32. - r, surface), (32. + r, surface), FOAM);
        tile.line((33. - r, surface + 1.), (31. + r, surface + 1.), FOAM);
        if profile.foam == "cream" {
            tile.ellipse(32., surface - 2., r * 0.8, 2., FOAM);
            tile.ellipse(32., surface - 4., r * 0.45, 2., FOAM);
        }
    }
    // Only surface reflection/engraving is seeded. Ingredients select real motifs.
    for yy in (surface as i32 + 3)..bottom as i32 - 2 {
        let y = yy as f64;
        let r = radius(y);
        if profile.variant == 1 && yy % 3 != 0 {
            tile.dot(32. - r * 0.58, y, SHADOW);
        }
        if profile.variant == 2 {
            tile.dot(32. - r * 0.50 + (yy as f64 * 0.6).sin(), y, SHADOW);
            tile.dot(32. + r * 0.5 - (yy as f64 * 0.6).sin(), y, SHADOW);
        }
        if profile.variant == 3 && yy % 6 == 0 {
            tile.line((34. - r, y), (30. + r, y), dim(liquid));
        }
        if profile.bubbles && yy % 5 == 0 {
            let x = 32. + ((yy as u32 + profile.seed) % 9) as f64 - 4.;
            if (x - 32.).abs() < r - 3. {
                tile.dot(x, y, LIGHT);
            }
        }
    }
    if profile.ice != "none" {
        if profile.ice == "crushed" {
            for yy in (surface as i32 + 1..bottom as i32 - 1).step_by(3) {
                for xx in (8..56).step_by(4) {
                    if ((xx - 32) as f64).abs() < radius(yy as f64) - 4. {
                        tile.line(
                            (xx as f64, yy as f64),
                            (xx as f64 + 1., yy as f64 + 1.),
                            ICE,
                        );
                    }
                }
            }
        } else {
            let cubes = if profile.ice == "large" {
                vec![(32., surface + 6., 6.)]
            } else {
                vec![(29., surface + 5., 4.), (35., surface + 14., 4.)]
            };
            for (cx, cy, half) in cubes {
                if cy + half < bottom - 1. && half < radius(cy) - 3. {
                    let a = (cx - half, cy - half + 1.);
                    let b = (cx + half - 1., cy - half - 1.);
                    let d = (cx - half + 1., cy + half);
                    tile.line(a, b, ICE);
                    tile.line(b, (cx + half, cy + half - 1.), GLASS);
                    tile.line((cx + half, cy + half - 1.), d, ICE);
                    tile.line(d, a, GLASS);
                    tile.dot(cx - 1., cy - 1., LIGHT);
                }
            }
        }
    }
    if glass.stem {
        tile.line((32., bottom), (32., 53.), GLASS);
        tile.line((31., bottom + 1.), (31., 52.), LIGHT);
        let foot = if profile.variant == 1 { 12. } else { 10. };
        tile.ellipse(32., 55., foot, 2., GLASS);
        tile.line((32. - foot + 2., 56.), (32. + foot - 2., 56.), LIGHT);
    } else {
        let r = radius(bottom);
        tile.line((32. - r, bottom), (32. + r, bottom), GLASS);
        tile.line((33. - r, bottom + 2.), (31. + r, bottom + 2.), LIGHT);
    }
    if template == "mug" {
        let cy = (top + bottom) / 2.;
        let rx = radius(cy);
        for i in 0..60 {
            let a = -std::f64::consts::FRAC_PI_2 + i as f64 / 59. * std::f64::consts::PI;
            tile.dot(
                32. + rx + a.cos() * 7.,
                cy + a.sin() * (bottom - top) * 0.3,
                GLASS,
            );
        }
    }
    if profile.rim {
        for x in ((32. - radius(top)) as i32..(32. + radius(top)) as i32).step_by(3) {
            tile.dot(x as f64, top - 1., FOAM);
        }
    }
    for (index, kind) in profile.garnishes.iter().enumerate() {
        let side = if index == 1 { -1. } else { 1. };
        let x = if index == 2 {
            32.
        } else {
            32. + side * (radius(top) - 2.)
        };
        let y = (top - 1.).max(8.);
        match kind.as_str() {
            "twist" | "cucumber" => {
                let c = if kind == "cucumber" { LEAF } else { GOLD };
                for i in 0..13 {
                    let a = i as f64 * 0.65;
                    tile.dot(x + a.sin() * 3., y - 4. + i as f64, c);
                    tile.dot(x + a.sin() * 3. + 1., y - 4. + i as f64, lighten(c, 30));
                }
            }
            "citrus" | "kiwi" => {
                tile.ellipse(x, y, 5., 5., GOLD);
                tile.ellipse(x, y, 3., 3., lighten(GOLD, 27));
                tile.line((x - 3., y), (x + 3., y), GOLD);
                tile.line((x, y - 3.), (x, y + 3.), GOLD);
            }
            "olive" | "cherry" => {
                if template == "martini" || template == "coupe" {
                    tile.line((x + 4., y - 6.), (x - 7., y + 7.), GOLD);
                }
                let c = if kind == "olive" { LEAF } else { FRUIT };
                tile.ellipse(x, y, 3., 2., c);
                tile.dot(x, y, c);
                tile.dot(x - 1., y - 1., LIGHT);
            }
            "herb" | "sprig" | "celery" => {
                tile.line((x, y + 4.), (x + 2., y - 6.), LEAF);
                for i in 0..3 {
                    let yy = y - 5. + i as f64 * 3.;
                    tile.line((x + 1., yy + 2.), (x - 3., yy), LEAF);
                    tile.line((x + 1., yy + 2.), (x + 5., yy - 1.), LEAF);
                }
            }
            "beans" => {
                for dx in [-4., 0., 4.] {
                    tile.ellipse(32. + dx, surface, 1.2, 1., [76, 49, 36, 255]);
                    tile.dot(32. + dx, surface, dim(GOLD));
                }
            }
            "dust" => {
                let r = radius(surface) - 4.;
                for x in ((32. - r) as i32..(32. + r) as i32).step_by(3) {
                    tile.dot(x as f64, surface, [105, 76, 48, 255]);
                }
            }
            "pineapple" => {
                tile.line((x - 3., y + 4.), (x - 4., y - 5.), GOLD);
                tile.line((x - 4., y - 5.), (x + 5., y + 1.), GOLD);
                tile.line((x + 5., y + 1.), (x - 3., y + 4.), GOLD);
                for i in 0..3 {
                    tile.dot(x - 1., y - 1. + i as f64, GOLD);
                }
            }
            "berry" | "grape" => {
                for (dx, dy) in [(-2., 0.), (2., 0.), (0., 3.)] {
                    tile.ellipse(x + dx, y + dy, 2., 1.5, FRUIT);
                    tile.dot(x + dx, y + dy, FRUIT);
                }
                tile.line((x - 1., y - 3.), (x + 2., y - 4.), LEAF);
            }
            "passion" => {
                tile.ellipse(x, y, 5., 3., GOLD);
                tile.ellipse(x, y, 3., 2., FRUIT);
                for dx in [-2., 0., 2.] {
                    tile.dot(x + dx, y, GOLD);
                }
            }
            "ginger" => {
                tile.ellipse(x, y, 4., 2., GOLD);
                tile.line((x - 2., y), (x + 2., y + 1.), dim(GOLD));
            }
            "chili" | "carrot" => {
                tile.line((x - 2., y - 4.), (x, y + 5.), FRUIT);
                tile.line((x + 2., y - 4.), (x, y + 5.), FRUIT);
                tile.line((x - 2., y - 5.), (x + 2., y - 5.), LEAF);
            }
            _ => {}
        }
    }
    if profile.hot {
        for col in [26., 37.] {
            for y in 0..5 {
                tile.dot(col + (y as f64).sin(), top - 6. + y as f64, SHADOW);
            }
        }
    }
    // A small collector's edge motif also survives repeated recipes with similar
    // liquid and glassware. It is unrelated to approval, quality or ticket state.
    for bit in 0..16 {
        let c = if profile.seed & (1 << bit) != 0 {
            liquid
        } else {
            SHADOW
        };
        tile.line((9. + bit as f64 * 3., 60.), (10. + bit as f64 * 3., 60.), c);
    }
    tile.data
}

pub(super) fn pixels(profile: &Profile, template: &str, size: usize) -> Vec<Colour> {
    let source_size = if size <= 24 { 16 } else { 64 };
    let source = master(profile, template, source_size);
    (0..size * size)
        .map(|offset| {
            let x = offset % size;
            let y = offset / size;
            source[((2 * y + 1) * source_size / (2 * size)).min(source_size - 1) * source_size
                + ((2 * x + 1) * source_size / (2 * size)).min(source_size - 1)]
        })
        .collect()
}

#[cfg(test)]
mod tests;
