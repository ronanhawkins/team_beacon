"""Bundle the exported Jezero route tile and reproject the cached wide landscape.

Measured geometry stays in the planner's local east/north frame. No new heights
are generated. The wide cache is the earlier NASA/USGS orthographic export.
"""
import json
import shutil
from pathlib import Path
import numpy as np
import rasterio
from affine import Affine
from rasterio.enums import Resampling
from rasterio.warp import reproject
from PIL import Image
from jezero_ranges import dem_grid,image_crop

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data/out/jezero/terrain'
RAW=ROOT/'data/raw/jezero'
ART=ROOT/'apps/quest/Assets/Beacon/Art/JezeroTerrain'
CRS='+proj=ortho +lat_0=18.4663 +lon_0=77.4298 +R=3396190 +units=m +no_defs'

def main():
    ART.mkdir(parents=True,exist_ok=True)
    RAW.mkdir(parents=True,exist_ok=True)
    source_base='https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/'
    if not (RAW/'height_1025.npy').exists():
        step=10000/1024
        values=dem_grid(source_base+'JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif',RAW,CRS,
                        Affine(step,0,-5000-step/2,0,-step,5000+step/2),1025)
        np.save(RAW/'height_1025.npy',values)
    image_crop(source_base+'JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif',RAW)
    site=json.loads((ROOT/'data/sites/jezero/site.json').read_text())
    base=json.loads((DATA/'terrain.json').read_text())
    detail=json.loads((DATA/'detail.json').read_text())
    routes=json.loads((ROOT/'data/out/jezero/waypoints.json').read_text())
    width=detail['heightGrid']['width']; spacing=detail['heightGrid']['metresPerPixel']
    ox=detail['originLocal']['x']+.5; oy=detail['originLocal']['y']+.5
    heights=np.fromfile(DATA/'detail_height_600.bin',dtype='<f4').reshape(width,width)
    background=np.fromfile(DATA/'height_750.bin',dtype='<f4').reshape(750,750)
    def sample(values,x,y,left,bottom,step):
        n=values.shape[0];c=np.clip((x-left)/step,0,n-1.001);r=np.clip(n-1-(y-bottom)/step,0,n-1.001)
        ix=c.astype(np.int32);iy=r.astype(np.int32);fx=c-ix;fy=r-iy
        return (values[iy,ix]*(1-fx)+values[iy,ix+1]*fx)*(1-fy)+(values[iy+1,ix]*(1-fx)+values[iy+1,ix+1]*fx)*fy
    def height(x,y):
        fine=sample(heights,x,y,ox,oy,1);coarse=sample(background,x,y,2,2,4)
        return np.where((x>=ox)&(x<=ox+width-1)&(y>=oy)&(y<=oy+width-1),fine,coarse)
    points=[p for path in [routes['main'],*routes['reroutes'].values()] for p in path]
    for p in points:
        x,y=p['pos']['x'],p['pos']['y']
        if not ox+2<x<ox+width-3 or not oy+2<y<oy+width-3:raise ValueError('Route outside detail tile')
        if abs(float(height(np.array(x),np.array(y)))-p['pos']['z'])>.25:raise ValueError('Route elevation mismatch')
    # The 7 km square stays inside the existing measured 10 km image cache.
    # Its centre is the planner crop centre, not the old orthographic origin.
    out_size=1000;wide_spacing=7.;wide_edge=-2000.;wide_origin=wide_edge+wide_spacing/2
    west=site['grid']['southWestEasting']+wide_edge
    north=site['grid']['southWestNorthing']+wide_edge+7000
    target=Affine(wide_spacing,0,west,0,-wide_spacing,north)
    wide=np.full((out_size,out_size),np.nan,dtype='<f4')
    source=np.load(RAW/'height_1025.npy')
    step=10000/1024
    reproject(source,wide,src_transform=Affine(step,0,-5000-step/2,0,-step,5000+step/2),src_crs=CRS,
              dst_transform=target,dst_crs=base['crsWkt'],dst_nodata=np.nan,resampling=Resampling.bilinear)
    if not np.isfinite(wide).all():raise ValueError('Wide DEM coverage is incomplete')
    (ART/'background.bytes').write_bytes(wide.tobytes())
    image=np.zeros((4096,4096),dtype=np.uint8)
    with rasterio.open(RAW/'imagery-crop.tif') as src:
        reproject(rasterio.band(src,1),image,src_transform=src.transform,src_crs=src.crs,
                  dst_transform=Affine(7000/4096,0,west,0,-7000/4096,north),dst_crs=base['crsWkt'],
                  resampling=Resampling.average)
    if (image==0).mean()>.001:raise ValueError('Wide image coverage is incomplete')
    Image.fromarray(image).save(ART/'background.jpg',quality=92)
    shutil.copyfile(DATA/'detail_height_600.bin',ART/'height.bytes')
    shutil.copyfile(DATA/'detail_2400.jpg',ART/'orbital.jpg')
    # Appearance-only shadow mask; use full-resolution detail and the 4 m export.
    shadow_width=301;shadow_spacing=(width-1)/300
    xx,yy=np.meshgrid(ox+np.arange(shadow_width)*shadow_spacing,oy+np.arange(shadow_width-1,-1,-1)*shadow_spacing)
    z=height(xx,yy);az=np.deg2rad(site['sky']['sun']['az']);sun=np.tan(np.deg2rad(site['sky']['sun']['el']))
    horizon=np.full_like(z,-100.)
    for d in np.arange(2,402,2):horizon=np.maximum(horizon,(height(xx+np.sin(az)*d,yy+np.cos(az)*d)-z)/d)
    visibility=np.clip((sun-horizon+.012)/.024,0,1);visibility=(visibility*visibility*(3-2*visibility)).astype('<f4')
    (ART/'shadow.bytes').write_bytes(visibility.tobytes())
    meta={'version':1,'site':'jezero','width':width,'height':width,'originX':ox,'originY':oy,'spacing':spacing,
          'heightOrigin':base['parking']['z'],'backgroundWidth':out_size,'backgroundSpacing':wide_spacing,'backgroundOrigin':wide_origin,
          'backgroundMeshSpacing':32,'wideWalking':True,'photoTint':[.86,.67,.49],
          'shadowWidth':shadow_width,'shadowSpacing':shadow_spacing,'shadowSun':site['sky']['sun'],
          'sources':base['source'],'wideImageSource':'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif',
          'frame':'+X east, +Y up, +Z north; local mission metres from southwest of the Jezero crop',
          'heightLayout':'Float32 little-endian, north row first, pixel centres',
          'wideHeightLimit':'Reprojected earlier 9.765625 m cache; 7 m output does not increase source detail',
          'textureLimit':'Grayscale HiRISE; warm tint and fine materials are illustrative',
          'routePointsCovered':len(points),'mainRoute':[p['pos'] for p in routes['main']]}
    (ART/'terrain.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(json.dumps({'site':'jezero','coveredRoutePoints':len(points),'detailMetres':width-1,'wideMetres':7000,'output':str(ART)},indent=2))

if __name__=='__main__':main()
