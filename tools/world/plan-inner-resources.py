"""一次性编排内州高级地；只写新候选表，正式构建读取冻结后的坐标。"""
import argparse
import collections
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
target = (ROOT / args.output).resolve()
if not target.is_relative_to(ROOT) or target.exists():
    raise SystemExit('候选输出必须在项目内且尚不存在')
spec = importlib.util.spec_from_file_location('campaign', ROOT / 'tools/world/build-campaign-map.py')
campaign = importlib.util.module_from_spec(spec)
spec.loader.exec_module(campaign)
world = json.loads((ROOT / 'assets/resources/world/campaign-map.json').read_text(encoding='utf8'))
terrain = json.loads((ROOT / 'assets/resources/world/original-landscape.json').read_text(encoding='utf8'))
blocked = set(terrain['riverCells']) | set(terrain['mountainCells'])
points = []
targets = {6: {8: 8, 7: 40, 6: 140}, 7: {8: 8, 7: 40, 6: 140},
           8: {8: 8, 7: 40, 6: 140}, 9: {9: 4, 8: 20, 7: 70}}
spacing = {6: {6: 14, 7: 26, 8: 42}, 7: {6: 14, 7: 26, 8: 42},
           8: {6: 14, 7: 26, 8: 42}, 9: {7: 12, 8: 22, 9: 36}}
for region, levels in targets.items():
    candidates = []
    for y in range(210, 790):
        for x in range(210, 790):
            if campaign.region_at(x, y) != region or campaign.noise(x + 37, y + 83) % 5:
                continue
            if any((y + dy) * 1000 + x + dx in blocked for dx in (-3, 0, 3) for dy in (-3, 0, 3)):
                continue
            if any(math.hypot(x - p['x'], y - p['y']) < 12 for p in world['cities'] + world['gates']):
                continue
            candidates.append((x, y))
    for level, count in levels.items():
        allowed = [(x, y) for x, y in candidates if region == 9 or
                   ({8: (112, 180), 7: (125, 245), 6: (145, 273)}[level][0]
                    <= math.hypot(x - 499.5, y - 499.5) <= {8: (112, 180), 7: (125, 245), 6: (145, 273)}[level][1])]
        if region == 9 and level == 9:
            allowed = [(x, y) for x, y in allowed if math.hypot(x - 499.5, y - 499.5) <= 60]
        scores = {p: min(((p[0]-q['x'])**2 + (p[1]-q['y'])**2 for q in points), default=1000000) for p in allowed}
        for slot in range(count):
            valid = [p for p in allowed if scores[p] >= spacing[region][level] ** 2]
            if not valid:
                raise ValueError(f'州 {region} 的 {level} 级地无法满足数量和间距，未写出配置')
            x, y = max(valid, key=lambda p: (scores[p], campaign.noise(*p)))
            points.append(dict(id=f'inner-{region}-{level}-{slot+1:03}', region=region, x=x, y=y,
                               level=level, type=52 + slot % 4, group='resource' if region < 9 else 'capital'))
            for p in allowed:
                scores[p] = min(scores[p], (p[0]-x)**2 + (p[1]-y)**2)
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(dict(schemaVersion=1, width=1000, height=1000, spacing=spacing,
                                 note='逐点固定；正式构建不重新排点。资源州6～8级，王畿7～9级。', points=points),
                                 ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps({'points': len(points), 'levels': dict(collections.Counter(p['level'] for p in points))}))
