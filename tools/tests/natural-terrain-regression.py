"""自然地形与玩法索引的一致性、非圆形州界、主支流及远景轮廓。"""
import collections
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/world'))
from natural_terrain import decode_rows

read=lambda p:json.loads((ROOT/p).read_text(encoding='utf8'))
world=read('assets/resources/world/campaign-map.json')
land=read('assets/resources/world/original-landscape.json')
res=read('assets/resources/config/mapRes_0.json')
ids=decode_rows(world['regionRows'])
assert len(ids)==1000000 and set(ids)==set(range(10))
assert world['topologyVersion']==land['topologyVersion']==2
water=set(land['riverCells']); mountains=set(land['mountainCells'])
bridge_water=set(land['bridgeWaterCells'])
assert not water.intersection(mountains)
blocked=water|mountains
assert bridge_water and not bridge_water.intersection(blocked)
root=ET.parse(ROOT/'assets/resources/world/map.tmx').getroot()
mask=bytearray(map(int,root.find("layer[@name='obstruct']/data").text.split(',')))
assert {i for i,v in enumerate(mask) if v}==blocked
empty=set(res['emptyCells'])
assert not empty.intersection(blocked)
assert all(res['list'][i]==[0,0] for i in blocked)
bridges=[g for g in world['gates'] if g.get('crossing')=='bridge']
assert len(bridges)==6
for gate in bridges:
    assert res['list'][gate['y']*1000+gate['x']]==[50,gate['level']]
    def at(u,v=0):
        x=gate['x']+(u if gate['axis']=='x' else v)
        y=gate['y']+(v if gate['axis']=='x' else u)
        return y*1000+x
    assert at(0) in bridge_water, '桥下保持连续水面'
    end=gate['bridgeSpan']//2
    for sign in (-1,1):
        for v in (-1,0,1):
            assert at(sign*end,v) not in water|bridge_water, '桥头必须落在陆地'
            assert at(sign*end,v) not in blocked, '桥头可集结部队'
            assert res['list'][at(sign*end,v)]==[0,0], '引道不能出现资源图标'
        assert all(at(sign*u) not in blocked for u in range(end+1)), '桥面沿关门轴连通'
    assert at(0,-1) in blocked and at(0,1) in blocked, '城门两侧不能绕关'
assert all(ids[p['y']*1000+p['x']]==p['id'] for p in world['regions'])
for i in mountains:
    assert min(i%1000,i//1000,999-i%1000,999-i//1000)>=3,'外围不应存在方形山墙'
features=collections.Counter(p['kind'] for p in world['terrainFeatures'])
assert features['tributary']>=6 and features['spur']>=10
assert len(water)>15000
assert {s['region'] for s in world['landShapes']}==set(range(10))
assert all(len(s['points'])>=3 for s in world['landShapes'])
# 原规则王畿所有边界都在半径100附近；现在必须具有实质性的伸展与收缩。
radius=[]
for y in range(1,999):
    for x in range(1,999):
        i=y*1000+x
        if ids[i]==9 and any(ids[j]!=9 for j in (i-1,i+1,i-1000,i+1000)):
            radius.append(math.hypot(x-499.5,y-499.5))
assert max(radius)-min(radius)>45
assert len({round(r/5) for r in radius})>=10
print(json.dumps(dict(cells=len(ids),regions=10,water=len(water),mountains=len(mountains),features=features,
                     capitalBoundaryRadius=[round(min(radius),1),round(max(radius),1)],
                     overviewVertices=sum(len(s['points']) for s in world['landShapes']))))
