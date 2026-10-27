//! Dedicated native pixel art for the user's Zhenglin Soup recipe.
//! The foam and lemon orbit are optional presentation motifs from 文件.txt;
//! they disappear when their corresponding ingredient rows are removed.
use super::Colour;
use serde_json::Value;

#[derive(Clone, Copy)]
pub(super) struct Appearance {
    foam: bool,
    peel: bool,
    cassis_drops: bool,
}

/// Match recipe content, never a transient personal/archive ID. A differently
/// named drink, altered core dose, or additional main liquid uses the generic
/// portrait. Metadata, ingredient ordering and integer/float JSON representation
/// do not change this drink's artwork.
pub(super) fn appearance(recipe: &Value) -> Option<Appearance> {
    if !recipe["name_en"]
        .as_str()?
        .trim()
        .eq_ignore_ascii_case("Zhenglin Soup")
        || recipe["glass_template"] != "coupe"
        || recipe["method"] != "shake"
    {
        return None;
    }
    let parts = recipe["ingredients"].as_array()?;
    let core = [
        ("gin", 45.0),
        ("cassis", 15.0),
        ("cointreau", 10.0),
        ("lemon", 22.5),
        ("simple_syrup", 7.5),
    ];
    let mut seen = [false; 5];
    let mut result = Appearance {
        foam: false,
        peel: false,
        cassis_drops: false,
    };
    let present = |part: &Value| {
        part["quantity"]
            .as_f64()
            .is_some_and(|v| v.is_finite() && v > 0.)
            || part["quantity_range"].as_array().is_some_and(|range| {
                range.len() == 2
                    && range
                        .iter()
                        .all(|v| v.as_f64().is_some_and(|v| v.is_finite() && v > 0.))
            })
    };
    for part in parts {
        let id = part["ingredient_id"].as_str()?;
        let stage = part["stage"].as_str()?;
        if stage == "mix" {
            if id == "cdb_ice" && part["unit"] == "g" {
                continue;
            }
            let index = core.iter().position(|(known, _)| id == *known)?;
            if seen[index]
                || part["unit"] != "ml"
                || part["optional"] != false
                || part["quantity"].as_f64()? != core[index].1
                || !part["quantity_range"].is_null()
            {
                return None;
            }
            seen[index] = true;
        } else if id == "user_zhenglin_nebula_foam" && matches!(stage, "float" | "garnish") {
            result.foam |= part["unit"] == "ml" && present(part);
        } else if stage == "garnish" {
            result.peel |= id == "cdb_lemon_peel" && part["unit"] == "piece" && present(part);
            result.cassis_drops |= id == "cassis" && part["unit"] == "drop" && present(part);
        } else {
            return None;
        }
    }
    seen.iter().all(|v| *v).then_some(result)
}

const N: usize = 64;
const TRANSPARENT: Colour = [0, 0, 0, 0];
const BACK: Colour = [9, 18, 31, 255];
const FRAME: Colour = [66, 82, 105, 255];
const GLASS: Colour = [167, 205, 213, 255];
const GLASS_LIGHT: Colour = [217, 234, 229, 255];
const GLASS_SHADOW: Colour = [68, 107, 128, 255];
const BERRY: Colour = [143, 39, 101, 255];
const BERRY_LIGHT: Colour = [189, 59, 124, 255];
const BERRY_DEEP: Colour = [84, 30, 76, 255];
const FOAM: Colour = [243, 237, 220, 255];
const FOAM_SHADE: Colour = [190, 183, 199, 255];
const GOLD: Colour = [238, 191, 70, 255];
const GOLD_LIGHT: Colour = [255, 224, 127, 255];
const GOLD_SHADOW: Colour = [159, 101, 42, 255];

struct Tile(Vec<Colour>);
impl Tile {
    fn new() -> Self {
        Self(vec![TRANSPARENT; N * N])
    }
    fn dot(&mut self, x: i32, y: i32, colour: Colour) {
        if (0..N as i32).contains(&x) && (0..N as i32).contains(&y) {
            self.0[y as usize * N + x as usize] = colour;
        }
    }
    fn rect(&mut self, x: i32, y: i32, w: i32, h: i32, colour: Colour) {
        for yy in y..y + h {
            for xx in x..x + w {
                self.dot(xx, yy, colour);
            }
        }
    }
    fn line(&mut self, a: (i32, i32), b: (i32, i32), colour: Colour) {
        let (mut x, mut y) = a;
        let (dx, dy) = ((b.0 - x).abs(), -(b.1 - y).abs());
        let (sx, sy) = (if x < b.0 { 1 } else { -1 }, if y < b.1 { 1 } else { -1 });
        let mut error = dx + dy;
        loop {
            self.dot(x, y, colour);
            if (x, y) == b {
                break;
            }
            let twice = error * 2;
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
    fn path(&mut self, points: &[(i32, i32)], colour: Colour) {
        for edge in points.windows(2) {
            self.line(edge[0], edge[1], colour);
        }
    }
    fn star(&mut self, x: i32, y: i32, colour: Colour) {
        self.line((x - 1, y), (x + 1, y), colour);
        self.line((x, y - 1), (x, y + 1), colour);
    }
}

fn master(a: Appearance) -> Vec<Colour> {
    let mut c = Tile::new();
    c.rect(3, 2, 58, 60, BACK);
    c.rect(2, 3, 60, 58, BACK);
    c.line((5, 2), (58, 2), FRAME);
    c.line((2, 5), (2, 58), FRAME);
    c.line((5, 61), (58, 61), FRAME);
    c.line((61, 5), (61, 58), FRAME);
    // A quiet constellation leaves the coupe, foam and peel as the dominant shapes.
    c.star(12, 11, [144, 158, 188, 255]);
    c.star(51, 43, [145, 155, 188, 255]);
    c.dot(23, 8, GLASS_SHADOW);
    c.dot(7, 44, FRAME);
    c.rect(53, 8, 2, 2, GLASS_SHADOW);
    c.dot(44, 53, FRAME);
    c.dot(18, 48, GLASS_SHADOW);
    if a.peel {
        // Back half of the lemon-peel loop, behind the glass rim.
        c.path(
            &[
                (9, 25),
                (10, 20),
                (15, 15),
                (24, 12),
                (36, 10),
                (47, 10),
                (54, 12),
                (56, 15),
            ],
            GOLD_SHADOW,
        );
        c.path(
            &[
                (10, 25),
                (11, 20),
                (16, 16),
                (25, 13),
                (36, 11),
                (47, 11),
                (53, 13),
                (55, 16),
            ],
            GOLD,
        );
        c.path(&[(18, 15), (25, 13), (36, 11), (43, 11)], GOLD_LIGHT);
    }
    // Rounded, shallow coupe with a magenta bowl, darker berry underside and
    // asymmetric cut-glass glints. The stem is two pixels wide at the 64px master.
    let widths = [21, 22, 22, 21, 21, 20, 20, 19, 18, 17, 16, 14, 12, 10, 7, 4];
    for (row, &half) in widths.iter().enumerate() {
        let y = 24 + row as i32;
        for x in 32 - half..=32 + half {
            let colour = if y >= 36 || x > 32 + half - 3 {
                BERRY_DEEP
            } else if y <= 27 || (x < 27 && y < 33) {
                BERRY_LIGHT
            } else {
                BERRY
            };
            c.dot(x, y, colour);
        }
        c.dot(31 - half, y, GLASS_LIGHT);
        c.dot(32 - half, y, GLASS);
        c.dot(33 + half, y, GLASS_SHADOW);
    }
    c.path(
        &[
            (10, 24),
            (10, 22),
            (16, 20),
            (25, 19),
            (39, 19),
            (48, 20),
            (54, 22),
            (55, 24),
        ],
        GLASS,
    );
    c.path(
        &[(10, 24), (16, 26), (25, 27), (39, 27), (49, 26), (55, 24)],
        GLASS_SHADOW,
    );
    c.path(&[(12, 22), (18, 21), (28, 20), (38, 20)], GLASS_LIGHT);
    c.path(&[(14, 29), (17, 32), (21, 35)], GLASS_LIGHT);
    c.path(&[(15, 30), (18, 33), (22, 36)], GLASS);
    c.path(&[(25, 39), (30, 41), (35, 41), (41, 39)], GLASS_SHADOW);
    c.line((31, 41), (31, 55), GLASS);
    c.line((32, 41), (32, 55), GLASS_LIGHT);
    c.line((33, 43), (33, 54), GLASS_SHADOW);
    c.path(
        &[
            (31, 55),
            (25, 57),
            (20, 58),
            (20, 59),
            (43, 59),
            (43, 58),
            (36, 56),
            (33, 55),
        ],
        GLASS_SHADOW,
    );
    c.line((23, 57), (40, 57), GLASS);
    c.line((21, 58), (42, 58), GLASS_LIGHT);
    // Illustrative white nebula: an open crescent, with the berry surface visible.
    if a.foam {
        c.path(
            &[(17, 25), (20, 23), (26, 22), (33, 22), (40, 23), (43, 24)],
            FOAM_SHADE,
        );
        c.path(
            &[(17, 26), (19, 24), (24, 23), (31, 23), (38, 24), (41, 25)],
            FOAM,
        );
        c.path(
            &[(18, 27), (20, 25), (25, 24), (31, 24), (35, 25), (36, 27)],
            FOAM,
        );
        c.path(
            &[
                (19, 28),
                (22, 27),
                (27, 27),
                (33, 28),
                (38, 29),
                (43, 28),
                (46, 26),
            ],
            FOAM,
        );
        c.path(
            &[(24, 28), (30, 29), (37, 30), (42, 29), (46, 27)],
            FOAM_SHADE,
        );
        c.dot(20, 26, GLASS_LIGHT);
        c.dot(39, 28, GLASS_LIGHT);
        if a.cassis_drops {
            c.path(&[(24, 24), (28, 24), (31, 25)], BERRY);
            c.path(&[(35, 28), (39, 28), (41, 27)], BERRY_LIGHT);
        }
    }
    if a.peel {
        // Front half is drawn last: an unmistakable gold orbit, not a flat slice.
        c.path(
            &[
                (56, 15),
                (56, 19),
                (53, 23),
                (47, 27),
                (38, 31),
                (28, 33),
                (19, 33),
                (13, 31),
                (10, 28),
                (9, 25),
            ],
            GOLD_SHADOW,
        );
        c.path(
            &[
                (55, 16),
                (55, 19),
                (52, 23),
                (46, 27),
                (37, 31),
                (28, 32),
                (20, 32),
                (14, 30),
                (11, 28),
            ],
            GOLD,
        );
        c.path(
            &[(52, 23), (46, 27), (37, 31), (28, 32), (23, 32)],
            GOLD_LIGHT,
        );
        c.rect(52, 18, 3, 2, GOLD);
        c.dot(52, 18, GOLD_LIGHT);
    }
    // A very small berry signature, away from the bowl's physical presentation.
    c.rect(7, 56, 2, 2, BERRY);
    c.rect(10, 56, 2, 2, BERRY_LIGHT);
    c.0
}

fn small(a: Appearance) -> Vec<Colour> {
    // Hand-hinted 16px silhouette. No thin feature depends on downsampling luck.
    let mut p = vec![TRANSPARENT; 16 * 16];
    let mut dot = |x: usize, y: usize, c: Colour| {
        p[y * 16 + x] = c;
    };
    for y in 1..15 {
        for x in 1..15 {
            dot(
                x,
                y,
                if x == 1 || y == 1 || x == 14 || y == 14 {
                    FRAME
                } else {
                    BACK
                },
            );
        }
    }
    dot(3, 3, GLASS);
    dot(12, 3, GLASS_SHADOW);
    if a.peel {
        for (x, y) in [
            (4, 5),
            (5, 4),
            (6, 3),
            (7, 3),
            (8, 3),
            (9, 3),
            (10, 3),
            (11, 4),
            (12, 5),
        ] {
            dot(x, y, GOLD_SHADOW);
        }
    }
    for (y, left, right) in [(5, 3, 12), (6, 3, 12), (7, 4, 11), (8, 5, 10), (9, 6, 9)] {
        for x in left..=right {
            dot(
                x,
                y,
                if x == left {
                    GLASS
                } else if x == right {
                    GLASS_SHADOW
                } else if y < 8 {
                    BERRY_LIGHT
                } else {
                    BERRY
                },
            );
        }
    }
    for x in 4..12 {
        dot(x, 5, GLASS);
    }
    if a.foam {
        for (x, y) in [(5, 6), (6, 6), (7, 6), (8, 7), (9, 7)] {
            dot(x, y, FOAM);
        }
    }
    if a.peel {
        for (x, y) in [
            (12, 5),
            (12, 6),
            (11, 7),
            (10, 8),
            (9, 8),
            (8, 9),
            (7, 9),
            (6, 9),
            (5, 8),
            (4, 7),
        ] {
            dot(x, y, GOLD);
        }
        dot(11, 7, GOLD_LIGHT);
    }
    for y in 10..13 {
        dot(8, y, GLASS_LIGHT);
    }
    for x in 5..12 {
        dot(
            x,
            13,
            if x == 5 || x == 11 {
                GLASS_SHADOW
            } else {
                GLASS
            },
        );
    }
    p
}

pub(super) fn pixels(a: Appearance, n: usize) -> Vec<Colour> {
    let (source, side) = if n <= 24 {
        (small(a), 16)
    } else {
        (master(a), N)
    };
    (0..n * n)
        .map(|offset| {
            let x = offset % n;
            let y = offset / n;
            source[((2 * y + 1) * side / (2 * n)).min(side - 1) * side
                + ((2 * x + 1) * side / (2 * n)).min(side - 1)]
        })
        .collect()
}

#[cfg(test)]
mod tests;
