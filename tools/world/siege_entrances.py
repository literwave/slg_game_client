"""固定攻城入口的构建/导出校验，不在服务端或运行时重新挑选入口。"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def reserve_siege_entrance_ground(world, landscape, resources, empty_cells, protected_cells):
    """建图时为贴墙落脚点留空；不移动固定资源、不改变山河通路。"""
    config = json.loads((ROOT / 'tools/world/siege-entrances.json').read_text(encoding='utf8'))
    if config.get('cityEntranceLayout') != 'front-wall-adjacent':
        return
    blocked = set(landscape['riverCells']) | set(landscape['mountainCells'])
    empty = set(empty_cells)
    for city in world['cities']:
        r = city['footprintRadius'] + 1
        for x, y in [(city['x'] + r, city['y']), (city['x'], city['y'] + r)]:
            cell = y * world['width'] + x
            if cell in blocked or cell in protected_cells or resources[cell][0] not in (0, 52, 53, 54, 55):
                raise ValueError(f'贴墙落脚点与固定资源或通路冲突: {city["name"]} {x},{y}')
            resources[cell] = [0, 0]
            empty.add(cell)
    empty_cells[:] = sorted(empty)


def attach_siege_entrances(world, landscape, resources, empty_cells, verify_snapshot=False):
    config = json.loads((ROOT / 'tools/world/siege-entrances.json').read_text(encoding='utf8'))
    if config.get('version') != 1 or (config['width'], config['height']) != (world['width'], world['height']):
        raise ValueError('攻城入口配置版本或地图尺寸不一致')
    for name, expected in config['geometryHashes'].items():
        source = (ROOT / name).read_text(encoding='utf8').replace('\r\n', '\n')
        if hashlib.sha256(source.encode('utf8')).hexdigest() != expected:
            raise ValueError(f'城图几何已改变，请运行保留入口校验更新几何哈希: {name}')
    table = {(entry['kind'], entry['x'], entry['y']): entry for entry in config['landmarks']}
    if len(table) != len(world['cities']) + len(world['gates']):
        raise ValueError('固定入口表与城池/关隘数量不一致')
    blocked = set(landscape['riverCells']) | set(landscape['mountainCells'])
    empty = set(empty_cells)
    reserved, used = set(), set()
    width, height = world['width'], world['height']
    rows = [('city', row) for row in world['cities']] + [('gate', row) for row in world['gates']]
    for kind, row in rows:
        radius = row.get('footprintRadius', 4 if row['level'] >= 10 else 3 if row['level'] >= 8 else 2 if row['level'] >= 5 else 1)
        width_radius = row.get('footprintWidthRadius', radius)
        if kind == 'gate' and row.get('crossing') == 'pass':
            rx, ry = (radius, width_radius) if row.get('axis') == 'x' else (width_radius, radius)
        else:
            rx = ry = radius
        for y in range(row['y'] - ry, row['y'] + ry + 1):
            for x in range(row['x'] - rx, row['x'] + rx + 1):
                reserved.add(y * width + x)
    for kind, row in rows:
        entry = table.get((kind, row['x'], row['y']))
        if not entry or entry['level'] != row['level']:
            raise ValueError(f'城池位置或等级已改变，请重新生成入口: {row["name"]}')
        if kind == 'gate' and any(entry.get(key) != row.get(key, 0 if key == 'bridgeSpan' else None)
                                  for key in ('axis', 'crossing', 'bridgeSpan')):
            raise ValueError(f'关隘朝向或跨度已改变，请重新生成入口: {row["name"]}')
        if kind == 'city' and entry['footprintRadius'] != row['footprintRadius']:
            raise ValueError('城池占地已改变，请重新生成入口')
        points = entry['attackEntrances']
        if kind == 'gate' and row.get('crossing') == 'pass':
            pass_radius = 2
            pass_width_radius = 3
            pass_ring = pass_radius + 1
            expected = [dict(x=row['x'] + (u if row['axis'] == 'x' else 0),
                y=row['y'] + (u if row['axis'] == 'y' else 0)) for u in (pass_ring, -pass_ring)]
            if (row.get('footprintRadius') != pass_radius or entry.get('footprintRadius') != pass_radius
                    or row.get('footprintWidthRadius') != pass_width_radius
                    or entry.get('footprintWidthRadius') != pass_width_radius or points != expected):
                raise ValueError('山口关隘必须使用 5×7 占地和两侧贴墙入口')
        adjacent = kind == 'city' and config.get('cityEntranceLayout') == 'front-wall-adjacent'
        if len(points) != (4 if kind == 'city' and not adjacent else 2):
            raise ValueError('城池和关隘落脚点数量与配置不符')
        if adjacent:
            r = row['footprintRadius'] + 1
            if points != [dict(x=row['x'] + r, y=row['y']), dict(x=row['x'], y=row['y'] + r)]:
                raise ValueError('城池落脚点必须紧邻正面两侧城墙')
        for point in points:
            x, y = point['x'], point['y']
            if type(x) is not int or type(y) is not int or not (0 <= x < width and 0 <= y < height):
                raise ValueError('入口坐标不在地图内')
            cell = y * width + x
            if cell in used or cell in blocked or cell in reserved or cell not in empty or resources[cell][0] != 0:
                raise ValueError(f'入口不可通行、不是空地、处于占地内或重复: {row["name"]} {x},{y}')
            used.add(cell)
        if verify_snapshot and row.get('attackEntrances') != points:
            raise ValueError(f'地图快照入口缺失或与固定表不一致: {row["name"]}')
        row['attackEntrances'] = [dict(point) for point in points]
    return len(used)
