"""Cross-language fixtures from unchanged handoff reference; no network, no mutation of data/."""
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from reference.core import redistribute_bps, allocate
from reference.ascii_glass import TEMPLATES, render

rng = random.Random(20260921)
cases = []
for _ in range(2000):
    anchor = allocate(10000, [rng.randrange(101) for _ in range(5)])
    axis = rng.randrange(5)
    locks = [i for i in range(5) if i != axis and rng.randrange(2)]
    requested = rng.randrange(-2000, 14000)
    cases.append(dict(anchor=anchor, axis=axis, requested=requested, locked=locks,
                      expected=redistribute_bps(anchor, axis, requested, locks)))
dest = ROOT / 'product' / 'tests' / 'fixtures'
dest.mkdir(parents=True, exist_ok=True)
(dest / 'taste-golden.json').write_text(json.dumps(cases, separators=(',', ':')), encoding='utf-8')
(dest / 'glass-golden.json').write_text(json.dumps({k: render(k) for k in TEMPLATES}, indent=2), encoding='utf-8')
print(f'Wrote {len(cases)} reference taste cases and {len(TEMPLATES)} glass fixtures')
