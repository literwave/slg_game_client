"""山口关隘按整格封边：5×7 城基（通路深 5 格、跨山口宽 7 格），两座门外各清出 3 格宽平地（中心攻城格 + 左右各 1 格），其余贴墙格为山地。"""
RADIUS = 2
WIDTH_RADIUS = 3
RING = RADIUS + 1
WIDTH_RING = WIDTH_RADIUS + 1
OPEN_HALF_WIDTH = 1


def pass_cells(gate):
    for du in range(-RING, RING + 1):
        for dv in range(-WIDTH_RING, WIDTH_RING + 1):
            # 外圈四角不与城墙共边，不移动那里已有的固定资源。
            if abs(du) == RING and abs(dv) == WIDTH_RING:
                continue
            dx, dy = (du, dv) if gate['axis'] == 'x' else (dv, du)
            inside = abs(du) <= RADIUS and abs(dv) <= WIDTH_RADIUS
            wall = (dv != 0) if inside else (abs(du) != RING or abs(dv) > OPEN_HALF_WIDTH)
            yield gate['x'] + dx, gate['y'] + dy, wall, inside


def apply_pass_grid(gates, width, resources, empty, blocked, river_mask, protected=frozenset()):
    reserved = set()
    for gate in gates:
        if gate.get('crossing') != 'pass':
            continue
        gate['footprintRadius'] = RADIUS
        gate['footprintWidthRadius'] = WIDTH_RADIUS
        gate['attackEntrances'] = [dict(x=gate['x'] + (u if gate['axis'] == 'x' else 0),
            y=gate['y'] + (u if gate['axis'] == 'y' else 0)) for u in (RING, -RING)]
        for x, y, wall, inside in pass_cells(gate):
            idx = y * width + x
            if idx in protected:
                # 城墙外侧山肩格若已有固定资源（如临淄关北侧墙外 1 格），内侧 5×7 城基已完整封堵，保留固定资源不动。
                if not inside and wall:
                    continue
                raise ValueError(f'关隘整格布局与固定资源冲突: {gate["name"]} {x},{y}')
            if not (0 <= x < width and 0 <= y < len(blocked) // width):
                raise ValueError('关隘占地越界')
            if resources[idx][0] == 51 or (resources[idx][0] == 50 and (x, y) != (gate['x'], gate['y'])):
                raise ValueError('关隘占地与其他城关冲突')
            blocked[idx] = int(wall)
            river_mask[idx] = 0
            resources[idx] = [0, 0]
            empty.discard(idx)
            if not wall and (x, y) != (gate['x'], gate['y']):
                empty.add(idx)
            reserved.add(idx)
        resources[gate['y'] * width + gate['x']] = [50, gate['level']]
    return reserved


def pass_mountain_patches(patches, gates, blocked=None, width=1000):
    """沿贴墙山地逐格补低山；客户端对关口周围的可走整格裁切山体。"""
    result = [p for p in patches if p.get('role') not in ('gate-shoulder', 'pass-grid-shoulder')]
    for gate in gates:
        if gate.get('crossing') != 'pass':
            continue
        for x, y, wall, inside in pass_cells(gate):
            if not wall or inside:
                continue
            if blocked is not None and not blocked[y * width + x]:
                continue
            result.append(dict(x=x, y=y, art='mountain_shoulder_scree_v9', width=330,
                heightScale=.82, anchorY=.50, flipX=False,
                role='pass-grid-shoulder', gate=gate['id']))
    return result
