"""按山带方向编排连体山脊，用真实透明轮廓合并覆盖，避免逐格堆山。"""
import collections
import heapq
import json
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MOUNTAIN_ART = ('mountain_ridge_connected', 'mountain_shoulder')


def read_alpha(name):
    png = (ROOT / 'assets/resources/ui/world' / (name + '.png')).read_bytes()
    width, height, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', png[16:29])
    assert depth == 8 and color == 6 and interlace == 0, name
    compressed = bytearray()
    offset = 8
    while offset < len(png):
        length = struct.unpack('>I', png[offset:offset + 4])[0]
        if png[offset + 4:offset + 8] == b'IDAT':
            compressed.extend(png[offset + 8:offset + 8 + length])
        offset += length + 12
    raw = zlib.decompress(compressed)
    stride = width * 4
    prev = bytearray(stride)
    alpha = bytearray(width * height)
    for y in range(height):
        offset = y * (stride + 1)
        mode = raw[offset]
        row = bytearray(raw[offset + 1:offset + 1 + stride])
        for i in range(stride):
            left, up, corner = row[i - 4] if i >= 4 else 0, prev[i], prev[i - 4] if i >= 4 else 0
            if mode == 1:
                predictor = left
            elif mode == 2:
                predictor = up
            elif mode == 3:
                predictor = (left + up) // 2
            elif mode == 4:
                p = left + up - corner
                distances = (abs(p - left), abs(p - up), abs(p - corner))
                predictor = (left, up, corner)[distances.index(min(distances))]
            else:
                assert mode == 0
                predictor = 0
            row[i] = (row[i] + predictor) & 255
        alpha[y * width:(y + 1) * width] = row[3::4]
        prev = row
    return width, height, alpha


def pixel(x, y):
    return (x - y) * 100, (999 - x - y) * 50


class Coverage:
    def __init__(self):
        self.frames = {name: read_alpha(name) for name in MOUNTAIN_ART}
        self.buckets = collections.defaultdict(list)

    def alpha_at(self, patch, px, py):
        width, height, alpha = self.frames[patch['art']]
        x, y = pixel(patch['x'], patch['y'])
        h = patch['width'] * height / width * patch.get('heightScale', 1)
        u = (px - x) / patch['width'] + .5
        if patch.get('flipX'):
            u = 1 - u
        v = 1 - patch.get('anchorY', .22) - (py - y) / h
        if not 0 <= u < 1 or not 0 <= v < 1:
            return 0
        return alpha[int(v * height) * width + int(u * width)]

    def ellipse_at(self, patch, px, py):
        width, height, _ = self.frames[patch['art']]
        x, y = pixel(patch['x'], patch['y'])
        h = patch['width'] * height / width * patch.get('heightScale', 1)
        dx = (px - x) / (patch['width'] * .39)
        dy = (py - y - (.5 - patch.get('anchorY', .22)) * h) / (h * .39)
        return dx * dx + dy * dy <= 1

    def add(self, patch):
        width, height, _ = self.frames[patch['art']]
        x, y = pixel(patch['x'], patch['y'])
        h = patch['width'] * height / width * patch.get('heightScale', 1)
        ay = patch.get('anchorY', .22)
        for by in range(math.floor((y - ay * h) / 256), math.floor((y + (1 - ay) * h) / 256) + 1):
            for bx in range(math.floor((x - patch['width'] / 2) / 256), math.floor((x + patch['width'] / 2) / 256) + 1):
                self.buckets[bx, by].append(patch)

    def covered(self, x, y):
        px, py = pixel(x, y)
        return any(self.alpha_at(p, px, py) >= 160 for p in self.buckets[math.floor(px / 256), math.floor(py / 256)])


def samples(x, y, mountains):
    yield x, y
    for dx, dy in ((1, 0), (0, 1), (1, 1), (1, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < 1000 and 0 <= ny < 1000 and ny * 1000 + nx in mountains:
            for step in (.25, .5, .75):
                yield x + dx * step, y + dy * step


def build_mountain_patches(mountains, gates, blocked, noise):
    cover = Coverage()
    protected = [pixel(g['x'] + dx, g['y'] + dy) for g in gates
                 for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                 if not blocked[(g['y'] + dy) * 1000 + g['x'] + dx]]
    def clear_pass(p):
        px, py = pixel(p['x'], p['y'])
        return all(not cover.ellipse_at(p, x, y) and cover.alpha_at(p, x, y) < 64
                   for x, y in protected if abs(px - x) < 650 and abs(py - y) < 650)

    # 对共享边只采样一次。先覆盖完整山带，再仅补仍裸露的山脚，
    # 不会因某个朝前采样点未覆盖，就在每一格重复叠一整座山。
    sample_cells = set()
    for idx in sorted(mountains):
        for x, y in samples(idx % 1000, idx // 1000, mountains):
            if any(max(abs(x - g['x']), abs(y - g['y'])) <= 3 for g in gates):
                continue
            sample_cells.add((int(x * 4), int(y * 4)))
    points = [pixel(x / 4, y / 4) for x, y in sorted(sample_cells)]
    point_buckets = collections.defaultdict(list)
    for i, (px, py) in enumerate(points):
        point_buckets[math.floor(px / 256), math.floor(py / 256)].append(i)

    def covered_points(p):
        width, height, alpha = cover.frames[p['art']]
        px, py = pixel(p['x'], p['y'])
        h = p['width'] * height / width * p['heightScale']
        left, bottom = px - p['width'] / 2, py - p['anchorY'] * h
        result = []
        for by in range(math.floor(bottom / 256), math.floor((bottom + h) / 256) + 1):
            for bx in range(math.floor(left / 256), math.floor((left + p['width']) / 256) + 1):
                for i in point_buckets[bx, by]:
                    sx, sy = points[i]
                    u, v = (sx - left) / p['width'], 1 - (sy - bottom) / h
                    if p['flipX']:
                        u = 1 - u
                    if 0 <= u < 1 and 0 <= v < 1 and alpha[int(v * height) * width + int(u * width)] >= 160:
                        result.append(i)
        return result

    def direction(x, y):
        neighbors = [pixel(dx, dy) for dy in range(-5, 6) for dx in range(-5, 6)
                     if 0 <= x + dx < 1000 and 0 <= y + dy < 1000 and (y + dy) * 1000 + x + dx in mountains]
        mx = sum(p[0] for p in neighbors) / len(neighbors)
        my = sum(p[1] for p in neighbors) / len(neighbors)
        xx = sum((p[0] - mx) ** 2 for p in neighbors)
        yy = sum((p[1] - my) ** 2 for p in neighbors)
        xy = sum((p[0] - mx) * (p[1] - my) for p in neighbors)
        return .5 * math.atan2(2 * xy, xx - yy)

    candidates, heap = [], []
    for idx in sorted(mountains):
        x, y = idx % 1000, idx // 1000
        h, angle = noise(x, y), direction(x, y)
        distance = min(max(abs(x - g['x']), abs(y - g['y'])) for g in gates)
        shoulder = abs(angle) > .95 or abs(angle) < .16 or distance < 5
        art = MOUNTAIN_ART[1 if shoulder else 0]
        width = (720 if shoulder else 1000) + h % 120
        if distance < 5:
            width = 180 + distance * 75
        p = dict(x=x, y=y, art=art, width=width, heightScale=round(.94 + (h % 11) / 100, 2),
                 anchorY=.38, role='range', flipX=angle > 0)
        if not clear_pass(p):
            continue
        covered = covered_points(p)
        if covered:
            i = len(candidates)
            candidates.append((p, covered))
            heapq.heappush(heap, (-len(covered), h, i))

    uncovered = bytearray([1]) * len(points)
    selected = []
    while heap:
        negative_count, tie, i = heapq.heappop(heap)
        p, ids = candidates[i]
        count = sum(uncovered[j] for j in ids)
        if not count:
            continue
        if count < -negative_count:
            heapq.heappush(heap, (-count, tie, i))
            continue
        selected.append(i)
        for j in ids:
            uncovered[j] = 0

    # 去掉后续山体已经完全遮住的候选，保留最少必要的衔接。
    counts = collections.Counter(j for i in selected for j in candidates[i][1])
    patches = []
    for i in reversed(selected):
        p, ids = candidates[i]
        if all(counts[j] > 1 for j in ids):
            for j in ids:
                counts[j] -= 1
        else:
            patches.append(p)
    patches.sort(key=lambda p: (p['y'], p['x']))
    # 仅关门紧邻的透明缝可交给关隘素材；其余裸露位置必须报错。
    missing = [points[i] for i, value in enumerate(uncovered) if value]
    for px, py in missing:
        row = (999 * 50 - py) / 100
        x, y = row + px / 200, row - px / 200
        if not any(max(abs(x - g['x']), abs(y - g['y'])) <= 5 for g in gates):
            raise ValueError(f'山脊未覆盖: {(x, y)}')
    return patches


if __name__ == '__main__':
    # 美术重排只写地貌配置，不重建资源、阻挡或服务端地图。
    import importlib.util
    spec = importlib.util.spec_from_file_location('campaign', ROOT / 'tools/world/build-campaign-map.py')
    campaign = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(campaign)
    target = ROOT / 'assets/resources/world/original-landscape.json'
    landscape = json.loads(target.read_text(encoding='utf8'))
    world = json.loads((ROOT / 'assets/resources/world/campaign-map.json').read_text(encoding='utf8'))
    blocked = bytearray(landscape['width'] * landscape['height'])
    for idx in landscape['mountainCells'] + landscape['riverCells']:
        blocked[idx] = 1
    landscape['patches'] = build_mountain_patches(set(landscape['mountainCells']), world['gates'], blocked, campaign.noise)
    landscape['version'] = 5
    target.write_text(json.dumps(landscape, separators=(',', ':')), encoding='utf8')
    print(json.dumps(dict(patches=len(landscape['patches']), art=dict(collections.Counter(p['art'] for p in landscape['patches'])))))
