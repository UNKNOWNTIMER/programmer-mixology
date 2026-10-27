//! Pure deterministic domain functions. No network, database, or model authority.
use serde::{Deserialize, Serialize};

pub const TASTE_AXES: [&str; 5] = ["sweet", "sour", "bitter", "salty", "umami"];
pub const SENSORY_AXES: [&str; 7] = [
    "alcohol_heat",
    "aroma",
    "body",
    "carbonation",
    "cooling",
    "spiciness",
    "finish",
];
pub type Taste = [u16; 5];
pub type Sensory = [f64; 7];
pub type Result<T> = std::result::Result<T, DomainError>;

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct DomainError(pub String);
fn invalid(message: &str) -> DomainError {
    DomainError(message.into())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TargetProfile {
    pub taste_bps: Taste,
    pub sensory_0_10: Sensory,
}
impl TargetProfile {
    pub fn validate(&self) -> Result<()> {
        validate_bps(&self.taste_bps)?;
        validate_sensory(&self.sensory_0_10)
    }
}

pub fn validate_bps(values: &Taste) -> Result<()> {
    if values.iter().map(|v| u32::from(*v)).sum::<u32>() != 10_000 {
        return Err(invalid(
            "Five nonnegative integer basis points must sum to 10000",
        ));
    }
    Ok(())
}

pub fn validate_sensory(values: &Sensory) -> Result<()> {
    if values
        .iter()
        .any(|v| !v.is_finite() || !(0.0..=10.0).contains(v))
    {
        return Err(invalid(
            "Seven finite sensory intensities in [0,10] required",
        ));
    }
    Ok(())
}

/// Stable largest remainders. Integer weights avoid floating point tie drift.
pub fn allocate(total: u32, weights: &[u32]) -> Result<Vec<u32>> {
    if weights.is_empty() {
        return if total == 0 {
            Ok(vec![])
        } else {
            Err(invalid("No recipient for positive budget"))
        };
    }
    let mut weights: Vec<u64> = weights.iter().map(|x| u64::from(*x)).collect();
    if weights.iter().all(|x| *x == 0) {
        weights.fill(1);
    }
    let denominator: u64 = weights.iter().sum();
    let numerators: Vec<u64> = weights.iter().map(|x| x * u64::from(total)).collect();
    let mut result: Vec<u32> = numerators
        .iter()
        .map(|x| (x / denominator) as u32)
        .collect();
    let mut order: Vec<usize> = (0..weights.len()).collect();
    order.sort_by(|a, b| {
        (numerators[*b] % denominator)
            .cmp(&(numerators[*a] % denominator))
            .then(a.cmp(b))
    });
    let missing = total - result.iter().sum::<u32>();
    for index in order.into_iter().take(missing as usize) {
        result[index] += 1;
    }
    Ok(result)
}

/// Every drag event must use the gesture-start anchor, not the previous result.
pub fn redistribute_bps(
    anchor: Taste,
    axis: usize,
    requested: i32,
    locked: &[usize],
) -> Result<Taste> {
    validate_bps(&anchor)?;
    if axis >= 5 || locked.iter().any(|x| *x >= 5) {
        return Err(invalid("Invalid axis or lock"));
    }
    let mut locks = [false; 5];
    for index in locked {
        locks[*index] = true;
    }
    if locks[axis] {
        return Err(invalid("Selected axis is locked"));
    }
    let others: Vec<usize> = (0..5).filter(|i| *i != axis && !locks[*i]).collect();
    let budget = 10_000
        - (0..5)
            .filter(|i| locks[*i])
            .map(|i| i32::from(anchor[i]))
            .sum::<i32>();
    let value = if others.is_empty() {
        budget
    } else {
        requested.clamp(0, budget)
    };
    let mut out = anchor;
    out[axis] = value as u16;
    let shares = allocate(
        (budget - value) as u32,
        &others
            .iter()
            .map(|i| u32::from(anchor[*i]))
            .collect::<Vec<_>>(),
    )?;
    for (index, share) in others.into_iter().zip(shares) {
        out[index] = share as u16;
    }
    validate_bps(&out)?;
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MatchIndex {
    pub index: Option<f64>,
    pub taste_distance: Option<f64>,
    pub sensory_distance: Option<f64>,
    pub coverage: f64,
    pub calibrated: bool,
}

pub fn match_index(
    target: &TargetProfile,
    taste: &Taste,
    sensory: &Sensory,
    taste_weight: f64,
) -> Result<MatchIndex> {
    validate_bps(taste)?;
    validate_sensory(sensory)?;
    match_partial(target, Some(*taste), sensory.map(Some), taste_weight)
}

/// Missing sensory axes are omitted, not filled with zero. Missing tastes stay unknown.
pub fn match_partial(
    target: &TargetProfile,
    taste: Option<Taste>,
    sensory: [Option<f64>; 7],
    weight: f64,
) -> Result<MatchIndex> {
    target.validate()?;
    if !weight.is_finite() || !(0.0..=1.0).contains(&weight) {
        return Err(invalid("Invalid taste weight"));
    }
    let dt = if let Some(t) = taste {
        validate_bps(&t)?;
        Some(
            target
                .taste_bps
                .iter()
                .zip(t)
                .map(|(a, b)| (i32::from(*a) - i32::from(b)).abs() as f64)
                .sum::<f64>()
                / 20_000.0,
        )
    } else {
        None
    };
    let mut count = 0;
    let mut distance = 0.0;
    for (actual, desired) in sensory.into_iter().zip(target.sensory_0_10) {
        if let Some(actual) = actual {
            if !actual.is_finite() || !(0.0..=10.0).contains(&actual) {
                return Err(invalid("Invalid sensory prediction"));
            }
            count += 1;
            distance += (actual - desired).abs();
        }
    }
    let ds = if count > 0 {
        Some(distance / (count as f64 * 10.0))
    } else {
        None
    };
    let w_t = if dt.is_some() { weight } else { 0.0 };
    let w_s = if ds.is_some() { 1.0 - weight } else { 0.0 };
    let index = if w_t + w_s > 0.0 {
        Some(
            ((100.0 * (1.0 - (w_t * dt.unwrap_or(0.0) + w_s * ds.unwrap_or(0.0)) / (w_t + w_s)))
                .clamp(0.0, 100.0)
                * 10.0)
                .round()
                / 10.0,
        )
    } else {
        None
    };
    Ok(MatchIndex {
        index,
        taste_distance: dt,
        sensory_distance: ds,
        coverage: ((if dt.is_some() { 5 } else { 0 }) + count) as f64 / 12.0,
        calibrated: false,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PhysicalComponent {
    pub consumed_ml: Option<f64>,
    pub abv_fraction: Option<f64>,
}

pub fn estimate_abv(
    components: &[PhysicalComponent],
    dilution_ml: Option<f64>,
) -> Result<serde_json::Value> {
    use serde_json::json;
    let Some(dilution) = dilution_ml else {
        return Ok(json!({"abv_fraction":null,"reason":"unknown_dilution"}));
    };
    if !dilution.is_finite() || dilution < 0.0 {
        return Err(invalid("Invalid dilution"));
    }
    let (mut total, mut ethanol) = (dilution, 0.0);
    for part in components {
        let (Some(volume), Some(abv)) = (part.consumed_ml, part.abv_fraction) else {
            return Ok(json!({"abv_fraction":null,"reason":"unknown_volume_or_ABV"}));
        };
        if !volume.is_finite() || volume < 0.0 || !abv.is_finite() || !(0.0..=1.0).contains(&abv) {
            return Err(invalid("Invalid physical input"));
        }
        total += volume;
        ethanol += volume * abv;
    }
    if total <= 0.0 {
        return Ok(json!({"abv_fraction":null,"reason":"empty_drink"}));
    }
    Ok(
        json!({"abv_fraction":ethanol/total,"ethanol_ml":ethanol,"served_liquid_ml":total,"status":"estimate","assumed_dilution_ml":dilution}),
    )
}

/// Eight deterministic ASCII templates. Liquid is a mixed schematic, not taste layering.
pub fn render_glass(template: &str, liquid: bool) -> Result<String> {
    let rows: &[&str] = match template {
        "highball" => &[
            "     __________",
            "    |          |",
            "    |          |",
            "    |          |",
            "    |          |",
            "    |          |",
            "    |__________|",
        ],
        "rocks" => &[
            "    ____________",
            "   |            |",
            "   |            |",
            "   |            |",
            "   |____________|",
        ],
        "martini" => &[
            "  ________________",
            "   \\            /",
            "    \\          /",
            "     \\        /",
            "      \\______/",
            "         ||",
            "         ||",
            "      ___||___",
        ],
        "coupe" => &[
            "   ______________",
            "   \\            /",
            "    \\__________/",
            "         ||",
            "         ||",
            "      ___||___",
        ],
        "flute" => &[
            "       ______",
            "      |      |",
            "      |      |",
            "      |      |",
            "       \\____/",
            "         ||",
            "         ||",
            "       __||__",
        ],
        "hurricane" => &[
            "      ________",
            "     /        \\",
            "     \\        /",
            "      |      |",
            "     /        \\",
            "     \\________/",
            "         ||",
            "      ___||___",
        ],
        "mug" => &[
            "    __________",
            "   |          |__",
            "   |          |  |",
            "   |          |__|",
            "   |__________|",
        ],
        "goblet" => &[
            "     __________",
            "    /          \\",
            "    \\          /",
            "     \\________/",
            "         ||",
            "      ___||___",
        ],
        _ => return Err(invalid("Unknown glass template")),
    };
    let mut out = Vec::new();
    for row in rows {
        let mut bytes = row.as_bytes().to_vec();
        if liquid {
            let walls: Vec<_> = bytes
                .iter()
                .enumerate()
                .filter(|(_, v)| b"|/\\".contains(v))
                .map(|(i, _)| i)
                .collect();
            if walls.len() >= 2 && walls[1] - walls[0] > 3 {
                for (i, byte) in bytes
                    .iter_mut()
                    .enumerate()
                    .take(walls[1])
                    .skip(walls[0] + 1)
                {
                    if *byte == b' ' {
                        *byte = if i % 3 == 0 { b':' } else { b'.' };
                    }
                }
            }
        }
        out.push(String::from_utf8(bytes).expect("static ASCII templates"));
    }
    Ok(out.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_unchanged_python_reference_golden_files() {
        #[derive(Deserialize)]
        struct Case {
            anchor: Taste,
            axis: usize,
            requested: i32,
            locked: Vec<usize>,
            expected: Taste,
        }
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("../../../tests/fixtures/taste-golden.json"))
                .unwrap();
        assert_eq!(cases.len(), 2000);
        for case in cases {
            assert_eq!(
                redistribute_bps(case.anchor, case.axis, case.requested, &case.locked).unwrap(),
                case.expected
            );
        }
        let glasses: std::collections::BTreeMap<String, String> =
            serde_json::from_str(include_str!("../../../tests/fixtures/glass-golden.json"))
                .unwrap();
        for (template, expected) in glasses {
            assert_eq!(
                render_glass(&template, true).unwrap(),
                expected,
                "{template}"
            );
        }
    }
    #[test]
    fn reference_examples_and_boundaries() {
        let p = [4000, 3000, 2000, 500, 500];
        assert_eq!(
            redistribute_bps(p, 0, 6000, &[]).unwrap(),
            [6000, 2000, 1334, 333, 333]
        );
        assert_eq!(
            redistribute_bps([10000, 0, 0, 0, 0], 0, 6000, &[]).unwrap(),
            [6000, 1000, 1000, 1000, 1000]
        );
        assert_eq!(
            redistribute_bps(p, 0, 9000, &[1]).unwrap(),
            [7000, 3000, 0, 0, 0]
        );
        assert_eq!(redistribute_bps(p, 0, 0, &[1, 2, 3, 4]).unwrap(), p);
        assert!(redistribute_bps(p, 0, 100, &[0]).is_err());
        assert!(redistribute_bps(p, 8, 100, &[]).is_err());
        assert!(redistribute_bps([1, 2, 3, 4, 5], 0, 100, &[]).is_err());
        assert_eq!(allocate(2, &[1, 1, 1]).unwrap(), [1, 1, 0]);
        assert_eq!(redistribute_bps(p, 0, -100, &[]).unwrap()[0], 0);
    }
    #[test]
    fn hundred_thousand_integer_invariants() {
        let mut rng = 812_u64;
        let mut next = || {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            rng
        };
        for _ in 0..100_000 {
            let weights: Vec<_> = (0..5).map(|_| (next() % 10_001) as u32).collect();
            let p: Taste = allocate(10_000, &weights)
                .unwrap()
                .into_iter()
                .map(|x| x as u16)
                .collect::<Vec<_>>()
                .try_into()
                .unwrap();
            let axis = (next() % 5) as usize;
            let locks: Vec<_> = (0..5).filter(|i| *i != axis && next() % 3 == 0).collect();
            let adjusted =
                redistribute_bps(p, axis, (next() % 20_001) as i32 - 5000, &locks).unwrap();
            assert_eq!(adjusted.iter().map(|v| u32::from(*v)).sum::<u32>(), 10_000);
            for index in &locks {
                assert_eq!(adjusted[*index], p[*index]);
            }
            assert_eq!(
                redistribute_bps(p, axis, p[axis] as i32, &locks).unwrap(),
                p
            );
        }
    }
    #[test]
    fn nonintegers_and_unknown_fields_rejected() {
        for value in ["3.5", "true", "null", "-1"] {
            assert!(serde_json::from_str::<TargetProfile>(&format!(
                r#"{{"taste_bps":[{value},2000,2000,2000,2000],"sensory_0_10":[5,5,5,5,5,5,5]}}"#
            ))
            .is_err());
        }
        assert!(validate_sensory(&[f64::NAN; 7]).is_err());
        assert!(validate_sensory(&[f64::INFINITY; 7]).is_err());
    }
    #[test]
    fn match_and_missing_coverage() {
        let p = TargetProfile {
            taste_bps: [2000; 5],
            sensory_0_10: [5.0; 7],
        };
        assert_eq!(
            match_index(&p, &p.taste_bps, &p.sensory_0_10, 0.6)
                .unwrap()
                .index,
            Some(100.0)
        );
        assert_eq!(match_partial(&p, None, [None; 7], 0.6).unwrap().index, None);
        let partial = match_partial(
            &p,
            None,
            [Some(5.0), None, None, None, None, None, None],
            0.6,
        )
        .unwrap();
        assert_eq!(partial.index, Some(100.0));
        assert_eq!(partial.coverage, 1.0 / 12.0);
        let opposite = TargetProfile {
            taste_bps: [10000, 0, 0, 0, 0],
            sensory_0_10: [0.0; 7],
        };
        assert_eq!(
            match_index(&opposite, &[0, 10000, 0, 0, 0], &[10.0; 7], 0.6)
                .unwrap()
                .index,
            Some(0.0)
        );
    }
    #[test]
    fn physical_unknowns_remain_unknown() {
        let parts = [
            PhysicalComponent {
                consumed_ml: Some(60.0),
                abv_fraction: Some(0.4),
            },
            PhysicalComponent {
                consumed_ml: Some(30.0),
                abv_fraction: Some(0.0),
            },
        ];
        assert!(estimate_abv(&parts, None).unwrap()["abv_fraction"].is_null());
        let result = estimate_abv(&parts, Some(30.0)).unwrap();
        assert_eq!(result["ethanol_ml"], 24.0);
        assert_eq!(result["abv_fraction"], 0.2);
        assert!(estimate_abv(
            &[PhysicalComponent {
                consumed_ml: None,
                abv_fraction: Some(0.4)
            }],
            Some(0.0)
        )
        .unwrap()["abv_fraction"]
            .is_null());
        assert!(estimate_abv(
            &[PhysicalComponent {
                consumed_ml: Some(60.0),
                abv_fraction: Some(1.2)
            }],
            Some(0.0)
        )
        .is_err());
    }
    #[test]
    fn ascii_templates_are_stable() {
        for glass in [
            "highball",
            "rocks",
            "martini",
            "coupe",
            "flute",
            "hurricane",
            "mug",
            "goblet",
        ] {
            let output = render_glass(glass, true).unwrap();
            assert!(output.is_ascii());
            assert!(output.len() > 10);
            assert_eq!(output, render_glass(glass, true).unwrap());
        }
        assert!(render_glass("javascript:alert(1)", true).is_err());
    }
}
