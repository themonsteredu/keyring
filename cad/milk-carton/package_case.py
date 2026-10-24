#!/usr/bin/env python3
"""Package verified meshes and assembly drawings for an ordinary download."""
from pathlib import Path
import hashlib,io,json,zipfile
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'downloads/milk-carton'
DEST=ROOT/'downloads/Milk-Carton-Keyring-STL.zip'
FILES=['milk_case_body.stl','milk_case_lid.stl','oled_fit_check.stl',
       'milk_case_assembly.step','case-preview.png','assembly-preview.png',
       'parameters.json','validation.json']
report=json.loads((SOURCE/'validation.json').read_text())
for key,name in [('body',FILES[0]),('lid_print',FILES[1]),('oled_fit_check',FILES[2])]:
    assert hashlib.sha256((SOURCE/name).read_bytes()).hexdigest()==report['parts'][key]['sha256'],f'Stale mesh: {name}'
readme=(ROOT/'cad/milk-carton/README.md').read_text().replace('../../downloads/milk-carton/','')
readme=readme.replace('[build_case.py](build_case.py)','[build_case.py](https://github.com/themonsteredu/keyring/blob/main/cad/milk-carton/build_case.py)')
readme=readme.replace('저장소 루트의 다음 명령으로 생성합니다.', '[GitHub 저장소](https://github.com/themonsteredu/keyring)를 받은 뒤 저장소 루트의 다음 명령으로 생성합니다.')
content={name:(SOURCE/name).read_bytes() for name in FILES};content['README-ko.md']=readme.encode('utf-8')
buf=io.BytesIO()
with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name,data in content.items():
        entry=zipfile.ZipInfo('Milk-Carton-Keyring/'+name,date_time=(1980,1,1,0,0,0))
        entry.create_system=3;entry.external_attr=0o100644<<16;entry.compress_type=zipfile.ZIP_DEFLATED
        z.writestr(entry,data,compresslevel=9)
with zipfile.ZipFile(io.BytesIO(buf.getvalue())) as z:
    assert z.testzip() is None
    assert len(z.namelist())==len(content)
    for name,data in content.items():assert z.read('Milk-Carton-Keyring/'+name)==data
DEST.write_bytes(buf.getvalue())
for path in SOURCE.iterdir():
    if path.is_file():path.chmod(0o644)
print(json.dumps({'file':str(DEST.relative_to(ROOT)),'files':len(content),'bytes':DEST.stat().st_size,'sha256':hashlib.sha256(DEST.read_bytes()).hexdigest()},indent=2))
