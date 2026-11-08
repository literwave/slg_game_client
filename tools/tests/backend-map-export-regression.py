"""独立核对已导出的 Lua 快照和 ZIP，避免只验证少数样本格。"""
import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--output', default='temp/world-map-export')
folder = (ROOT / parser.parse_args().output).resolve()


def read_json(path):
    return json.loads((ROOT / path).read_text(encoding='utf8'))


def table(text, key):
    match = re.search(r'\["' + re.escape(key) + r'"\]\s*=\s*\{', text)
    assert match, f'Lua 缺少 {key}'
    start = match.end() - 1
    depth = 0
    for index in range(start, len(text)):
        if text[index] == '{':
            depth += 1
        elif text[index] == '}':
            depth -= 1
            if depth == 0:
                return text[start + 1:index]
    raise AssertionError(f'Lua 表未闭合: {key}')


def numbers(text):
    return [int(value) for value in re.findall(r'\d+', text)]


names = {'mapRes_0.lua', 'campaign-map.lua', 'terrain.lua', 'manifest.lua'}
with zipfile.ZipFile(folder / 'world-map-backend.zip') as package:
    assert set(package.namelist()) == names
    assert package.testzip() is None
    content = {name: package.read(name) for name in names}
for name, data in content.items():
    assert data == (folder / name).read_bytes(), f'ZIP 与单文件不一致: {name}'
text = {name: data.decode('utf8') for name, data in content.items()}
manifest = text['manifest.lua']
checksums = {}
for name in sorted(names - {'manifest.lua'}):
    digest = hashlib.sha256(content[name]).hexdigest()
    assert re.search(r'\["' + re.escape(name) + r'"\]\s*=\s*"' + digest + '"', manifest), name
    checksums[name] = digest
revision = hashlib.sha256(json.dumps(checksums, sort_keys=True).encode('utf8')).hexdigest()
assert re.search(r'\["mapRevision"\]\s*=\s*"' + revision + '"', manifest)

source = read_json('assets/resources/config/mapRes_0.json')
expected = source['list']
count = 0
for match in re.finditer(r'\[(\d+)\]=\{(\d+),(\d+)\}', text['mapRes_0.lua']):
    cell_id, kind, level = map(int, match.groups())
    assert cell_id == count, f'格号遗漏或重排: {count}'
    assert [kind, level] == expected[cell_id], f'地块不一致: {cell_id}'
    count += 1
assert count == source['w'] * source['h'] == 1000000
assert numbers(table(text['mapRes_0.lua'], 'emptyCells')) == source['emptyCells']

campaign = read_json('assets/resources/world/campaign-map.json')
landscape = read_json('assets/resources/world/original-landscape.json')
lua_campaign = text['campaign-map.lua']
rows = [numbers(row) for row in re.findall(r'\{([^{}]*)\}', table(lua_campaign, 'regionRows'))]
assert rows == campaign['regionRows']
for key, kind in [('gates', 50), ('cities', 51)]:
    group = table(lua_campaign, key)
    assert len(re.findall(r'\["name"\]\s*=', group)) == len(campaign[key])
    for point in campaign[key]:
        pattern = (r'\["name"\]\s*=\s*"' + re.escape(point['name']) + r'",\s*'
                   + r'\["x"\]\s*=\s*' + str(point['x']) + r',\s*'
                   + r'\["y"\]\s*=\s*' + str(point['y']) + r',')
        assert re.search(pattern, group), point['name']
        assert expected[point['y'] * 1000 + point['x']] == [kind, point['level']], point['name']

terrain = text['terrain.lua']
for key in ['riverCells', 'mountainCells']:
    assert numbers(table(terrain, key)) == landscape[key], key
assert numbers(table(terrain, 'blockedCells')) == sorted(set(landscape['riverCells']) | set(landscape['mountainCells']))
reserved = set()
for city in campaign['cities']:
    radius = city['footprintRadius']
    for y in range(city['y'] - radius, city['y'] + radius + 1):
        for x in range(city['x'] - radius, city['x'] + radius + 1):
            reserved.add(y * 1000 + x)
assert numbers(table(terrain, 'reservedCityCells')) == sorted(reserved)
assert '["spawnZones"]' not in lua_campaign
print(json.dumps({'cells': count, 'emptyCells': len(source['emptyCells']),
                  'landmarks': len(campaign['gates']) + len(campaign['cities']),
                  'regionRows': len(rows), 'sha256Verified': True,
                  'mapRevision': revision}, ensure_ascii=False))
