"""Beat-synced trailer edit: composites captured site footage + motion graphics + music -> MP4.
Every punch-zoom, flash, shake, stutter and text slam is keyed to hits in out/beats.json.
Run: python trailer/edit.py [--preview START END]  (renders trailer/out/bharatciv_trailer.mp4)"""
import math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from timeline import SHOTS, B, T, FPS, W, H, BEAT, BAR, STILL_LENSES

HERE = os.path.dirname(os.path.abspath(__file__))
FR = os.path.join(HERE, 'frames')
OUT = os.path.join(HERE, 'out')
FONTS = os.path.join(HERE, 'fonts')
FFMPEG = os.environ.get('FFMPEG') or 'ffmpeg'
GOLD = (243, 201, 92); GOLD2 = (255, 228, 150); WHITE = (255, 255, 255)
rng = np.random.default_rng(3)


def font(name, size, var=None):
    f = ImageFont.truetype(os.path.join(FONTS, name), size)
    if var:
        try:
            f.set_variation_by_name(var)
        except Exception:
            pass
    return f


BEBAS = lambda s: font('Bebas.ttf', s)
CINZEL = lambda s, v='Bold': font('Cinzel.ttf', s, v)
INTER = lambda s, v='Bold': font('Inter.ttf', s, v)

# ---------------------------------------------------------------- music hits
KICKS = np.array(B['kick']); CLAPS = np.array(B['snare']); IMPACTS = np.array(B['impact']); ROLLS = np.array(B['roll'])
HATROLLS = B['hat_roll']
SEC = B['sections']
DUR = B['duration']
NF = int(DUR * FPS)


def since(arr, t):
    """time since most recent hit in arr at/before t (inf if none)"""
    a = arr[arr <= t + 1e-6]
    return t - a[-1] if len(a) else 1e9


# ---------------------------------------------------------------- text rendering
def text_layer(lines, align='center', tracking=0, glow=18, shadow=True):
    """lines: [(text, font, fill, gap_after)] -> RGBA image tightly cropped"""
    dummy = ImageDraw.Draw(Image.new('RGBA', (10, 10)))
    sizes = []
    for txt, f, fill, gap in lines:
        w = sum(dummy.textlength(ch, font=f) for ch in txt) + tracking * max(0, len(txt) - 1)
        asc, desc = f.getmetrics()
        sizes.append((w, asc + desc))
    Wt = int(max(s[0] for s in sizes)) + 2 * glow + 20
    Ht = int(sum(s[1] + l[3] for s, l in zip(sizes, lines))) + 2 * glow + 20
    img = Image.new('RGBA', (Wt, Ht), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    y = glow + 10
    for (txt, f, fill, gap), (w, h) in zip(lines, sizes):
        x = glow + 10 + (0 if align == 'left' else (Wt - 2 * glow - 20 - w) / 2)
        for ch in txt:
            d.text((x, y), ch, font=f, fill=fill)
            x += d.textlength(ch, font=f) + tracking
        y += h + gap
    if shadow:
        a = img.split()[3].filter(ImageFilter.GaussianBlur(glow))
        sh = Image.new('RGBA', img.size, (0, 0, 0, 0)); sh.putalpha(a.point(lambda v: min(255, int(v * 1.6))))
        img = Image.alpha_composite(sh, img)
    return img


def gold_fill(img):
    """vertical gold gradient through the text alpha"""
    w, h = img.size
    grad = np.zeros((h, w, 4), np.uint8)
    yy = np.linspace(0, 1, h)[:, None]
    top, bot = np.array(GOLD2), np.array((214, 150, 40))
    grad[..., :3] = (top + (bot - top) * yy[..., None]).astype(np.uint8)
    arr = np.array(img)
    grad[..., 3] = arr[..., 3]
    return Image.fromarray(grad)


_cache = {}


def cap_img(c):
    key = id(c)
    if key in _cache:
        return _cache[key]
    st = c['style']; txt = c['text']; sub = c.get('sub')
    if st == 'slam':
        lines = [(txt, BEBAS(210), WHITE, 6)] + ([(sub, INTER(40), GOLD, 0)] if sub else [])
        img = text_layer(lines, tracking=4)
    elif st == 'title':
        img = text_layer([(txt, CINZEL(92), WHITE, 0)], tracking=10, glow=22)
    elif st == 'lower':
        t1 = text_layer([(txt, BEBAS(104), WHITE, 0)], align='left', tracking=3, glow=14)
        t2 = text_layer([(sub, INTER(34, 'SemiBold'), GOLD2, 0)], align='left', glow=10) if sub else None
        w = max(t1.width, t2.width if t2 else 0) + 30
        img = Image.new('RGBA', (w, t1.height + (t2.height - 20 if t2 else 0)), (0, 0, 0, 0))
        bar = Image.new('RGBA', (10, t1.height - 40 + (t2.height - 30 if t2 else 0)), GOLD + (255,))
        img.paste(bar, (8, 26))
        img.alpha_composite(t1, (24, 0))
        if t2:
            img.alpha_composite(t2, (28, t1.height - 34))
    elif st == 'city':
        t1 = text_layer([(txt.upper(), BEBAS(230), WHITE, 0)], align='left', tracking=6, glow=20)
        t2 = text_layer([(sub, CINZEL(46, 'Bold'), GOLD2, 0)], align='left', glow=12) if sub else None
        img = Image.new('RGBA', (max(t1.width, t2.width if t2 else 0), t1.height + (t2.height - 40 if t2 else 0)), (0, 0, 0, 0))
        img.alpha_composite(t1, (0, 0))
        if t2:
            img.alpha_composite(t2, (14, t1.height - 58))
    elif st == 'logo':
        a = text_layer([('BHARAT', CINZEL(210, 'Black'), WHITE, 0)], tracking=8, glow=26)
        b = gold_fill(text_layer([('CIV', CINZEL(210, 'Black'), WHITE, 0)], tracking=8, glow=0, shadow=False))
        bs = text_layer([('CIV', CINZEL(210, 'Black'), WHITE, 0)], tracking=8, glow=26)
        img = Image.new('RGBA', (a.width + bs.width - 60, max(a.height, bs.height)), (0, 0, 0, 0))
        img.alpha_composite(a, (0, 0)); img.alpha_composite(bs, (a.width - 60, 0)); img.alpha_composite(b, (a.width - 60 + 26, 26))
        if sub:
            s2 = text_layer([(sub, INTER(38, 'SemiBold'), GOLD2, 0)], tracking=8, glow=12)
            full = Image.new('RGBA', (max(img.width, s2.width), img.height + s2.height - 30), (0, 0, 0, 0))
            full.alpha_composite(img, ((full.width - img.width) // 2, 0)); full.alpha_composite(s2, ((full.width - s2.width) // 2, img.height - 40))
            img = full
    elif st == 'tiny':
        img = text_layer([(txt, BEBAS(84), WHITE, 0)], tracking=6, glow=12)
    elif st == 'url':
        img = text_layer([(txt, INTER(54, 'Bold'), WHITE, 6)] + ([(sub, INTER(28, 'Medium'), (200, 210, 215), 0)] if sub else []), glow=14)
    _cache[key] = img
    return img


# ---------------------------------------------------------------- captions (on the beat grid)
CAPS = []


def cap(t0, t1, text, style='slam', sub=None, pos='center', anim='slam'):
    CAPS.append(dict(t0=t0, t1=t1, text=text, style=style, sub=sub, pos=pos, anim=anim))


cap(T(0, 1), T(1, 3.6), 'WHAT IF INDIA', 'title', anim='track')
cap(T(2, 0), T(3, 3.6), 'WAS A CIVILIZATION MAP?', 'title', anim='track')
BUILD_CAPS = [('CENSUS 2011', '1.21 BILLION PEOPLE · 640 DISTRICTS'), ('SRTM ELEVATION', '43,000 SAMPLES OF REAL TERRAIN'),
              ('NASA CLIMATE', 'RAINFALL + TEMPERATURE'), ('STATE GDP', '₹377 LAKH CRORE, MAPPED TO TILES'),
              ('POWER PLANTS', '313 GW · WRI GLOBAL DATABASE'), ('INDIAN RAILWAYS', '5,208 TRAINS · 8,697 STATIONS'),
              ('QUAKES + CYCLONES', 'USGS SINCE 1900 · NOAA IBTRACS'), ('FAITH', '7 RELIGIONS · EVERY DISTRICT')]
for k, (a, b) in enumerate(BUILD_CAPS):
    cap(T(4, k), T(4, k + 1), a, 'slam', b)
cap(T(7, 0), T(7, 3), '25 LENSES', 'slam', anim='slam')
cap(T(7, 3), T(8), '6,147 TILES.', 'tiny', anim='cut')
cap(T(8), T(10), 'BHARATCIV', 'logo', 'INDIA  ·  REAL DATA  ·  ONE HEX GRID')
TOUR_CAPS = [('ELEVATION', 'The Himalaya, from SRTM'), ('RAINFALL', 'The Western Ghats catch the monsoon'), ('POPULATION', 'The Gangetic plain'),
             ('GOLD = GDP', 'Mumbai, the Maximum City'), ('FAITH', 'Majority religion by district'), ('PRODUCTION', 'The coal belt: real power stations'),
             ('TRADE ROUTES', 'Every train in the timetable'), ('DISASTERS', 'Cyclone tracks of the Bay of Bengal'), ('DEGREES', 'Graduates by district'),
             ('TRIBAL INDIA', 'Scheduled Tribe share'), ('YIELDS', 'Food · Production · Gold · Science on every tile'), ('WONDERS', 'Taj Mahal · World Heritage on the map')]
for k, (a, b) in enumerate(TOUR_CAPS):
    t0 = T(10 + k // 2, (k % 2) * 2)
    cap(t0, t0 + 2 * BEAT, a, 'lower', b, pos='lowerleft', anim='slide')
cap(T(16, 0.5), T(18), '469 CITIES', 'slam', 'REAL WORKFORCES  ·  REAL CIV DISTRICTS', pos='left', anim='slam')
for k, (c, e) in enumerate([('Bengaluru', 'Silicon Valley of India'), ('Delhi', 'Capital of the Republic'), ('Kolkata', 'City of Joy'), ('Jaipur', 'Pink City')]):
    t0 = T(18 + k // 2, (k % 2) * 2)
    cap(t0, t0 + 2 * BEAT, c, 'city', e, pos='cityleft', anim='slam')
cap(T(20), T(20, 2), '9 ADVISORS', 'lower', 'Economy · Science · Culture · Faith · Industry · Trade…', pos='lowerleft', anim='slide')
cap(T(20, 2), T(21), 'ECONOMIC ADVISOR', 'lower', 'Top 10% of districts make 42% of the Gold', pos='lowerleft', anim='slide')
cap(T(21), T(21, 2), 'INDUSTRY ADVISOR', 'lower', 'Coal still powers most of the grid', pos='lowerleft', anim='slide')
cap(T(21, 2), T(22), 'ENVIRONMENT ADVISOR', 'lower', 'Great quakes & fiercest cyclones', pos='lowerleft', anim='slide')
cap(T(22), T(23), 'EXPLORER', 'lower', '50+ columns × 640 districts, linked to the map', pos='lowerleft', anim='slide')
cap(T(23), T(24), 'ANY COLUMN BECOMES A LENS', 'lower', 'Internet access, 2011', pos='lowerleft', anim='slide')
cap(T(24), T(25), '20+ PUBLIC DATASETS', 'slam', anim='slam')
cap(T(25), T(26), 'ONE MAP', 'slam', anim='slam')
cap(T(26), DUR, 'BHARATCIV', 'logo', 'INDIA AS A CIVILIZATION MAP', pos='logo_up', anim='slam')
cap(T(26, 4), DUR, 'bharatciv.vercel.app', 'url', 'Built with Claude Code  ·  inspired by Karpathy’s USA Civ', pos='bottom', anim='fade')


# ---------------------------------------------------------------- footage lookup
MOV = [s for s in SHOTS if not s['still']]
STILLS = {s['lens']: s for s in SHOTS if s['still']}
_img = {}


def load(path):
    if path not in _img:
        if len(_img) > 120:
            _img.clear()
        _img[path] = Image.open(path).convert('RGB')
    return _img[path]


def shot_frame(sh, ts):
    d = os.path.join(FR, sh['id'])
    n = len(os.listdir(d))
    i = min(n - 1, max(0, int(round((ts - sh['t0']) * FPS))))
    return load(os.path.join(d, '%04d.jpg' % i))


def stutter_time(t, sh):
    """hat-roll stutter: loop a tiny slice in sync with the roll hits"""
    for hr in HATROLLS:
        if hr <= t < hr + BEAT and sh['t0'] <= hr:
            n = 6 if int(round((hr - BEAT * 3) / BAR)) % 4 == 1 else 8
            return hr + ((t - hr) % (BEAT / n)) * 0.5, (t - hr) % (BEAT / n)
    return t, None


def source(t):
    """returns (PIL image, shot or None, cut_age)"""
    # rapid stills in bars 6-7 (8ths then 16ths), black gap on the last beat
    if T(6) <= t < T(8):
        if t >= T(7, 3):
            return None, None, t - T(7, 3)
        if t < T(7):
            k = int((t - T(6)) / (BEAT / 2)); age = (t - T(6)) % (BEAT / 2)
        else:
            k = 8 + int((t - T(7)) / (BEAT / 4)); age = (t - T(7)) % (BEAT / 4)
        lens = STILL_LENSES[k % len(STILL_LENSES)]
        return load(os.path.join(FR, 'still_' + lens, '0000.jpg')), {'id': 'still', 'lens': lens}, age
    for sh in MOV:
        if sh['t0'] <= t < sh['t1'] + 1e-9:
            ts, st = stutter_time(t, sh) if t >= SEC['drop1'] else (t, None)
            return shot_frame(sh, ts), sh, t - sh['t0']
    return None, None, 0


# ---------------------------------------------------------------- frame compositor
yy, xx = np.mgrid[0:H, 0:W]
VIGNETTE = (1 - 0.55 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) ** 1.4).clip(0.35, 1)[..., None].astype(np.float32)
LUT = np.clip((np.arange(256) / 255.0 - 0.5) * 1.12 + 0.5, 0, 1) * 255
LUT = LUT.astype(np.uint8)
LOWER_SCRIM = (1 - 0.72 * np.clip(1 - (((xx - 0) / (W * 0.62)) ** 2 + ((yy - H) / (H * 0.45)) ** 2), 0, 1))[..., None].astype(np.float32)
SCRIM = (0.42 + 0.4 * np.clip((((xx - W / 2) / (W * 0.42)) ** 2 + ((yy - H / 2) / (H * 0.32)) ** 2), 0, 1))[..., None].astype(np.float32)


def crop_zoom(sh):
    if sh is None:
        return 1.0, (0.5, 0.5)
    if sh['id'].startswith('adv') or sh['id'] == 'explorer':
        return 1.42, (0.5, 0.5)
    if sh['id'].startswith('city_'):
        return 1.18, (0.62, 0.5)
    return 1.0, (0.5, 0.5)


def render_frame(f):
    t = f / FPS
    img, sh, age = source(t)
    if img is None:
        canvas = Image.new('RGB', (W, H), (0, 0, 0))
    else:
        canvas = img
    in_drop = t >= SEC['build']
    # ---- camera fx: punch-zoom on kicks, shake on impacts, crop for UI shots
    z, (cx, cy) = crop_zoom(sh)
    k_age = since(KICKS, t)
    if in_drop:
        z *= 1 + 0.055 * math.exp(-k_age / 0.085)
    i_age = since(IMPACTS, t)
    shake = 26 * math.exp(-i_age / 0.22) if i_age < 1 else 0
    c_age = since(CLAPS, t)
    if sh and sh.get('id', '').startswith('still') is False and age < 0.35 and in_drop:
        z *= 1 + 0.06 * math.exp(-age / 0.08)       # cut-in punch
    sx, sy = (rng.uniform(-shake, shake), rng.uniform(-shake, shake)) if shake > 0.5 else (0, 0)
    if t < SEC['build']:
        z *= 1 + 0.02 * (t / SEC['build'])           # slow intro creep
    if abs(z - 1) > 1e-3 or shake > 0.5:
        w2, h2 = W / z, H / z
        x0 = cx * W - w2 / 2 + sx; y0 = cy * H - h2 / 2 + sy
        canvas = canvas.transform((W, H), Image.EXTENT, (x0, y0, x0 + w2, y0 + h2), Image.BILINEAR)
    arr = np.asarray(canvas, dtype=np.uint8)
    arr = LUT[arr]
    a = arr.astype(np.float32) * VIGNETTE
    # ---- chromatic aberration: impacts, claps, cuts
    ca = 0.0
    if i_age < 0.4: ca = max(ca, 18 * math.exp(-i_age / 0.12))
    if in_drop and c_age < 0.2: ca = max(ca, 7 * math.exp(-c_age / 0.05))
    if sh and age < 2.5 / FPS and in_drop: ca = max(ca, 12)
    if ca >= 1:
        d = int(ca)
        a[..., 0] = np.roll(a[..., 0], d, axis=1); a[..., 2] = np.roll(a[..., 2], -d, axis=1)
    # ---- flashes
    fl = 0.0
    if i_age < 0.5: fl = max(fl, 0.9 * math.exp(-i_age / 0.11))
    if in_drop and c_age < 0.25: fl = max(fl, 0.16 * math.exp(-c_age / 0.06))
    if T(6) <= t < T(7, 3) and age < 1 / FPS: fl = max(fl, 0.25)
    if fl > 0.01:
        a = a * (1 - fl) + 255 * fl
    # ---- scrim behind big centred titles (keeps type readable over busy map labels)
    if any(c['t0'] <= t < c['t1'] and c['style'] in ('slam', 'logo', 'title') for c in CAPS):
        a *= SCRIM
    if any(c['t0'] <= t < c['t1'] and c['style'] == 'lower' for c in CAPS):
        a *= LOWER_SCRIM
    # ---- fades / letterbox
    if t < 0.8: a *= t / 0.8
    if t > DUR - 1.2: a *= max(0, (DUR - t) / 1.2)
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    lb = 0
    if t < SEC['build']: lb = 120
    elif t >= SEC['outro']: lb = int(120 * min(1, (t - SEC['outro']) / 0.6))
    if lb:
        d = ImageDraw.Draw(out); d.rectangle((0, 0, W, lb), fill=0); d.rectangle((0, H - lb, W, H), fill=0)
    # ---- captions
    for c in CAPS:
        if c['t0'] <= t < c['t1']:
            draw_caption(out, c, t - c['t0'], c['t1'] - t, ca)
    return out


def draw_caption(out, c, age, left, ca):
    img = cap_img(c)
    anim = c['anim']; alpha = 1.0; scale = 1.0; dx = 0; dy = 0
    if anim == 'slam':
        scale = 1 + 0.45 * math.exp(-age / 0.045); alpha = min(1, age / 0.05 + 0.2)
    elif anim == 'track':
        scale = 0.94 + 0.08 * min(1, age / 3.0); alpha = min(1, age / 0.6) * min(1, left / 0.35)
    elif anim == 'slide':
        dx = -260 * math.exp(-age / 0.06); alpha = min(1, age / 0.06)
    elif anim == 'fade':
        alpha = min(1, age / 0.5)
    if left < 1.5 / FPS and anim in ('slam', 'slide'):
        alpha *= 0.6
    if abs(scale - 1) > 1e-3:
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.BILINEAR)
    if alpha < 1:
        a = img.split()[3].point(lambda v: int(v * alpha)); img = img.copy(); img.putalpha(a)
    pos = c['pos']
    if pos == 'center': x, y = (W - img.width) / 2, (H - img.height) / 2
    elif pos == 'lowerleft': x, y = 70, H - img.height - 110
    elif pos == 'left': x, y = 90, (H - img.height) / 2
    elif pos == 'cityleft': x, y = 60, H - img.height - 70
    elif pos == 'top': x, y = (W - img.width) / 2, 40
    elif pos == 'bottom': x, y = (W - img.width) / 2, H - img.height - 140
    elif pos == 'logo_up': x, y = (W - img.width) / 2, (H - img.height) / 2 - 70
    else: x, y = (W - img.width) / 2, (H - img.height) / 2
    x += dx + dy * 0
    if ca >= 4 and c['style'] in ('slam', 'logo', 'city'):   # RGB-split ghost on hits
        r = img.copy(); r.putalpha(img.split()[3].point(lambda v: int(v * 0.45)))
        out.paste((255, 40, 60), (int(x + ca), int(y)), r)
        out.paste((40, 200, 255), (int(x - ca), int(y)), r)
    out.paste(img, (int(x), int(y)), img)


def main():
    args = sys.argv[1:]
    f0, f1 = 0, NF
    name = 'bharatciv_trailer.mp4'
    if args and args[0] == '--preview':
        f0, f1 = int(float(args[1]) * FPS), int(float(args[2]) * FPS); name = 'preview.mp4'
    if args and args[0] == '--frames':
        for s in args[1:]:
            render_frame(int(float(s) * FPS)).save(os.path.join(OUT, 'f_%s.jpg' % s), quality=90)
        return
    out = os.path.join(OUT, name)
    cmd = [FFMPEG, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, H), '-r', str(FPS), '-i', '-',
           '-ss', str(f0 / FPS), '-i', os.path.join(OUT, 'music.wav'),
           '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p',
           '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for f in range(f0, f1):
        p.stdin.write(render_frame(f).tobytes())
        if f % 150 == 0:
            print('frame', f, '/', f1, flush=True)
    p.stdin.close(); p.wait()
    print('wrote', out)


if __name__ == '__main__':
    main()
