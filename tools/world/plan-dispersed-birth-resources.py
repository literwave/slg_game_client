"""离线编排固定坐标，拒绝覆盖已有文件；候选表审核后才替换正式表，构建器不调用本工具。"""
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
    raise SystemExit('请指定项目内尚不存在的候选文件，禁止覆盖已冻结的坐标表。')
spec = importlib.util.spec_from_file_location('campaign', Path(__file__).with_name('build-campaign-map.py'))
campaign = importlib.util.module_from_spec(spec)
spec.loader.exec_module(campaign)
world = json.loads((ROOT / 'assets/resources/world/campaign-map.json').read_text(encoding='utf8'))
data = json.loads((ROOT / 'assets/resources/config/mapRes_0.json').read_text(encoding='utf8'))
empty = set(data['emptyCells'])
placed = []
fixed_source = json.loads((ROOT / 'tools/world/fixed-birth-resources.json').read_text(encoding='utf8'))
quotas_by_region = collections.Counter((p['region'], p['level']) for p in fixed_source['points'])


def valid(x, y, region):
    if not 6 <= x < 994 or not 6 <= y < 994 or campaign.region_at(x, y) != region:
        return False
    kind = data['list'][y * 1000 + x][0]
    if not (52 <= kind <= 55 or y * 1000 + x in empty):
        return False
    if any(math.hypot(x - c['x'], y - c['y']) < 9 for c in world['cities'] + world['gates']):
        return False
    return True


def distance2(a, b):
    return (a['x'] - b['x']) ** 2 + (a['y'] - b['y']) ** 2


# 确定性最远点编排：沿用已冻结的州域资源配额，不依赖玩家出生位置。
candidates = [[] for _ in range(6)]
for y in range(6, 994, 3):
    for x in range(6, 994, 3):
        region = campaign.region_at(x, y)
        if region < 6 and valid(x, y, region):
            candidates[region].append(dict(x=x, y=y, region=region))
for level in (6, 5):
    for region in range(6):
        count = quotas_by_region[region, level]
        points = [dict(p) for p in candidates[region]
                  if (315 <= math.hypot(p['x'] - 499.5, p['y'] - 499.5) <= 375 if level == 6
                      else math.hypot(p['x'] - 499.5, p['y'] - 499.5) > 375)]
        for p in points:
            p['score'] = min((distance2(p, q) for q in placed), default=1000000)
        for slot in range(count):
            spacing = 48 if level == 6 else 28
            available = [p for p in points if p['score'] >= spacing ** 2]
            if not available:
                if level == 5 and slot >= math.ceil(count * .65):
                    break  # 州域形状不同；间距优先，不能为凑数量往已有点旁边塞资源。
                raise ValueError(f'州{region}无法满足{level}级间距；候选文件未写入')
            point = max(available, key=lambda p: (p['score'], campaign.noise(p['x'], p['y'])))
            placed.append(dict(x=point['x'], y=point['y'], region=region, level=level,
                               group=f'frontier-{region}' if level == 6 else f'dispersed-{region}'))
            for p in points:
                p['score'] = min(p['score'], distance2(p, point))

# 4级也固定为孤立单点：8格排斥距离，同时避让所有5/6级，不再整圈生成4级。
buckets = collections.defaultdict(list)
for p in placed:
    buckets[p['x'] // 8, p['y'] // 8].append(p)
low_candidates = sorted((p for row in candidates for p in row), key=lambda p: campaign.noise(p['x'], p['y']))
for p in low_candidates:
    bx, by = p['x'] // 8, p['y'] // 8
    if any(distance2(p, q) < 8 ** 2 for dx in (-1, 0, 1) for dy in (-1, 0, 1)
           for q in buckets[bx + dx, by + dy]):
        continue
    point = dict(p, level=4, group=f'growth-{p["region"]}')
    placed.append(point)
    buckets[bx, by].append(point)

# 四种资源轮流覆盖空间，并限制各州同等级数量差不超过1。
for region in range(6):
    for level in (6, 5, 4):
        group = [p for p in placed if p['region'] == region and p['level'] == level]
        chosen = collections.defaultdict(list)
        quotas = {kind: len(group) // 4 + (kind - 52 < len(group) % 4) for kind in range(52, 56)}
        for p in group:
            kinds = [kind for kind in range(52, 56) if len(chosen[kind]) < quotas[kind]]
            kind = max(kinds, key=lambda k: (min((distance2(p, q) for q in chosen[k]), default=1000000), -k))
            p['type'] = kind
            chosen[kind].append(p)

placed.sort(key=lambda p: (p['region'], p['level'], p['y'], p['x']))
for i, p in enumerate(placed):
    p['id'] = f'birth-v2-{p["region"]}-{p["level"]}-{i + 1:05}'
fixed = dict(schemaVersion=2, width=1000, height=1000, minDistance=8,
             advancedMinDistance=28, level6MinDistance=48,
             note='4/5/6级逐点固定；8格错开4级，28格错开5/6级，48格错开6级。构建和运行时禁止重排。', points=placed)
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(fixed, ensure_ascii=False, indent=2), encoding='utf8')
report = dict(points=len(placed), counts=dict(collections.Counter(p['level'] for p in placed)))
report['regionCounts'] = {region: dict(collections.Counter(p['level'] for p in placed if p['region'] == region))
                          for region in range(6)}
print(json.dumps(report))
