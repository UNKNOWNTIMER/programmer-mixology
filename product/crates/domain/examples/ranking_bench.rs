//! Local measured compute benchmark. Synthetic expansion is explicitly labeled.
use pixelmix_domain::{match_index, Sensory, TargetProfile, Taste};
use serde::Deserialize;
use serde_json::json;
use std::time::Instant;

#[derive(Deserialize)]
struct Seed {
    profiles: Vec<Profile>,
}
#[derive(Clone, Deserialize)]
struct Profile {
    taste_preference_bps: Taste,
    sensory_0_10: Sensory,
}

fn measure(profiles: &[Profile], label: &str) -> serde_json::Value {
    let target = TargetProfile {
        taste_bps: [4000, 5000, 1000, 0, 0],
        sensory_0_10: [5.0, 6.0, 4.0, 0.0, 1.0, 0.0, 5.0],
    };
    let mut samples = Vec::new();
    let mut checksum = 0.0;
    for round in 0..110 {
        let started = Instant::now();
        let mut scores: Vec<_> = profiles
            .iter()
            .enumerate()
            .map(|(index, p)| {
                (
                    index,
                    match_index(&target, &p.taste_preference_bps, &p.sensory_0_10, 0.6)
                        .unwrap()
                        .index
                        .unwrap(),
                )
            })
            .collect();
        scores.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        std::hint::black_box(&scores);
        if round >= 10 {
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        checksum += scores[0].1;
    }
    samples.sort_by(f64::total_cmp);
    json!({"dataset":label,"records":profiles.len(),"warmup_runs":10,"measured_runs":100,"p50_ms":samples[49],"p95_ms":samples[94],"max_ms":samples[99],"checksum":checksum,"scope":"pure_Rust_match_and_sort_excludes_UI_DB_IPC"})
}
fn main() {
    let seed: Seed =
        serde_json::from_str(include_str!("../../../../data/profiles.seed.json")).unwrap();
    let synthetic: Vec<Profile> = (0..10_000)
        .map(|i| seed.profiles[i % seed.profiles.len()].clone())
        .collect();
    let result = json!({"profile":"release_recommended","seed_prior_status":"heuristic_unvalidated","measurements":[measure(&seed.profiles,"actual_70_seed_profiles"),measure(&synthetic,"synthetic_10000_repeated_seed_profiles")]});
    println!("{}", serde_json::to_string_pretty(&result).unwrap());
}
