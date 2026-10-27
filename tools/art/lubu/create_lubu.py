"""原创吕布角色样板：Blender 5.2，米制、骨骼动画、可重新生成的 glTF。

运行：blender --background --factory-startup --python tools/art/lubu/create_lubu.py
源文件留在 art/characters/lubu；仅 GLB 导入 Cocos。无外部模型或贴图依赖。
"""
import bpy
import math
import json
import random
import sys
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'art/characters/lubu'
OUTPUT = ROOT / 'assets/resources/battle3d/lubu'
SOURCE.mkdir(parents=True, exist_ok=True)
OUTPUT.mkdir(parents=True, exist_ok=True)
random.seed(39)
bpy.context.preferences.filepaths.save_version = 0
if hasattr(bpy.context.preferences.filepaths, 'file_preview_type'):
    bpy.context.preferences.filepaths.file_preview_type = 'NONE'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color, metallic=0, roughness=.5):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    return m

SKIN = material('Warm olive skin', (.32, .165, .085), 0, .65)
LIP = material('Natural lips', (.27, .115, .085), 0, .53)
SHADOW = material('Facial creases', (.085, .035, .023), 0, .7)
EYE = material('Ivory sclera', (.33, .30, .24), 0, .4)
IRIS = material('Brown iris', (.055, .032, .017), 0, .28)
HAIR = material('Black hair', (.025, .02, .018), .05, .51)
STEEL = material('Blued iron', (.085, .115, .125), .78, .32)
EDGE = material('Brushed blade steel', (.39, .46, .48), .86, .24)
GOLD = material('Antique brass', (.49, .30, .095), .75, .32)
DARKGOLD = material('Recessed brass', (.20, .115, .04), .65, .43)
RED = material('Oxblood silk', (.24, .025, .025), .04, .71)
CLOTH = material('Charcoal undercoat', (.027, .032, .031), 0, .88)
LEATHER = material('Dark leather', (.065, .037, .025), .02, .7)
FEATHER = material('Pheasant bronze', (.30, .21, .08), .15, .55)

parts = []
def finish(obj, name, mat, bone='chest', weights=None):
    obj.name = name
    obj.data.materials.append(mat)
    if obj.type == 'MESH':
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        if weights:
            groups = {}
            for i, ws in enumerate(weights):
                for bn, value in ws.items():
                    if value <= 0: continue
                    group = groups.get(bn)
                    if group is None:
                        group = groups[bn] = obj.vertex_groups.new(name=bn)
                    group.add([i], value, 'REPLACE')
        else:
            obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    parts.append(obj)
    return obj

def mesh(name, verts, faces, mat, bone='chest', weights=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat, bone, weights)

def ellipsoid(name, pos, scale, mat, bone='head', segments=24, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=pos)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, bone)

def tube(name, points, radius, mat, bone='chest', sides=8, radii=None):
    verts, faces = [], []
    for i, pt in enumerate(points):
        direction = Vector(points[min(i+1, len(points)-1)]) - Vector(points[max(0, i-1)])
        direction.normalize()
        guide = Vector((0, 1, 0)) if abs(direction.y) < .9 else Vector((1, 0, 0))
        u = direction.cross(guide).normalized()
        v = direction.cross(u).normalized()
        r = radii[i] if radii else radius
        for j in range(sides):
            a = j * math.tau / sides
            verts.append(Vector(pt) + r * (u*math.cos(a) + v*math.sin(a)))
        if i:
            for j in range(sides):
                faces.append(((i-1)*sides+j, (i-1)*sides+(j+1)%sides,
                              i*sides+(j+1)%sides, i*sides+j))
    faces.extend([tuple(range(sides-1, -1, -1)), tuple((len(points)-1)*sides+j for j in range(sides))])
    return mesh(name, verts, faces, mat, bone)

def loft(name, sections, mat, bone='chest', segments=48, sculpt=None):
    verts, faces = [], []
    for z, rx, ry, cy in sections:
        for j in range(segments):
            a = math.tau*j/segments
            x, y = rx*math.sin(a), cy-ry*math.cos(a)
            if sculpt: x, y, z1 = sculpt(x, y, z, a)
            else: z1 = z
            verts.append((x, y, z1))
    for i in range(len(sections)-1):
        for j in range(segments):
            a = i*segments+j; b = i*segments+(j+1)%segments
            faces.append((a, b, b+segments, a+segments))
    faces.extend([tuple(range(segments-1,-1,-1)), tuple((len(sections)-1)*segments+j for j in range(segments))])
    return mesh(name, verts, faces, mat, bone)

def plate(name, center, width, height, depth, mat, bone, bevel=.006):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj=bpy.context.object; obj.scale=(width,depth,height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod=obj.modifiers.new('Forged rounded edge','BEVEL');mod.width=bevel;mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(obj,name,mat,bone)

def segment(name, a, b, r1, r2, mat, bone):
    pts=[Vector(a).lerp(Vector(b), i/6) for i in range(7)]
    return tube(name,pts,0,mat,bone,16,[r1+(r2-r1)*i/6 for i in range(7)])

# Body proportions: 2.0 m without crown. Armor sits above a continuous padded coat.
loft('Quilted torso',[(.96,.16,.112,0),(1.08,.18,.12,0),(1.24,.19,.127,0),
    (1.42,.245,.145,0),(1.56,.25,.13,0),(1.65,.12,.086,0)],CLOTH)
loft('Neck',[(1.59,.064,.058,0),(1.73,.057,.055,-.005),(1.77,.06,.055,-.009)],SKIN,'neck')
loft('Silk fauld',[(.66,.25,.145,0),(.78,.24,.15,0),(.94,.20,.13,0),(1.07,.18,.12,0)],RED,'pelvis')
for side in [-1,1]:
    s='L' if side<0 else 'R'
    hip=(side*.135,0,1.01);knee=(side*.15,-.025,.58);ankle=(side*.15,0,.14)
    segment('Trouser thigh '+s,hip,knee,.108,.076,CLOTH,'thigh.'+s)
    segment('Trouser shin '+s,knee,ankle,.076,.049,CLOTH,'shin.'+s)
    boot=plate('Leather boot '+s,(side*.15,-.055,.077),.135,.125,.26,LEATHER,'foot.'+s,.033)
    plate('Boot sole '+s,(side*.15,-.06,.018),.142,.026,.275,LEATHER,'foot.'+s,.01)
    plate('Boot toe cap '+s,(side*.15,-.133,.102),.132,.042,.095,STEEL,'foot.'+s,.016)
    for k in range(4):
        plate('Shin band '+s,(side*.15,-.058,.22+k*.073),.106,.058,.035,STEEL,'shin.'+s)
        tube('Shin brass '+s,[(side*.15-.051,-.08,.247+k*.073),(side*.15+.051,-.08,.247+k*.073)],.003,GOLD,'shin.'+s)
    ellipsoid('Knee guard '+s,(side*.15,-.094,.59),(.08,.037,.07),STEEL,'shin.'+s)
    ellipsoid('Knee boss '+s,(side*.15,-.127,.59),(.035,.012,.034),GOLD,'shin.'+s)
    shoulder=(side*.27,0,1.57); elbow=(side*.445,-.006,1.30); wrist=(side*.515,-.055,1.075)
    segment('Silk upper sleeve '+s,shoulder,elbow,.096,.073,RED,'upper_arm.'+s)
    segment('Silk lower sleeve '+s,elbow,wrist,.07,.046,CLOTH,'forearm.'+s)
    for k in range(3):
        z=1.135+k*.06;x=side*(.50-k*.018)
        plate('Vambrace '+s,(x,-.105,z),.095,.056,.048,STEEL,'forearm.'+s)
        tube('Vambrace edge '+s,[(x-.044,-.131,z+.025),(x+.044,-.131,z+.025)],.003,GOLD,'forearm.'+s)
    ellipsoid('Hand '+s,(side*.531,-.055,1.031),(.045,.039,.068),SKIN,'hand.'+s)
    for k in range(4):
        # Folded fingers around a narrow grip, not spherical mittens.
        x=side*(.507+k*.013)
        tube('Finger '+s,[(x,-.072,1.036),(x,-.094,1.013),(x,-.088,.988)],.0095,SKIN,'hand.'+s)
    tube('Thumb '+s,[(side*.50,-.054,1.055),(side*.486,-.082,1.035),(side*.502,-.103,1.017)],.014,SKIN,'hand.'+s)

# Curved cuirass, overlapping lamellae and brass binding strips.
loft('Cuirass',[(1.06,.19,.132,0),(1.20,.20,.146,0),(1.38,.246,.158,0),
    (1.53,.25,.143,0),(1.61,.12,.10,0)],STEEL)
loft('Standing padded collar',[(1.60,.085,.075,0),(1.70,.067,.064,0)],RED,'neck')
tube('Collar brass edging',[(.069*math.sin(i*math.tau/48),-.066*math.cos(i*math.tau/48),1.701) for i in range(49)],.003,GOLD,'neck')
for row in range(7):
    z=1.105+row*.059
    rx=.20+(min(z,1.38)-1.20)*.25 if z>=1.20 else .195
    ry=.149+(z-1.20)*.066 if z<1.38 else .161-(z-1.38)*.1
    rx+=.012;ry+=.009
    for col in range(32):
        a=(col-15.5)*math.tau/32
        x=rx*math.sin(a);y=-ry*math.cos(a)
        obj=plate('Cuirass lamella',(x,y,z),.047,.065,.012,STEEL,'chest',.003)
        obj.rotation_euler[2]=a
        if col%2==0:
            ellipsoid('Brass rivet',(x,y-.015,z+.02),(.0037,.0037,.0037),GOLD,'chest',8,4)
for side in [-1,1]:
    pts=[]
    for i in range(18):
        z=1.10+i*.029;x=side*(.105+.055*math.sin(i/17*math.pi));pts.append((x,-.164,z))
    tube('Cuirass raised piping',pts,.006,GOLD)
    s='L' if side<0 else 'R'
    for row in range(4):
        x=side*(.255+row*.028);z=1.61-row*.053
        obj=ellipsoid('Overlapping shoulder plate '+s,(x,-.005,z),(.113,.132,.038),STEEL,'upper_arm.'+s)
        pts=[(x+.108*math.cos(a),-.005+.126*math.sin(a),z-.015) for a in [math.pi+i*math.pi/24 for i in range(25)]]
        tube('Shoulder rim '+s,pts,.004,GOLD,'upper_arm.'+s)
    for j in range(3):
        tube('Shoulder chased scroll '+s,[(side*.245+j*.013,-.132,1.604),(side*.28+j*.012,-.14,1.615),(side*.31+j*.012,-.129,1.593)],.0035,GOLD,'upper_arm.'+s)

# Ornamental chest beast mask, sculpted relief with brow, eyes and curled fangs.
ellipsoid('Chest beast face',(0,-.163,1.44),(.08,.021,.078),DARKGOLD,'chest')
for s in [-1,1]:
    tube('Beast brow',[(s*.008,-.19,1.47),(s*.028,-.197,1.49),(s*.060,-.181,1.48)],.009,GOLD)
    ellipsoid('Beast eye',(s*.034,-.19,1.46),(.012,.006,.007),GOLD,'chest',12,6)
    tube('Beast fang',[(s*.038,-.184,1.435),(s*.048,-.193,1.403),(s*.033,-.196,1.396)],.007,GOLD,radii=[.009,.006,.001])
    tube('Beast horn',[(s*.055,-.177,1.48),(s*.074,-.174,1.51),(s*.062,-.169,1.53)],.007,GOLD,radii=[.009,.006,.001])
ellipsoid('Beast nose',(0,-.195,1.443),(.021,.011,.019),GOLD,'chest')

loft('Waist belt',[(1.015,.20,.14,0),(1.08,.20,.14,0)],LEATHER,'pelvis')
plate('Belt plaque',(0,-.153,1.045),.115,.067,.024,GOLD,'pelvis',.009)
plate('Belt plaque inset',(0,-.168,1.045),.075,.043,.01,DARKGOLD,'pelvis',.008)
for row in range(5):
    z=.94-row*.059
    for col in range(11):
        a=(col-5)*.22;rx=.205+(.94-z)*.18;ry=.145+(.94-z)*.05
        obj=plate('Fauld lamella',(rx*math.sin(a),-ry*math.cos(a),z),.052,.064,.014,STEEL,'pelvis')
        obj.rotation_euler[2]=a
        if row in [0,4]:
            ellipsoid('Fauld rivet',(rx*math.sin(a),-ry*math.cos(a)-.012,z+.017),(.0035,.0035,.0035),GOLD,'pelvis',8,4)
# Red front sash lies between the armor panels.
mesh('Silk front tabard',[(-.046,-.176,1.02),(.046,-.176,1.02),(.065,-.19,.66),(0,-.198,.61),(-.065,-.19,.66)],[(0,1,2,3,4)],RED,'pelvis')
tube('Tabard gold hem',[(-.045,-.181,1.01),(-.064,-.195,.665),(0,-.202,.615),(.064,-.195,.665),(.045,-.181,1.01)],.0035,GOLD,'pelvis')

# Sculpted facial surface, with inset sockets, projecting cheekbones, bridge and chin.
head_profile=[(1.72,.037,.047,-.022),(1.75,.062,.069,-.012),(1.79,.085,.079,0),
    (1.84,.095,.083,.005),(1.89,.092,.083,.008),(1.94,.088,.079,.013),
    (1.98,.073,.067,.016),(2.008,.042,.043,.016),(2.015,.008,.009,.016)]
def interp(z, index):
    for i,(a,b) in enumerate(zip(head_profile,head_profile[1:])):
        if a[0]<=z<=b[0]:
            t=(z-a[0])/(b[0]-a[0]);p=head_profile[max(0,i-1)][index];q=head_profile[min(len(head_profile)-1,i+2)][index]
            return .5*((2*a[index])+(-p+b[index])*t+(2*p-5*a[index]+4*b[index]-q)*t*t+(-p+3*a[index]-3*b[index]+q)*t*t*t)
    return head_profile[-1][index]
def gauss(x,z,cx,cz,sx,sz):return math.exp(-((x-cx)/sx)**2-((z-cz)/sz)**2)
def face_surface(x,y,z,a):
    front=max(0,math.cos(a))**5
    project=.0
    project+=.033*gauss(x,z,0,1.84,.017,.049)
    project+=.027*gauss(x,z,0,1.824,.025,.014)
    project+=.014*gauss(x,z,0,1.749,.041,.018)
    project+=.006*gauss(x,z,0,1.793,.041,.021)
    for s in [-1,1]:
        project-=.014*gauss(x,z,s*.042,1.872,.028,.015)
        project+=.010*gauss(x,z,s*.044,1.897,.037,.011)
        project+=.010*gauss(x,z,s*.061,1.839,.028,.022)
    return x,y-project*front,z
loft('Sculpted head',[(z,interp(z,1),interp(z,2),interp(z,3)) for z in [1.72+i*.295/72 for i in range(73)]],SKIN,'head',96,face_surface)
for side in [-1,1]:
    x=side*.042
    # Narrow almond eyes and inset lids keep the expression stern.
    ellipsoid('Eyeball',(x,-.073,1.873),(.023,.013,.0068),EYE,'head',24,12)
    ellipsoid('Iris',(x,-.086,1.874),(.007,.0025,.007),IRIS,'head',20,10)
    ellipsoid('Pupil',(x,-.088,1.874),(.0034,.0015,.0038),HAIR,'head',16,8)
    upper=[];lower=[]
    for i in range(21):
        t=i/20;xx=x-.024+t*.048
        upper.append((xx,-.081-.006*math.sin(t*math.pi),1.872+.007*math.sin(t*math.pi)+side*(t-.5)*.003))
        lower.append((xx,-.080-.005*math.sin(t*math.pi),1.872-.0045*math.sin(t*math.pi)))
    tube('Upper eyelid',upper,.0021,SKIN,'head');tube('Lower eyelid',lower,.0015,SKIN,'head')
    brow=[(side*(.019+t*.054),-.082+ t*.015,1.897+.007*math.sin(t*math.pi)-t*.003) for t in [i/16 for i in range(17)]]
    tube('Swept eyebrow',brow,.003,HAIR,'head',8,[.0025+ .0015*math.sin(i/16*math.pi) if i<14 else .002*(17-i)/3 for i in range(17)])
    ellipsoid('Nostril',(side*.014,-.124,1.817),(.005,.002,.0032),SHADOW,'head',12,6)
    ear=ellipsoid('Ear',(side*.096,.006,1.845),(.018,.020,.041),SKIN,'head')
    ellipsoid('Ear concha',(side*.108,-.011,1.846),(.006,.008,.022),LIP,'head',16,8)
mouth=[(-.031+i*.062/24,-.092+.009*abs((i-12)/12),1.787+.0018*math.cos((i-12)/12*math.pi)) for i in range(25)]
tube('Upper lip',[(x,y,z+.001) for x,y,z in mouth],.0019,LIP,'head')
tube('Lower lip',[(x,y-.0008,z-.002) for x,y,z in mouth],.002,SKIN,'head')
tube('Mouth seam',mouth,.0007,SHADOW,'head')
for s in [-1,1]:
    for i in range(15):
        tube('Fine moustache',[(s*(.004+i*.0015),-.095+i*.0004,1.802),(s*(.008+i*.0015),-.093+i*.0004,1.796)],.00035,HAIR,'head',4)
for i in range(13):
    x=(i-6)*.002
    tube('Chin stubble',[(x,-.083,1.765),(x*.7,-.078,1.747)],.0005,HAIR,'head',4)

# Hair cap leaves forehead and face exposed; individual ridges add readable direction.
verts=[];faces=[]
for i in range(19):
    v=i/18
    for j in range(64):
        a=j*math.tau/64;low=1.907+.047*max(0,math.cos(a));z=low+(2.016-low)*v
        verts.append(((interp(min(z,2.014),1)+.004)*math.sin(a),.012-(interp(min(z,2.014),2)+.004)*math.cos(a),z))
for i in range(18):
    for j in range(64):a=i*64+j;b=i*64+(j+1)%64;faces.append((a,b,b+64,a+64))
mesh('Swept hair cap',verts,faces,HAIR,'head')
ellipsoid('Topknot',(0,.027,2.035),(.052,.048,.067),HAIR,'head')
for j in range(22):
    a=math.tau*j/22
    tube('Hair comb ridge',[(.091*math.sin(a),.012-.079*math.cos(a),1.93+.03*max(0,math.cos(a))),
        (.079*math.sin(a),.013-.072*math.cos(a),1.98),(.040*math.sin(a),.02-.043*math.cos(a),2.035)],.0018,LEATHER,'head',5)
loft('Crown circlet',[(1.947,.094,.086,.01),(1.968,.091,.082,.01)],GOLD,'head')
plate('Crown forehead plaque',(0,-.080,1.983),.078,.061,.018,GOLD,'head')
ellipsoid('Crown red stone',(0,-.094,1.984),(.018,.007,.021),RED,'head',20,12)
for s in [-1,1]:
    # Long pheasant plumes are curved ribbons with visible banding and a central shaft.
    points=[];left=[];right=[]
    for i in range(65):
        t=i/64;x=s*(.061+.17*math.sin(t*2.0));y=.025+.50*t*t;z=2.02+.92*t-.37*t*t
        points.append((x,y,z));w=.023*math.sin(math.pi*min(.99,.06+t*.94))**.6
        left.append((x-w,y,z));right.append((x+w,y,z))
    verts=[p for pair in zip(left,right) for p in pair]
    obj=mesh('Pheasant plume',verts,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(64)],FEATHER,'head')
    obj.data.materials.append(HAIR)
    for i,p in enumerate(obj.data.polygons):p.material_index=1 if i%8<3 else 0
    tube('Plume shaft',points,.0021,DARKGOLD,'head',6)
    for i in range(2,63,2):
        p=points[i];q=points[i+2]
        for edge in [left[i],right[i]]:tube('Feather barb',[edge,q],.0006,GOLD,'head',4)

# Weighted cape: three bones, double-sided shell, sculpted folds.
verts=[];faces=[];weights=[]
for i in range(30):
    t=i/29;z=1.60-1.05*t;width=.19+.20*t
    for j in range(27):
        u=j/26*2-1;x=width*u;y=.115+.16*t+.034*math.cos(u*math.pi*5)*(t*.7+.3)
        verts.append((x,y,z+.025*math.cos(u*math.pi*3)*t))
        if t<.5:weights.append({'cape_top':1-t*2,'cape_mid':t*2})
        else:weights.append({'cape_mid':2-t*2,'cape_end':t*2-1})
for i in range(29):
    for j in range(26):a=i*27+j;faces.append((a,a+1,a+28,a+27))
cape=mesh('Crimson cape',verts,faces,RED,weights=weights)
bpy.context.view_layer.objects.active=cape;cape.select_set(True)
mod=cape.modifiers.new('Cloth thickness','SOLIDIFY');mod.thickness=.004
bpy.ops.object.modifier_apply(modifier=mod.name)
for s in [-1,1]:ellipsoid('Cape clasp',(s*.14,-.105,1.587),(.029,.012,.026),GOLD,'chest')

# Original Fangtian halberd: spear blade, offset crescent, brass fittings and wrapped shaft.
wx=.55;wy=-.065
tube('Halberd hardwood shaft',[(wx,wy,.10),(wx,wy,2.40)],.016,LEATHER,'hand.R',16)
for z in [.12,.92,1.18,1.93,2.28,2.39]:
    segment('Halberd brass ferrule',(wx,wy,z-.018),(wx,wy,z+.018),.022,.022,GOLD,'hand.R')
for i in range(16):
    z=.94+i*.014
    tube('Grip cord',[(wx+.017*math.cos(a),wy+.017*math.sin(a),z+.01*a/math.tau) for a in [j*math.tau/16 for j in range(17)]],.0025,RED,'hand.R',5)
def blade(name, outline):
    verts=[(wx+x,wy+d,z) for d in [-.008,.008] for x,z in outline]
    n=len(outline);faces=[tuple(range(n-1,-1,-1)),tuple(n+i for i in range(n))]
    faces.extend([(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)])
    obj=mesh(name,verts,faces,EDGE,'hand.R')
    for p in obj.data.polygons:p.use_smooth=False
    return obj
blade('Halberd spearhead',[(0,2.74),(.050,2.47),(.025,2.37),(-.025,2.37),(-.05,2.47)])
tube('Blade central spine',[(wx,wy-.010,2.39),(wx,wy-.015,2.48),(wx,wy-.009,2.72)],.007,STEEL,'hand.R',4,radii=[.008,.012,.001])
blade('Halberd crescent',[(.08,2.43),(.16,2.54),(.22,2.61),(.205,2.54),(.225,2.46),(.24,2.38),(.225,2.30),(.20,2.22),(.13,2.30),(.10,2.36)])
tube('Crescent connecting arms',[(wx,wy,2.41),(wx+.13,wy,2.44),(wx+.18,wy,2.48)],.016,GOLD,'hand.R')
tube('Crescent lower arm',[(wx,wy,2.30),(wx+.12,wy,2.32),(wx+.18,wy,2.34)],.014,GOLD,'hand.R')
for i in range(11):
    angle=i*math.tau/11
    tube('Halberd red tassel',[(wx+.02*math.cos(angle),wy+.02*math.sin(angle),2.30),
        (wx+.025*math.cos(angle),wy+.03*math.sin(angle),2.18),
        (wx+.04*math.cos(angle),wy+.04*math.sin(angle),2.08)],.003,RED,'hand.R',5)

# The sample opponents share a plain infantry rig, without Lu Bu's identifying ornaments.
hero_parts = parts[:]
guard_parts = []
GUARD_CLOTH = material('Guard indigo linen', (.045, .075, .085), 0, .85)
GUARD_METAL = material('Guard aged iron', (.12, .13, .12), .65, .53)
omit = ('Crown', 'Pheasant', 'Plume', 'Feather', 'Topknot', 'Halberd crescent',
        'Crescent', 'Chest beast', 'Beast', 'Crimson cape', 'Cape clasp')
for original in hero_parts:
    if original.name.startswith(omit): continue
    obj = original.copy(); obj.data = original.data.copy()
    bpy.context.collection.objects.link(obj)
    for slot in obj.material_slots:
        if slot.material == RED: slot.material = GUARD_CLOTH
        elif slot.material in (GOLD, DARKGOLD): slot.material = GUARD_METAL
    guard_parts.append(obj)
parts = guard_parts
loft('Guard helmet',[(1.88,.105,.095,0),(1.97,.103,.09,0),(2.04,.06,.06,0),(2.07,.004,.004,0)],STEEL,'head')
plate('Guard nasal bar',(0,-.10,1.89),.017,.12,.013,STEEL,'head',.003)
for s in [-1,1]:
    plate('Guard cheek plate',(s*.103,-.005,1.81),.018,.13,.12,STEEL,'head',.007)
parts = hero_parts

# One skinned mesh per character retains all named vertex groups.
def join_parts(items, name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in items: obj.select_set(True)
    bpy.context.view_layer.objects.active=items[0]
    bpy.ops.object.join()
    obj=bpy.context.object; obj.name=name
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    return obj
guard=join_parts(guard_parts,'Guard_Original_Mesh')
bpy.ops.object.select_all(action='DESELECT')
for obj in parts:obj.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.join()
hero=bpy.context.object;hero.name='Lubu_Original_Mesh'
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
arm_data=bpy.data.armatures.new('LubuSkeleton')
rig=bpy.data.objects.new('Lubu',arm_data);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);hero.select_set(False)
bpy.ops.object.mode_set(mode='EDIT')
def bone(name,a,b,parent=None):
    edit=arm_data.edit_bones.new(name);edit.head=a;edit.tail=b
    if parent:edit.parent=arm_data.edit_bones[parent]
    return edit
bone('root',(0,0,0),(0,0,.2))
bone('pelvis',(0,0,1.0),(0,0,1.15),'root')
bone('spine',(0,0,1.15),(0,0,1.35),'pelvis')
bone('chest',(0,0,1.35),(0,0,1.60),'spine')
bone('neck',(0,0,1.60),(0,0,1.75),'chest')
bone('head',(0,0,1.75),(0,0,2.02),'neck')
for side in [-1,1]:
    s='L' if side<0 else 'R'
    bone('clavicle.'+s,(0,0,1.57),(side*.27,0,1.57),'chest')
    bone('upper_arm.'+s,(side*.27,0,1.57),(side*.445,-.006,1.30),'clavicle.'+s)
    bone('forearm.'+s,(side*.445,-.006,1.30),(side*.515,-.055,1.075),'upper_arm.'+s)
    bone('hand.'+s,(side*.515,-.055,1.075),(side*.531,-.055,.995),'forearm.'+s)
    bone('thigh.'+s,(side*.135,0,1.01),(side*.15,-.025,.58),'pelvis')
    bone('shin.'+s,(side*.15,-.025,.58),(side*.15,0,.14),'thigh.'+s)
    bone('foot.'+s,(side*.15,0,.14),(side*.15,-.16,.08),'shin.'+s)
bone('cape_top',(0,.13,1.6),(0,.20,1.24),'chest')
bone('cape_mid',(0,.20,1.24),(0,.27,.9),'cape_top')
bone('cape_end',(0,.27,.9),(0,.30,.53),'cape_mid')
bpy.ops.object.mode_set(mode='OBJECT')
hero.parent=rig
arm=hero.modifiers.new('Lubu skin','ARMATURE');arm.object=rig
guard.parent=rig
guard.modifiers.new('Guard skin','ARMATURE').object=rig
for pb in rig.pose.bones:pb.rotation_mode='XYZ'

def pose(frame, rotations=None, root_z=0, thrust=None):
    for pb in rig.pose.bones:
        pb.rotation_euler=(0,0,0);pb.location=(0,0,0)
    if rotations:
        for name,angles in rotations.items():rig.pose.bones[name].rotation_euler=tuple(math.radians(v) for v in angles)
    rig.pose.bones['root'].location.z=root_z
    if thrust:
        # Two-bone IK solved in armature space. The blade must point at the opponent,
        # independent of the bone's rest roll (Euler-only posing swung it backwards).
        bpy.context.view_layer.update()
        wrist, angle = Vector(thrust[0]), thrust[1]
        upper=rig.pose.bones['upper_arm.R']; fore=rig.pose.bones['forearm.R']; hand=rig.pose.bones['hand.R']
        shoulder=upper.head.copy(); direction=(wrist-shoulder).normalized()
        distance=min((wrist-shoulder).length,upper.length+fore.length-.002)
        wrist=shoulder+direction*distance
        a=(upper.length**2-fore.length**2+distance**2)/(2*distance)
        pole=Vector((.8,.0,1.25))-shoulder; perpendicular=(pole-direction*pole.dot(direction)).normalized()
        elbow=shoulder+direction*a+perpendicular*math.sqrt(max(0,upper.length**2-a*a))
        for pb, head, tail in [(upper,shoulder,elbow),(fore,elbow,wrist)]:
            rest=pb.bone.matrix_local
            rotation=(pb.bone.tail_local-pb.bone.head_local).rotation_difference(tail-head) @ rest.to_quaternion()
            pb.matrix=Matrix.LocRotScale(head,rotation,Vector((1,1,1)));bpy.context.view_layer.update()
        hand.matrix=Matrix.Translation(wrist) @ Matrix.Rotation(math.radians(angle),4,'X') @ hand.bone.matrix_local.to_quaternion().to_matrix().to_4x4()
        bpy.context.view_layer.update()
    for pb in rig.pose.bones:
        pb.keyframe_insert(data_path='rotation_euler',frame=frame,group=pb.name)
        pb.keyframe_insert(data_path='location',frame=frame,group=pb.name)

rig.animation_data_create()
clips=[]
def animation(name,frames,fn):
    action=bpy.data.actions.new(name);action.use_fake_user=True
    rig.animation_data.action=action
    for f in frames:fn(f)
    clips.append({'name':name,'frames':[min(frames),max(frames)],'duration':(max(frames)-min(frames))/30})

animation('Idle',range(1,92,5),lambda f:pose(f,{'chest':(math.sin((f-1)/90*math.tau)*.7,0,0),
    'head':(0,math.sin((f-1)/90*math.tau)*1.2,0),'cape_top':(math.sin((f-1)/90*math.tau)*2,0,0),
    'cape_mid':(math.sin((f-1)/90*math.tau-.5)*3,0,0)}))
def walk(f):
    a=(f-1)/40*math.tau;s=math.sin(a)
    pose(f,{'thigh.L':(s*18,0,0),'thigh.R':(-s*18,0,0),
        'shin.L':(-max(0,-s)*28,0,0),'shin.R':(-max(0,s)*28,0,0),
        'foot.L':(-s*8,0,0),'foot.R':(s*8,0,0),
        'upper_arm.L':(-s*12,0,0),'chest':(0,0,s*2),
        'cape_top':(5+math.sin(a)*3,0,0),'cape_mid':(math.cos(a)*5,0,0)},abs(s)*.012)
animation('Walk',range(1,42,2),walk)
attack={1:{},10:{'chest':(0,-8,16),'upper_arm.R':(-56,5,-12),'forearm.R':(-35,0,0),'hand.R':(10,0,0),'upper_arm.L':(-15,0,20),'cape_top':(-7,0,0)},
    18:{'chest':(9,12,-20),'upper_arm.R':(24,0,-10),'forearm.R':(-18,0,0),'hand.R':(-35,0,0),'upper_arm.L':(-28,0,10),'cape_top':(17,0,0),'cape_mid':(12,0,0)},
    26:{'chest':(4,5,-8),'upper_arm.R':(12,0,0),'forearm.R':(-10,0,0),'cape_top':(8,0,0)},40:{}}
thrusts={10:((.50,.015,1.26),-24),18:((.44,-.44,1.38),79),26:((.49,-.25,1.29),48)}
animation('Attack',attack.keys(),lambda f:pose(f,attack[f],thrust=thrusts.get(f)))
hit={1:{},5:{'spine':(-9,0,0),'chest':(-7,0,5),'head':(-10,0,0),'upper_arm.L':(-12,0,10),'cape_top':(-12,0,0)},12:{'spine':(-3,0,0)},25:{}}
animation('Hit',hit.keys(),lambda f:pose(f,hit[f]))
death={1:{},12:{'spine':(16,0,0),'head':(18,0,0),'thigh.L':(-25,0,0),'shin.L':(-45,0,0)},
    25:{'root':(0,0,28),'spine':(30,0,0),'thigh.L':(-45,0,0),'shin.L':(-75,0,0),'thigh.R':(-20,0,0),'upper_arm.L':(25,0,35)},
    45:{'root':(0,0,82),'spine':(15,0,0),'head':(12,0,0),'thigh.L':(-10,0,0),'upper_arm.L':(-12,0,25),'hand.R':(15,0,0)}}
animation('Death',death.keys(),lambda f:pose(f,death[f],0))
animation('Salute',[1,15,30,55,70],lambda f:pose(f,{'head':(8,0,0),'forearm.L':(-74,0,0),'upper_arm.L':(-25,0,35)} if f in [15,30,55] else {}))
rig.animation_data.action=bpy.data.actions['Idle'];bpy.context.scene.frame_set(1)
bpy.context.scene.render.fps=30

# Export only the character, with animation actions and PBR material factors.
bpy.ops.object.select_all(action='DESELECT');hero.select_set(True);rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUTPUT/'lubu.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,
    export_skins=True,export_yup=True,export_apply=False,export_materials='EXPORT')
bpy.ops.object.select_all(action='DESELECT');guard.select_set(True);rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUTPUT/'guard.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,
    export_skins=True,export_yup=True,export_apply=False,export_materials='EXPORT')
guard.hide_render=True;guard.hide_set(True)

# Independent studio for modeling review; not shipped with the game character.
groundmat=material('Studio basalt',(.026,.033,.033),.2,.6)
bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=1.15,depth=.07,location=(0,0,-.055))
ground=bpy.context.object;ground.name='Studio plinth';ground.data.materials.append(groundmat)
bevel=ground.modifiers.new('Soft edge','BEVEL');bevel.width=.025;bevel.segments=3
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.095));bpy.context.object.data.materials.append(groundmat)
def light(name,pos,energy,color,size,target=(0,0,1.3)):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.color=color;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.location=pos
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
light('Warm key',(-3,-4,5),850,(1,.83,.65),3)
light('Cool fill',(3,-1,3),550,(.55,.72,1),3)
light('Gold rim',(1,3,4),1100,(1,.7,.4),2)
scene=bpy.context.scene;scene.world.color=(.09,.09,.09)
bpy.ops.object.camera_add(location=(3.4,-6.4,2.95))
camera=bpy.context.object;camera.name='Review camera';scene.camera=camera
camera.rotation_euler=(Vector((.12,.05,1.37))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=3.35
scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=1152;scene.render.resolution_y=1152;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
scene.view_settings.view_transform='AgX'
scene.render.filepath=str(SOURCE/'lubu-full.png')
scene.frame_start=1;scene.frame_end=91
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'lubu.blend'))
if '--no-render' not in sys.argv: bpy.ops.render.render(write_still=True)
camera.location=(1.15,-3.4,2.15);camera.rotation_euler=(Vector((0,-.02,1.85))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=.64
scene.render.filepath=str(SOURCE/'lubu-face.png')
if '--no-render' not in sys.argv: bpy.ops.render.render(write_still=True)
triangles=sum(len(p.vertices)-2 for p in hero.data.polygons)
report={'original':True,'source':'tools/art/lubu/create_lubu.py','blender':bpy.app.version_string,
    'vertices':len(hero.data.vertices),'triangles':triangles,'bones':len(rig.data.bones),'materials':len(hero.data.materials),
    'animations':clips,'front':'Blender -Y / glTF +Z','heightMeters':2.74,'externalAssets':[]}
(SOURCE/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print('LUBU_BUILD_COMPLETE',json.dumps(report,ensure_ascii=False))
