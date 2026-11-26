"""山脊错位后仍连续，四向关口和游戏地形数据保持一致。读取真实 PNG alpha，不修改资源。"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('mountain_layout', ROOT / 'tools/world/mountain_layout.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
read = lambda p: json.loads(p.read_text(encoding='utf8'))
current = read(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets/resources/world/original-landscape.json')
world = read(ROOT / 'assets/resources/world/campaign-map.json')
baseline = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'temp/mountain-natural-review/before-landscape.json'
if baseline.exists():
    before = read(baseline)
    assert {k: v for k, v in current.items() if k not in ('version', 'patches')} == {
        k: v for k, v in before.items() if k not in ('version', 'patches')}, '仅调整山体美术，不改变山地/河流/桥面'

cover = module.Coverage()
mountains = set(current['mountainCells'])
for patch in current['patches']:
    assert isinstance(patch['x'], int) and isinstance(patch['y'], int)
    assert patch['y'] * current['width'] + patch['x'] in mountains
    assert not patch.get('flipX'), '水平镜像会翻转原画光照'
    cover.add(patch)
missing, checked = [], 0
for idx in sorted(mountains):
    for x, y in module.samples(idx % 1000, idx // 1000, mountains):
        if any(max(abs(x-g['x']), abs(y-g['y'])) <= 5 for g in world['gates']):
            continue
        checked += 1
        if not cover.covered(x, y):
            missing.append((x, y))
assert not missing, ('山脊露底', missing[:10])
passes = [g for g in world['gates'] if g['crossing'] == 'pass']
for gate in passes:
    shoulders = [p for p in current['patches'] if p.get('role') == 'pass-grid-shoulder' and p.get('gate') == gate['id']]
    assert len(shoulders) == 10
    assert all(not p.get('offsetX') and not p.get('offsetY') for p in shoulders), '贴墙山脚不能扰动城门朝向'
    for entry in gate['attackEntrances']:
        assert entry['y']*1000+entry['x'] not in mountains
        assert entry['y']*1000+entry['x'] not in current['riverCells']
print(json.dumps(dict(samples=checked, uncovered=0, patches=len(current['patches']),
                     passes=len(passes), mirrored=0, terrainUnchanged=True)))
