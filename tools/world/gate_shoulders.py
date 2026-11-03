"""补齐山口外侧的低山脚；只输出美术贴片，不改通路、资源或阻挡格。"""


def inside_polygon(point, polygon):
    x, y = point
    hit = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            hit = not hit
    return hit


def gate_ground(gate, pixel):
    width = 760 if gate['level'] >= 8 else 680 if gate['level'] >= 6 else 600
    height = width * 805 / 1280
    cx, cy = pixel(gate['x'], gate['y'])
    mirror = -1 if gate['axis'] == 'x' else 1
    return [(cx+(x-.5)*width*mirror, cy+(1-y-.46)*height)
            for x, y in ((.015,.61),(.40,.20),(.985,.62),(.55,.99))]


def pass_protected_points(gate, blocked, pixel):
    gx, gy = gate['x'], gate['y']
    points = {pixel(gx+dx, gy+dy) for dx in (-1,0,1) for dy in (-1,0,1)
              if not blocked[(gy+dy)*1000+gx+dx]}
    # 连续采样前后城门道路，不只检查九个格心，防止贴片伸进格心之间。
    for i in range(-16,17):
        u = i / 4
        for v in (-.32,0,.32):
            x, y = (gx+u,gy+v) if gate['axis'] == 'x' else (gx+v,gy+u)
            if not blocked[round(y)*1000+round(x)]:
                points.add(pixel(x,y))
    return sorted(points)


def build_gate_shoulders(patches, mountains, gates, blocked, coverage, pixel):
    baseline = [p for p in patches if p.get('role') != 'gate-shoulder']
    coverage.buckets.clear()
    for p in baseline:
        coverage.add(p)
    additions = []
    for gate in gates:
        if gate.get('crossing') != 'pass':
            continue
        gx, gy = gate['x'], gate['y']
        protected = pass_protected_points(gate, blocked, pixel)
        ground = gate_ground(gate, pixel)
        cells = [(x,y) for y in range(gy-5,gy+6) for x in range(gx-5,gx+6)
                 if y*1000+x in mountains]
        samples = set()
        for x,y in cells:
            samples.add((x,y))
            for dx,dy in ((1,0),(0,1),(1,1),(1,-1)):
                if (y+dy)*1000+x+dx in mountains:
                    for t in (.25,.5,.75):
                        samples.add((x+dx*t,y+dy*t))
        # 城内已经有建筑原画覆盖，城外裸露山带才是补齐目标。
        points = [pixel(x,y) for x,y in sorted(samples)
                  if not inside_polygon(pixel(x,y),ground) and not coverage.covered(x,y)]
        candidates = []
        for x,y in cells:
            for art in ('mountain_shoulder','mountain_saddle_natural'):
                for width in (280,360,440,520):
                    for height in (.68,.84):
                        for anchor in (.36,.50):
                            p = dict(x=x,y=y,art=art,width=width,heightScale=height,anchorY=anchor,
                                     role='gate-shoulder',gate=gate['id'],flipX=gate['axis']=='x')
                            px,py = pixel(x,y)
                            nearby = [(a,b) for a,b in protected if abs(a-px)<width and abs(b-py)<width]
                            if any(coverage.alpha_at(p,a,b)>=48 or coverage.ellipse_at(p,a,b) for a,b in nearby):
                                continue
                            ids = {i for i,(a,b) in enumerate(points) if abs(a-px)<width*.5 and abs(b-py)<width
                                   and coverage.alpha_at(p,a,b)>=160}
                            if ids:
                                candidates.append((p,ids))
        missing = set(range(len(points)))
        for _ in range(8):
            if not missing or not candidates:
                break
            p,ids = max(candidates,key=lambda c:(len(c[1]&missing)/(1+c[0]['width']/900),-c[0]['width']))
            gain = ids & missing
            if len(gain)<3:
                break
            additions.append(p)
            coverage.add(p)
            missing -= gain
            candidates = [(a,b) for a,b in candidates if a is not p]
    return baseline + additions
