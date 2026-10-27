"""可重现的千里山河地图。TMX 暂存后由 Creator AssetDB 保存，保留资产 UUID。"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SIZE = 1000
CENTER = 499.5
SEED = 20261024


def region_at(x, y):
    dx, dy = x - CENTER, y - CENTER
    radius = math.hypot(dx, dy)
    angle = math.atan2(dy, dx) % math.tau
    if radius < 100:
        return 9
    if radius < 285:
        return 6 + int(angle / (math.tau / 3))
    return int(angle / (math.tau / 6))


def noise(x, y):
    n = ((x * 374761393 + y * 668265263 + SEED) ^ (x * y * 1274126177)) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return (n ^ (n >> 16)) & 0xffffffff


def resource_level(x, y, rid, regions):
    radius = math.hypot(x - CENTER, y - CENTER)
    # 按单格采样，不能用同一个6×6区块的随机数制造同等级条带。
    roll = noise(x + 137, y + 293) % 100
    if rid < 6:
        # 每48格保留一个补给中心；基础层仅提供1→2→3级，避免整圈4级建筑。
        distance = max(abs(x % 48 - 24), abs(y % 48 - 24))
        local = noise(x, y) % 100
        level = (1 if local < 50 else 2) if distance <= 5 else (1 if local < 16 else 2 if local < 58 else 3)
        # 出生州4/5/6级完全由逐点坐标表覆盖。
        return level
    if rid < 9:
        # 2～5级始终混合；6～8级只来自固定散点，不形成内圈高级带。
        return 2 if roll < 12 else 3 if roll < 42 else 4 if roll < 70 else 5
    return 3 if roll < 5 else 4 if roll < 30 else 5 if roll < 65 else 6


def build():
    names = ['青州', '徐州', '荆州', '益州', '凉州', '幽州', '河东', '关中', '河内', '王畿']
    colors = ['#7eaf90', '#c2b679', '#b5a079', '#8ca782', '#829da7', '#a0a1bb', '#b99862', '#aa8066', '#8ca7a1', '#d3b56a']
    regions = []
    for i, name in enumerate(names):
        angle = (i + .5) * math.tau / 6 if i < 6 else (i - 6 + .5) * math.tau / 3
        r = 385 if i < 6 else 190 if i < 9 else 0
        regions.append(dict(id=i, name=name, tier=0 if i < 6 else 1 if i < 9 else 2,
                            color=colors[i], x=round(CENTER + r * math.cos(angle)), y=round(CENTER + r * math.sin(angle))))
    gates = []

    def gate(name, x, y, a, b, level, nx, ny):
        gates.append(dict(id=f'pass-{len(gates) + 1:02}', name=name, x=round(x), y=round(y),
                          regions=[a, b], level=level, nx=nx, ny=ny))

    for i, name in enumerate(['临淄关', '广陵关', '江陵关', '剑门关', '玉门关', '雁门关']):
        a = (i + .5) * math.tau / 6
        gate(name, CENTER + 285 * math.cos(a), CENTER + 285 * math.sin(a), i, 6 + i // 2, 5, math.cos(a), math.sin(a))
    for i, name in enumerate(['虎牢关', '函谷关', '孟津关']):
        a = (i + .5) * math.tau / 3
        gate(name, CENTER + 100 * math.cos(a), CENTER + 100 * math.sin(a), 6 + i, 9, 8, math.cos(a), math.sin(a))
    for i, name in enumerate(['东海隘', '淮南隘', '巴蜀隘', '陇西隘', '朔方隘', '渔阳隘']):
        a = i * math.tau / 6
        gate(name, CENTER + 405 * math.cos(a), CENTER + 405 * math.sin(a), (i - 1) % 6, i, 4, -math.sin(a), math.cos(a))
    for i, name in enumerate(['蒲坂渡', '武关', '潼关']):
        a = i * math.tau / 3
        gate(name, CENTER + 190 * math.cos(a), CENTER + 190 * math.sin(a), 6 + (i - 1) % 3, 6 + i, 6, -math.sin(a), math.cos(a))

    ids = bytearray(region_at(x, y) for y in range(SIZE) for x in range(SIZE))
    blocked = bytearray(SIZE * SIZE)
    river = []
    patches = []
    resources = []
    # 边界两格厚，通行走廊只在命名关隘附近开口。
    for y in range(SIZE):
        for x in range(SIZE):
            idx = y * SIZE + x
            rid = ids[idx]
            border = x < 3 or y < 3 or x >= SIZE - 3 or y >= SIZE - 3
            if not border:
                border = any(ids[(y + dy) * SIZE + x + dx] != rid for dx, dy in [(2, 0), (-2, 0), (0, 2), (0, -2)])
            h = noise(x, y)
            if border:
                blocked[idx] = 1
                resources.append([0, 0])
                if 6 <= rid < 9 and math.hypot(x - CENTER, y - CENTER) > 275:
                    river.append(idx)
                continue
            level = resource_level(x, y, rid, regions)
            # 局部类型轮换，避免新手附近只有一种资源造成卡粮/卡铁。
            kind = 52 + noise(x + 419, y + 673) % 4
            resources.append([kind, level])
    # 每条走廊连通两个州，关口本身只有一个坐标，与现有要塞协议一致。
    corridor = set()
    for g in gates:
        for step in range(-9, 10):
            x, y = round(g['x'] + g['nx'] * step), round(g['y'] + g['ny'] * step)
            for dy in range(-1, 2):
                for dx in range(-1, 2):
                    idx = (y + dy) * SIZE + x + dx
                    corridor.add(idx)
                    blocked[idx] = 0
                    resources[idx] = [52 + noise(x + dx, y + dy) % 4, resource_level(x + dx, y + dy, ids[idx], regions)]
        # 中心收窄为单格关门；移除这一个关门格，八方向也不能从旁边绕过去。
        horizontal = abs(g['nx']) >= abs(g['ny'])
        for lateral in range(-5, 6):
            for depth in range(-1, 2):
                x = g['x'] + (depth if horizontal else lateral)
                y = g['y'] + (lateral if horizontal else depth)
                idx = y * SIZE + x
                if lateral == 0:
                    blocked[idx] = 0
                    resources[idx] = [55, resource_level(x, y, ids[idx], regions)]
                    corridor.add(idx)
                else:
                    blocked[idx] = 1
                    resources[idx] = [0, 0]
                    corridor.discard(idx)
        resources[g['y'] * SIZE + g['x']] = [50, g['level']]
        del g['nx'], g['ny']
    river = [idx for idx in river if idx not in corridor]
    # 城池有独立 3/5/7 格占地范围，周边预留不产生资源图标。
    cities = []
    for r in regions:
        cities.append(dict(name=r['name'] + ('州府' if r['tier'] == 0 else '都城') if r['id'] != 9 else '洛阳',
                           x=r['x'], y=r['y'], level=4 if r['tier'] == 0 else 7 if r['tier'] == 1 else 10, region=r['id'],
                           footprintRadius=1 if r['tier'] == 0 else 2 if r['tier'] == 1 else 4,
                           art='town' if r['tier'] == 0 else 'county' if r['tier'] == 1 else 'capital'))
    for c in cities:
        radius = c['footprintRadius']
        for y in range(c['y'] - radius, c['y'] + radius + 1):
            for x in range(c['x'] - radius, c['x'] + radius + 1):
                resources[y * SIZE + x] = [0, 0]
        resources[c['y'] * SIZE + c['x']] = [51, c['level']]
    spawn_zones = []
    for y in range(24, SIZE - 24, 48):
        for x in range(24, SIZE - 24, 48):
            rid = region_at(x, y)
            if rid >= 6 or math.hypot(x - CENTER, y - CENTER) < 380:
                continue
            if any(region_at(x + dx, y + dy) != rid for dx in (-14, 14) for dy in (-14, 14)):
                continue
            if any(math.hypot(x - c['x'], y - c['y']) < 36 for c in cities):
                continue
            if any(math.hypot(x - g['x'], y - g['y']) < 26 for g in gates):
                continue
            spawn_zones.append(dict(x=x, y=y, region=rid, safeRadius=12))
    # 真正可走、可选中的空地，与山河阻挡的[0,0]用独立索引区分。
    empty_cells = []
    for idx, (kind, level) in enumerate(resources):
        if not 52 <= kind <= 55:
            continue
        x, y = idx % SIZE, idx // SIZE
        distance = max(abs(x % 48 - 24), abs(y % 48 - 24))
        # 空地也逐格采样，避免3×3资源团和斜向整排地块。
        keep = noise(x + 71, y + 167) % 100 < (60 if distance <= 6 and ids[idx] < 6 else 40)
        if not keep:
            empty_cells.append(idx)
            resources[idx] = [0, 0]
    fixed = json.loads((ROOT / 'tools/world/fixed-birth-resources.json').read_text(encoding='utf8'))
    if fixed.get('schemaVersion') != 2 or fixed['width'] != SIZE or fixed['height'] != SIZE:
        raise ValueError('固定高级资源表尺寸与地图不一致')
    empty_set = set(empty_cells)
    fixed_ids = set()
    fixed_buckets = {}
    for point in fixed['points']:
        x, y = point['x'], point['y']
        idx = y * SIZE + x
        if not 0 <= x < SIZE or not 0 <= y < SIZE or idx in fixed_ids:
            raise ValueError(f'固定高级资源坐标无效或重复: {point}')
        if region_at(x, y) != point['region'] or point['region'] >= 6 or point['level'] not in (4, 5, 6) or point['type'] not in (52, 53, 54, 55):
            raise ValueError(f'固定高级资源字段无效: {point}')
        if blocked[idx] or resources[idx][0] in (50, 51) or resources[idx][0] == 0 and idx not in empty_set:
            raise ValueError(f'固定高级资源与阻挡/城市占地冲突: {point}')
        if any(max(abs(x - s['x']), abs(y - s['y'])) <= 12 for s in spawn_zones):
            raise ValueError(f'固定高级资源进入新手保护圈: {point}')
        bucket = (x // 64, y // 64)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for other in fixed_buckets.get((bucket[0] + dx, bucket[1] + dy), []):
                    lowest = min(point['level'], other['level'])
                    spacing = fixed['level6MinDistance'] if lowest == 6 else fixed['advancedMinDistance'] if lowest >= 5 else fixed['minDistance']
                    if math.hypot(x - other['x'], y - other['y']) < spacing:
                        raise ValueError(f'固定资源间距不足: {point["id"]}, {other["id"]}')
        fixed_buckets.setdefault(bucket, []).append(point)
        resources[idx] = [point['type'], point['level']]
        fixed_ids.add(idx)
        empty_set.discard(idx)
    from resource_layout import apply_inner_resources, mix_resources
    inner = apply_inner_resources(ROOT, resources, empty_set, blocked, region_at)
    all_fixed_ids = fixed_ids | {p['y'] * SIZE + p['x'] for p in inner['points']}
    mix_resources(resources, ids, empty_set, all_fixed_ids, noise)
    empty_cells = sorted(empty_set)
    strategy = dict(version=1, title='千里山河 · 破关逐鹿', width=SIZE, height=SIZE, seed=SEED,
                    fixedBirthResourceCount=len(fixed_ids),
                    fixedBirthLevels=[4, 5, 6], birthResourceMinDistance=dict(all=8, advanced=28, level6=48),
                    resourceLayoutVersion=3, fixedInnerResourceCount=len(inner['points']), innerResourceSpacing=inner['spacing'],
                    regions=regions, gates=gates, cities=cities, spawnZones=spawn_zones,
                    stages=['立足出生州，发展资源与同盟', '铺路至关口，集结攻关', '控制资源州，争夺渡口与都城', '突破王畿三关，会战洛阳'])
    rivers = set(river)
    mountains = [i for i, value in enumerate(blocked) if value and i not in rivers]
    from mountain_layout import build_mountain_patches
    patches = build_mountain_patches(set(mountains), gates, blocked, noise)
    landscape = dict(version=5, width=SIZE, height=SIZE, seed=SEED, riverCells=river, mountainCells=mountains, patches=patches)
    world = ROOT / 'assets/resources/world'
    (ROOT / 'assets/resources/config/mapRes_0.json').write_text(json.dumps(dict(w=SIZE, h=SIZE, list=resources, emptyCells=empty_cells), separators=(',', ':')), encoding='utf8')
    (world / 'original-landscape.json').write_text(json.dumps(landscape, separators=(',', ':')), encoding='utf8')
    (world / 'campaign-map.json').write_text(json.dumps(strategy, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    city_mask = bytearray(SIZE * SIZE)
    for c in cities:
        city_mask[c['y'] * SIZE + c['x']] = 1
    masks = []
    for i, (name, values) in enumerate([('obstruct', blocked), ('city_position', city_mask)]):
        masks.append(f'<layer id="{i + 1}" name="{name}" width="1000" height="1000" visible="0"><data encoding="csv">' + ','.join(map(str, values)) + '</data></layer>')
    tmx = '<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.4" tiledversion="1.4.3" orientation="isometric" renderorder="right-down" width="1000" height="1000" tilewidth="200" tileheight="100" infinite="0" nextlayerid="3" nextobjectid="1">\n<tileset firstgid="1" source="original-ground.tsx"/>\n' + '\n'.join(masks) + '\n</map>\n'
    stage = ROOT / 'temp/campaign-map'
    stage.mkdir(parents=True, exist_ok=True)
    (stage / 'map.tmx').write_text(tmx, encoding='utf8')
    print(json.dumps(dict(size=[SIZE, SIZE], cells=len(resources), gates=len(gates), cities=len(cities), patches=len(patches), riverCells=len(river))))
    return strategy, ids, blocked, resources


if __name__ == '__main__':
    build()
