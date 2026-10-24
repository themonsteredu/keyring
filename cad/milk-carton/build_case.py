#!/usr/bin/env python3
"""Parametric milk-carton prototype, mm. CadQuery 2.7.0; hardware fit unverified.
Coordinates: X width, Y upright height, Z front-to-back depth.
STLs have their intended print face at Z=0. Assembly STEP keeps real positions.
"""
import argparse
import hashlib
import json
import struct
from collections import defaultdict
from pathlib import Path
import cadquery as cq

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'downloads/milk-carton'
P = dict(width=42.0, body_height=49.0, depth=32.0, wall=2.0,
         roof_rise=14.0, seal_height=3.0, lid_thickness=2.4,
         lid_clearance=0.30, lip_depth=2.8, lip_wall=1.4,
         window_width=26.0, window_height=14.5, window_y=31.5,
         oled_width=27.178, oled_height=27.94, oled_y=30.0,
         oled_pcb_z=5.0, oled_pcb_thickness=1.524,
         oled_header_edge_offset=1.8, oled_header_clearance=15.2,
         esp_width=18.0, esp_height=22.5, esp_y=3.0,
         usb_width=16.0, usb_depth=10.0, usb_z=25.0,
         ring_outer_d=12.0, ring_hole_d=5.5, ring_thickness=5.0,
         screw_pilot_d=1.6, screw_clearance_d=2.4,
         screw_head_d=4.6, screw_boss_r=3.2)

def box(x, y, z, sx, sy, sz):
    return cq.Workplane('XY').box(sx, sy, sz).translate((x, y, z))

def rounded_plate(width, height, depth, y, z, radius=1.2):
    return box(0,y,z,width,height,depth).edges('|Z').fillet(radius)

def cyl(x, y, z, radius, height):
    return cq.Workplane('XY').center(x,y).circle(radius).extrude(height).translate((0,0,z))

def yz_prism(points, width):
    return cq.Workplane('YZ').polyline(points).close().extrude(width).translate((-width/2,0,0))

def build(p):
    w,h,d,t = (p[k] for k in ('width','body_height','depth','wall'))
    peak=h+p['roof_rise']; top=peak+p['seal_height']
    outer=rounded_plate(w,h,d,h/2,d/2)
    roof=yz_prism([(h-.1,0),(peak,d/2-2),(top,d/2-2),
                  (top,d/2+2),(peak,d/2+2),(h-.1,d)],w)
    body=outer.union(roof)
    cavity=box(0,h/2,(t+d+.5)/2,w-2*t,h-2*t,d+.5-t)
    inside_roof=yz_prism([(h-3,t),(peak-2,d/2-1),
                         (peak-2,d/2+1),(h-3,d-t)],w-2*t)
    body=body.cut(cavity.union(inside_roof))
    # Seal creases are shallow and leave the roof wall intact.
    for yy in (peak+1,peak+2):
        body=body.cut(box(0,yy,d/2-2.05,w-3,.35,.65))
    ring_x=-w/2+8; ring_y=top+3; ring_z=d/2-p['ring_thickness']/2
    neck=box(ring_x,top-.1,d/2,9,6.2,p['ring_thickness'])
    ring=cyl(ring_x,ring_y,ring_z,p['ring_outer_d']/2,p['ring_thickness'])
    body=body.union(neck).union(ring)
    body=body.cut(cyl(ring_x,ring_y,ring_z-1,p['ring_hole_d']/2,p['ring_thickness']+2))
    window=rounded_plate(p['window_width'],p['window_height'],t+4,p['window_y'],t/2,1.0)
    body=body.cut(window)
    # Adjustable OLED seat: corner pads, no assumed mounting-hole pitch.
    pad_x=p['oled_width']/2-2.65
    pad_ys=(p['oled_y']-p['oled_height']/2-.1,p['oled_y']+p['oled_height']/2+.1)
    pad_bottom=t-.2; pad_height=p['oled_pcb_z']-pad_bottom
    for xx in (-pad_x,pad_x):
        for yy in pad_ys:
            body=body.union(box(xx,yy,pad_bottom+pad_height/2,3.5,3.5,pad_height))
    guide_x=p['oled_width']/2+1.6; guide_height=pad_height+3.2
    for xx in (-guide_x,guide_x):
        body=body.union(box(xx,p['oled_y']+1,pad_bottom+guide_height/2,1.4,p['oled_height']-9.8,guide_height))
    # Four screw bosses connect to side walls, away from the electronics.
    bosses=[(xx,yy) for xx in (-w/2+4.5,w/2-4.5) for yy in (6,h-6)]
    for xx,yy in bosses:
        # A 45-degree ramp supports the inward boss overhang when front-down.
        sign=1 if xx>0 else -1
        outer_x=sign*(w/2-1); inner_x=xx-sign*p['screw_boss_r']
        ramp_run=abs(outer_x-inner_x)
        ramp=cq.Workplane('XZ').polyline([(outer_x,d-9-ramp_run),
            (outer_x,d-8.8),(inner_x,d-8.8)]).close().extrude(2*p['screw_boss_r']).translate((0,yy+p['screw_boss_r'],0))
        body=body.union(ramp).union(cyl(xx,yy,d-9,p['screw_boss_r'],9))
        body=body.cut(cyl(xx,yy,d-7,p['screw_pilot_d']/2,8))
    # Generous access for the cable moulding, not just the metal USB socket.
    usb=box(0,.5,p['usb_z'],p['usb_width'],t+3,p['usb_depth'])
    body=body.cut(usb)
    # Screw-fastened lid; the inset rim locates it but is not a friction latch.
    lt=p['lid_thickness']; clearance=p['lid_clearance']; lip=p['lip_wall']
    lid=rounded_plate(w,h,lt,h/2,d+lt/2)
    lip_w=w-2*t-2*clearance; lip_h=h-2*t-2*clearance
    rim=box(0,h/2,d-p['lip_depth']/2,lip_w,lip_h,p['lip_depth']+.2)
    rim=rim.cut(box(0,h/2,d-p['lip_depth']/2,lip_w-2*lip,lip_h-2*lip,p['lip_depth']+1))
    for xx,yy in bosses:
        rim=rim.cut(cyl(xx,yy,d-p['lip_depth']-1,p['screw_boss_r']+clearance,p['lip_depth']+2))
    lid=lid.union(rim)
    # Insulating foam tape sits on these rails; board back is approximately Z=28.
    for xx in (-6.5,6.5):
        lid=lid.union(box(xx,14,d-1.4,3,18,3.0))
    for xx,yy in bosses:
        lid=lid.cut(cyl(xx,yy,d-1,p['screw_clearance_d']/2,lt+2))
        lid=lid.cut(cyl(xx,yy,d+lt-.9,p['screw_head_d']/2,1.2))
    # Small bottom pry recess is accessible even with all wires installed.
    lid=lid.cut(box(0,.2,d+lt-.25,7,2.0,.7))
    # Low-material first-fit panel uses the exact OLED opening and seats.
    coupon=body.intersect(box(0,30,4.5,36,36,9)).translate((0,-12,0))
    lid_print=lid.rotate((0,0,0),(1,0,0),180).translate((0,h,d+lt))
    # Conservative layout references; these are not extra printable components.
    oled_pcb=box(0,p['oled_y'],p['oled_pcb_z']+p['oled_pcb_thickness']/2,
                 p['oled_width'],p['oled_height'],p['oled_pcb_thickness'])
    oled_glass=box(0,p['window_y'],p['oled_pcb_z']-1.4,27.0,19.5,2.8)
    esp_pcb=box(0,p['esp_y']+p['esp_height']/2,d-4.8,p['esp_width'],p['esp_height'],1.6)
    # User diagram: VCC/GND/SCL/SDA header at TOP in front view.
    # 15.2 mm is a provisional connector + female-jumper keep-out, not a measured dimension.
    oled_header=box(0,p['oled_y']+p['oled_height']/2-p['oled_header_edge_offset'],
                    p['oled_pcb_z']+p['oled_pcb_thickness']+p['oled_header_clearance']/2,
                    10.5,3.0,p['oled_header_clearance'])
    esp_headers=box(-7.6,14,22,2.5,19,8).union(box(7.6,14,22,2.5,19,8))
    usb_socket=box(0,3.4,p['usb_z'],9.2,4.6,3.2)
    usb_cable=box(0,-3,p['usb_z'],13,10,8)
    return dict(body=body.clean(),lid=lid.clean(),lid_print=lid_print.clean(),
                oled_fit_check=coupon.clean(),oled_pcb=oled_pcb,oled_glass=oled_glass,
                esp_pcb=esp_pcb,oled_header=oled_header,esp_headers=esp_headers,
                usb_socket=usb_socket,usb_cable=usb_cable,ring_center=(ring_x,ring_y,ring_z))

def validate_stl(path):
    """Independent binary STL topology check after welding coincident vertices."""
    data=path.read_bytes(); count=struct.unpack_from('<I',data,80)[0]
    assert len(data)==84+50*count, (path,'invalid binary STL length')
    edge_faces=defaultdict(list); volume=0.0; coords=[]
    for i in range(count):
        values=struct.unpack_from('<12fH',data,84+50*i)
        vertices=[tuple(values[j:j+3]) for j in (3,6,9)]
        a,b,c=vertices; coords.extend(vertices)
        u=tuple(b[j]-a[j] for j in range(3)); v=tuple(c[j]-a[j] for j in range(3))
        cross=(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])
        assert sum(q*q for q in cross)>1e-16, (path,'degenerate triangle')
        volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6
        keys=[tuple(round(q,5) for q in vertex) for vertex in vertices]
        for aa,bb in zip(keys,keys[1:]+keys[:1]):
            edge_faces[tuple(sorted((aa,bb)))].append((i,1 if aa<bb else -1))
    assert all(len(f)==2 and f[0][1]+f[1][1]==0 for f in edge_faces.values()),(path,'open/nonmanifold/inconsistent edge')
    graph=defaultdict(list)
    for (a,_),(b,_) in edge_faces.values(): graph[a].append(b);graph[b].append(a)
    seen={0};todo=[0]
    while todo:
        for n in graph[todo.pop()]:
            if n not in seen: seen.add(n);todo.append(n)
    assert len(seen)==count,(path,'disconnected surfaces')
    assert volume>0,(path,'inverted or zero-volume mesh')
    bounds=[[min(c[i] for c in coords),max(c[i] for c in coords)] for i in range(3)]
    assert abs(bounds[2][0])<1e-4,(path,'print base is not at Z=0')
    return dict(triangles=count,closed_manifold=True,connected_components=1,
                consistent_winding=True,volume_mm3=round(volume,3),
                bounds_mm=bounds,sha256=hashlib.sha256(data).hexdigest())

def generate(p, out=OUT):
    out.mkdir(parents=True,exist_ok=True); parts=build(p)
    report={'units':'mm','hardware_fit':'UNVERIFIED physical fit; PCB outline follows user product diagram; connector assembly dimensions remain provisional',
            'oled_reference':{'source':'User-provided product dimension screenshot, 2026-10-24',
                'pcb_width_in':1.07,'pcb_height_in':1.10,'provisional_pcb_thickness_in':0.06,
                'front_top_pin_order':['VCC','GND','SCL','SDA'],
                'esp32_mapping':['3.3V','GND','GPIO5','GPIO4'],
                'unconfirmed':'PCB thickness is provisional because side-view witness lines are ambiguous; mounting-hole pitch and screen offset are not fixed from this drawing; 15.2 mm connector keep-out is an allowance, not a measured attached jumper length'},
            'parameters':p,'parts':{},'checks':{}}
    for name in ('body','lid_print','oled_fit_check'):
        part=parts[name]
        assert part.val().isValid() and len(part.solids().vals())==1,(name,'invalid CAD solid')
        path=out / {'body':'milk_case_body.stl','lid_print':'milk_case_lid.stl','oled_fit_check':'oled_fit_check.stl'}[name]
        cq.exporters.export(part,str(path),tolerance=.04,angularTolerance=.12,opt={'ascii':False})
        report['parts'][name]=validate_stl(path)
    interference=parts['body'].intersect(parts['lid']).val().Volume()
    assert interference<1e-6,('body/lid interference',interference)
    report['checks']['assembled_body_lid_interference_mm3']=interference
    for name in ('oled_pcb','oled_glass','esp_pcb','oled_header','esp_headers','usb_socket','usb_cable'):
        for shell in ('body','lid'):
            value=parts[name].intersect(parts[shell]).val().Volume()
            assert value<1e-6,(name,shell,'nominal envelope interference',value)
            report['checks'][f'{name}_{shell}_interference_mm3']=round(value,8)
    pair=parts['oled_header'].intersect(parts['esp_headers']).val().Volume()
    assert pair<1e-6,('Dupont envelope interference',pair)
    report['checks']['nominal_header_interference_mm3']=pair
    x,y,z=parts['ring_center']
    bore=cyl(x,y,z-.2,p['ring_hole_d']/2-.05,p['ring_thickness']+.4)
    assert parts['body'].intersect(bore).val().Volume()<1e-6,'ring bore blocked'
    report['checks']['keyring_hole_through']=True
    assembly=cq.Assembly(name='milk_keyring_prototype')
    assembly.add(parts['body'],name='body',color=cq.Color(.94,.93,.88))
    assembly.add(parts['lid'],name='lid',color=cq.Color(.85,.87,.86))
    assembly.save(str(out/'milk_case_assembly.step'))
    # Export nominal references only for accurate assembly illustration.
    preview=ROOT/'.build/case-preview';preview.mkdir(parents=True,exist_ok=True)
    for name in ('body','lid','oled_pcb','oled_glass','esp_pcb','oled_header','esp_headers','usb_socket'):
        cq.exporters.export(parts[name],str(preview/f'{name}.stl'),tolerance=.06,angularTolerance=.15,opt={'ascii':False})
    (out/'parameters.json').write_text(json.dumps(p,indent=2)+'\n')
    (out/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'output':str(out),'parts':report['parts'],'checks':report['checks']},ensure_ascii=False,indent=2))
    return parts,report

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--parameters',type=Path);args=ap.parse_args()
    if args.parameters: P.update(json.loads(args.parameters.read_text()))
    generate(P)
