"""自然州域、分水岭和树枝状水系；所有美术与通行表使用同一份地形。"""
import collections
import math

SIZE = 1000
WATER_PAIRS = {(0, 5), (6, 8), (6, 9), (8, 9), (2, 3), (3, 7)}


def warped_point(x, y):
    # 两次可逆剪切保留盆地连通性，多尺度起伏打破直线和规则多边形。
    u = x + 38 * math.sin(y / 87 + .7) + 18 * math.sin(y / 34 + 1.9) + 5 * math.sin(y / 13)
    v = y + 34 * math.sin(u / 94 - .8) + 16 * math.sin(u / 39 + 2.4) + 5 * math.sin(u / 16 + .5)
    return u, v


def encode_rows(ids):
    rows = []
    for y in range(SIZE):
        row, start, region = [], 0, ids[y * SIZE]
        for x in range(1, SIZE + 1):
            next_region = ids[y * SIZE + x] if x < SIZE else -1
            if next_region != region:
                row.extend((x, region))  # exclusive end, region; Lua/TS 共用，无浮点公式差异
                start, region = x, next_region
        rows.append(row)
    return rows


def decode_rows(rows):
    ids = bytearray(SIZE * SIZE)
    for y, row in enumerate(rows):
        start = 0
        for i in range(0, len(row), 2):
            end, region = row[i:i + 2]
            ids[y * SIZE + start:y * SIZE + end] = bytes([region]) * (end - start)
            start = end
        assert start == SIZE
    return ids


def align_regions(ids, blocked, gates, regions):
    """以关门关闭后的实际连通域确定可通行格归属，发布前拒绝孤立口袋。"""
    closed = bytearray(blocked)
    for gate in gates: closed[gate['y']*SIZE+gate['x']] = 1
    seen = bytearray(SIZE*SIZE)
    for region in regions:
        start = region['y']*SIZE+region['x']
        if closed[start] or seen[start]: raise ValueError('州府被阻挡或州界泄漏')
        seen[start] = 1
        queue = collections.deque([start])
        while queue:
            i = queue.popleft(); ids[i] = region['id']
            x,y = i%SIZE,i//SIZE
            for dy in (-1,0,1):
                for dx in (-1,0,1):
                    nx,ny = x+dx,y+dy
                    if not 0 <= nx < SIZE or not 0 <= ny < SIZE: continue
                    j = ny*SIZE+nx
                    if not closed[j] and not seen[j]:
                        seen[j] = 1; queue.append(j)
    if any(not closed[i] and not seen[i] for i in range(SIZE*SIZE)):
        raise ValueError('自然地形存在无法到达的孤立区域')
    for gate in gates:
        neighbors = {ids[(gate['y']+dy)*SIZE+gate['x']+dx] for dy in (-1,0,1) for dx in (-1,0,1)
                     if not closed[(gate['y']+dy)*SIZE+gate['x']+dx]}
        if neighbors != set(gate['regions']): raise ValueError(f'关口连接错误: {gate["name"]}')


def simplify(points, tolerance=1.25):
    if len(points) < 3:
        return points
    ax, ay = points[0]; bx, by = points[-1]
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    best, at = 0, 0
    for i, (x, y) in enumerate(points[1:-1], 1):
        t = max(0, min(1, ((x-ax)*dx + (y-ay)*dy) / denom)) if denom else 0
        d = (x-ax-t*dx)**2 + (y-ay-t*dy)**2
        if d > best:
            best, at = d, i
    if best <= tolerance * tolerance:
        return [points[0], points[-1]]
    return simplify(points[:at+1], tolerance)[:-1] + simplify(points[at:], tolerance)


def land_shapes(ids, river):
    """真实陆地轮廓供远景使用，避免近景已变曲线而远景仍画圆。"""
    edges = [collections.defaultdict(list) for _ in range(10)]
    def at(x, y):
        i = y * SIZE + x
        return ids[i] if 0 <= x < SIZE and 0 <= y < SIZE and not river[i] else -1
    for y in range(SIZE):
        for x in range(SIZE):
            region = at(x, y)
            if region < 0:
                continue
            e = edges[region]
            if at(x, y-1) != region: e[(x, y)].append((x+1, y))
            if at(x+1, y) != region: e[(x+1, y)].append((x+1, y+1))
            if at(x, y+1) != region: e[(x+1, y+1)].append((x, y+1))
            if at(x-1, y) != region: e[(x, y+1)].append((x, y))
    shapes = []
    for region, graph in enumerate(edges):
        while graph:
            start = next(iter(graph)); p = start; ring = [p]
            while True:
                following = graph[p].pop()
                if not graph[p]: del graph[p]
                p = following; ring.append(p)
                if p == start: break
            area = sum(a[0]*b[1]-a[1]*b[0] for a, b in zip(ring, ring[1:])) / 2
            if area <= 2:  # 水系连接边缘；仅忽略不到两格的栅格缝隙
                continue
            middle = len(ring)//2
            outline = simplify(ring[:middle+1])[:-1] + simplify(ring[middle:])[:-1]
            shapes.append(dict(region=region, points=[[x-.5, y-.5] for x, y in outline]))
    return shapes


def build_terrain(regions, gates, noise):
    # 以十个城池所在平原为盆地中心，州界是盆地间的曲折分水岭，而非同心圆。
    seeds = [(r['x'], r['y']) for r in regions]
    ids = bytearray(SIZE * SIZE)
    for y in range(SIZE):
        for x in range(SIZE):
            u, v = warped_point(x, y)
            ids[y*SIZE+x] = min(range(10), key=lambda r: (u-seeds[r][0])**2 + (v-seeds[r][1])**2)
    for r in regions:
        assert ids[r['y']*SIZE+r['x']] == r['id'], '城池不属于对应州域'

    boundaries = collections.defaultdict(list)
    for y in range(2, SIZE-2):
        for x in range(2, SIZE-2):
            r = ids[y*SIZE+x]
            others = {ids[y*SIZE+x+1], ids[(y+1)*SIZE+x]} - {r}
            for other in others:
                boundaries[tuple(sorted((r, other)))].append((x, y))
    for gate in gates:
        pair = tuple(sorted(gate['regions']))
        candidates = sorted(boundaries[pair], key=lambda p: (p[0]-gate['x'])**2+(p[1]-gate['y'])**2)
        for x, y in candidates:
            if not 15 < x < 984 or not 15 < y < 984: continue
            nearby = {ids[(y+dy)*SIZE+x+dx] for dy in range(-13,14,3) for dx in range(-13,14,3)}
            if nearby != set(pair): continue
            # 通道沿州界法向通过，关门收窄仍由主生成器负责。
            ax = ay = bx = by = ac = bc = 0
            for dy in range(-5,6):
                for dx in range(-5,6):
                    if ids[(y+dy)*SIZE+x+dx] == pair[0]: ax += dx; ay += dy; ac += 1
                    else: bx += dx; by += dy; bc += 1
            if not ac or not bc: continue
            nx, ny = bx/bc-ax/ac, by/bc-ay/ac
            length = math.hypot(nx,ny)
            axis = 'x' if abs(nx) >= abs(ny) else 'y'
            gate.update(x=x,y=y,nx=nx/length,ny=ny/length,axis=axis)
            if pair in WATER_PAIRS:
                # 长桥桥面沿一个等距轴跨河，桥头再衔接曲折的陆上通道。
                gate.update(crossing='bridge',bridgeSpan=12 if gate['level']>=8 else 10,
                            nx=1 if axis=='x' else 0,ny=0 if axis=='x' else 1)
            else:
                gate['crossing'] = 'pass'
            break
        else:
            raise ValueError(f'没有安全关口位置: {gate["name"]}')

    blocked, river = bytearray(SIZE*SIZE), bytearray(SIZE*SIZE)
    mountain_roots, river_roots = [], []
    for y in range(SIZE):
        for x in range(SIZE):
            i = y*SIZE+x
            if min(x,y,999-x,999-y) < 3:
                blocked[i] = river[i] = 1  # 外缘收为水岸，不再铺正方形山墙
                continue
            width = 2 + int(math.sin(x/29+.5*math.sin(y/43)) + math.cos(y/37) > .45)
            other = {ids[(y+dy)*SIZE+x+dx] for dx,dy in ((width,0),(-width,0),(0,width),(0,-width))
                     if 0 <= x+dx < SIZE and 0 <= y+dy < SIZE} - {ids[i]}
            if not other: continue
            blocked[i] = 1
            wet = any(tuple(sorted((ids[i], r))) in WATER_PAIRS for r in other)
            river[i] = int(wet)
            if noise(x+61,y+133)%31 == 0:
                (river_roots if wet else mountain_roots).append((x,y))

    # 支流和余脉伸入盆地，避免所有地貌都沿州界形成一道等宽的墙。
    landmarks = regions + gates
    roots = []
    features = []
    base_blocked = bytes(blocked)
    for wet, candidates, limit in ((True,river_roots,10),(False,mountain_roots,16)):
        candidates.sort(key=lambda p: noise(p[0]+857,p[1]+331))
        used = 0
        for x,y in candidates:
            if min(x,y,999-x,999-y) < 40: continue
            if any(math.hypot(x-p['x'],y-p['y']) < 36 for p in landmarks): continue
            if any(math.hypot(x-a,y-b) < 82 for a,b in roots): continue
            # 朝同侧开阔地伸展，宽度从汇合口向源头递减。
            directions = []
            for k in range(16):
                angle = k*math.tau/16
                cx,cy = round(x+math.cos(angle)*12),round(y+math.sin(angle)*12)
                if not blocked[cy*SIZE+cx]: directions.append((noise(cx,cy),angle,ids[cy*SIZE+cx]))
            if not directions: continue
            _,angle,region = min(directions)
            length = 23 + noise(x,y)%26
            points = []
            for step in range(length+1):
                bend = math.sin(step/10) * min(7,step*.3)
                cx = round(x+math.cos(angle)*step-math.sin(angle)*bend)
                cy = round(y+math.sin(angle)*step+math.cos(angle)*bend)
                if not 4 < cx < 995 or not 4 < cy < 995: break
                if step > 8 and ids[cy*SIZE+cx] != region: break
                if any(math.hypot(cx-p['x'],cy-p['y']) < 22 for p in landmarks): break
                radius = max(1, round((2.5 if wet else 3.8)*(1-step/(length+6))))
                # 余脉不能弯回另一段州界，围出无法抵达的狭小盆地。
                if step > 10 and any(base_blocked[(cy+dy)*SIZE+cx+dx]
                                     for dy in range(-radius-1,radius+2) for dx in range(-radius-1,radius+2)):
                    break
                points.append([cx,cy])
                for dy in range(-radius,radius+1):
                    for dx in range(-radius,radius+1):
                        if dx*dx+dy*dy > radius*radius: continue
                        j = (cy+dy)*SIZE+cx+dx
                        blocked[j] = 1
                        if wet: river[j] = 1
            if len(points) < 8: continue
            roots.append((x,y)); used += 1
            features.append(dict(kind='tributary' if wet else 'spur',points=points))
            if used >= limit: break
    shape_bridge_banks(gates, blocked, river)
    return ids, blocked, river, features


def shape_bridge_banks(gates, blocked, river):
    """桥墩落水、引坡落岸；横向渐变到原河道，避免桥边出现矩形水池。"""
    for gate in gates:
        if gate.get('crossing') != 'bridge':
            continue
        horizontal = gate['axis'] == 'x'
        def index(u, v):
            x = gate['x'] + (u if horizontal else v)
            y = gate['y'] + (v if horizontal else u)
            return y * SIZE + x
        original = bytes(river)
        half_span = gate['bridgeSpan'] / 2
        for lateral in range(-12, 13):
            wet = [u for u in range(-20, 21) if original[index(u, lateral)]]
            if not wet:
                continue
            # 留出两端各约1.5格的实体岸坡；河岸带轻微不对称起伏。
            weight = math.cos(lateral * math.pi / 26) ** 2
            left = round(min(wet) * (1-weight) + (-half_span+1.6+.25*math.sin(lateral*.7)) * weight)
            right = round(max(wet) * (1-weight) + (half_span-1.4+.25*math.sin(lateral*.6+.8)) * weight)
            for u in range(min(min(wet),left), max(max(wet),right)+1):
                idx = index(u,lateral)
                wet_now = left <= u <= right
                if wet_now or original[idx]:
                    river[idx] = int(wet_now)
                    blocked[idx] = int(wet_now)


def migrate_fixed(fixed, ids, blocked, cities, noise, reserved=()):
    """仅迁移新山河覆盖或州域已变化的固定点，其余坐标保持不变。"""
    import copy
    result = copy.deepcopy(fixed)
    buckets = collections.defaultdict(list)
    occupied = set()
    forbidden = bytearray(blocked)
    for idx in reserved: forbidden[idx] = 1
    for p in cities:
        radius = p['footprintRadius']
        for y in range(max(0,p['y']-radius),min(SIZE,p['y']+radius+1)):
            for x in range(max(0,p['x']-radius),min(SIZE,p['x']+radius+1)):
                forbidden[y*SIZE+x] = 1
    def spacing(p,q):
        low = min(p['level'],q['level'])
        if p['region'] < 6: return 48 if low == 6 else 28 if low >= 5 else 8
        return min(int(fixed['spacing'][str(p['region'])].get(str(low),12)),int(fixed['spacing'][str(q['region'])].get(str(low),12)))
    def valid(p,x,y):
        i = y*SIZE+x
        if not 3 <= x < 997 or not 3 <= y < 997 or forbidden[i] or i in occupied or ids[i] != p['region']: return False
        bx,by=x//64,y//64
        return all((x-q['x'])**2+(y-q['y'])**2 >= spacing(p,q)**2
                   for dy in (-1,0,1) for dx in (-1,0,1) for q in buckets[bx+dx,by+dy])
    def put(p):
        occupied.add(p['y']*SIZE+p['x']); buckets[p['x']//64,p['y']//64].append(p)
    pending = []
    for p in result['points']:
        if valid(p,p['x'],p['y']): put(p)
        else: pending.append(p)
    # 高级点先放，避免低级点占掉48格间距的有限空间。
    for p in sorted(pending,key=lambda p:(-p['level'],p['id'])):
        old = (p['x'],p['y'])
        found = False
        for radius in range(1,500):
            ring = [(old[0]+dx,old[1]+dy) for dx in range(-radius,radius+1) for dy in (-radius,radius)]
            ring += [(old[0]+dx,old[1]+dy) for dy in range(-radius+1,radius) for dx in (-radius,radius)]
            ring.sort(key=lambda xy: ((xy[0]-old[0])**2+(xy[1]-old[1])**2,noise(*xy)))
            for x,y in ring:
                if valid(p,x,y):
                    p.update(x=x,y=y); put(p); found=True; break
            if found: break
        if not found: raise ValueError(f'固定资源无法迁移: {p}')
    result['terrainRevision'] = 2
    return result, len(pending)
