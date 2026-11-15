"""Bounded, resumable HTTP-range downloads for the original USGS TIFF layout.

These source files have no overviews. Fetch only measured DEM scanlines at 10 m
spacing and compressed image tile rows intersecting the crop; never whole files.
"""
import struct
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.warp import reproject, transform_bounds
from rasterio.enums import Resampling


def fetch(url, start, length):
    command=['curl.exe','-sS','--retry','4','--retry-all-errors','--retry-delay','1',
             '--connect-timeout','10','--max-time','60','--range',f'{start}-{start+length-1}',url]
    for attempt in range(3):
        result=subprocess.run(command,capture_output=True)
        if not result.returncode and len(result.stdout)==length:return result.stdout
    raise IOError(f'Range {start}+{length}: {result.stderr.decode(errors="replace")[-300:]} ({len(result.stdout)} bytes)')


def header(url, path, big=False):
    if not path.exists(): path.write_bytes(fetch(url,0,2097152 if big else 1048576))
    b=bytearray(path.read_bytes())
    if big:
        # Original IFD remains at byte 16; the later IFD only updates metadata.
        # Its original georeferencing is also checked by the caller.
        if b[:4]!=b'II+\x00': raise ValueError('Expected little-endian BigTIFF')
        struct.pack_into('<Q',b,8,16)
        n=struct.unpack_from('<Q',b,16)[0]
        tags={t:(typ,count,value) for t,typ,count,value in
              (struct.unpack_from('<HHQQ',b,24+i*20) for i in range(n))}
    else:
        if b[:4]!=b'II*\x00': raise ValueError('Expected little-endian TIFF')
        off=struct.unpack_from('<I',b,4)[0];n=struct.unpack_from('<H',b,off)[0]
        tags={t:(typ,count,value) for t,typ,count,value in
              (struct.unpack_from('<HHII',b,off+2+i*12) for i in range(n))}
    if n>100: raise ValueError('Unexpected TIFF directory')
    return b,tags


def dem_grid(url, raw, target_crs, target_transform, size, bounds=(-5030,-5030,5030,5030), sample_spacing=10):
    head,tags=header(url,raw/'dem-header.tif')
    if tags[259][2]!=1 or tags[278][2]!=1 or tags[258][2]!=32:
        raise ValueError('DEM range sampler requires uncompressed float32 rows')
    offsets=np.frombuffer(head,dtype='<u4',count=tags[273][1],offset=tags[273][2])
    with rasterio.open(raw/'dem-header.tif') as src:
        source_crs=src.crs;source_transform=src.transform
        if src.transform.a!=1 or src.transform.e!=-1:raise ValueError('Expected one-metre DEM pixels')
        left,bottom,right,top=transform_bounds(target_crs,source_crs,*bounds,densify_pts=21)
        col0=max(0,int((left-source_transform.c)/source_transform.a)-10)
        col1=min(src.width,int((right-source_transform.c)/source_transform.a)+11)
        row0=max(0,int((source_transform.f-top)/(-source_transform.e))-10)
        row1=min(src.height,int((source_transform.f-bottom)/(-source_transform.e))+11)
    rows=list(range(row0,row1,sample_spacing));cols=list(range(col0,col1,sample_spacing));grid=np.empty((len(rows),len(cols)),dtype='<f4')
    cache=raw/'dem-rows';cache.mkdir(exist_ok=True)
    def read_row(item):
        i,row=item;path=cache/f'{row}_{col0}_{col1}.bin';length=(col1-col0)*4
        if not path.exists() or path.stat().st_size!=length:
            path.write_bytes(fetch(url,int(offsets[row])+col0*4,length))
        return i,np.frombuffer(path.read_bytes(),dtype='<f4')[::sample_spacing]
    print(f'Fetching {len(rows)} sampled DEM rows (about {len(rows)*(col1-col0)*4/1e6:.0f} MB)...',flush=True)
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures=[pool.submit(read_row,item) for item in enumerate(rows)]
        for done,future in enumerate(as_completed(futures),1):
            i,values=future.result();grid[i]=values
            if done%100==0:print(f'DEM rows {done}/{len(rows)}',flush=True)
    # Decimated nodes retain the exact source pixel centres. Bilinear reprojection
    # registers this measured 10 m grid with the imagery's orthographic CRS.
    x,y=source_transform*(col0+.5,row0+.5)
    coarse=Affine(sample_spacing,0,x-sample_spacing/2,0,-sample_spacing,y+sample_spacing/2)
    destination=np.full((size,size),np.nan,dtype='<f4')
    reproject(grid,destination,src_transform=coarse,src_crs=source_crs,src_nodata=-3.4028226550889045e38,
              dst_transform=target_transform,dst_crs=target_crs,dst_nodata=np.nan,resampling=Resampling.bilinear)
    return destination


def image_crop(url,raw):
    target=raw/'imagery-crop.tif';done=raw/'imagery-crop.complete'
    if target.exists() and done.exists():return target
    head,tags=header(url,raw/'image-header.tif',True)
    if tags[322][2]!=256 or tags[323][2]!=256 or tags[259][2]!=5:
        raise ValueError('Unexpected image tile layout')
    offsets=np.frombuffer(head,dtype='<u8',count=tags[324][1],offset=tags[324][2]).copy()
    counts=np.frombuffer(head,dtype='<u8',count=tags[325][1],offset=tags[325][2]).copy()
    # Read georeferencing from the preserved, bounded header.
    patched=raw/'image-georef.tif';patched.write_bytes(head)
    with rasterio.open(patched) as src:
        if src.transform!=Affine(.25,0,-11612,0,-.25,12036):raise ValueError('Image registration changed')
        columns=(src.width+255)//256
        c0=int(( -5000-src.transform.c)/.25)//256;c1=int((5000-src.transform.c)/.25)//256
        r0=int((src.transform.f-5000)/.25)//256;r1=int((src.transform.f+5000)/.25)//256
    cache=raw/'image-rows';cache.mkdir(exist_ok=True)
    spans=[]
    for row in range(r0,r1+1):
        first=row*columns+c0;last=row*columns+c1
        if np.any(offsets[first+1:last+1] < offsets[first:last]+counts[first:last]):raise ValueError('Tiles not sequential')
        start=int(offsets[first]);length=int(offsets[last]+counts[last])-start
        spans.append((row,first,last,start,length))
    print(f'Fetching {len(spans)} compressed image rows ({sum(s[4] for s in spans)/1e6:.0f} MB)...',flush=True)
    def read_span(span):
        row,first,last,start,length=span;path=cache/f'{row}_{c0}_{c1}.bin'
        if not path.exists() or path.stat().st_size!=length:path.write_bytes(fetch(url,start,length))
        return span,path
    new_offsets=np.zeros_like(offsets);new_counts=np.zeros_like(counts)
    with target.open('wb') as output,ThreadPoolExecutor(max_workers=8) as pool:
        output.write(head)
        futures=[pool.submit(read_span,span) for span in spans]
        for count,future in enumerate(as_completed(futures),1):
            (row,first,last,start,length),path=future.result();position=output.tell();output.write(path.read_bytes())
            new_offsets[first:last+1]=offsets[first:last+1]-start+position
            new_counts[first:last+1]=counts[first:last+1]
            if count%10==0:print(f'Image rows {count}/{len(spans)}',flush=True)
        output.seek(tags[324][2]);output.write(new_offsets.tobytes())
        output.seek(tags[325][2]);output.write(new_counts.tobytes())
    done.write_text('Selected compressed tiles copied unchanged; other tiles sparse.\n')
    return target
