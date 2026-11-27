"""Shared edit timeline: every shot is placed on the music grid (140 BPM).
cam = (lon, lat, zoom) where zoom is a multiple of the "whole India" fit scale."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
B = json.load(open(os.path.join(HERE, 'out', 'beats.json')))
BEAT, BAR = B['beat'], B['bar']
FPS = 30
W, H = 1920, 1080


def T(bar, beat=0.0):
    return bar * BAR + beat * BEAT


# places (lon, lat)
P = {
    'india': (80.5, 22.8), 'delhi': (77.2, 28.6), 'himalaya': (79.5, 31.0), 'ghats': (75.6, 12.5), 'ganga': (82.5, 26.0),
    'mumbai': (72.9, 19.1), 'punjab': (75.4, 31.2), 'coalbelt': (84.8, 22.6), 'bay': (86.5, 18.5), 'south': (78.5, 11.5),
    'central': (81.5, 21.5), 'varanasi': (83.0, 25.3), 'agra': (78.0, 27.2), 'bengaluru': (77.6, 12.97),
    'kolkata': (88.36, 22.57), 'jaipur': (75.8, 26.9), 'northeast': (93.0, 26.0), 'kashmir': (75.5, 34.0),
}

# shot: id, t0, t1, lens, cam_from, cam_to, ease, ui ('clean'|'map'|'full'), action (js), caption
SHOTS = []


def shot(id, t0, t1, lens='terrain', a='india', za=1.0, b=None, zb=None, ease='inout', ui='clean', action=None, still=False, panel=False):
    pa = P[a] if isinstance(a, str) else a
    pb = P[b] if isinstance(b, str) else (b or pa)
    SHOTS.append(dict(id=id, t0=round(t0, 4), t1=round(t1, 4), lens=lens, cam0=(*pa, za), cam1=(*pb, zb or za),
                      ease=ease, ui=ui, action=action, still=still, panel=panel))


# ---- intro (bars 0-4): slow cinematic push
shot('intro', T(0), T(4), 'terrain', 'india', 0.82, 'delhi', 1.5, 'inout', 'clean')
# ---- build (bars 4-8): data-source slams on every beat, then accelerating lens flashes (stills)
BUILD_LENSES = ['pop', 'elev', 'rain', 'gold', 'power', 'trade', 'dis', 'faith']
for k, l in enumerate(BUILD_LENSES):
    shot('build_%d' % k, T(4, k), T(4, k + 1), l, 'india', 1.0, 'india', 1.08, 'out', 'map')
STILL_LENSES = ['terrain', 'elev', 'rain', 'temp', 'pop', 'food', 'prod', 'gold', 'sci', 'gdppc', 'income', 'lit', 'deg', 'net',
                'faith', 'st', 'farmw', 'power', 'trade', 'dis', 'latrine', 'elec', 'car', 'sex', 'fwork']
for l in STILL_LENSES:
    shot('still_' + l, 0, 1 / FPS, l, 'india', 1.18, ui='clean', still=True)
# ---- drop 1 (bars 8-16)
shot('drop_logo', T(8), T(10), 'terrain', 'delhi', 9.0, 'india', 1.0, 'expo', 'clean')
TOUR = [('elev', 'himalaya', 2.2, 'kashmir', 2.6), ('rain', 'ghats', 2.6, 'south', 2.3), ('pop', 'ganga', 2.0, 'kolkata', 2.4),
        ('gold', 'mumbai', 3.2, 'mumbai', 4.2), ('faith', 'punjab', 2.0, 'kashmir', 2.2), ('power', 'coalbelt', 3.6, 'coalbelt', 4.6),
        ('trade', 'delhi', 4.0, 'delhi', 2.6), ('dis', 'bay', 1.8, 'bay', 2.3), ('deg', 'south', 2.4, 'bengaluru', 3.0),
        ('st', 'northeast', 2.4, 'central', 2.0), ('terrain', 'varanasi', 16.0, 'varanasi', 19.0), ('terrain', 'agra', 14.0, 'agra', 10.0)]
for k, (l, a, za, b, zb) in enumerate(TOUR):
    shot('tour_%d' % k, T(10 + k // 2, (k % 2) * 2), T(10 + k // 2, (k % 2) * 2 + 2), l, a, za, b, zb, 'inout', 'map')
# ---- break (bars 16-18): Mumbai City View
shot('city_mumbai', T(16), T(18), 'terrain', 'mumbai', 4.2, 'mumbai', 5.6, 'inout', 'full', "openCity('Mumbai')", panel=True)
# ---- drop 2 (bars 18-26)
for k, c in enumerate(['Bengaluru', 'Delhi', 'Kolkata', 'Jaipur']):
    key = c.lower()
    shot('city_' + key, T(18 + k // 2, (k % 2) * 2), T(18 + k // 2, (k % 2) * 2 + 2), 'terrain', key, 5.5, key, 4.6, 'out', 'full',
         "openCity('%s')" % c, panel=True)
shot('adv_grid', T(20), T(20, 2), 'gold', 'india', 1.0, 'india', 1.05, 'out', 'full', "openAdvisors()")
shot('adv_econ', T(20, 2), T(21), 'gold', 'india', 1.0, 'india', 1.05, 'out', 'full', "openAdvisor('econ')")
shot('adv_ind', T(21), T(21, 2), 'power', 'india', 1.0, 'india', 1.05, 'out', 'full', "openAdvisor('ind')")
shot('adv_env', T(21, 2), T(22), 'dis', 'india', 1.0, 'india', 1.05, 'out', 'full', "openAdvisor('env')")
shot('explorer', T(22), T(23), 'terrain', 'india', 1.0, 'india', 1.0, 'out', 'full', "openExplorer()")
shot('explorer_lens', T(23), T(24), 'custom', 'india', 0.95, 'india', 1.12, 'out', 'map', "customLens()")
shot('trade_whip', T(24), T(25), 'trade', 'delhi', 6.0, 'india', 1.25, 'expo', 'map')
shot('faith_wide', T(25), T(25, 2), 'faith', 'central', 1.6, 'india', 1.0, 'out', 'clean')
shot('terrain_wide', T(25, 2), T(26), 'terrain', 'india', 1.25, 'india', 0.95, 'out', 'clean')
# ---- outro (bars 26-28)
shot('outro', T(26), B['duration'], 'terrain', 'india', 0.9, 'india', 0.8, 'out', 'clean')
