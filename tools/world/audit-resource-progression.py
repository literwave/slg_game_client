"""按真实州域统计资源等级与成长配比，不生成或评估玩家出生位置。"""
import collections
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
data = json.loads((ROOT / 'assets/resources/config/mapRes_0.json').read_text(encoding='utf8'))
config = json.loads((ROOT / 'assets/resources/world/campaign-map.json').read_text(encoding='utf8'))
region_ids = bytearray()
for row in config['regionRows']:
    start = 0
    for i in range(0, len(row), 2):
        end, region = row[i:i+2]
        region_ids.extend(bytes([region]) * (end - start))
        start = end
    assert start == data['w']
assert len(region_ids) == len(data['list'])
tiers = {region['id']: region['tier'] for region in config['regions']}
regions = [collections.Counter() for _ in range(3)]
region_counts = {region['id']: collections.Counter() for region in config['regions']}
for i, (kind, level) in enumerate(data['list']):
    if not 52 <= kind <= 55:
        continue
    region = region_ids[i]
    regions[tiers[region]][level] += 1
    region_counts[region][level] += 1
report = {'regions': [dict(sorted(c.items())) for c in regions],
          'regionLevels': {region: dict(sorted(counts.items())) for region, counts in region_counts.items()}}
assert (regions[0][5] + regions[0][6]) / sum(regions[0].values()) < .06
assert regions[0][6] / sum(regions[0].values()) < .005
assert regions[1][8] / sum(regions[1].values()) < .03
assert regions[2][9] / sum(regions[2].values()) < .06
means = [sum(level * count for level, count in c.items()) / sum(c.values()) for c in regions]
assert means[0] < means[1] < means[2]
report['mean_levels'] = means
report['resource_progression_checks'] = 'PASS'
(ROOT / 'temp/resource-progression-audit.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report))
