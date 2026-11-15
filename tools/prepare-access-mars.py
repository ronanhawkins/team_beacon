"""Convert the pinned Access Mars Murray Buttes model for native Unity VR.

Source: googlecreativelab/access-mars, Apache-2.0, Copyright 2017 Google Inc.
Modifications: decode Draco offline; apply the original site's unit transform;
convert right-handed geometry to Unity; pack native mesh arrays. Photos unchanged.
"""
import hashlib
import json
import re
import shutil
import struct
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import DracoPy
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
RAW=ROOT/'data/raw/access-mars'
OUT=ROOT/'apps/quest/Assets/Beacon/Art/AccessMars'
COMMIT='4b0a445f4e3b3fbfbc6b06f3adf07c24c05a2c57'
BASE=f'https://raw.githubusercontent.com/googlecreativelab/access-mars/{COMMIT}/'
SITE='public/terrain/murray_buttes/'
CURL=shutil.which('curl.exe') or shutil.which('curl')
if CURL is None:raise RuntimeError('Install curl to download the original source assets')


def download(entry):
    path=RAW/entry['path'];path.parent.mkdir(parents=True,exist_ok=True)
    def valid(data):
        return len(data)==entry['size'] and hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest()==entry['sha']
    if path.exists() and valid(path.read_bytes()):return path
    result=subprocess.run([CURL,'-fsSL','--retry','4','--retry-all-errors','--retry-delay','1',
        '--connect-timeout','10','--max-time','60',BASE+entry['path']],capture_output=True)
    if result.returncode or not valid(result.stdout):raise RuntimeError('Download/hash check failed: '+entry['path'])
    path.write_bytes(result.stdout);return path


def local_matrix(node):
    if 'matrix' in node:return np.array(node['matrix']).reshape((4,4),order='F')
    if 'rotation' in node:raise ValueError('Unexpected rotation; implement quaternion transform explicitly')
    m=np.eye(4);m[:3,3]=node.get('translation',[0,0,0]);m[:3,:3]=np.diag(node.get('scale',[1,1,1]));return m


def main():
    RAW.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True);(OUT/'Textures').mkdir(exist_ok=True)
    inventory=ROOT/'.local/access-mars-tree.json'
    if not inventory.exists():
        inventory.parent.mkdir(parents=True,exist_ok=True)
        result=subprocess.run([CURL,'-fsSL','--retry','4','--retry-all-errors','--retry-delay','1',
            '--connect-timeout','10','--max-time','60',
            f'https://api.github.com/repos/googlecreativelab/access-mars/git/trees/{COMMIT}?recursive=1'],capture_output=True)
        if result.returncode:raise RuntimeError('Could not obtain the pinned source inventory')
        inventory.write_bytes(result.stdout)
    tree=json.loads(inventory.read_text(encoding='utf-8-sig'))
    if tree['sha']!=COMMIT or tree['truncated']:raise ValueError('Unverified source inventory')
    selected=[e for e in tree['tree'] if e['type']=='blob' and (e['path'] in ['LICENSE','README.md','public/index.html',
        'src/js/components/terrain.js','src/js/core/scene.js','src/js/shaders/terrain-shader.js','src/js/shaders/uv-highpass-shader.js']
        or e['path'].startswith(SITE) and (e['path'].endswith('_lg.jpg') or e['path'].endswith('background.jpg') or e['path'].endswith('terrain.glb')))]
    with ThreadPoolExecutor(max_workers=8) as pool:
        for i,future in enumerate(as_completed([pool.submit(download,e) for e in selected]),1):
            future.result()
            if i%10==0:print(f'Access Mars assets {i}/{len(selected)}',flush=True)
    (OUT/'LICENSE.txt').write_bytes((RAW/'LICENSE').read_bytes())
    licences=ROOT/'apps/quest/Assets/StreamingAssets/ThirdParty';licences.mkdir(parents=True,exist_ok=True)
    (licences/'AccessMars-LICENSE.txt').write_bytes((RAW/'LICENSE').read_bytes())
    b=(RAW/SITE/'terrain.glb').read_bytes()
    if struct.unpack_from('<III',b)!=(0x46546c67,2,len(b)):raise ValueError('Invalid GLB header')
    json_length,json_type=struct.unpack_from('<II',b,12)
    if json_type!=0x4e4f534a:raise ValueError('Expected glTF JSON')
    doc=json.loads(b[20:20+json_length]);binary_start=20+json_length+8
    binary_length,binary_type=struct.unpack_from('<II',b,20+json_length)
    if binary_type!=0x004e4942:raise ValueError('Expected glTF binary chunk')
    binary=b[binary_start:binary_start+binary_length]
    records=[];arrays=[]
    # Access Mars terrain.js multiplies its scene by 100, cancelling the model's
    # Y_UP root scale of 0.01. Mirror Z for Unity and reverse triangle winding.
    root=np.diag([100,100,-100,1])
    def visit(index,parent):
        node=doc['nodes'][index];world=parent@local_matrix(node)
        if 'mesh' in node:
            name=node['name'];kind='tile' if 'TYPE_TILE' in name else 'background' if 'TYPE_BACKGROUND' in name else 'collision'
            tile=re.search(r'ID_([0-3]+)',name);tile=tile.group(1) if tile else kind
            for p in doc['meshes'][node['mesh']]['primitives']:
                ext=p['extensions']['KHR_draco_mesh_compression'];view=doc['bufferViews'][ext['bufferView']]
                start=view.get('byteOffset',0);decoded=DracoPy.decode(binary[start:start+view['byteLength']])
                attr=lambda semantic:decoded.get_attribute_by_unique_id(ext['attributes'][semantic])['data']
                positions=attr('POSITION');normals=attr('NORMAL');uv=attr('TEXCOORD_0') if 'TEXCOORD_0' in ext['attributes'] else np.zeros((len(positions),2))
                positions=(world[:3,:3]@positions.T).T+world[:3,3]
                # Match the original terrain shader's COLLADA V correction.
                uv=uv.copy();uv[:,1]=1-uv[:,1]
                normals=(np.linalg.inv(world[:3,:3]).T@normals.T).T
                normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)
                faces=decoded.faces[:,[0,2,1]]
                if not np.isfinite(positions).all() or not np.isfinite(uv).all():raise ValueError('Invalid decoded geometry')
                texture=None
                if kind!='collision':
                    source=RAW/SITE/('background.jpg' if kind=='background' else f'tiles/{tile}_lg.jpg')
                    texture=f'{tile}.jpg';(OUT/'Textures'/texture).write_bytes(source.read_bytes())
                    with Image.open(source) as image:dimensions=list(image.size)
                records.append({'name':tile,'kind':kind,'texture':texture,'vertices':len(positions),'triangles':len(faces),
                    'min':positions.min(axis=0).tolist(),'max':positions.max(axis=0).tolist(),
                    'textureSize':dimensions if texture else None})
                arrays.append((positions.astype('<f4'),normals.astype('<f4'),uv.astype('<f4'),faces.astype('<u4')))
        for child in node.get('children',[]):visit(child,world)
    for node in doc['scenes'][doc.get('scene',0)]['nodes']:visit(node,root)
    with (OUT/'terrain.bytes').open('wb') as output:
        output.write(b'AMVR');output.write(struct.pack('<II',1,len(arrays)))
        for points,normals,uv,faces in arrays:
            output.write(struct.pack('<II',len(points),faces.size));output.write(points.tobytes());output.write(normals.tobytes());output.write(uv.tobytes());output.write(faces.tobytes())
    visible=sum(r['triangles'] for r in records if r['kind']!='collision')
    info={'sourceRepository':'https://github.com/googlecreativelab/access-mars','commit':COMMIT,'license':'Apache-2.0',
          'sourceCredit':'NASA/JPL-Caltech and Google Creative Lab','sourceCopyright':'Copyright 2017 Google Inc.',
          'modifications':'Draco decoded offline; original Access Mars scene scale and shader V correction applied; Z mirrored and winding reversed for Unity; mesh arrays packed; JPEG bytes unchanged.',
          'alignment':'Visual reference scenery only; not georegistered to the mission waypoints.',
          'visibleTriangles':visible,'collisionTriangles':sum(r['triangles'] for r in records if r['kind']=='collision'),
          'meshes':records,'sourceFiles':[{k:e[k] for k in ['path','sha','size']} for e in selected]}
    (OUT/'terrain.json').write_text(json.dumps(info,indent=2)+'\n',encoding='utf-8')
    print(f'ACCESS_MARS_READY: {visible} visible triangles, {len(records)} meshes',flush=True)
    for r in records[-2:]:print(r)


if __name__=='__main__':main()
