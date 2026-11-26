"""局部迁移当前山口快照；默认只审查，--write 写入，绝不重建全图或移动固定资源。"""
import argparse
import copy
import json
import re
from pathlib import Path
from pass_grid import RADIUS, WIDTH_RADIUS, apply_pass_grid, pass_mountain_patches

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--write', action='store_true')
args = parser.parse_args()
read = lambda path: json.loads((ROOT / path).read_text(encoding='utf8'))
world = read('assets/resources/world/campaign-map.json')
landscape = read('assets/resources/world/original-landscape.json')
resources = read('assets/resources/config/mapRes_0.json')
fixed = read('tools/world/siege-entrances.json')
protected = {p['y'] * world['width'] + p['x'] for file in ('fixed-birth-resources.json', 'fixed-inner-resources.json')
    for p in read('tools/world/' + file)['points']}
before = copy.deepcopy(resources)
blocked = bytearray(world['width'] * world['height'])
river = bytearray(len(blocked))
for i in landscape['mountainCells'] + landscape['riverCells']: blocked[i] = 1
for i in landscape['riverCells']: river[i] = 1
empty = set(resources['emptyCells'])
apply_pass_grid(world['gates'], world['width'], resources['list'], empty, blocked, river, protected)
resources['emptyCells'] = sorted(empty)
landscape['riverCells'] = [i for i, wet in enumerate(river) if wet and blocked[i]]
landscape['mountainCells'] = [i for i, wall in enumerate(blocked) if wall and not river[i]]
landscape['patches'] = pass_mountain_patches(landscape['patches'], world['gates'], blocked, world['width'])
world['passLayoutVersion'] = 3
fixed['passEntranceLayout'] = 'opposite-wall-adjacent'
for gate in world['gates']:
    if gate.get('crossing') != 'pass': continue
    entry = next(p for p in fixed['landmarks'] if p['kind'] == 'gate' and (p['x'], p['y']) == (gate['x'], gate['y']))
    entry['footprintRadius'] = RADIUS
    entry['footprintWidthRadius'] = WIDTH_RADIUS
    entry['attackEntrances'] = gate['attackEntrances']
changes = [i for i, (a, b) in enumerate(zip(before['list'], resources['list'])) if a != b]
old_empty = set(before['emptyCells'])
old_blocked = set(read('assets/resources/world/original-landscape.json')['mountainCells']) | set(read('assets/resources/world/original-landscape.json')['riverCells'])
report = dict(passCount=sum(g.get('crossing') == 'pass' for g in world['gates']),
    resourceChanges=len(changes), blockedAdded=sum(v and i not in old_blocked for i,v in enumerate(blocked)),
    blockedRemoved=sum(not blocked[i] for i in old_blocked), emptyAdded=len(empty-old_empty),
    emptyRemoved=len(old_empty-empty), fixedResourcesUnchanged=all(before['list'][i] == resources['list'][i] for i in protected),
    changedCells=sorted(set(changes) | (empty ^ old_empty) | ({i for i,v in enumerate(blocked) if v} ^ old_blocked)))
if args.write:
    outputs = {'assets/resources/world/campaign-map.json': world, 'assets/resources/world/original-landscape.json': landscape,
        'assets/resources/config/mapRes_0.json': resources, 'tools/world/siege-entrances.json': fixed}
    backup = ROOT / 'temp/pass-grid-before'
    backup.mkdir(parents=True, exist_ok=True)
    for file, data in outputs.items():
        target = ROOT / file
        saved = backup / target.name
        if not saved.exists(): saved.write_bytes(target.read_bytes())
        target.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    # TMX 阻挡与 JSON 同步，保留 tileset、场景和其他图层。
    target = ROOT / 'assets/resources/world/map.tmx'
    tmx = target.read_text(encoding='utf8')
    pattern = r'(<layer\b[^>]*name="obstruct"[^>]*>\s*<data encoding="csv">)[\s\S]*?(</data>)'
    updated, count = re.subn(pattern, lambda m: m[1] + '\n' + ','.join(map(str, blocked)) + m[2], tmx)
    if count != 1: raise ValueError('TMX obstruct 图层不唯一')
    if not (backup / target.name).exists(): (backup / target.name).write_bytes(target.read_bytes())
    target.write_text(updated, encoding='utf8')
    stage = ROOT / 'temp/campaign-map/map.tmx'
    stage.parent.mkdir(parents=True, exist_ok=True)
    stage.write_text(updated, encoding='utf8')
    (backup / 'changes.json').write_text(json.dumps(report), encoding='utf8')
print(json.dumps(report, ensure_ascii=False))
