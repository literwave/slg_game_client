"""等级/种类交错、空地打散和固定内州高级点；不改变山河或关隘。"""
import collections
import json
import math


def apply_inner_resources(root, resources, empty, blocked, region_at):
    fixed = json.loads((root / 'tools/world/fixed-inner-resources.json').read_text(encoding='utf8'))
    assert fixed['schemaVersion'] == 1 and fixed['width'] == fixed['height'] == 1000
    ids, names, buckets = set(), set(), collections.defaultdict(list)
    for p in fixed['points']:
        x, y, region, level = p['x'], p['y'], p['region'], p['level']
        idx = y * 1000 + x
        assert 0 <= x < 1000 and 0 <= y < 1000 and idx not in ids and p['id'] not in names
        assert region_at(x, y) == region and 6 <= region <= 9 and p['type'] in range(52, 56)
        assert level in ((6, 7, 8) if region < 9 else (7, 8, 9))
        assert not blocked[idx] and (resources[idx][0] in range(52, 56) or idx in empty), p
        bx, by = x // 64, y // 64
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for q in buckets[bx + dx, by + dy]:
                    lowest = min(level, q['level'])
                    required = min(int(fixed['spacing'][str(region)].get(str(lowest), 12)),
                                   int(fixed['spacing'][str(q['region'])].get(str(lowest), 12)))
                    assert math.hypot(x-q['x'], y-q['y']) >= required, (p, q)
        buckets[bx, by].append(p)
        resources[idx] = [p['type'], level]
        empty.discard(idx)
        ids.add(idx); names.add(p['id'])
    return fixed


def mix_resources(resources, ids, empty, fixed_ids, noise):
    """阻止横/竖/两种斜向连续三格同等级或同种类；固定点保持原样。"""
    size = 1000
    for idx, cell in enumerate(resources):
        if cell[0] not in range(52, 56) or idx in fixed_ids:
            continue
        x, y = idx % size, idx // size
        previous = []
        for dx, dy in ((-1, 0), (0, -1), (-1, -1), (1, -1)):
            if 0 <= x+dx*2 < size and 0 <= y+dy*2 < size:
                a, b = resources[(y+dy)*size+x+dx], resources[(y+dy*2)*size+x+dx*2]
                if a[0] in range(52, 56) and b[0] in range(52, 56):
                    previous.append((a, b))
        forbidden_types = {a[0] for a, b in previous if a[0] == b[0]}
        # 后方的固定点不会再改色，当前格也要提前避让它们组成的三连。
        for dx, dy in ((1, 0), (0, 1), (1, 1), (-1, 1)):
            for offsets in ((-2, -1), (-1, 1), (1, 2)):
                others = [(x+dx*k, y+dy*k) for k in offsets]
                if not all(0 <= px < size and 0 <= py < size for px, py in others):
                    continue
                keys = [py*size+px for px, py in others]
                if all(key < idx or key in fixed_ids for key in keys):
                    a, b = (resources[key] for key in keys)
                    if a[0] == b[0] and a[0] in range(52, 56):
                        forbidden_types.add(a[0])
        types = [t for t in range(52, 56) if t not in forbidden_types]
        if cell[0] in forbidden_types:
            if not types:
                resources[idx] = [0, 0]; empty.add(idx); continue
            cell[0] = types[noise(x+711, y+319) % len(types)]
        forbidden_levels = {a[1] for a, b in previous if a[1] == b[1]}
        safe = max(abs(x % 48 - 24), abs(y % 48 - 24)) <= 5
        levels = [1, 2] if ids[idx] < 6 and safe else [1, 2, 3] if ids[idx] < 6 else [2, 3, 4, 5] if ids[idx] < 9 else [3, 4, 5, 6]
        choices = [level for level in levels if level not in forbidden_levels]
        if cell[1] in forbidden_levels:
            if choices:
                cell[1] = choices[noise(x+217, y+593) % len(choices)]
            else:
                resources[idx] = [0, 0]; empty.add(idx)
