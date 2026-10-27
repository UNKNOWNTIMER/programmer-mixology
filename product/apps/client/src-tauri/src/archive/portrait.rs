//! Deterministic pixel portraits. Pixels illustrate the recipe; they are not a
//! measured colour, serving size, garnish recommendation or nutritional claim.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

mod xiaodong;
mod zhenglin;

const SIDE: usize = 32;
type Colour = [u8; 4];
const GLASS: Colour = [183, 215, 215, 255];
const SHADOW: Colour = [58, 95, 107, 255];
const LIGHT: Colour = [225, 237, 217, 255];
const CORAL: Colour = [184, 70, 62, 255];
const BACK: Colour = [8, 20, 27, 255];

struct Canvas(Vec<Colour>);
impl Canvas {
    fn pixel(&mut self, x: i32, y: i32, colour: Colour) {
        if (0..SIDE as i32).contains(&x) && (0..SIDE as i32).contains(&y) {
            self.0[y as usize * SIDE + x as usize] = colour;
        }
    }
    fn line(&mut self, a: (i32, i32), b: (i32, i32), colour: Colour) {
        let (mut x, mut y) = a;
        let dx = (b.0 - x).abs();
        let sx = if x < b.0 { 1 } else { -1 };
        let dy = -(b.1 - y).abs();
        let sy = if y < b.1 { 1 } else { -1 };
        let mut error = dx + dy;
        loop {
            self.pixel(x, y, colour);
            if (x, y) == b {
                break;
            }
            let twice = 2 * error;
            if twice >= dy {
                error += dy;
                x += sx;
            }
            if twice <= dx {
                error += dx;
                y += sy;
            }
        }
    }
    fn rect(&mut self, x: i32, y: i32, w: i32, h: i32, colour: Colour) {
        for yy in y..y + h {
            for xx in x..x + w {
                self.pixel(xx, yy, colour);
            }
        }
    }
}

fn identity(recipe: &Value) -> [u8; 32] {
    // Archive IDs, timestamps, user targets and the approval state must not change
    // the same drink's portrait when it is exported again or restored elsewhere.
    Sha256::digest(
        serde_json::to_vec(&json!({
            "name":recipe["name_en"], "name_zh":recipe["name_zh"],
            "glass":recipe["glass_template"], "method":recipe["method"],
            "ingredients":recipe["ingredients"]
        }))
        .expect("JSON value is serializable"),
    )
    .into()
}

/// Eight source glass families, each with four separately drawn silhouettes.
/// A variant is decorative glassware, never an instruction to add ingredients.
pub(super) fn design(recipe: &Value) -> (&'static str, usize) {
    let family = match recipe["glass_template"].as_str().unwrap_or("rocks") {
        "martini" => "martini",
        "coupe" => "coupe",
        "flute" => "flute",
        "highball" => "highball",
        "hurricane" => "hurricane",
        "goblet" => "goblet",
        "mug" => "mug",
        _ => "rocks",
    };
    (family, identity(recipe)[7] as usize % 4)
}

struct Shape {
    top: i32,
    half: Vec<i32>,
    stem: bool,
}
fn shape(family: &str, variant: usize) -> Shape {
    let (top, half, stem): (i32, &[i32], bool) = match (family, variant) {
        // Martini: long V, broad shallow V, deep triangular bowl, stepped rim.
        ("martini", 0) => (7, &[11, 10, 9, 8, 7, 6, 5, 4, 3, 2], true),
        ("martini", 1) => (10, &[12, 12, 10, 8, 6, 4, 2], true),
        ("martini", 2) => (5, &[10, 10, 9, 8, 8, 7, 6, 6, 5, 4, 4, 3, 2, 1], true),
        ("martini", _) => (7, &[12, 11, 11, 9, 9, 7, 7, 5, 5, 3, 2], true),
        // Coupe: rounded, saucer, squared Art Deco and a flared shallow bowl.
        ("coupe", 0) => (8, &[10, 10, 10, 9, 8, 7, 5, 3, 2], true),
        ("coupe", 1) => (11, &[12, 12, 11, 9, 6, 3, 2], true),
        ("coupe", 2) => (7, &[10, 10, 10, 10, 10, 9, 8, 6, 3, 2], true),
        ("coupe", _) => (8, &[11, 11, 10, 9, 8, 6, 4, 2], true),
        // Flute: straight, rounded tulip, trumpet and cut-crystal taper.
        ("flute", 0) => (
            4,
            &[4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 1],
            true,
        ),
        ("flute", 1) => (5, &[3, 4, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 3, 3, 2, 1], true),
        ("flute", 2) => (4, &[7, 7, 6, 5, 5, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 1], true),
        ("flute", _) => (4, &[5, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2], true),
        // Long drinks: Collins, taper, faceted tall tumbler and bowed sides.
        ("highball", 0) => (
            5,
            &[
                5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
            ],
            false,
        ),
        ("highball", 1) => (
            5,
            &[
                8, 8, 8, 8, 7, 7, 7, 7, 7, 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 4, 4,
            ],
            false,
        ),
        ("highball", 2) => (
            5,
            &[
                7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 5, 5,
            ],
            false,
        ),
        ("highball", _) => (
            6,
            &[6, 6, 6, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 7, 7, 7, 6, 6, 6, 5],
            false,
        ),
        // Hurricane: classic hourglass, tall waist, rounded pear, flared foot.
        ("hurricane", 0) => (
            5,
            &[7, 7, 6, 5, 5, 4, 4, 5, 5, 6, 7, 8, 8, 8, 7, 6, 4, 3, 2],
            true,
        ),
        ("hurricane", 1) => (
            4,
            &[8, 7, 6, 5, 4, 4, 3, 3, 4, 5, 6, 7, 7, 7, 6, 5, 4, 3, 2],
            true,
        ),
        ("hurricane", 2) => (
            5,
            &[5, 5, 4, 4, 4, 5, 6, 7, 8, 9, 9, 9, 8, 7, 6, 4, 2],
            true,
        ),
        ("hurricane", _) => (
            5,
            &[8, 7, 6, 6, 5, 5, 5, 5, 6, 7, 8, 8, 7, 6, 5, 4, 3, 3, 2],
            true,
        ),
        // Goblet: balloon, tulip, wine bowl and broad chalice.
        ("goblet", 0) => (6, &[7, 8, 9, 10, 10, 10, 10, 10, 9, 9, 8, 7, 6, 4, 2], true),
        ("goblet", 1) => (6, &[6, 6, 7, 8, 9, 9, 9, 9, 8, 7, 6, 4, 2], true),
        ("goblet", 2) => (5, &[6, 7, 8, 8, 9, 9, 9, 9, 9, 8, 8, 7, 6, 5, 3, 2], true),
        ("goblet", _) => (7, &[10, 10, 10, 10, 9, 9, 8, 8, 7, 6, 4, 2], true),
        // Mugs: tankard, footed Irish glass, rounded mule and conical cup.
        ("mug", 0) => (
            8,
            &[7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
            false,
        ),
        ("mug", 1) => (6, &[5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 3, 2], true),
        ("mug", 2) => (10, &[6, 7, 8, 8, 9, 9, 9, 9, 9, 9, 8, 8, 7, 6], false),
        ("mug", _) => (9, &[8, 8, 8, 7, 7, 7, 7, 6, 6, 6, 6, 5, 5, 5, 5], false),
        // Rocks: straight heavy base, tapered facets, barrel and low bowl.
        (_, 0) => (12, &[9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9], false),
        (_, 1) => (
            10,
            &[10, 10, 10, 9, 9, 9, 8, 8, 8, 7, 7, 7, 6, 6, 6, 6],
            false,
        ),
        (_, 2) => (
            11,
            &[7, 8, 9, 10, 10, 10, 10, 10, 10, 10, 9, 8, 7, 7],
            false,
        ),
        (_, _) => (15, &[11, 11, 11, 11, 10, 10, 9, 9, 8, 8, 8], false),
    };
    Shape {
        top,
        half: half.to_vec(),
        stem,
    }
}

fn pixels(recipe: &Value) -> Vec<Colour> {
    let hash = identity(recipe);
    let parts = recipe["ingredients"].to_string().to_lowercase();
    let palette: [Colour; 10] = [
        [166, 74, 47, 255],
        [191, 142, 59, 255],
        [145, 173, 89, 255],
        [190, 187, 133, 255],
        [69, 156, 172, 255],
        [164, 89, 118, 255],
        [101, 67, 49, 255],
        [185, 105, 63, 255],
        [196, 179, 157, 255],
        [136, 121, 165, 255],
    ];
    let colour_index = if parts.contains("blue_curacao") {
        4
    } else if parts.contains("campari") || parts.contains("grenadine") {
        0
    } else if parts.contains("coffee") || parts.contains("espresso") {
        6
    } else if parts.contains("cream") || parts.contains("milk") {
        8
    } else if parts.contains("mint") || parts.contains("chartreuse") {
        2
    } else if parts.contains("cranberry") || parts.contains("raspberry") {
        5
    } else if parts.contains("orange") || parts.contains("pineapple") || parts.contains("aperol") {
        7
    } else if parts.contains("champagne")
        || parts.contains("prosecco")
        || parts.contains("sparkling_wine")
        || parts.contains("gin")
        || parts.contains("vodka")
    {
        3
    } else {
        hash[0] as usize % palette.len()
    };
    let liquid = palette[colour_index];
    let bright = liquid.map(|v| v.saturating_add(24));
    let dark = [liquid[0] / 2, liquid[1] / 2, liquid[2] / 2, 255];
    let mut c = Canvas(vec![[0; 4]; SIDE * SIDE]);
    c.rect(2, 1, 28, 30, BACK);
    c.rect(1, 2, 30, 28, BACK);
    c.line((3, 1), (28, 1), SHADOW);
    c.line((1, 3), (1, 28), SHADOW);
    c.line((3, 30), (28, 30), SHADOW);
    c.line((30, 3), (30, 28), SHADOW);
    c.rect(3, 3, 3, 1, CORAL);
    c.rect(26, 3, 3, 1, LIGHT);
    let (template, variant) = design(recipe);
    let Shape { top, half, stem } = shape(template, variant);
    let bottom = top + half.len() as i32 - 1;
    let liquid_top = top + 3;
    for y in top..=bottom {
        let w = half[(y - top) as usize];
        if y >= liquid_top {
            for x in 16 - w + 1..16 + w {
                let speck = hash[((x + y * 3) as usize) % hash.len()];
                let fill = if x >= 16 + w - 2 {
                    dark
                } else if y == liquid_top || (speck % 13 == 0 && (x + y) % 3 == 0) {
                    bright
                } else if variant == 2 && (x - 16).abs() % 4 == 0 {
                    bright
                } else {
                    liquid
                };
                c.pixel(x, y, fill);
            }
        }
        c.pixel(16 - w, y, GLASS);
        c.pixel(16 + w, y, SHADOW);
        if y > top + 1 && y < bottom - 1 {
            c.pixel(17 - w, y, LIGHT);
        }
    }
    c.line((16 - half[0], top), (16 + half[0], top), GLASS);
    c.line(
        (16 - half[(bottom - top) as usize], bottom),
        (16 + half[(bottom - top) as usize], bottom),
        GLASS,
    );
    if stem {
        c.line((16, bottom + 1), (16, 26), GLASS);
        match variant {
            0 => c.line((11, 27), (21, 27), GLASS),
            1 => {
                c.line((16, 25), (10, 27), GLASS);
                c.line((16, 25), (22, 27), SHADOW);
                c.line((10, 28), (22, 28), GLASS);
            }
            2 => {
                c.rect(15, 25, 3, 2, SHADOW);
                c.line((10, 27), (22, 27), GLASS);
                c.line((11, 28), (21, 28), SHADOW);
            }
            _ => {
                c.rect(14, 25, 5, 2, GLASS);
                c.line((12, 27), (20, 27), SHADOW);
            }
        }
    } else {
        // Heavy bases and bevels make short and tall tumbler variants readable
        // at 32px, not just distinguishable by a hidden digest or tiny decoration.
        let w = *half.last().unwrap();
        c.line((17 - w, bottom - 1), (15 + w, bottom - 1), SHADOW);
        c.line((16 - w, bottom + 1), (16 + w, bottom + 1), GLASS);
    }
    if template == "mug" {
        let left = 17 + half[3];
        let right = (left + 4).min(29);
        c.line((left, top + 3), (right - 1, top + 3), GLASS);
        c.line((right, top + 4), (right, bottom - 4), GLASS);
        c.line((left, bottom - 3), (right - 1, bottom - 3), SHADOW);
    }
    // Only source-confirmed foam/cream and garnish families receive literal
    // motifs. The tiny border signature differentiates even closely related cups.
    let method = recipe["method"].as_str().unwrap_or("");
    if parts.contains("egg_white")
        || parts.contains("cream")
        || (parts.contains("espresso") && method.contains("shake"))
    {
        let w = half[(liquid_top - top) as usize];
        c.line((18 - w, liquid_top), (15 + w, liquid_top), LIGHT);
    }
    let garnish = recipe["garnish_zh"].as_str().unwrap_or("");
    if garnish.contains('橙')
        || garnish.contains('柠')
        || garnish.contains('檬')
        || garnish.to_lowercase().contains("lemon")
    {
        c.rect(20, top - 2, 4, 3, [196, 161, 62, 255]);
        c.pixel(22, top - 1, LIGHT);
    } else if garnish.contains('薄') || garnish.to_lowercase().contains("mint") {
        c.line((20, top), (24, top - 4), [88, 143, 104, 255]);
        c.rect(22, top - 4, 2, 2, [133, 181, 118, 255]);
    } else if garnish.contains('樱') || garnish.to_lowercase().contains("cherry") {
        c.rect(21, top - 1, 3, 3, CORAL);
    }
    // A 24-bit two-colour pixel signature stays visible at common 32/48px
    // desktop sizes. Cup texture uses the remaining digest bits.
    for bit in 0..24 {
        let colour = if hash[4 + bit / 8] & (1 << (bit % 8)) != 0 {
            liquid
        } else {
            SHADOW
        };
        c.pixel(4 + bit as i32, 29, colour);
    }
    c.0
}

/// Standard uncompressed 32-bit ICO: Explorer can read this directly, including
/// when the extension is .pixelmix and a verified data trailer follows it.
pub(super) fn ico(recipe: &Value, sizes: &[u16]) -> Vec<u8> {
    let pixels = pixels(recipe);
    let nebula = zhenglin::appearance(recipe);
    let dlc = xiaodong::appearance(recipe);
    let mut directory = vec![0, 0, 1, 0];
    directory.extend_from_slice(&(sizes.len() as u16).to_le_bytes());
    let mut images = Vec::new();
    let mut offset = 6 + 16 * sizes.len();
    for &size in sizes {
        let n = size as usize;
        let dedicated = nebula
            .map(|appearance| zhenglin::pixels(appearance, n))
            .or_else(|| {
                dlc.map(|appearance| {
                    xiaodong::pixels(
                        appearance,
                        recipe["glass_template"].as_str().unwrap_or("rocks"),
                        n,
                    )
                })
            });
        let mask_stride = n.div_ceil(32) * 4;
        let length = 40 + n * n * 4 + mask_stride * n;
        directory.extend_from_slice(&[if n == 256 { 0 } else { n as u8 }; 2]);
        directory.extend_from_slice(&[0, 0, 1, 0, 32, 0]);
        directory.extend_from_slice(&(length as u32).to_le_bytes());
        directory.extend_from_slice(&(offset as u32).to_le_bytes());
        offset += length;
        images.extend_from_slice(&40u32.to_le_bytes());
        images.extend_from_slice(&(n as i32).to_le_bytes());
        images.extend_from_slice(&((n * 2) as i32).to_le_bytes());
        images.extend_from_slice(&[1, 0, 32, 0]);
        images.extend_from_slice(&0u32.to_le_bytes());
        images.extend_from_slice(&((n * n * 4) as u32).to_le_bytes());
        images.extend_from_slice(&[0; 16]);
        let scaled = |x: usize, y: usize| {
            if let Some(frame) = &dedicated {
                frame[y * n + x]
            } else {
                pixels[((2 * y + 1) * SIDE / (2 * n)).min(SIDE - 1) * SIDE
                    + ((2 * x + 1) * SIDE / (2 * n)).min(SIDE - 1)]
            }
        };
        for y in (0..n).rev() {
            for x in 0..n {
                let p = scaled(x, y);
                images.extend_from_slice(&[p[2], p[1], p[0], p[3]]);
            }
        }
        for y in (0..n).rev() {
            let mut mask = vec![0; mask_stride];
            for x in 0..n {
                if scaled(x, y)[3] == 0 {
                    mask[x / 8] |= 0x80 >> (x % 8);
                }
            }
            images.extend_from_slice(&mask);
        }
    }
    directory.extend_from_slice(&images);
    directory
}

pub(super) fn archive_sizes(recipe: &Value) -> &'static [u16] {
    if zhenglin::appearance(recipe).is_some() || xiaodong::appearance(recipe).is_some() {
        &[16, 24, 32, 48, 64, 128, 256]
    } else {
        &[16, 24, 32, 48, 64, 128]
    }
}

pub(super) fn verify(bytes: &[u8]) -> bool {
    if bytes.len() < 6 || bytes[..4] != [0, 0, 1, 0] {
        return false;
    }
    let count = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
    if count == 0 || count > 8 || bytes.len() < 6 + 16 * count {
        return false;
    }
    let mut expected = 6 + 16 * count;
    for i in 0..count {
        let d = &bytes[6 + 16 * i..6 + 16 * (i + 1)];
        let n = if d[0] == 0 { 256 } else { d[0] as usize };
        let length = u32::from_le_bytes(d[8..12].try_into().unwrap()) as usize;
        let offset = u32::from_le_bytes(d[12..16].try_into().unwrap()) as usize;
        if ![16, 24, 32, 48, 64, 96, 128, 256].contains(&n)
            || d[1] != d[0]
            || d[2..8] != [0, 0, 1, 0, 32, 0]
            || offset != expected
            || length != 40 + n * n * 4 + n.div_ceil(32) * 4 * n
            || offset
                .checked_add(length)
                .is_none_or(|end| end > bytes.len())
        {
            return false;
        }
        let b = &bytes[offset..offset + 40];
        if b[..4] != 40u32.to_le_bytes()
            || b[4..8] != (n as u32).to_le_bytes()
            || b[8..12] != ((n * 2) as u32).to_le_bytes()
            || b[12..16] != [1, 0, 32, 0]
            || b[16..20] != [0; 4]
        {
            return false;
        }
        expected += length;
    }
    expected == bytes.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn thirty_two_silhouettes_are_distinct_and_within_the_tile() {
        let mut silhouettes = std::collections::HashSet::new();
        for family in [
            "rocks",
            "martini",
            "coupe",
            "flute",
            "highball",
            "hurricane",
            "goblet",
            "mug",
        ] {
            for variant in 0..4 {
                let s = shape(family, variant);
                assert!(s.top >= 4 && s.top + s.half.len() as i32 <= 27);
                assert!(s.half.iter().all(|w| (1..=12).contains(w)));
                assert!(
                    silhouettes.insert((s.top, s.half, s.stem, family == "mug")),
                    "duplicate {family}/{variant}"
                );
            }
        }
        assert_eq!(silhouettes.len(), 32);
    }
}
