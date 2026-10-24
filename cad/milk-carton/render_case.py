"""Render actual generated CAD meshes with Blender 4.3 (no artwork in print STLs).
Run: blender --background --python cad/milk-carton/render_case.py
"""
import base64,json,math,sys
from pathlib import Path
import bpy
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'.build/case-preview'
OUT=ROOT/'downloads/milk-carton'
PARAMETERS=json.loads((OUT/'parameters.json').read_text())

def material(name,color,metallic=0,roughness=.55,emission=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1)
    b.inputs['Metallic'].default_value=metallic;b.inputs['Roughness'].default_value=roughness
    if emission: b.inputs['Emission Color'].default_value=(*color,1);b.inputs['Emission Strength'].default_value=emission
    return m

def place(obj,offset=(0,0,0)):
    obj.rotation_euler=(math.pi/2,0,0);obj.scale=(.001,)*3
    obj.location=(offset[0]*.001,-offset[2]*.001,offset[1]*.001)

def mesh(name,mat,offset=(0,0,0),flip=False):
    bpy.ops.wm.stl_import(filepath=str(SOURCE/f'{name}.stl'))
    obj=bpy.context.object;obj.name=name
    if flip:
        for v in obj.data.vertices: v.co.x=-v.co.x;v.co.z=2*PARAMETERS['depth']-v.co.z
        obj.data.update()
    obj.data.materials.append(mat);place(obj,offset)
    return obj

def face(mat):
    atlas=json.loads((ROOT/'web/sprites.json').read_text())
    data=base64.b64decode(atlas['data']['rabbit:happy'][0])
    verts=[];faces=[];pitch=21.744/128
    for yy in range(64):
        for xx in range(128):
            if not(data[xx+(yy//8)*128]&(1<<(yy%8))):continue
            x=(xx-64)*pitch;y=PARAMETERS['window_y']+(32-yy)*pitch;z=2.15;i=len(verts)
            verts.extend([(x,y,z),(x+pitch,y,z),(x+pitch,y-pitch,z),(x,y-pitch,z)])
            faces.append((i,i+1,i+2,i+3))
    data_mesh=bpy.data.meshes.new('OLED lit pixels');data_mesh.from_pydata(verts,[],faces);data_mesh.update()
    obj=bpy.data.objects.new('Illustrative running OLED — not in STL',data_mesh);bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat);place(obj)

def scene(exploded=False):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    white=material('Warm white PLA',(.80,.79,.74));lidmat=material('Lid',(.73,.76,.76))
    black=material('OLED glass',(.004,.009,.012),roughness=.25)
    pcb=material('Nominal PCB envelope',(.018,.20,.15));esp=material('ESP board envelope',(.02,.035,.05))
    metal=material('USB socket envelope',(.48,.51,.54),metallic=.8,roughness=.3)
    lit=material('OLED white pixels',(.92,.98,1),emission=1.5)
    mesh('body',white);mesh('oled_glass',black);face(lit)
    if exploded:
        offset=(52,0,24)
        mesh('lid',lidmat,offset,True);mesh('esp_pcb',esp,offset,True);mesh('esp_headers',black,offset,True);mesh('usb_socket',metal,offset,True)
        mesh('oled_pcb',pcb);mesh('oled_header',black)
    else:mesh('lid',white)
    floor=material('Background',(.87,.86,.82),roughness=.8)
    bpy.ops.mesh.primitive_plane_add(size=2,location=(0,0,-.001))
    bpy.context.object.data.materials.append(floor)
    world=bpy.data.worlds.new('Soft studio');bpy.context.scene.world=world;world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.87,.88,.9,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.2
    for position,power,size in [((.12,.10,.17),16,.16),((-.10,.02,.1),8,.10),((.05,-.15,.16),12,.12)]:
        bpy.ops.object.light_add(type='AREA',location=position);lamp=bpy.context.object;lamp.data.energy=power*.02;lamp.data.shape='DISK';lamp.data.size=size
        lamp.rotation_euler=(Vector((.015,-.02,.035))-lamp.location).to_track_quat('-Z','Y').to_euler()
    target=Vector((.02,-.025,.036)) if exploded else Vector((0,-.013,.037))
    camera_pos=(.14,-.20,.13) if exploded else (.115,.17,.105)
    bpy.ops.object.camera_add(location=camera_pos);camera=bpy.context.object
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=.145 if exploded else .105
    sc=bpy.context.scene;sc.camera=camera;sc.render.engine='CYCLES';sc.cycles.device='CPU';sc.cycles.samples=64;sc.cycles.use_denoising=False
    sc.render.resolution_x=1200;sc.render.resolution_y=1100 if exploded else 1300;sc.render.resolution_percentage=100
    sc.view_settings.view_transform='AgX';sc.render.image_settings.file_format='PNG'
    sc.render.filepath=str(OUT/('assembly-preview.png' if exploded else 'case-preview.png'))
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'.build/case-preview'/('exploded.blend' if exploded else 'case.blend')))
    bpy.ops.render.render(write_still=True)

scene(False)
scene(True)
