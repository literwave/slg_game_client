"""原创国风军阵角色：完整色块建模，复用本项目的骨骼与六组动作。"""
import bpy
import bmesh
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'assets/resources/battle3d/sandbox'
ART = ROOT / 'art/characters/lubu'
bpy.ops.wm.open_mainfile(filepath=str(ART / 'lubu.blend'))
bpy.context.preferences.filepaths.save_version = 0
rig = bpy.data.objects['Lubu']
for obj in list(bpy.data.objects):
    if obj != rig:
        bpy.data.objects.remove(obj, do_unlink=True)
rig.location = (0, 0, 0)
rig.hide_set(False)
rig.hide_render = False
rig.animation_data.action = None
for bone in rig.pose.bones:
    bone.rotation_mode = 'XYZ'
    bone.rotation_euler = (0, 0, 0)
    bone.location = (0, 0, 0)
    bone.scale = (1, 1, 1)
for track in rig.animation_data.nla_tracks:
    track.mute = True

def material(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = .8
    return m

SKIN = material('Warm face', (.89, .62, .36))
INK = material('Ink edges', (.025, .035, .05))
IVORY = material('Ivory eyes', (.98, .95, .82))
STEEL = material('Blue iron', (.34, .48, .56))
EDGE = material('Silver edges', (.77, .86, .88))
GOLD = material('Old gold', (.96, .65, .20))
GOLD_DARK = material('Bronze plate', (.66, .36, .11))
RED = material('Crimson cloth', (.78, .115, .065))
RED_LIGHT = material('Vermilion fold', (.96, .22, .095))
BLUE = material('Indigo cloth', (.12, .37, .56))
BLUE_LIGHT = material('Blue fold', (.25, .63, .74))
BOOT = material('Leather boots', (.12, .14, .17))
WOOD = material('Weapon shaft', (.37, .20, .095))
parts = []

def finish(obj, name, mat, bone='chest'):
    obj.name = name
    obj.data.materials.append(mat)
    obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    parts.append(obj)
    return obj

def mesh(name, verts, faces, mat, bone='chest'):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat, bone)

def ellipsoid(name, pos, scale, mat, bone='head', segments=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=pos)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, bone)

def plate(name, pos, size, mat, bone='chest', bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Rounded forged edge', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(obj, name, mat, bone)

def tube(name, points, radii, mat, bone='chest', sides=8):
    verts, faces = [], []
    for i, pt in enumerate(points):
        direction = (Vector(points[min(i+1, len(points)-1)]) - Vector(points[max(0, i-1)])).normalized()
        guide = Vector((0, 1, 0)) if abs(direction.y) < .9 else Vector((1, 0, 0))
        u = direction.cross(guide).normalized()
        v = direction.cross(u).normalized()
        for j in range(sides):
            a = j * math.tau / sides
            verts.append(Vector(pt) + radii[i] * (u*math.cos(a) + v*math.sin(a)))
        if i:
            for j in range(sides):
                faces.append(((i-1)*sides+j, (i-1)*sides+(j+1)%sides, i*sides+(j+1)%sides, i*sides+j))
    faces += [tuple(range(sides-1, -1, -1)), tuple((len(points)-1)*sides+j for j in range(sides))]
    return mesh(name, verts, faces, mat, bone)

def loft(name, sections, mat, bone='chest', segments=12):
    verts, faces = [], []
    for z, rx, ry, cy in sections:
        for j in range(segments):
            a = j * math.tau / segments
            verts.append((rx*math.sin(a), cy-ry*math.cos(a), z))
    for i in range(len(sections)-1):
        for j in range(segments):
            a = i*segments+j
            b = i*segments+(j+1)%segments
            faces.append((a, b, b+segments, a+segments))
    faces += [tuple(range(segments-1, -1, -1)), tuple((len(sections)-1)*segments+j for j in range(segments))]
    return mesh(name, verts, faces, mat, bone)

def blade(name, profile, y, depth, mat, bone='hand.R'):
    # Extruded silhouette gives the spear/halberd a readable silver edge from either side.
    verts = [(x, y-depth/2, z) for x, z in profile] + [(x, y+depth/2, z) for x, z in profile]
    n = len(profile)
    faces = [tuple(range(n-1, -1, -1)), tuple(range(n, n*2))]
    faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    return mesh(name, verts, faces, mat, bone)

def body(commander, cloth, fold):
    armor = GOLD_DARK if commander else STEEL
    trim = GOLD if commander else EDGE
    loft('Padded coat', [(.78,.26,.17,0),(1.06,.24,.18,0),(1.38,.30,.19,0),(1.62,.27,.17,0),(1.70,.13,.11,0)], cloth)
    loft('Broad cuirass', [(1.13,.24,.18,-.005),(1.34,.29,.21,-.005),(1.54,.30,.19,0),(1.62,.19,.14,0)], armor)
    plate('Chest upper rim', (0,-.195,1.52), (.43,.036,.052), trim, bevel=.012)
    plate('Breastplate central ridge', (0,-.219,1.37), (.055,.025,.23), trim, bevel=.01)
    loft('Waist belt', [(1.045,.245,.187,0),(1.13,.245,.187,0)], INK, 'pelvis')
    plate('Belt clasp', (0,-.198,1.09), (.14,.04,.105), trim, 'pelvis', .018)
    # Four broad skirt plates replace the noisy overlapping scale mesh.
    for sx in [-1,1]:
        skirt = plate('Armoured skirt', (sx*.15,-.11,.88), (.26,.17,.31), armor, 'pelvis', .035)
        skirt.rotation_euler.y = sx*.13
        plate('Skirt edge', (sx*.15,-.202,.78), (.22,.025,.045), trim, 'pelvis', .01)
    loft('Neck', [(1.58,.085,.077,0),(1.83,.088,.079,0)], SKIN, 'neck')
    for sign in [-1,1]:
        s = 'L' if sign<0 else 'R'
        shoulder=(sign*.27,0,1.57); elbow=(sign*.445,-.006,1.30); wrist=(sign*.515,-.055,1.075)
        tube('Full upper sleeve', [shoulder,elbow], [.145,.105], cloth, 'upper_arm.'+s)
        ellipsoid('Shoulder armour', (sign*.30,-.005,1.59), (.175,.19,.13), armor, 'upper_arm.'+s)
        plate('Shoulder cuff', (sign*.33,-.17,1.57), (.20,.035,.065), trim, 'upper_arm.'+s, .015)
        ellipsoid('Elbow cloth', elbow, (.105,.10,.10), cloth, 'forearm.'+s)
        tube('Bracer', [elbow,wrist], [.103,.080], armor, 'forearm.'+s)
        tube('Bracer wrist edge', [Vector(wrist)+Vector((0,0,.025)),Vector(wrist)+Vector((0,0,.075))], [.085,.085], trim, 'forearm.'+s)
        ellipsoid('Clenched hand', (sign*.531,-.055,1.035), (.079,.071,.091), SKIN, 'hand.'+s)
        hip=(sign*.135,0,1.01); knee=(sign*.15,-.025,.58); ankle=(sign*.15,0,.14)
        tube('Wide trousers', [hip,knee], [.13,.105], cloth, 'thigh.'+s)
        ellipsoid('Knee', knee, (.108,.107,.10), armor, 'shin.'+s)
        tube('Solid greave', [knee,ankle], [.102,.085], armor, 'shin.'+s)
        plate('Greave central ridge', (sign*.15,-.104,.37), (.050,.025,.29), trim, 'shin.'+s, .012)
        plate('Boot', (sign*.15,-.065,.095), (.20,.34,.17), BOOT, 'foot.'+s, .045)
        plate('Boot toe', (sign*.15,-.175,.13), (.19,.10,.095), armor, 'foot.'+s, .027)

def head(commander, cloth, fold):
    ellipsoid('Face', (0,-.02,1.96), (.205,.172,.255), SKIN)
    ellipsoid('Hair under helmet', (0,.025,2.04), (.222,.177,.25), INK)
    # Forward-facing face mask leaves the cheeks and chin free of the hair shell.
    ellipsoid('Cheeks', (0,-.115,1.935), (.183,.115,.19), SKIN)
    ellipsoid('Nose', (0,-.232,1.95), (.038,.037,.058), SKIN, segments=10, rings=6)
    for side in [-1,1]:
        ellipsoid('Eye white', (side*.079,-.221,2.006), (.052,.012,.026), IVORY, segments=10, rings=6)
        ellipsoid('Dark eye', (side*.069,-.233,2.007), (.019,.008,.023), INK, segments=8, rings=6)
        tube('Determined eyebrow', [(side*.029,-.225,2.044),(side*.118,-.216,2.06)], [.016,.012], INK, 'head', 6)
        ellipsoid('Ear', (side*.205,-.002,1.97), (.04,.055,.073), SKIN, segments=10, rings=6)
    tube('Mouth', [(-.045,-.215,1.86),(.045,-.215,1.86)], [.008,.008], INK, 'head', 6)
    if commander:
        loft('Golden crown', [(2.12,.23,.18,.025),(2.18,.24,.19,.025),(2.27,.16,.13,.025),(2.32,.08,.08,.025)], GOLD, 'head')
        blade('Crown brow crest', [(-.065,2.13),(0,2.28),(.065,2.13),(0,2.09)], -.176,.035,GOLD,'head')
        ellipsoid('Crown red jewel', (0,-.208,2.17), (.034,.018,.05), RED, segments=10, rings=6)
        for s in [-1,1]:
            tube('Long crimson pheasant plume', [(s*.135,.04,2.23),(s*.22,.10,2.63),(s*.40,.21,2.96),(s*.54,.40,3.00),(s*.60,.63,2.78),(s*.59,.76,2.43)], [.045,.060,.068,.063,.048,.004], RED, 'head', 10)
            tube('Plume highlight', [(s*.15,.005,2.29),(s*.23,.055,2.63),(s*.41,.16,2.94),(s*.53,.34,2.98)], [.011,.016,.018,.006], RED_LIGHT, 'head', 6)
        # A flowing red cape, with broad readable folds and three weighted sections.
        cape = loft('Crimson cape', [(.52,.39,.065,.31),(.83,.38,.065,.30),(1.19,.31,.05,.26),(1.61,.255,.04,.17)], RED, 'cape_top')
        cape.vertex_groups.clear()
        for vertex in cape.data.vertices:
            z=vertex.co.z
            weights={'cape_top':1} if z>1.3 else {'cape_top':.4,'cape_mid':.6} if z>1 else {'cape_mid':.45,'cape_end':.55} if z>.7 else {'cape_end':1}
            for bone,w in weights.items():
                group=cape.vertex_groups.get(bone) or cape.vertex_groups.new(name=bone)
                group.add([vertex.index],w,'REPLACE')
        for s in [-1,1]:
            tube('Cape fold', [(s*.15,.22,1.50),(s*.23,.31,1.12),(s*.30,.36,.58)], [.018,.025,.009], RED_LIGHT, 'cape_mid', 6)
    else:
        loft('Iron helmet', [(2.075,.23,.185,.035),(2.15,.245,.20,.035),(2.30,.155,.14,.035),(2.36,.035,.04,.035)], STEEL, 'head')
        loft('Helmet rim', [(2.075,.235,.19,.035),(2.12,.239,.194,.035)], EDGE, 'head')
        for s in [-1,1]:
            plate('Helmet cheek guard', (s*.205,-.005,1.99), (.055,.18,.22), STEEL, 'head', .025)
        tube('Helmet tassel', [(0,.04,2.34),(0,.12,2.49),(0,.24,2.42)], [.040,.070,.008], cloth, 'head', 8)

def weapon(commander):
    x=.535; y=-.055
    tube('Long weapon shaft', [(x,y,.20),(x,y,2.53)], [.025,.025], WOOD, 'hand.R', 8)
    for z in [1.03,2.31]:
        tube('Grip band', [(x,y,z),(x,y,z+.10)], [.032,.032], GOLD if commander else EDGE, 'hand.R',8)
    blade('Spear blade', [(x-.065,2.45),(x,2.87 if commander else 2.76),(x+.065,2.45),(x,2.39)], y,.036,EDGE)
    if commander:
        blade('Crescent halberd', [(x+.035,2.31),(x+.27,2.32),(x+.37,2.46),(x+.33,2.69),(x+.22,2.80),(x+.29,2.53),(x+.19,2.43),(x+.035,2.44)], y,.05,EDGE)
        tube('Halberd gold socket', [(x,y,2.37),(x+.20,y,2.37)], [.036,.036], GOLD,'hand.R',8)
        for i in range(4):
            tube('Weapon red tassel', [(x,y-.03,2.35),(x-.05-i*.035,y-.02,2.15),(x-.10-i*.035,y+.01,2.03)], [.018,.024,.004], RED,'hand.R',6)

def export_unit(name, commander=False, red=False):
    global parts
    parts=[]
    cloth=RED if commander or red else BLUE
    fold=RED_LIGHT if commander or red else BLUE_LIGHT
    body(commander,cloth,fold)
    head(commander,cloth,fold)
    weapon(commander)
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:p.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]
    bpy.ops.object.join()
    obj=bpy.context.object;obj.name=name
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    colors=obj.data.color_attributes.new(name='InkColor',type='FLOAT_COLOR',domain='CORNER')
    light=Vector((-.35,-.60,1)).normalized()
    for polygon in obj.data.polygons:
        shade=1 if polygon.normal.dot(light)>.32 else .80 if polygon.normal.dot(light)>-.32 else .57
        base=obj.data.materials[polygon.material_index].diffuse_color
        for loop in polygon.loop_indices:colors.data[loop].color=(*[min(1,v*shade) for v in base[:3]],1)
    ink=material(name+' painted colours',(1,1,1))
    nt=ink.node_tree;nt.nodes.clear()
    vc=nt.nodes.new('ShaderNodeVertexColor');vc.layer_name='InkColor'
    shader=nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(vc.outputs['Color'],shader.inputs['Base Color'])
    nt.links.new(vc.outputs['Color'],shader.inputs['Emission Color'])
    shader.inputs['Emission Strength'].default_value=1
    output=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(shader.outputs[0],output.inputs['Surface'])
    obj.data.materials.clear();obj.data.materials.append(ink)
    for polygon in obj.data.polygons:polygon.material_index=0
    obj.parent=rig
    arm=obj.modifiers.new('Character skin','ARMATURE');arm.object=rig
    # Inverted hull uses one extra draw, with no circles, stands or miniature bases.
    outline=obj.copy();outline.data=obj.data.copy();outline.name=name+'_InkOutline'
    bpy.context.collection.objects.link(outline)
    for v in outline.data.vertices:v.co+=v.normal*.006
    bm=bmesh.new();bm.from_mesh(outline.data)
    bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(outline.data);bm.free()
    outline.data.materials.clear();outline.data.materials.append(INK);INK.use_backface_culling=True
    for attr in list(outline.data.color_attributes):outline.data.color_attributes.remove(attr)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True);outline.select_set(True);rig.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,
        export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,
        export_skins=True,export_yup=True,export_apply=False,export_materials='EXPORT')
    return obj,outline,{'name':name,'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons),'joints':len(rig.data.bones)}

units=[export_unit('commander',True),export_unit('infantry'),export_unit('infantry-red',False,True)]
(ART/'ink-units-manifest.json').write_text(json.dumps([u[2] for u in units],indent=2),encoding='utf8')
# Keep a separate editable source; the original detailed sculpt is preserved.
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'ink-units.blend'))
for i,(obj,outline,_) in enumerate(units):
    # Only the commander for the preview portrait; this does not affect exported runtime assets.
    obj.hide_render=i!=0;outline.hide_render=i!=0
bpy.ops.object.camera_add(location=(4,-7,4.6))
camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,1.45))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=3.8
scene=bpy.context.scene;scene.camera=camera
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=700;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.world.color=(.07,.095,.13)
scene.view_settings.view_transform='Standard'
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ART/'ink-commander.png')
bpy.ops.render.render(write_still=True)
print('INK_UNITS_COMPLETE',json.dumps([u[2] for u in units]))
