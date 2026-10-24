"""导出当前已确认的地图快照为服务端 Lua，不在后端重新生成资源。"""
import argparse
import hashlib
import json
import runpy
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--output', default='temp/world-map-export', help='项目内导出目录')
args = parser.parse_args()
output = (ROOT / args.output).resolve()
if not output.is_relative_to(ROOT):
    raise SystemExit('导出目录必须位于项目内')
# 数据校验不通过时不写出交付包。
runpy.run_path(str(ROOT / 'tools/tests/fixed-birth-resources-regression.py'), run_name='__main__')
runpy.run_path(str(ROOT / 'tools/tests/mixed-resource-layout-regression.py'), run_name='__main__')
world = json.loads((ROOT / 'assets/resources/world/campaign-map.json').read_text(encoding='utf8'))
landscape = json.loads((ROOT / 'assets/resources/world/original-landscape.json').read_text(encoding='utf8'))
map_res = json.loads((ROOT / 'assets/resources/config/mapRes_0.json').read_text(encoding='utf8'))
fixed = json.loads((ROOT / 'tools/world/fixed-birth-resources.json').read_text(encoding='utf8'))
inner = json.loads((ROOT / 'tools/world/fixed-inner-resources.json').read_text(encoding='utf8'))
res_land = json.loads((ROOT / 'assets/resources/config/ResLand.json').read_text(encoding='utf8'))
resource_types = {row['Enum']: row['Id'] for row in json.loads((ROOT / 'assets/resources/config/ResLandType.json').read_text(encoding='utf8'))}
map_enums = {52: 'WOOD', 53: 'IRON', 54: 'STONE', 55: 'GRAIN'}
pending = []
for kind, name in map_enums.items():
    protocol_type = resource_types.get(name)
    levels = {row['Level'] for row in res_land if row['Type'] == protocol_type}
    missing = [level for level in range(1, 11) if level not in levels]
    if missing:
        pending.append(dict(mapType=kind, enum=name, missingLevels=missing))
if pending:
    raise SystemExit('ResLand 等级未齐，服务端配置补齐后再导出: ' + json.dumps(pending, ensure_ascii=False))
reserved = set()
for city in world['cities']:
    radius = city['footprintRadius']
    for y in range(city['y'] - radius, city['y'] + radius + 1):
        for x in range(city['x'] - radius, city['x'] + radius + 1):
            reserved.add(y * 1000 + x)
terrain = dict(width=1000, height=1000,
               blockedCells=sorted(set(landscape['riverCells']) | set(landscape['mountainCells'])),
               riverCells=landscape['riverCells'], mountainCells=landscape['mountainCells'],
               reservedCityCells=sorted(reserved))


def lua_string(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r') + '"'


def lua_int_list(values):
    if not values:
        return '{}'
    lines = []
    row = []
    for number in values:
        row.append(str(int(number)))
        if len(row) == 40:
            lines.append(','.join(row))
            row = []
    if row:
        lines.append(','.join(row))
    return '{\n' + ',\n'.join(lines) + '\n}'


def lua_value(value, indent=0):
    pad = ' ' * indent
    if value is None:
        return 'nil'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else repr(value)
    if isinstance(value, str):
        return lua_string(value)
    if isinstance(value, list):
        if not value:
            return '{}'
        if all(isinstance(item, int) and not isinstance(item, bool) for item in value):
            return lua_int_list(value)
        inner = ',\n'.join(pad + '    ' + lua_value(item, indent + 4) for item in value)
        return '{\n' + inner + '\n' + pad + '}'
    if isinstance(value, dict):
        if not value:
            return '{}'
        lines = [f'{pad}    [{lua_value(key)}] = {lua_value(item, indent + 4)}' for key, item in value.items()]
        return '{\n' + ',\n'.join(lines) + '\n' + pad + '}'
    raise TypeError(type(value))


def lua_module(header, body):
    return (header.rstrip() + '\n\nreturn ' + body + '\n').encode('utf8')


cells = map_res['list']
if map_res.get('w') != 1000 or map_res.get('h') != 1000 or len(cells) != 1000000:
    raise SystemExit('mapRes_0 不是 1000×1000')
pair_rows = []
row = []
for cell_id, pair in enumerate(cells):
    row.append(f'[{cell_id}]={{{int(pair[0])},{int(pair[1])}}}')
    if len(row) == 20:
        pair_rows.append(','.join(row))
        row = []
if row:
    pair_rows.append(','.join(row))
list_literal = '{\n' + ',\n'.join(pair_rows) + '\n}'
map_header = '''-- 百万格资源快照。服务端直接读取，不要按固定点重新生成。
-- cellId = y * 1000 + x，从 0 起。list[cellId][1] 是类型，list[cellId][2] 是等级。
-- 不要用 #list，下标含 0。类型 52木、53铁、54石、55粮、50关隘、51城市。
-- 类型 0 不是一律阻挡：emptyCells 的值是可通行空地 cellId，山河与城市占地见 terrain.lua。'''
map_body = '{\n["w"] = 1000,\n["h"] = 1000,\n["list"] = ' + list_literal + ',\n["emptyCells"] = ' + lua_int_list(map_res['emptyCells']) + '\n}'
campaign_header = '''-- 州域、关口、城池和建议出生区。出生点按容量分配玩家并保持间距。
-- footprintRadius 为方形占地半径：出生州 1 即 3×3，资源州 2 即 5×5，洛阳 4 即 9×9。'''
terrain_header = '''-- blockedCells 是山河阻挡，reservedCityCells 是城市占地，元素都是 cellId。
-- 类型 0 不能一律当作阻挡：可通行空地在 mapRes_0.lua 的 emptyCells。'''
files = {
    'mapRes_0.lua': lua_module(map_header, map_body),
    'campaign-map.lua': lua_module(campaign_header, lua_value(world)),
    'terrain.lua': lua_module(terrain_header, lua_value(terrain)),
}
sample_ids = (0, 500500, 999999)
for cell_id in sample_ids:
    pair = cells[cell_id]
    token = f'[{cell_id}]={{{int(pair[0])},{int(pair[1])}}}'
    if token.encode('ascii') not in files['mapRes_0.lua']:
        raise SystemExit('mapRes_0.lua 与客户端快照不一致: ' + token)
if f'{int(map_res["emptyCells"][0])},'.encode('ascii') not in files['mapRes_0.lua']:
    raise SystemExit('emptyCells 未写入 mapRes_0.lua')
if '临淄关'.encode('utf8') not in files['campaign-map.lua']:
    raise SystemExit('campaign-map.lua 缺少关口')
if b'["blockedCells"]' not in files['terrain.lua'] or b'["reservedCityCells"]' not in files['terrain.lua']:
    raise SystemExit('terrain.lua 缺少阻挡或城市占地')
checksums = {name: hashlib.sha256(content).hexdigest() for name, content in sorted(files.items())}
revision = hashlib.sha256(json.dumps(checksums, sort_keys=True).encode('utf8')).hexdigest()
manifest = dict(schemaVersion=2, mapRevision=revision, width=1000, height=1000,
                cellIdFormula='y * 1000 + x', listAccess='list[cellId][1]=type, list[cellId][2]=level',
                fixedBirthResourceCount=len(fixed['points']), fixedBirthLevels=[4, 5, 6],
                fixedInnerResourceCount=len(inner['points']), resourceLayoutVersion=world['resourceLayoutVersion'],
                files=checksums)
manifest_header = '''-- 本目录 Lua 的 SHA256 与地图版本。服务端记录 mapRevision，不要和旧版点位混用。
-- 配置表 ResLand、ResLandType 由 game_common 的 server/res 提供，不在此包内。'''
files['manifest.lua'] = lua_module(manifest_header, lua_value(manifest))
output.mkdir(parents=True, exist_ok=True)
for name, content in files.items():
    (output / name).write_bytes(content)
package = output / 'world-map-backend.zip'
with zipfile.ZipFile(package, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name, content in files.items():
        archive.writestr(name, content)
with zipfile.ZipFile(package) as archive:
    assert archive.testzip() is None
    for name, content in files.items():
        assert archive.read(name) == content
        assert hashlib.sha256(content).hexdigest() == (checksums[name] if name != 'manifest.lua' else hashlib.sha256(content).hexdigest())
print(json.dumps({'exported': str(package.relative_to(ROOT)), 'lua': sorted(files),
                  'fixedPoints': len(fixed['points']), 'sha256Verified': True, 'mapRevision': revision},
                 ensure_ascii=False))
