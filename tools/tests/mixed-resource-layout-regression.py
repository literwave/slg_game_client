"""整图混排、冻结内州资源点、密度梯度与城池占地回归。"""
import collections
import importlib.util
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('campaign', ROOT / 'tools/world/build-campaign-map.py')
campaign = importlib.util.module_from_spec(spec)
spec.loader.exec_module(campaign)
read = lambda p: json.loads((ROOT / p).read_text(encoding='utf8'))
data = read('assets/resources/config/mapRes_0.json')
world = read('assets/resources/world/campaign-map.json')
land = read('assets/resources/world/original-landscape.json')
fixed = read('tools/world/fixed-inner-resources.json')
cells, empty = data['list'], set(data['emptyCells'])
blocked = set(land['riverCells']) | set(land['mountainCells'])
assert len(cells) == 1000000 and world['resourceLayoutVersion'] == 3
counts = collections.Counter()
actual = {}
for idx, (kind, level) in enumerate(cells):
    if kind not in range(52, 56):
        continue
    x, y = idx % 1000, idx // 1000
    region = campaign.region_at(x, y)
    counts[region, level] += 1
    assert idx not in empty and idx not in blocked
    if region >= 6 and level >= (6 if region < 9 else 7):
        actual[idx] = (kind, level)
    for dx, dy in ((1, 0), (0, 1), (1, 1), (-1, 1)):
        if not (0 <= x+2*dx < 1000 and y+2*dy < 1000):
            continue
        a, b = cells[(y+dy)*1000+x+dx], cells[(y+2*dy)*1000+x+2*dx]
        if a[0] in range(52, 56) and b[0] in range(52, 56):
            assert not (level == a[1] == b[1]), ('level run', x, y, dx, dy)
            assert not (kind == a[0] == b[0]), ('type run', x, y, dx, dy)
points = fixed['points']
assert actual == {p['y']*1000+p['x']: (p['type'], p['level']) for p in points}
assert len(actual) == len(points) == world['fixedInnerResourceCount'] == 658
assert len({p['id'] for p in points}) == len(points)
for i, p in enumerate(points):
    assert campaign.region_at(p['x'], p['y']) == p['region']
    for q in points[:i]:
        low = min(p['level'], q['level'])
        spacing = min(int(fixed['spacing'][str(p['region'])].get(str(low), 12)),
                      int(fixed['spacing'][str(q['region'])].get(str(low), 12)))
        assert math.hypot(p['x']-q['x'], p['y']-q['y']) >= spacing
ratios = {}
for region in range(10):
    total = sum(n for (r, _), n in counts.items() if r == region)
    advanced = sum(n for (r, level), n in counts.items() if r == region and level >= 4)
    ratios[region] = round(advanced / total, 4)
    if region < 6:
        assert 0 < advanced / total < .04
    elif region < 9:
        assert .4 < advanced / total < .7
        assert [counts[region, level] for level in (6, 7, 8)] == [140, 40, 8]
    for level in range(6, 10):
        kinds = [sum(p['region'] == region and p['level'] == level and p['type'] == t for p in points) for t in range(52, 56)]
        assert max(kinds) - min(kinds) <= 1
footprints = []
for city in world['cities']:
    radius = city['footprintRadius']
    assert radius == (4 if city['level'] >= 10 else 2 if city['level'] >= 5 else 1)
    for y in range(city['y']-radius, city['y']+radius+1):
        for x in range(city['x']-radius, city['x']+radius+1):
            idx = y*1000+x
            assert idx not in empty and idx not in blocked
            assert cells[idx][0] == (51 if (x, y) == (city['x'], city['y']) else 0)
    footprints.append(2*radius+1)
staged = ROOT / 'temp/campaign-map/map.tmx'
if staged.exists():
    # Creator保存可能改变换行；比较尺寸和逻辑层，不以文本格式差异触发重导入。
    def logical_map(path):
        root = ET.parse(path).getroot()
        return root.attrib, [(layer.attrib, layer.find('data').attrib,
            [int(v) for v in layer.find('data').text.split(',') if v.strip()]) for layer in root.findall('layer')]
    assert logical_map(staged) == logical_map(ROOT / 'assets/resources/world/map.tmx'), 'TMX需通过AssetDB更新'
report = dict(cells=1000000, sameLevelTripleRuns=0, sameTypeTripleRuns=0, fixedInnerPoints=len(points),
              level4PlusRatios=ratios, cityFootprintWidths=footprints, emptyCells=len(empty))
(ROOT / 'temp/mixed-resource-audit.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report))
