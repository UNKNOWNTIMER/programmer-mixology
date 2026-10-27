"""Dependency-free executable specifications. Port to Rust; do not ship as a second backend."""
from __future__ import annotations
from fractions import Fraction
import math
from typing import Iterable, Sequence

TASTE_AXES = ('sweet', 'sour', 'bitter', 'salty', 'umami')
SENSORY_AXES = ('alcohol_heat', 'aroma', 'body', 'carbonation', 'cooling', 'spiciness', 'finish')


def _integer(v: object) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def validate_bps(values: Sequence[int]) -> None:
    if len(values) != 5 or any(not _integer(x) or x < 0 for x in values) or sum(values) != 10000:
        raise ValueError('Five nonnegative integer basis points summing to 10000 are required.')


def allocate(total: int, weights: Sequence[int | float]) -> list[int]:
    """Stable largest-remainder allocation, including the all-zero fallback."""
    if not _integer(total) or total < 0:
        raise ValueError('Nonnegative integer total required.')
    if not weights:
        if total == 0:
            return []
        raise ValueError('No recipient for positive budget.')
    if any(isinstance(x, bool) or not math.isfinite(float(x)) or x < 0 for x in weights):
        raise ValueError('Weights must be finite and nonnegative.')
    f = [Fraction(str(x)) for x in weights]
    if sum(f) == 0:
        f = [Fraction(1) for _ in f]
    denominator = sum(f)
    ideal = [x * total / denominator for x in f]
    result = [int(x) for x in ideal]
    order = sorted(range(len(f)), key=lambda j: (-(ideal[j] - result[j]), j))
    for j in order[:total - sum(result)]:
        result[j] += 1
    return result


def redistribute_bps(anchor: Sequence[int], axis: int, requested: int,
                     locked: Iterable[int] = ()) -> list[int]:
    """Use the gesture-start ANCHOR on every drag event to avoid path-dependent rounding."""
    validate_bps(anchor)
    locks = set(locked)
    if not _integer(axis) or axis not in range(5) or any(not _integer(j) or j not in range(5) for j in locks):
        raise ValueError('Invalid axis or lock.')
    if axis in locks:
        raise ValueError('Selected axis is locked.')
    if not _integer(requested):
        raise ValueError('Requested value must be integer basis points.')
    others = [j for j in range(5) if j != axis and j not in locks]
    budget = 10000 - sum(anchor[j] for j in locks)
    # If every other axis is locked, the only feasible value is the existing residual.
    x = max(0, min(requested, budget)) if others else budget
    out = list(anchor)
    out[axis] = x
    shares = allocate(budget - x, [anchor[j] for j in others])
    for j, share in zip(others, shares):
        out[j] = share
    validate_bps(out)
    return out


def validate_sensory(values: Sequence[float]) -> None:
    if len(values) != 7 or any(isinstance(v, bool) or not math.isfinite(float(v)) or not 0 <= v <= 10 for v in values):
        raise ValueError('Seven finite sensory intensities in [0,10] required.')


def match_index(target_taste: Sequence[int], target_sensory: Sequence[float],
                achieved_taste: Sequence[int], achieved_sensory: Sequence[float],
                taste_weight: float = 0.6) -> dict:
    """Descriptive distance index, NOT a probability of enjoyment or a validated rating."""
    validate_bps(target_taste); validate_bps(achieved_taste)
    validate_sensory(target_sensory); validate_sensory(achieved_sensory)
    if not math.isfinite(taste_weight) or not 0 <= taste_weight <= 1:
        raise ValueError('Invalid weight.')
    taste_distance = sum(abs(a-b) for a,b in zip(target_taste, achieved_taste)) / 20000
    sensory_distance = sum(abs(a-b) for a,b in zip(target_sensory, achieved_sensory)) / 70
    score = 100*(1-taste_weight*taste_distance-(1-taste_weight)*sensory_distance)
    return dict(index=round(max(0,min(100,score)),1), taste_distance=taste_distance,
                sensory_distance=sensory_distance, calibrated=False)


def estimate_abv(components: Sequence[dict], dilution_ml: float | None) -> dict:
    """Consumed volumes only. Unknown SKU/rinse retention/ice melt produces unknown output.
    Supply each component as {consumed_ml: number|null, abv_fraction: number|null}.
    This is an approximate additive-volume model, not a laboratory alcohol measurement.
    """
    if dilution_ml is None:
        return {'abv_fraction': None, 'reason': 'unknown_dilution'}
    if not math.isfinite(dilution_ml) or dilution_ml < 0:
        raise ValueError('Invalid dilution.')
    total, ethanol = float(dilution_ml), 0.0
    for c in components:
        v, a = c.get('consumed_ml'), c.get('abv_fraction')
        if v is None or a is None:
            return {'abv_fraction': None, 'reason': 'unknown_volume_or_ABV'}
        if not math.isfinite(v) or not math.isfinite(a) or v < 0 or not 0 <= a <= 1:
            raise ValueError('Invalid physical input.')
        total += v
        ethanol += v*a
    if total <= 0:
        return {'abv_fraction': None, 'reason': 'empty_drink'}
    return {'abv_fraction': ethanol/total, 'ethanol_ml': ethanol,
            'served_liquid_ml': total, 'status': 'estimate', 'assumed_dilution_ml': dilution_ml}
