"""Step 1: build the 25 km hex grid over India and sample SRTM elevation.
Outputs data/work/grid.json and data/work/elev.json (cached; re-run safe)."""
import json, math, os, subprocess, sys, time
import numpy as np
import shapefile
from shapely.geometry import shape, Point, Polygon
from shapely.ops import unary_union
from shapely import STRtree
from pyproj import Transformer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(ROOT, 'data', 'raw')
WORK = os.path.join(ROOT, 'data', 'work')
os.makedirs(WORK, exist_ok=True)

# Lambert azimuthal equal-area centred on India: hexes have equal real area
FWD = Transformer.from_crs('EPSG:4326', '+proj=laea +lat_0=22 +lon_0=81 +units=km', always_xy=True)
INV = Transformer.from_crs('+proj=laea +lat_0=22 +lon_0=81 +units=km', 'EPSG:4326', always_xy=True)
HEX_W = 25.0                       # flat-to-flat width (km), pointy-top hexes
R = HEX_W / math.sqrt(3)           # circumradius
ROW_H = 1.5 * R


def proj_geom(g):
    from shapely.ops import transform
    return transform(lambda x, y, z=None: FWD.transform(x, y), g)


def hex_poly(cx, cy):
    return Polygon([(cx + R * math.cos(math.radians(60 * i - 30)), cy + R * math.sin(math.radians(60 * i - 30))) for i in range(6)])


def load_districts():
    r = shapefile.Reader(os.path.join(RAW, '2011_Dist'))
    out = []
    for sr in r.iterShapeRecords():
        g = shape(sr.shape.__geo_interface__)
        if not g.is_valid:
            g = g.buffer(0)
        rec = sr.record.as_dict()
        out.append({'code': int(rec['censuscode']), 'name': rec['DISTRICT'], 'state': rec['ST_NM'], 'geom': proj_geom(g)})
    return out


def build_grid():
    dists = load_districts()
    land = unary_union([d['geom'] for d in dists])
    tree = STRtree([d['geom'] for d in dists])
    minx, miny, maxx, maxy = land.bounds
    pad = 3 * HEX_W
    hexes = []
    row = 0
    y = miny - pad
    while y < maxy + pad:
        x0 = minx - pad + (HEX_W / 2 if row % 2 else 0)
        col = 0
        x = x0
        while x < maxx + pad:
            hexes.append((col, row, x, y))
            x += HEX_W; col += 1
        y += ROW_H; row += 1
    print('candidate hexes', len(hexes))
    land_buf = land.buffer(60)  # keep a ring of sea hexes around the coast
    cells = []
    for col, row, x, y in hexes:
        p = Point(x, y)
        if not land_buf.contains(p):
            continue
        hp = hex_poly(x, y)
        shares = {}
        for i in tree.query(hp):
            a = dists[i]['geom'].intersection(hp).area
            if a > 0.5:
                shares[dists[i]['code']] = a
        land_area = sum(shares.values())
        is_land = land_area > 0.35 * hp.area
        cells.append({'c': col, 'r': row, 'x': round(x, 2), 'y': round(y, 2), 'land': is_land,
                      'landArea': round(land_area, 1), 'shares': {str(k): round(v, 1) for k, v in shares.items()}})
    # every district must own at least one land hex (tiny districts, islands)
    owned = set()
    for c in cells:
        if c['land']:
            owned.update(c['shares'])
    for d in dists:
        if str(d['code']) not in owned:
            p = d['geom'].representative_point()
            best = min(cells, key=lambda c: (c['x'] - p.x) ** 2 + (c['y'] - p.y) ** 2)
            best['land'] = True
            best['shares'].setdefault(str(d['code']), round(d['geom'].area, 1))
    for c in cells:
        lon, lat = INV.transform(c['x'], c['y'])
        c['lon'], c['lat'] = round(lon, 4), round(lat, 4)
    dmeta = [{'code': d['code'], 'name': d['name'], 'state': d['state'], 'area': round(d['geom'].area, 1)} for d in dists]
    json.dump({'hexW': HEX_W, 'cells': cells, 'districts': dmeta}, open(os.path.join(WORK, 'grid.json'), 'w'))
    print('cells', len(cells), 'land', sum(c['land'] for c in cells))


def sample_elevation():
    """7 SRTM samples per land hex (centre + 6 at 0.6R) via the OpenTopoData public API."""
    g = json.load(open(os.path.join(WORK, 'grid.json')))
    path = os.path.join(WORK, 'elev.json')
    cache = json.load(open(path)) if os.path.exists(path) else {}
    pts = []
    for c in g['cells']:
        if not c['land']:
            continue
        key = '%d,%d' % (c['c'], c['r'])
        if key in cache:
            continue
        for i in range(7):
            if i == 0:
                x, y = c['x'], c['y']
            else:
                a = math.radians(60 * i)
                x, y = c['x'] + 0.6 * R * math.cos(a), c['y'] + 0.6 * R * math.sin(a)
            lon, lat = INV.transform(x, y)
            pts.append((key, lat, lon))
    print('points to fetch', len(pts))
    tmp = {}
    for b in range(0, len(pts), 100):
        batch = pts[b:b + 100]
        locs = '|'.join('%.4f,%.4f' % (la, lo) for _, la, lo in batch)
        for attempt in range(5):
            res = subprocess.run(['curl', '-sS', '--max-time', '60', '-X', 'POST',
                                  '-d', 'locations=' + locs, 'https://api.opentopodata.org/v1/srtm90m'],
                                 capture_output=True, text=True)
            try:
                d = json.loads(res.stdout)
                if d.get('status') == 'OK':
                    break
            except Exception:
                d = {}
            print('retry', attempt, res.stdout[:200], file=sys.stderr)
            time.sleep(3 + 3 * attempt)
        else:
            raise RuntimeError('elevation API failed')
        for (key, _, _), rr in zip(batch, d['results']):
            tmp.setdefault(key, []).append(rr['elevation'] if rr['elevation'] is not None else 0)
        for key, v in list(tmp.items()):
            if len(v) == 7:
                cache[key] = v
                del tmp[key]
        if (b // 100) % 20 == 0:
            json.dump(cache, open(path, 'w'))
            print('fetched', b + len(batch), '/', len(pts))
        time.sleep(1.05)  # API limit: 1 request/second
    json.dump(cache, open(path, 'w'))
    print('elevation cached for', len(cache))


if __name__ == '__main__':
    if 'elev' not in sys.argv:
        build_grid()
    sample_elevation()
