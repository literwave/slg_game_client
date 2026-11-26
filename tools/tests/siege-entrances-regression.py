"""入口快照校验：不重建地图，不写项目或服务端数据。"""
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/world'))
from siege_entrances import attach_siege_entrances, reserve_siege_entrance_ground


def read(name):
    return json.loads((ROOT / name).read_text(encoding='utf8'))


world = read('assets/resources/world/campaign-map.json')
terrain = read('assets/resources/world/original-landscape.json')
resources = read('assets/resources/config/mapRes_0.json')
assert attach_siege_entrances(world, terrain, resources['list'], resources['emptyCells'], True) == 56
for city in world['cities']:
    r = city['footprintRadius'] + 1
    assert city['attackEntrances'] == [dict(x=city['x'] + r, y=city['y']), dict(x=city['x'], y=city['y'] + r)]
reserved = resources['list'].copy()
empties = resources['emptyCells'].copy()
first = world['cities'][0]['attackEntrances'][0]
cell = first['y'] * world['width'] + first['x']
reserved[cell] = [53, 2]
empties.remove(cell)
reserve_siege_entrance_ground(world, terrain, reserved, empties, set())
assert reserved == resources['list'] and empties == resources['emptyCells'], '重建地图必须恢复贴墙空地'
try:
    reserve_siege_entrance_ground(world, terrain, reserved, empties, {cell})
except ValueError:
    pass
else:
    raise AssertionError('不能覆盖固定资源')
stripped = copy.deepcopy(world)
for row in stripped['cities'] + stripped['gates']:
    row.pop('attackEntrances')
attach_siege_entrances(stripped, terrain, resources['list'], resources['emptyCells'])
assert stripped == world, '重建阶段必须完整恢复固定入口'


def rejected(changed_world, changed_terrain=terrain, changed_resources=resources['list']):
    try:
        attach_siege_entrances(changed_world, changed_terrain, changed_resources, resources['emptyCells'], True)
    except ValueError:
        return
    raise AssertionError('错误入口配置被静默接受')


missing = copy.deepcopy(world)
missing['cities'][0].pop('attackEntrances')
rejected(missing)
wrong = copy.deepcopy(world)
wrong['gates'][0]['attackEntrances'][0] = dict(wrong['gates'][1]['attackEntrances'][0])
rejected(wrong)
footprint = copy.deepcopy(world)
footprint['cities'][0]['footprintRadius'] += 1
rejected(footprint)
axis = copy.deepcopy(world)
axis['gates'][0]['axis'] = 'y' if axis['gates'][0]['axis'] == 'x' else 'x'
rejected(axis)
first = world['cities'][0]['attackEntrances'][0]
cell = first['y'] * world['width'] + first['x']
blocked = dict(terrain, riverCells=terrain['riverCells'] + [cell])
rejected(copy.deepcopy(world), blocked)
occupied = resources['list'].copy()
occupied[cell] = [52, 6]
rejected(copy.deepcopy(world), terrain, occupied)
print('PASS 内部攻城落脚点：10城贴墙两格、18关通路两端、56格、重建留空及冲突校验')
