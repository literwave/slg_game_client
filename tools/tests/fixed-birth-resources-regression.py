"""逐点检查固定高级地与最终资源表一致、间距及配比。"""
import collections
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('campaign', ROOT / 'tools/world/build-campaign-map.py')
campaign = importlib.util.module_from_spec(spec)
spec.loader.exec_module(campaign)
fixed = json.loads((ROOT / 'tools/world/fixed-birth-resources.json').read_text(encoding='utf8'))
data = json.loads((ROOT / 'assets/resources/config/mapRes_0.json').read_text(encoding='utf8'))
world = json.loads((ROOT / 'assets/resources/world/campaign-map.json').read_text(encoding='utf8'))
terrain = json.loads((ROOT / 'assets/resources/world/original-landscape.json').read_text(encoding='utf8'))
points = fixed['points']
expected = {p['y'] * 1000 + p['x']: (p['type'], p['level']) for p in points}
assert fixed['schemaVersion'] == 2
assert (fixed['minDistance'], fixed['advancedMinDistance'], fixed['level6MinDistance']) == (8, 28, 48)
assert len(expected) == len(points) == world['fixedBirthResourceCount']
assert len({p['id'] for p in points}) == len(points)
empty = set(data['emptyCells'])
blocked = set(terrain['riverCells']) | set(terrain['mountainCells'])
actual = {idx: (kind, level) for idx, (kind, level) in enumerate(data['list'])
          if 52 <= kind <= 55 and level >= 4 and campaign.region_at(idx % 1000, idx // 1000) < 6}
assert actual == expected, '最终地图存在表外高级地，或漏掉/改动固定点'
counts = collections.Counter()
minimum = {4: float('inf'), 5: float('inf'), 6: float('inf')}
buckets = collections.defaultdict(list)
for i, p in enumerate(points):
    idx = p['y'] * 1000 + p['x']
    assert idx not in empty and idx not in blocked
    assert campaign.region_at(p['x'], p['y']) == p['region']
    counts[p['region'], p['level'], p['type']] += 1
    bx, by = p['x'] // 64, p['y'] // 64
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for q in buckets[bx + dx, by + dy]:
                distance = math.hypot(p['x'] - q['x'], p['y'] - q['y'])
                for level in (4, 5, 6):
                    if min(p['level'], q['level']) >= level:
                        minimum[level] = min(minimum[level], distance)
                spacing = 48 if min(p['level'], q['level']) == 6 else 28 if min(p['level'], q['level']) >= 5 else 8
                assert distance >= spacing, (p, q, distance)
    buckets[bx, by].append(p)
for region in range(6):
    for level in (4, 5, 6):
        kinds = [counts[region, level, kind] for kind in range(52, 56)]
        assert max(kinds) - min(kinds) <= 1, (region, level, kinds)
    assert sum(counts[region, 6, kind] for kind in range(52, 56)) == 8
report = {'fixedPoints': len(points), 'levels': dict(collections.Counter(p['level'] for p in points)),
          'minDistance': {k: round(v, 2) for k, v in minimum.items()},
          'mapMatchesFixedTable': True}
(ROOT / 'temp/fixed-birth-resources-audit.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report))
