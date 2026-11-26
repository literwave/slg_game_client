"""验证每座山口 5×7 整格占地、前后 3 格宽平地入口、固定资源和 TMX 阻挡一致。"""
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/world'))
from pass_grid import OPEN_HALF_WIDTH, RADIUS, WIDTH_RADIUS, RING, pass_cells
read = lambda p: json.loads((ROOT / p).read_text(encoding='utf8'))
w = read('assets/resources/world/campaign-map.json')
l = read('assets/resources/world/original-landscape.json')
r = read('assets/resources/config/mapRes_0.json')
blocked = set(l['mountainCells']) | set(l['riverCells'])
empty = set(r['emptyCells'])
protected = {p['y'] * w['width'] + p['x'] for file in ('fixed-birth-resources.json', 'fixed-inner-resources.json')
    for p in read('tools/world/' + file)['points']}
passes = [g for g in w['gates'] if g.get('crossing') == 'pass']
assert len(passes) == 12
for g in passes:
    assert g['footprintRadius'] == RADIUS
    assert g['footprintWidthRadius'] == WIDTH_RADIUS
    ring_open = []
    expected_shoulders = 0
    for x, y, wall, inside in pass_cells(g):
        i = y * w['width'] + x
        if not inside and wall and i in protected:
            continue
        if not inside and wall:
            expected_shoulders += 1
        assert (i in blocked) == wall, (g['name'], x, y, 'blocking')
        if (x, y) == (g['x'], g['y']):
            assert r['list'][i] == [50, g['level']]
        else:
            assert r['list'][i] == [0, 0]
            assert (i in empty) == (not wall)
        if not inside and not wall:
            ring_open.append(dict(x=x, y=y))
    expected = [dict(x=g['x'] + (u if g['axis'] == 'x' else 0), y=g['y'] + (u if g['axis'] == 'y' else 0)) for u in (RING, -RING)]
    expected_open = [dict(x=g['x'] + (u if g['axis'] == 'x' else v), y=g['y'] + (v if g['axis'] == 'x' else u))
        for u in (RING, -RING) for v in range(-OPEN_HALF_WIDTH, OPEN_HALF_WIDTH + 1)]
    assert g['attackEntrances'] == expected
    assert sorted(ring_open, key=str) == sorted(expected_open, key=str), (g['name'], 'extra connection')
    for entry in expected:
        x, y = entry['x'], entry['y']
        assert any((y + dy) * w['width'] + x + dx not in blocked and max(abs(x + dx - g['x']), abs(y + dy - g['y'])) > RING
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))), (g['name'], 'dead end')
    shoulders = [p for p in l['patches'] if p.get('role') == 'pass-grid-shoulder' and p.get('gate') == g['id']]
    assert len(shoulders) == expected_shoulders
    assert all(p['y'] * w['width'] + p['x'] in blocked and isinstance(p['x'], int) and isinstance(p['y'], int) for p in shoulders)
for file in ('fixed-birth-resources.json', 'fixed-inner-resources.json'):
    for p in read('tools/world/' + file)['points']:
        i = p['y'] * w['width'] + p['x']
        assert i not in blocked and r['list'][i] == [p['type'], p['level']]
print('PASS 12 mountain passes: 5x7 footprint, 3-tile-wide cleared front/rear forecourts, sealed flanks, fixed resources preserved')
