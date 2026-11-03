"""用真实PNG透明轮廓检查所有非关口山脊连接段，并检查关门可见/可点。"""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('coverage', ROOT / 'tools/world/mountain_layout.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
world = json.loads((ROOT / 'assets/resources/world/campaign-map.json').read_text(encoding='utf8'))
landscape = json.loads((ROOT / 'assets/resources/world/original-landscape.json').read_text(encoding='utf8'))
data = json.loads((ROOT / 'assets/resources/config/mapRes_0.json').read_text(encoding='utf8'))
cover = module.Coverage()
mountains = set(landscape['mountainCells'])
blocked = mountains | set(landscape['riverCells'])
for p in landscape['patches']:
    assert p['y'] * 1000 + p['x'] in mountains
    cover.add(p)
missing = []
sample_count = 0
for idx in sorted(mountains):
    x, y = idx % 1000, idx // 1000
    for sx, sy in module.samples(x, y, mountains):
        if any(max(abs(sx - g['x']), abs(sy - g['y'])) <= 5 for g in world['gates']):
            continue
        sample_count += 1
        if not cover.covered(sx, sy):
            missing.append((sx, sy))
for g in world['gates']:
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            x, y = g['x'] + dx, g['y'] + dy
            if y * 1000 + x in blocked:
                continue
            px, py = module.pixel(x, y)
            for p in cover.buckets[px // 256, py // 256]:
                assert cover.alpha_at(p, px, py) < 64 and not cover.ellipse_at(p, px, py), ('gate obscured', g['name'], p)
report = dict(samples=sample_count, uncovered=len(missing), firstGaps=missing[:8], gatesClear=18, patches=len(landscape['patches']))
report_path = ROOT / 'temp/map-dispersion-review/mountain-coverage.json'
report_path.parent.mkdir(parents=True, exist_ok=True)
report_path.write_text(json.dumps(report), encoding='utf8')
print(json.dumps(report))
assert not missing, '山脊轮廓仍有未衔接位置'

# 关口不能继续整体跳过覆盖检查：围墙外的山带也必须衔接，城门道路保持透明。
shoulder_spec = importlib.util.spec_from_file_location('gate_shoulders', ROOT / 'tools/world/gate_shoulders.py')
shoulders = importlib.util.module_from_spec(shoulder_spec)
shoulder_spec.loader.exec_module(shoulders)
pass_checks = []
additions = [p for p in landscape['patches'] if p.get('role') == 'gate-shoulder']
passes = {g['id']: g for g in world['gates'] if g.get('crossing') == 'pass'}
assert additions and all(p.get('gate') in passes for p in additions), '只为山口补山脚，不能填到河桥'
for g in passes.values():
    points = set()
    ground = shoulders.gate_ground(g, module.pixel)
    for y in range(g['y']-4, g['y']+5):
        for x in range(g['x']-4, g['x']+5):
            if y * 1000 + x not in mountains:
                continue
            for sx, sy in module.samples(x, y, mountains):
                if not shoulders.inside_polygon(module.pixel(sx, sy), ground):
                    points.add((sx, sy))
    covered = sum(cover.covered(x,y) for x,y in points)
    assert covered / len(points) >= .98, ('关城外山带露底', g['name'], covered, len(points))
    own = [p for p in additions if p['gate'] == g['id']]
    assert 1 <= len(own) <= 8
    assert all(p['width'] <= 520 and p['heightScale'] <= .84 for p in own), '补山脚不能堆成高山墙'
    # 九格中心之外，再检查前后四格道路的连续中线和两侧，捕捉格间伸出的轮廓。
    for step in range(-16,17):
        u = step / 4
        for v in (-.32,0,.32):
            x,y = (g['x']+u,g['y']+v) if g['axis']=='x' else (g['x']+v,g['y']+u)
            if round(y)*1000+round(x) in blocked:
                continue
            px,py = module.pixel(x,y)
            for p in additions:
                assert cover.alpha_at(p,px,py)<48 and not cover.ellipse_at(p,px,py), ('新增山脚挡路',g['name'],p)
    pass_checks.append(dict(gate=g['id'],samples=len(points),covered=covered))
print(json.dumps(dict(passShoulders=len(additions),checks=pass_checks)))
