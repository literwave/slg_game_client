"""提取桥图透明轮廓；只生成点击数据，不修改原图或地图通路。"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/world'))
from mountain_layout import read_alpha

def generate():
    art = 'river_pass_citadel'
    width, height, alpha = read_alpha(art)
    columns = 384
    count = math.ceil(columns * height / width)
    rows = []
    for row in range(count):
        spans, start = [], None
        for col in range(columns + 1):
            solid = False
            if col < columns:
                for y in range(row * height // count, (row + 1) * height // count):
                    if any(alpha[y * width + x] >= 128 for x in
                           range(col * width // columns, (col + 1) * width // columns)):
                        solid = True
                        break
            if solid and start is None:
                start = col
            elif not solid and start is not None:
                spans.extend((start, col))
                start = None
        rows.append(spans)
    source_hash = hashlib.sha256((ROOT / 'assets/resources/ui/world' / (art + '.png')).read_bytes()).hexdigest()
    return ("/** 由 tools/art/build-bridge-hit-mask.py 生成；保留桥拱透明洞口。 */\n"
            "export const BRIDGE_SILHOUETTE = {\n"
            f"    width: {width}, height: {height}, columns: {columns},\n"
            f"    sourceHash: '{source_hash}',\n"
            "    rows: [\n" +
            ''.join('        ' + json.dumps(row, separators=(',', ':')) + ',\n' for row in rows) +
            "    ],\n};\n")

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--emit', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    content = generate()
    target = ROOT / 'assets/scripts/map/BridgeSilhouette.ts'
    if args.emit:
        sys.stdout.reconfigure(encoding='utf-8')
        print(content, end='')
    elif args.check:
        assert target.read_text(encoding='utf-8') == content, '桥图已改变，请重新生成点击轮廓'
        print('PASS bridge alpha mask matches artwork')
    else:
        target.write_text(content, encoding='utf-8', newline='\n')
