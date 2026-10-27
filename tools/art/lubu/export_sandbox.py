"""将原创武将源文件制作成低面数兵棋棋子；保留骨骼和动作，不依赖外部素材。"""
import bpy
import json
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'assets/resources/battle3d/sandbox'
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/characters/lubu/lubu.blend'))
rig=bpy.data.objects['Lubu']
hero=bpy.data.objects['Lubu_Original_Mesh']
guard=bpy.data.objects['Guard_Original_Mesh']
for obj in bpy.context.scene.objects:
    obj.hide_set(False);obj.hide_render=False;obj.select_set(False)

def material(name,color,metal=.1):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=.78
    return m

armor=material('Miniature charcoal iron',(.28,.35,.38),0)
skin=material('Miniature warm ivory',(.80,.51,.28),0)
trim=material('Miniature antique brass',(.88,.63,.25),0)
red=material('Miniature cinnabar',(.68,.10,.06),0)
blue=material('Miniature jade blue',(.10,.39,.52),0)

stats=[]
for obj,name,cloth in [(hero,'commander',red),(guard,'infantry',blue)]:
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    slots=[m.name for m in obj.data.materials]
    assignments=[]
    for polygon in obj.data.polygons:
        s=slots[polygon.material_index]
        assignments.append(4 if 'Pheasant' in s else 5 if any(t in s for t in ['hair','iris','creases']) else 1 if 'skin' in s else 2 if any(t in s for t in ['brass','blade','bronze','sclera'])
            else 3 if any(t in s for t in ['silk','linen']) else 0)
    obj.data.materials.clear()
    for m in [armor,skin,trim,cloth,red,armor]:obj.data.materials.append(m)
    for polygon,index in zip(obj.data.polygons,assignments):polygon.material_index=index
    # 大头盔、宽肩与清晰色块，让俯视小尺寸也能读出人物轮廓。
    head=obj.vertex_groups.get('head')
    for vertex in obj.data.vertices:
        weight=next((g.weight for g in vertex.groups if head and g.group==head.index),0)
        if weight:
            pivot=Vector((0,0,1.75))
            vertex.co=pivot+(vertex.co-pivot)*(1+weight*.55)
        vertex.co.y*=1.45
    # A miniature reads from armour silhouette, plumes and colour, not individual rivets.
    armature=obj.modifiers.get('Lubu skin') or obj.modifiers.get('Guard skin')
    dec=obj.modifiers.new('Tabletop LOD','DECIMATE');dec.ratio=.12 if obj==hero else .028
    while obj.modifiers.find(dec.name)>0:bpy.ops.object.modifier_move_up(modifier=dec.name)
    bpy.ops.object.modifier_apply(modifier=dec.name)
    obj.data.validate(clean_customdata=True);obj.data.update()
    # 将三档光影烘进顶点色，Cocos 使用 unlit 呈现稳定的漫画色块。
    colors=obj.data.color_attributes.new(name='InkColor',type='FLOAT_COLOR',domain='CORNER')
    light=Vector((-.45,-.65,1)).normalized()
    palette=[(.58,.30,.12) if name=='commander' else (.25,.34,.37),(.80,.61,.39),(.95,.72,.27),
        (.78,.07,.035) if name=='commander' else (.10,.39,.52),(.58,.055,.025),(.025,.035,.045)]
    for polygon in obj.data.polygons:
        shade=1 if polygon.normal.dot(light)>.45 else .76 if polygon.normal.dot(light)>-.15 else .48
        base=palette[polygon.material_index]
        for loop in polygon.loop_indices:colors.data[loop].color=(*[v*shade for v in base],1)
    ink=material('InkColor painted miniature',(1,1,1),0)
    vc=ink.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='InkColor'
    ink.node_tree.links.new(vc.outputs['Color'],ink.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    obj.data.materials.clear();obj.data.materials.append(ink)
    for polygon in obj.data.polygons:polygon.material_index=0
    # 倒壳描边与本体共用骨骼，动画时轮廓仍贴合。
    outline=obj.copy();outline.data=obj.data.copy();outline.name=name+'_InkOutline'
    bpy.context.collection.objects.link(outline)
    for vertex in outline.data.vertices:vertex.co+=vertex.normal*.008
    import bmesh
    bm=bmesh.new();bm.from_mesh(outline.data)
    bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(outline.data);bm.free()
    black=material('Ink silhouette',(.008,.012,.018),0);black.use_backface_culling=True
    outline.data.materials.clear();outline.data.materials.append(black)
    for attr in list(outline.data.color_attributes):outline.data.color_attributes.remove(attr)
    outline.select_set(True)
    obj.select_set(True);rig.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,
        export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,
        export_skins=True,export_yup=True,export_apply=False,export_materials='EXPORT')
    stats.append({'name':name,'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons),'materials':len(obj.data.materials)})
    if name=='infantry':
        for color in colors.data:
            r,g,b,a=color.color
            if b>r*2 and g>r*2:
                shade=r/.10;color.color=(.68*shade,.10*shade,.06*shade,a)
        bpy.ops.export_scene.gltf(filepath=str(OUT/'infantry-red.glb'),export_format='GLB',use_selection=True,
            export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,
            export_skins=True,export_yup=True,export_apply=False,export_materials='EXPORT')
    outline.select_set(False)
(ROOT/'art/characters/lubu/sandbox-manifest.json').write_text(json.dumps(stats,indent=2),encoding='utf8')
print('SANDBOX_UNITS_COMPLETE',stats)
