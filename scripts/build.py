"""Step 2: reconcile every data source onto the hex grid and write public/data/*.json.
Needs data/work/grid.json + elev.json from grid.py.  Run: python -I scripts/build.py"""
import json, math, os, re, zipfile, io, csv
from collections import defaultdict, Counter
import numpy as np
import pandas as pd
import shapefile
from shapely.geometry import shape, Point, LineString
from shapely.ops import transform
from shapely import STRtree
from pyproj import Transformer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(ROOT, 'data', 'raw')
WORK = os.path.join(ROOT, 'data', 'work')
OUT = os.path.join(ROOT, 'public', 'data')
os.makedirs(OUT, exist_ok=True)
FWD = Transformer.from_crs('EPSG:4326', '+proj=laea +lat_0=22 +lon_0=81 +units=km', always_xy=True)


def P(lon, lat):
    return FWD.transform(lon, lat)


def jload(name):
    return json.load(open(os.path.join(RAW, name), encoding='utf8'))


def wkt_pt(s):
    m = re.match(r'Point\(([-\d.eE]+) ([-\d.eE]+)\)', s)
    return float(m.group(1)), float(m.group(2))


def wd_rows(name):
    rows = jload(name)
    if isinstance(rows, dict):
        rows = rows['results']['bindings']
    out, seen = [], set()
    for r in rows:
        qid = r['s']['value'].rsplit('/', 1)[-1]
        if qid in seen:
            continue
        label = r.get('sLabel', {}).get('value', qid)
        if re.fullmatch(r'Q\d+', label):
            continue  # unlabeled item
        seen.add(qid)
        lon, lat = wkt_pt(r['coord']['value'])
        out.append({'qid': qid, 'name': label, 'lon': lon, 'lat': lat,
                    **{k: v['value'] for k, v in r.items() if k not in ('s', 'sLabel', 'coord')}})
    return out


# ---------------------------------------------------------------- grid
G = json.load(open(os.path.join(WORK, 'grid.json')))
ELEV = json.load(open(os.path.join(WORK, 'elev.json')))
HEX_W = G['hexW']; R = HEX_W / math.sqrt(3); ROW_H = 1.5 * R
cells = G['cells']
index = {(c['c'], c['r']): i for i, c in enumerate(cells)}
_e = next(c for c in cells if c['r'] % 2 == 0)
x0 = _e['x'] - _e['c'] * HEX_W          # grid origin (col 0, row 0)
y0 = _e['y'] - _e['r'] * ROW_H
N = len(cells)
land = np.array([c['land'] for c in cells])
HEX_AREA = (math.sqrt(3) / 2) * HEX_W ** 2


def hex_at(x, y):
    """index of the cell whose centre is nearest to projected point (x, y), or None"""
    r0 = int(round((y - y0) / ROW_H))
    best, bd = None, 1e18
    for r in (r0 - 1, r0, r0 + 1):
        cg = int(round((x - x0 - (HEX_W / 2 if r % 2 else 0)) / HEX_W))
        for cc in (cg - 1, cg, cg + 1):
            i = index.get((cc, r))
            if i is None:
                continue
            d = (cells[i]['x'] - x) ** 2 + (cells[i]['y'] - y) ** 2
            if d < bd:
                best, bd = i, d
    return best if best is not None and bd < (R * 1.2) ** 2 else None


def hex_ll(lon, lat):
    return hex_at(*P(lon, lat))


def neighbors(i):
    c, r = cells[i]['c'], cells[i]['r']
    odd = r % 2
    d = [(1, 0), (-1, 0), (odd, -1), (odd - 1, -1), (odd, 1), (odd - 1, 1)]
    return [index[(c + dc, r + dr)] for dc, dr in d if (c + dc, r + dr) in index]


# ---------------------------------------------------------------- census / districts
C = pd.read_csv(os.path.join(RAW, 'census2011.csv'))
C = C.rename(columns={'District code': 'code', 'State name': 'state_raw', 'District name': 'name'})
C = C.set_index('code')
STATE_FIX = {'ORISSA': 'Odisha', 'PONDICHERRY': 'Puducherry', 'NCT OF DELHI': 'Delhi'}
TELANGANA = {'Adilabad', 'Nizamabad', 'Karimnagar', 'Medak', 'Hyderabad', 'Rangareddy', 'Mahbubnagar', 'Nalgonda', 'Warangal', 'Khammam'}


def title_state(s):
    s = STATE_FIX.get(s, s.title())
    return s.replace(' And ', ' and ').replace(' Of ', ' of ')


C['state'] = [('Telangana' if (st == 'ANDHRA PRADESH' and n in TELANGANA) else
               'Ladakh' if (st == 'JAMMU AND KASHMIR' and n in ('Leh(Ladakh)', 'Kargil')) else title_state(st))
              for st, n in zip(C.state_raw, C.name)]

# household income (Census 2011 "power parity" brackets) -> income proxy
BRK = [('Power_Parity_Less_than_Rs_45000', 30000), ('Power_Parity_Rs_45000_90000', 67500),
       ('Power_Parity_Rs_90000_150000', 120000), ('Power_Parity_Rs_150000_240000', 195000),
       ('Power_Parity_Rs_240000_330000', 285000), ('Power_Parity_Rs_330000_425000', 377500),
       ('Power_Parity_Rs_425000_545000', 485000), ('Power_Parity_Above_Rs_545000', 700000)]
C['income_total'] = sum(C[k] * v for k, v in BRK)
C['hh_income_mean'] = C['income_total'] / C['Total_Power_Parity'].clip(lower=1)
C['pct_above_330k'] = 100 * (C['Power_Parity_Rs_330000_425000'] + C['Power_Parity_Rs_425000_545000'] + C['Power_Parity_Above_Rs_545000']) / C['Total_Power_Parity'].clip(lower=1)

# State GDP (Wikipedia list, nominal GSDP, ₹ crore) allocated to districts by income share
import html as _html
wp = json.load(open(os.path.join(RAW, 'wp_gsdp.json'), encoding='utf8'))['parse']['text']
gt = pd.read_html(io.StringIO(wp))[1]
gt.columns = ['rank', 'state', 'gdp_inr', 'gdp_usd', 'growth']
GSDP = {}
for s, v in zip(gt.state, gt.gdp_inr):
    s = s.replace('Andaman and Nicobar Islands', 'Andaman and Nicobar Islands')
    GSDP[s] = float(re.sub(r'[^\d.]', '', str(v)))
# Ladakh is reported with J&K in this table; Dadra/Daman & Lakshadweep missing -> per-capita fallback
C['gstate'] = C.state.replace({'Ladakh': 'Jammu and Kashmir'})
nat_pc = sum(GSDP.values()) / C.Population.sum()
C['gdp_cr'] = 0.0
for st, grp in C.groupby('gstate'):
    total = GSDP.get(st)
    if total is None:
        total = nat_pc * grp.Population.sum()
    C.loc[grp.index, 'gdp_cr'] = total * grp.income_total / grp.income_total.sum()
C['gdp_pc'] = C.gdp_cr * 1e7 / C.Population

W = C.Workers.clip(lower=1)
C['pct_cultivators'] = 100 * C.Cultivator_Workers / W
C['pct_agri_labour'] = 100 * C.Agricultural_Workers / W
C['pct_household_ind'] = 100 * C.Household_Workers / W
C['pct_other_workers'] = 100 * C.Other_Workers / W
C['pct_farm'] = C.pct_cultivators + C.pct_agri_labour
C['literacy'] = 100 * C.Literate / C.Population
C['female_literacy'] = 100 * C.Female_Literate / C.Female
C['sex_ratio'] = 1000 * C.Female / C.Male
C['pct_graduates'] = 100 * C.Graduate_Education / C.Total_Education.clip(lower=1)
C['pct_sc'] = 100 * C.SC / C.Population
C['pct_st'] = 100 * C.ST / C.Population
C['worker_rate'] = 100 * C.Workers / C.Population
C['female_work_rate'] = 100 * C.Female_Workers / C.Female
H = C.Households.clip(lower=1)
C['pct_urban'] = 100 * C.Urban_Households / H
C['pct_internet'] = 100 * C.Households_with_Internet / H
C['pct_computer'] = 100 * C.Households_with_Computer / H
C['pct_electricity'] = 100 * C.Housholds_with_Electric_Lighting / H
C['pct_lpg'] = 100 * C.LPG_or_PNG_Households / H
C['pct_latrine'] = 100 * C.Having_latrine_facility_within_the_premises_Total_Households / H
C['pct_car'] = 100 * C.Households_with_Car_Jeep_Van / H
C['pct_tv'] = 100 * C.Households_with_Television / H
C['pct_phone'] = 100 * C.Households_with_Telephone_Mobile_Phone / H
C['pct_tapwater'] = 100 * C.Main_source_of_drinking_water_Tapwater_Households / H
C['pct_twowheeler'] = 100 * C.Households_with_Scooter_Motorcycle_Moped / H
REL = ['Hindus', 'Muslims', 'Christians', 'Sikhs', 'Buddhists', 'Jains', 'Others_Religions']
for r in REL:
    C['pct_' + r.lower()] = 100 * C[r] / C.Population
relshare = C[REL].div(C.Population, axis=0)
C['dominant_religion'] = relshare.idxmax(axis=1)
C['religious_diversity'] = 100 * (1 - (relshare ** 2).sum(axis=1))  # 1 - Herfindahl
C['pct_young'] = 100 * C.Age_Group_0_29 / C.Population

geom_area = {d['code']: d['area'] for d in G['districts']}
C['area_km2'] = [geom_area.get(i, np.nan) for i in C.index]
C['density'] = C.Population / C.area_km2

# ---------------------------------------------------------------- district geometries (for point-in-district)
shp = shapefile.Reader(os.path.join(RAW, '2011_Dist'))
dgeoms, dcodes = [], []
for sr in shp.iterShapeRecords():
    g = shape(sr.shape.__geo_interface__)
    if not g.is_valid:
        g = g.buffer(0)
    dgeoms.append(transform(lambda x, y, z=None: FWD.transform(x, y), g))
    dcodes.append(int(sr.record['censuscode']))
dtree = STRtree(dgeoms)


def district_of(x, y):
    p = Point(x, y)
    for i in dtree.query(p):
        if dgeoms[i].contains(p):
            return dcodes[i]
    i = dtree.nearest(p)
    return dcodes[i] if dgeoms[i].distance(p) < 15 else None


# ---------------------------------------------------------------- towns (GeoNames) for urban allocation + cities
z = zipfile.ZipFile(os.path.join(RAW, 'geonames_IN.zip'))
gn_cols = ['id', 'name', 'ascii', 'alt', 'lat', 'lon', 'fclass', 'fcode', 'cc', 'cc2', 'a1', 'a2', 'a3', 'a4', 'pop', 'elev', 'dem', 'tz', 'mod']
GN = pd.read_csv(z.open('IN.txt'), sep='\t', names=gn_cols, header=None, quoting=csv.QUOTE_NONE, low_memory=False)
GN = GN[(GN.fclass == 'P') & (GN['pop'] >= 5000)].sort_values('pop', ascending=False)
GN = GN[~GN.fcode.isin(['PPLX', 'PPLH', 'PPLQ', 'PPLW'])]
towns = []
for t in GN.itertuples():
    x, y = P(t.lon, t.lat)
    h = hex_at(x, y)
    if h is None:
        continue
    towns.append({'name': t.name, 'lon': t.lon, 'lat': t.lat, 'x': x, 'y': y, 'pop': int(t.pop), 'fcode': t.fcode, 'hex': h})
for t in towns:
    t['dist'] = district_of(t['x'], t['y'])

# ---------------------------------------------------------------- allocate district totals to hexes
# rural quantities by land share; urban quantities by town population within the district
area_w = defaultdict(dict)                     # district -> {hex: area}
for i, c in enumerate(cells):
    if not c['land']:
        continue
    for code, a in c['shares'].items():
        area_w[int(code)][i] = a
town_w = defaultdict(lambda: defaultdict(float))
for t in towns:
    if t['dist'] is not None and t['hex'] in area_w.get(t['dist'], {}):
        town_w[t['dist']][t['hex']] += t['pop']
    elif t['dist'] is not None:
        town_w[t['dist']][t['hex']] += t['pop'] if land[t['hex']] else 0


def norm(d):
    s = sum(d.values())
    return {k: v / s for k, v in d.items()} if s > 0 else {}


def alloc(rural_vals, urban_vals):
    """rural_vals/urban_vals: Series indexed by district -> totals. returns per-hex array"""
    out = np.zeros(N)
    for code in C.index:
        aw = norm(area_w.get(code, {}))
        tw = norm(town_w.get(code, {})) or aw
        ru = rural_vals.get(code, 0); ur = urban_vals.get(code, 0)
        for h, w in aw.items():
            out[h] += ru * w
        for h, w in tw.items():
            out[h] += ur * w
    return out


u = C.pct_urban / 100
pop = alloc(C.Population * (1 - u), C.Population * u)
farm_frac = (0.18 * (C.pct_farm / C.pct_farm.mean())).clip(0.03, 0.6)
gdp = alloc(C.gdp_cr * farm_frac, C.gdp_cr * (1 - farm_frac))
farmworkers = alloc(C.Cultivator_Workers + C.Agricultural_Workers, C.Cultivator_Workers * 0)
nonfarm = alloc(C.Household_Workers * (1 - u), C.Other_Workers + C.Household_Workers * u)
grads = alloc(C.Graduate_Education * (1 - u) * 0.5, C.Graduate_Education * (1 - (1 - u) * 0.5))

# dominant district per hex
hex_dist = np.full(N, -1)
for i, c in enumerate(cells):
    if c['shares']:
        hex_dist[i] = int(max(c['shares'].items(), key=lambda kv: kv[1])[0])
    if hex_dist[i] not in C.index and hex_dist[i] != 0:   # 0 = area India claims but the 2011 census did not cover
        hex_dist[i] = -1
land &= hex_dist >= 0

# ---------------------------------------------------------------- climate (NASA POWER climatology)
PW = jload('power_climate.json')


def grid_lookup(cellsll):
    arr = np.array(cellsll)
    tree_x = arr[:, 0]; tree_y = arr[:, 1]

    def f(lon, lat):
        k = np.argmin((tree_x - lon) ** 2 + (tree_y - lat) ** 2)
        return arr[k, 2]
    return f


rainf = grid_lookup(PW['PRECTOTCORR']); tempf = grid_lookup(PW['T2M'])
rain = np.array([rainf(c['lon'], c['lat']) * 365 for c in cells])   # mm / year
temp = np.array([tempf(c['lon'], c['lat']) for c in cells])         # °C annual mean

# ---------------------------------------------------------------- elevation & terrain
elev = np.zeros(N); relief = np.zeros(N)
for i, c in enumerate(cells):
    v = ELEV.get('%d,%d' % (c['c'], c['r']))
    if v:
        elev[i] = float(np.mean(v)); relief[i] = float(max(v) - min(v))
# temperature lapse correction where POWER's 0.5° cell is coarser than the terrain
# (POWER already reflects average cell elevation; keep as-is)

coast = np.zeros(N, bool)
for i in range(N):
    if land[i] and any(not land[j] for j in neighbors(i)):
        coast[i] = True

# rivers (Natural Earth 10m centerlines) -> projected polylines + hex river flag
RIV = jload('rivers.geojson')
rivers_out = []; river = np.zeros(N, bool)
for f in RIV['features']:
    pr = f['properties']
    g = shape(f['geometry'])
    if not g.intersects(shape({'type': 'Polygon', 'coordinates': [[[66, 5], [99, 5], [99, 38], [66, 38], [66, 5]]]})):
        continue
    if (pr.get('scalerank') or 10) > 8 or pr.get('featurecla', '').startswith('Lake'):
        continue
    lines = [g] if g.geom_type == 'LineString' else list(g.geoms)
    for ln in lines:
        pl = transform(lambda x, y, z=None: FWD.transform(x, y), ln).simplify(2.0)
        pts = [(round(x, 1), round(y, 1)) for x, y in pl.coords]
        keep = False
        for k in range(0, int(pl.length), 4):
            p = pl.interpolate(k)
            h = hex_at(p.x, p.y)
            if h is not None and land[h]:
                river[h] = True; keep = True
        if keep:
            rivers_out.append({'n': pr.get('name') or '', 'r': pr.get('scalerank'), 'p': pts})

dens = np.where(land, pop / HEX_AREA, 0)
# Terrain codes: 0 ocean,1 coast-water,2 grassland,3 plains,4 desert,5 tundra,6 snow
# Feature codes: 0 none,1 hills,2 mountains,3 forest,4 rainforest,5 floodplains,6 marsh
terrain = np.zeros(N, int); feature = np.zeros(N, int)
for i in range(N):
    if not land[i]:
        terrain[i] = 1 if any(land[j] for j in neighbors(i)) else 0
        continue
    e, rel, rn, t = elev[i], relief[i], rain[i], temp[i]
    if e > 4800 or t < -6:
        terrain[i] = 6
    elif e > 3300 or t < 2:
        terrain[i] = 5
    elif rn < 420:
        terrain[i] = 4
    elif rn < 950:
        terrain[i] = 3
    else:
        terrain[i] = 2
    if rel > 1300 or (e > 2500 and rel > 700):
        feature[i] = 2
    elif rel > 280 or e > 1100:
        feature[i] = 1
    if feature[i] != 2 and dens[i] < 250 and terrain[i] in (2, 3):
        if rn > 2200 and t > 20:
            feature[i] = 4 if feature[i] == 0 else feature[i]
        elif rn > 1250 and feature[i] == 0:
            feature[i] = 3
        elif rn > 1250 and feature[i] == 1:
            feature[i] = 1   # forested hills stay hills (yield bonus applies)
    if feature[i] == 0 and river[i] and rel < 120 and terrain[i] in (3, 4):
        feature[i] = 5
    if feature[i] == 0 and coast[i] and elev[i] < 8 and rn > 1500:
        feature[i] = 6   # low, wet coastal deltas (Sundarbans etc.)

# ---------------------------------------------------------------- point features
def ptfeat(lon, lat):
    h = hex_ll(lon, lat)
    return h

# power plants (WRI Global Power Plant Database)
gp = pd.read_csv(os.path.join(RAW, 'gppd.csv'), low_memory=False)
gp = gp[gp.country == 'IND']
plants = []; power_mw = np.zeros(N); power_by = defaultdict(lambda: defaultdict(float))
for t in gp.itertuples():
    h = hex_ll(t.longitude, t.latitude)
    if h is None:
        continue
    power_mw[h] += t.capacity_mw
    d = hex_dist[h]
    power_by[d][t.primary_fuel] += t.capacity_mw
    if t.capacity_mw >= 50:
        plants.append({'n': t.name, 'f': t.primary_fuel, 'mw': round(t.capacity_mw), 'h': int(h),
                       'gwh': None if pd.isna(t.generation_gwh_2019) else round(t.generation_gwh_2019)})

# airports (OurAirports)
ap = pd.read_csv(os.path.join(RAW, 'airports.csv'), low_memory=False)
ap = ap[(ap.iso_country == 'IN') & ap.type.isin(['large_airport', 'medium_airport']) & (ap.scheduled_service == 'yes')]
airports = []
for t in ap.itertuples():
    h = hex_ll(t.longitude_deg, t.latitude_deg)
    if h is not None:
        airports.append({'n': t.name, 'iata': t.iata_code if isinstance(t.iata_code, str) else '', 'big': t.type == 'large_airport', 'h': int(h), 'city': t.municipality if isinstance(t.municipality, str) else ''})

MAJOR_PORTS = ['Kolkata', 'Syama Prasad', 'Haldia', 'Paradip', 'Visakhapatnam', 'Kamarajar', 'Ennore', 'Chennai Port',
               'Tuticorin', 'V. O. Chidambaranar', 'Cochin', 'Kochi', 'New Mangalore', 'Mormugao', 'Mumbai Port',
               'Jawaharlal Nehru', 'Nhava', 'Kandla', 'Deendayal']
ports = []
for p in wd_rows('wd_ports.json'):
    h = hex_ll(p['lon'], p['lat'])
    if h is None:
        continue
    if not coast[h]:   # snap inland-looking port to the nearest coastal hex
        cand = [j for j in [h] + neighbors(h) if coast[j]]
        if not cand:
            continue
        h = cand[0]
    major = any(k.lower() in p['name'].lower() for k in MAJOR_PORTS)
    ports.append({'n': p['name'], 'h': int(h), 'major': major})

mines = []
MINRES = {'coal': 'coal', 'lignite': 'coal', 'iron': 'iron', 'copper': 'copper', 'gold': 'gold', 'diamond': 'diamond',
          'bauxite': 'aluminium', 'aluminium': 'aluminium', 'uranium': 'uranium', 'zinc': 'zinc', 'lead': 'zinc',
          'manganese': 'manganese', 'limestone': 'limestone', 'mica': 'mica', 'marble': 'marble', 'salt': 'salt'}
for m in wd_rows('wd_mines.json'):
    h = hex_ll(m['lon'], m['lat'])
    if h is None:
        continue
    text = (m['name'] + ' ' + m.get('prodLabel', '')).lower()
    res = next((v for k, v in MINRES.items() if k in text), 'mine')
    mines.append({'n': m['name'], 'res': res, 'h': int(h)})

dams = []
for d in wd_rows('wd_dams.json'):
    h = hex_ll(d['lon'], d['lat'])
    if h is not None:
        dams.append({'n': d['name'], 'h': int(h)})

parks = []
for p in wd_rows('wd_parks.json'):
    h = hex_ll(p['lon'], p['lat'])
    if h is None:
        continue
    try:
        area = float(p.get('area', 'nan'))
    except ValueError:
        area = float('nan')
    parks.append({'n': p['name'], 'h': int(h), 'area': None if math.isnan(area) else round(area)})

whs = []
for w in wd_rows('wd_whs.json'):
    h = hex_ll(w['lon'], w['lat'])
    if h is not None:
        whs.append({'n': w['name'], 'h': int(h)})

# universities: NIRF 2024 overall top 10 are "Great Libraries"; every other university is a campus point
NIRF = [('IIT Madras', 'Indian Institute of Technology Madras', 80.2337, 12.9916),
        ('IISc Bengaluru', 'Indian Institute of Science', 77.5671, 13.0219),
        ('IIT Bombay', 'Indian Institute of Technology Bombay', 72.9133, 19.1334),
        ('IIT Delhi', 'Indian Institute of Technology Delhi', 77.1926, 28.5450),
        ('IIT Kanpur', 'Indian Institute of Technology Kanpur', 80.2341, 26.5123),
        ('IIT Kharagpur', 'Indian Institute of Technology Kharagpur', 87.3105, 22.3149),
        ('AIIMS New Delhi', 'All India Institute of Medical Sciences, New Delhi', 77.2100, 28.5672),
        ('IIT Roorkee', 'Indian Institute of Technology Roorkee', 77.8963, 29.8649),
        ('IIT Guwahati', 'Indian Institute of Technology Guwahati', 91.6916, 26.1878),
        ('JNU', 'Jawaharlal Nehru University', 77.1665, 28.5402)]
univs = []
for u_ in wd_rows('wd_univ.json'):
    h = hex_ll(u_['lon'], u_['lat'])
    if h is not None:
        univs.append({'n': u_['name'], 'h': int(h)})
univ_count = Counter(u_['h'] for u_ in univs)
NIRF_PTS = [{"h": hex_ll(lo, la), "n": n} for n, _, lo, la in NIRF]

HOLY = [('Kashi Vishwanath', 'Hindu', 83.0107, 25.3109), ('Golden Temple (Harmandir Sahib)', 'Sikh', 74.8765, 31.6200),
        ('Tirumala Venkateswara', 'Hindu', 79.3474, 13.6833), ('Vaishno Devi', 'Hindu', 74.9490, 33.0308),
        ('Ajmer Sharif Dargah', 'Muslim', 74.6283, 26.4560), ('Mahabodhi, Bodh Gaya', 'Buddhist', 84.9913, 24.6959),
        ('Jagannath Puri', 'Hindu', 85.8179, 19.8048), ('Meenakshi Amman', 'Hindu', 78.1193, 9.9195),
        ('Sabarimala', 'Hindu', 77.0814, 9.4346), ('Basilica of Bom Jesus', 'Christian', 73.9116, 15.5009),
        ('Shirdi Sai Baba', 'Hindu', 74.4771, 19.7667), ('Kedarnath', 'Hindu', 79.0669, 30.7346),
        ('Somnath', 'Hindu', 70.4013, 20.8880), ('Palitana Jain Temples', 'Jain', 71.8000, 21.4833),
        ('Jama Masjid, Delhi', 'Muslim', 77.2334, 28.6507), ('Tawang Monastery', 'Buddhist', 91.8594, 27.5859),
        ('Velankanni Basilica', 'Christian', 79.8497, 10.6806), ('Ramanathaswamy, Rameswaram', 'Hindu', 79.3174, 9.2881),
        ('Dwarkadhish', 'Hindu', 68.9674, 22.2376), ('Kamakhya', 'Hindu', 91.7055, 26.1664),
        ('Hazratbal Shrine', 'Muslim', 74.8429, 34.1281), ('Shravanabelagola', 'Jain', 76.4840, 12.8590),
        ('Hemkund Sahib', 'Sikh', 79.6243, 30.7016), ('Rumtek Monastery', 'Buddhist', 88.5585, 27.2885)]
holy = []
for n, rel, lon, lat in HOLY:
    h = hex_ll(lon, lat)
    if h is not None:
        holy.append({'n': n, 'rel': rel, 'h': int(h)})

# ---------------------------------------------------------------- disasters
qk = pd.read_csv(os.path.join(RAW, 'quakes.csv'))
qk['x'], qk['y'] = P(qk.longitude.values, qk.latitude.values)
quake_e = np.zeros(N)
cx = np.array([c['x'] for c in cells]); cy = np.array([c['y'] for c in cells])
for t in qk.itertuples():
    d2 = (cx - t.x) ** 2 + (cy - t.y) ** 2
    near = d2 < 75 ** 2
    quake_e[near] += 10 ** (1.5 * t.mag - 6)
big_quakes = [{'m': float(t.mag), 'y': t.time[:4], 'h': int(hex_at(t.x, t.y)), 'place': str(t.place)}
              for t in qk[qk.mag >= 6.5].itertuples() if hex_at(t.x, t.y) is not None]

ib = pd.read_csv(os.path.join(RAW, 'ibtracs_ni.csv'), skiprows=[1], low_memory=False,
                 usecols=['SID', 'SEASON', 'NAME', 'LAT', 'LON', 'WMO_WIND', 'USA_WIND'])
ib['SEASON'] = pd.to_numeric(ib.SEASON, errors='coerce')
ib['wind'] = pd.to_numeric(ib.WMO_WIND, errors='coerce').fillna(pd.to_numeric(ib.USA_WIND, errors='coerce'))
ib = ib[(ib.SEASON >= 1970)]
ib['x'], ib['y'] = P(pd.to_numeric(ib.LON).values, pd.to_numeric(ib.LAT).values)
cyc_hits = [set() for _ in range(N)]
storms = []
for sid, g in ib.groupby('SID'):
    mx = g.wind.max()
    if not (mx >= 64):   # tropical-cyclone strength (64 kt) at some point
        continue
    pts = list(zip(g.x, g.y))
    for x, y in pts:
        near = np.nonzero((cx - x) ** 2 + (cy - y) ** 2 < 60 ** 2)[0]
        for k in near:
            cyc_hits[k].add(sid)
    storms.append({'n': str(g.NAME.iloc[0]).title(), 'y': int(g.SEASON.iloc[0]), 'w': int(mx),
                   'p': [[round(x, 1), round(y, 1)] for x, y in pts[::2]]})
cyclones = np.array([len(s) for s in cyc_hits])

# ---------------------------------------------------------------- railways -> hex trade routes
ST = jload('stations.json')
stations = {}
for f in ST['features']:
    if f['geometry']:
        stations[f['properties']['code']] = f['geometry']['coordinates']
TR = jload('trains.json')
edge = Counter(); rail = np.zeros(N)
for f in TR['features']:
    g = f['geometry']
    if not g or g['type'] != 'LineString' or len(g['coordinates']) < 2:
        continue
    xy = [P(lon, lat) for lon, lat in g['coordinates']]
    seq = []
    for (ax, ay), (bx, by) in zip(xy, xy[1:]):
        L = math.hypot(bx - ax, by - ay)
        steps = max(1, int(L / 6))
        for s in range(steps):
            h = hex_at(ax + (bx - ax) * s / steps, ay + (by - ay) * s / steps)
            if h is not None and (not seq or seq[-1] != h):
                seq.append(h)
    h = hex_at(*xy[-1])
    if h is not None and (not seq or seq[-1] != h):
        seq.append(h)
    for h in set(seq):
        rail[h] += 1
    for a, b in zip(seq, seq[1:]):
        if b in neighbors(a):
            edge[(min(a, b), max(a, b))] += 1
rail_edges = [[a, b, n] for (a, b), n in edge.items()]

# ---------------------------------------------------------------- yields
def scale(v, top=8, mask=None):
    """0 for zero, else 1..top by percentile among positive land hexes"""
    v = np.asarray(v, float)
    m = (v > 0) & land if mask is None else mask & (v > 0)
    out = np.zeros(N, int)
    if m.sum() == 0:
        return out
    ranks = pd.Series(v[m]).rank(pct=True).values
    out[m] = np.clip(np.ceil(ranks * top), 1, top).astype(int)
    return out


TBASE_FOOD = {2: 2, 3: 1, 4: 0, 5: 1, 6: 0}
TBASE_PROD = {2: 0, 3: 1, 4: 0, 5: 0, 6: 0}
food = np.zeros(N, int); prod = np.zeros(N, int)
farm_s = scale(farmworkers, 4); nonfarm_s = scale(nonfarm, 3); power_s = scale(power_mw, 4)
mine_hex = Counter(m['h'] for m in mines)
for i in range(N):
    if not land[i]:
        food[i] = 1 if terrain[i] else 0
        continue
    f = TBASE_FOOD[terrain[i]] + farm_s[i]
    p_ = TBASE_PROD[terrain[i]] + (1 if feature[i] in (1, 3, 4) else 0) + (2 if feature[i] == 2 else 0)
    if feature[i] == 5: f += 2
    if feature[i] == 2: f = max(0, f - 2)
    if river[i]: f += 1
    p_ += power_s[i] + nonfarm_s[i] + 2 * mine_hex.get(i, 0)
    food[i] = f; prod[i] = p_
gold = scale(gdp, 10)
science = np.minimum(10, scale(grads, 7) + 2 * np.array([min(univ_count.get(i, 0), 2) for i in range(N)]))
culture = np.zeros(N, int); faith = np.zeros(N, int)
for w in whs: culture[w['h']] += 4
for p in parks: culture[p['h']] += 1
for h in holy: faith[h['h']] += 4

# ---------------------------------------------------------------- cities (GeoNames >= 100k, deduped)
cities = []
taken = []
for t in towns:
    if t['pop'] < 100000:
        break
    if any((t['x'] - a) ** 2 + (t['y'] - b) ** 2 < 9 ** 2 for a, b in taken):
        continue
    if t['dist'] is None or t['dist'] not in C.index:
        continue
    taken.append((t['x'], t['y']))
    cities.append(t)
print('cities', len(cities))

nat = {k: float(v) for k, v in {
    'pct_cultivators': 100 * C.Cultivator_Workers.sum() / C.Workers.sum(),
    'pct_agri_labour': 100 * C.Agricultural_Workers.sum() / C.Workers.sum(),
    'pct_household_ind': 100 * C.Household_Workers.sum() / C.Workers.sum(),
    'pct_other_workers': 100 * C.Other_Workers.sum() / C.Workers.sum(),
    'pct_graduates': 100 * C.Graduate_Education.sum() / C.Total_Education.sum(),
    'literacy': 100 * C.Literate.sum() / C.Population.sum(),
    'pct_internet': 100 * C.Households_with_Internet.sum() / C.Households.sum(),
    'pct_car': 100 * C.Households_with_Car_Jeep_Van.sum() / C.Households.sum(),
    'gdp_pc': C.gdp_cr.sum() * 1e7 / C.Population.sum(),
    'female_work_rate': 100 * C.Female_Workers.sum() / C.Female.sum(),
    'pct_computer': 100 * C.Households_with_Computer.sum() / C.Households.sum(),
}.items()}

EPITHETS = {'Mumbai': 'Maximum City', 'Bengaluru': 'Silicon Valley of India', 'Bangalore': 'Silicon Valley of India',
            'Kolkata': 'City of Joy', 'Chennai': 'Detroit of Asia', 'Hyderabad': 'City of Pearls', 'Jaipur': 'Pink City',
            'Surat': 'Diamond City', 'Kanpur': 'Manchester of the East', 'Ludhiana': 'Manchester of India',
            'Pune': 'Oxford of the East', 'Varanasi': 'Spiritual Capital of India', 'Udaipur': 'City of Lakes',
            'Jamshedpur': 'Steel City', 'Kochi': 'Queen of the Arabian Sea', 'Indore': 'Cleanest City of India',
            'Delhi': 'Capital of the Republic', 'New Delhi': 'Capital of the Republic', 'Tiruppur': 'Knitwear Capital',
            'Agra': 'City of the Taj', 'Amritsar': 'City of the Golden Temple', 'Nagpur': 'Orange City',
            'Coimbatore': 'Manchester of South India', 'Mysore': 'City of Palaces', 'Mysuru': 'City of Palaces',
            'Bhopal': 'City of Lakes', 'Patna': 'Ancient Pataliputra', 'Ahmedabad': 'Manchester of the East (textiles)',
            'Shillong': 'Scotland of the East', 'Guwahati': 'Gateway to the Northeast', 'Firozabad': 'Glass City',
            'Moradabad': 'Brass City', 'Aligarh': 'Lock City', 'Panipat': 'City of Weavers', 'Bhilai': 'Steel Town',
            'Rourkela': 'Steel City of Odisha', 'Visakhapatnam': 'City of Destiny', 'Madurai': 'Temple City',
            'Thiruvananthapuram': 'Evergreen City', 'Lucknow': 'City of Nawabs', 'Gurgaon': 'Millennium City',
            'Gurugram': 'Millennium City', 'Noida': 'Electronics hub of the NCR'}


def near(h, items, k=1):
    """items within k hex steps"""
    ring = {h}
    for _ in range(k):
        ring |= {j for i in ring for j in neighbors(i)}
    return [it for it in items if it['h'] in ring]


city_out = []
for t in cities:
    d = C.loc[t['dist']]
    h = t['hex']
    lq = {k: float(d[k] / nat[k]) for k in ['pct_cultivators', 'pct_agri_labour', 'pct_household_ind', 'pct_other_workers', 'pct_graduates']}
    dists = []   # Civ districts from real specialisations
    if near(h, NIRF_PTS, 1) or (lq['pct_graduates'] > 1.6 and univ_count.get(h, 0)):
        dists.append(('Campus', 'top research university or graduates %.1f× national' % lq['pct_graduates']))
    if d.pct_other_workers > 75 and d.gdp_pc > nat['gdp_pc'] * 1.3:
        dists.append(('Commercial Hub', '%.0f%% of workers in services/industry; GDP/person %.1f× national' % (d.pct_other_workers, d.gdp_pc / nat['gdp_pc'])))
    dpower = sum(power_by[t['dist']].values())
    if dpower >= 1500 or near(h, mines, 1):
        top = max(power_by[t['dist']].items(), key=lambda kv: kv[1])[0] if power_by[t['dist']] else 'mining'
        dists.append(('Industrial Zone', '%s MW of generating capacity in district (mostly %s)' % (f'{dpower:,.0f}', top) if dpower >= 1500 else 'mines nearby'))
    pn = near(h, ports, 1)
    if pn:
        dists.append(('Harbor', pn[0]['n'] + (' (major port)' if any(p['major'] for p in pn) else '')))
    an = near(h, airports, 1)
    if an:
        dists.append(('Aerodrome', an[0]['n'] + (' — international hub' if any(a['big'] for a in an) else '')))
    hn = near(h, holy, 2)
    if hn:
        dists.append(('Holy Site', hn[0]['n']))
    wn = near(h, whs, 2)
    if wn:
        dists.append(('Theater Square', wn[0]['n'] + ' (World Heritage)'))
    if lq['pct_household_ind'] > 2.0:
        dists.append(('Artisan Quarter', '%.0f%% of workers in household industry (%.1f× national)' % (d.pct_household_ind, lq['pct_household_ind'])))
    if d.pct_farm > 65:
        dists.append(('Granary', '%.0f%% of district workers farm' % d.pct_farm))
    pk = near(h, parks, 2)
    if pk:
        dists.append(('Preserve', pk[0]['n']))
    if t['pop'] >= 1_000_000:
        dists.append(('Neighborhood', 'million-plus city'))
    if t['fcode'] in ('PPLC',):
        dists.insert(0, ('Palace', 'national capital'))
    elif t['fcode'] == 'PPLA':
        dists.insert(0, ('Government Plaza', 'state / UT capital'))
    # signature: workforce category with highest location quotient
    sig_k = max(lq, key=lq.get)
    SIG = {'pct_cultivators': 'Farming town', 'pct_agri_labour': 'Plantation & farm-labour town',
           'pct_household_ind': 'Artisan town', 'pct_other_workers': 'Services & industry city', 'pct_graduates': 'Knowledge city'}
    city_out.append({
        'n': t['name'], 'h': int(h), 'pop': t['pop'], 'd': int(t['dist']), 'cap': t['fcode'],
        'epithet': EPITHETS.get(t['name'], ''), 'sig': SIG[sig_k], 'sigLQ': round(lq[sig_k], 2),
        'districts': [{'t': a, 'why': b} for a, b in dists],
        'power': {k: round(v) for k, v in power_by[t['dist']].items()},
    })

# state of the hex & capitals per state
# ---------------------------------------------------------------- write
DCOLS = ['name', 'state', 'Population', 'area_km2', 'density', 'gdp_cr', 'gdp_pc', 'hh_income_mean', 'pct_above_330k',
         'literacy', 'female_literacy', 'pct_graduates', 'sex_ratio', 'pct_sc', 'pct_st', 'worker_rate', 'female_work_rate',
         'pct_cultivators', 'pct_agri_labour', 'pct_household_ind', 'pct_other_workers', 'pct_farm', 'pct_urban',
         'pct_internet', 'pct_computer', 'pct_electricity', 'pct_lpg', 'pct_latrine', 'pct_tapwater', 'pct_car', 'pct_twowheeler',
         'pct_tv', 'pct_phone', 'pct_hindus', 'pct_muslims', 'pct_christians', 'pct_sikhs', 'pct_buddhists', 'pct_jains',
         'pct_others_religions', 'dominant_religion', 'religious_diversity', 'pct_young', 'Households', 'Workers', 'Literate',
         'Graduate_Education']
D = C[DCOLS].copy()
pwr = pd.Series({k: sum(v.values()) for k, v in power_by.items()})
D['power_mw'] = [float(pwr.get(i, 0)) for i in D.index]
qd = defaultdict(float); cd = defaultdict(int); rd = defaultdict(float)
for i in range(N):
    if land[i]:
        qd[hex_dist[i]] = max(qd[hex_dist[i]], quake_e[i]); cd[hex_dist[i]] = max(cd[hex_dist[i]], cyclones[i])
        rd[hex_dist[i]] += rail[i]
D['quake_energy_log'] = [round(math.log10(qd[i] + 1), 2) for i in D.index]
D['cyclones_since_1970'] = [cd[i] for i in D.index]
D['rail_traffic'] = [rd[i] for i in D.index]
D['universities'] = [0] * len(D)
uc = Counter(hex_dist[u_['h']] for u_ in univs)
D['universities'] = [uc.get(i, 0) for i in D.index]
D = D.round(2)
D.loc[0] = [None] * len(D.columns)
D.loc[0, 'name'] = 'Not covered by Census 2011 (PoK / Aksai Chin)'
D.loc[0, 'state'] = 'Jammu and Kashmir'
D = D.astype(object).where(pd.notna(D), None)
districts_out = {'codes': [int(i) for i in D.index], 'cols': {k: D[k].tolist() for k in D.columns}, 'national': nat}

hexes_out = {
    'hexW': HEX_W, 'N': N,
    'c': [c['c'] for c in cells], 'r': [c['r'] for c in cells],
    'x': [c['x'] for c in cells], 'y': [c['y'] for c in cells],
    'lon': [c['lon'] for c in cells], 'lat': [c['lat'] for c in cells],
    'land': land.astype(int).tolist(), 'd': hex_dist.tolist(),
    'terrain': terrain.tolist(), 'feature': feature.tolist(), 'river': river.astype(int).tolist(), 'coast': coast.astype(int).tolist(),
    'elev': np.round(elev).astype(int).tolist(), 'relief': np.round(relief).astype(int).tolist(),
    'rain': np.round(rain).astype(int).tolist(), 'temp': np.round(temp, 1).tolist(),
    'pop': np.round(pop).astype(int).tolist(), 'gdp': np.round(gdp, 1).tolist(),
    'farm': np.round(farmworkers).astype(int).tolist(), 'nonfarm': np.round(nonfarm).astype(int).tolist(),
    'grads': np.round(grads).astype(int).tolist(),
    'power': np.round(power_mw).astype(int).tolist(), 'rail': rail.astype(int).tolist(),
    'quake': np.round(np.log10(quake_e + 1), 2).tolist(), 'cyclone': cyclones.tolist(),
    'food': food.tolist(), 'prod': prod.tolist(), 'gold': gold.tolist(), 'sci': science.tolist(),
    'cult': culture.tolist(), 'faith': faith.tolist(),
}
features_out = {'plants': plants, 'airports': airports, 'ports': ports, 'mines': mines, 'dams': dams, 'parks': parks,
                'whs': whs, 'holy': holy, 'univs': univs,
                'nirf': [{'n': n, 'full': f, 'h': hex_ll(lo, la), 'rank': k + 1} for k, (n, f, lo, la) in enumerate(NIRF)],
                'quakes': big_quakes, 'storms': storms, 'rivers': rivers_out, 'rail': rail_edges}


def dump(name, obj):
    with open(os.path.join(OUT, name), 'w', encoding='utf8') as f:
        json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)
    print(name, os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')


dump('hexes.json', hexes_out)
dump('districts.json', districts_out)
dump('cities.json', city_out)
dump('features.json', features_out)

# district outlines for drawing state borders (projected, simplified)
from shapely.ops import unary_union
sgeo = defaultdict(list)
for g, code in zip(dgeoms, dcodes):
    if code in C.index:
        sgeo[C.loc[code, 'state']].append(g)
borders = []
for st, gs in sgeo.items():
    u_ = unary_union(gs).simplify(3)
    polys = [u_] if u_.geom_type == 'Polygon' else list(u_.geoms)
    for pg in polys:
        if pg.area > 50:
            borders.append({'s': st, 'p': [[round(x, 1), round(y, 1)] for x, y in pg.exterior.coords]})
dump('borders.json', borders)
print('land hexes', int(land.sum()), 'pop check', int(pop.sum()), 'gdp check', int(gdp.sum()))
