"""验证地图阻挡、关口走廊和所有州域的实际地表连通性。"""
import json
import math
import xml.etree.ElementTree as ET
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
config = json.loads((ROOT / 'assets/resources/world/campaign-map.json').read_text(encoding='utf8'))
assert 'spawnZones' not in config, '静态地图不应生成玩家出生位置'
data = json.loads((ROOT / 'assets/resources/config/mapRes_0.json').read_text(encoding='utf8'))
tmx = ET.parse(ROOT / 'assets/resources/world/map.tmx').getroot()
assert int(tmx.attrib['width']) == int(tmx.attrib['height']) == data['w'] == data['h'] == 1000
assert len(data['list']) == 1000000
layers = {layer.attrib['name']: bytearray(map(int, layer.find('data').text.split(','))) for layer in tmx.findall('layer')}
blocked = layers['obstruct']
assert len(blocked) == len(layers['city_position']) == 1000000
assert len(config['gates']) == len({(g['x'], g['y']) for g in config['gates']}) == 18
assert len(config['regions']) == len(config['cities']) == 10
for g in config['gates']:
    idx = g['y'] * 1000 + g['x']
    assert data['list'][idx] == [50, g['level']] and not blocked[idx]
    # 关闭整段关口：检查其余地形没有跨州偷渡口。
    blocked[idx] = 1

labels = [-1] * 1000000
component = 0
for idx in range(1000000):
    if blocked[idx] or labels[idx] >= 0:
        continue
    labels[idx] = component
    queue = deque([idx])
    while queue:
        i = queue.popleft()
        x, y = i % 1000, i // 1000
        # 八方向也不可绕过山脉，覆盖斜向行军的风险。
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                nx, ny = x + dx, y + dy
                if not 0 <= nx < 1000 or not 0 <= ny < 1000:
                    continue
                n = ny * 1000 + nx
                if not blocked[n] and labels[n] < 0:
                    labels[n] = component
                    queue.append(n)
    component += 1
assert component == 10, f'关口关闭后应有10个独立州域，实际 {component}'
assert len({labels[r['y'] * 1000 + r['x']] for r in config['regions']}) == 10
if config.get('regionRows'):
    region_labels = [labels[r['y'] * 1000 + r['x']] for r in config['regions']]
    for y, row in enumerate(config['regionRows']):
        start = 0
        for j in range(0, len(row), 2):
            end, region = row[j:j+2]
            assert all(labels[y*1000+x] < 0 or labels[y*1000+x] == region_labels[region]
                       for x in range(start,end)), ('region/terrain disagreement',y,start,end,region)
            start = end
for g in config['gates']:
    near = {labels[y * 1000 + x] for y in range(g['y'] - 12, g['y'] + 13)
            for x in range(g['x'] - 12, g['x'] + 13) if labels[y * 1000 + x] >= 0}
    expected = {labels[config['regions'][r]['y'] * 1000 + config['regions'][r]['x']] for r in g['regions']}
    assert near == expected, f"{g['name']} 接错州域: {near} != {expected}"
    adjacent = {labels[(g['y'] + dy) * 1000 + g['x'] + dx] for dy in (-1, 0, 1)
                for dx in (-1, 0, 1) if labels[(g['y'] + dy) * 1000 + g['x'] + dx] >= 0}
    assert adjacent == expected, f"{g['name']} 单格关门未连通两侧: {adjacent} != {expected}"
for city in config['cities']:
    idx = city['y'] * 1000 + city['x']
    assert data['list'][idx] == [51, city['level']]
    assert layers['city_position'][idx] == 1
landscape = json.loads((ROOT / 'assets/resources/world/original-landscape.json').read_text(encoding='utf8'))
assert landscape['width'] == landscape['height'] == 1000
assert all(data['list'][idx][0] == 0 for idx in landscape['riverCells'])
print('PASS 1000×1000数据/图层一致；18关口坐标与等级；10州八方向隔离；关口两端连通；10城池；水系阻挡一致')
