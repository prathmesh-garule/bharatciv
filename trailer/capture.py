"""Record real site footage, frame by frame, for every shot in timeline.py.
Drives the actual app (public/) in headless Chromium; the camera is set per frame so moves are exact.
Run: python trailer/capture.py [shot_id ...]"""
import math, os, subprocess, sys, time, shutil
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from timeline import SHOTS, FPS, W, H

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FR = os.path.join(ROOT, 'trailer', 'frames')
PORT = 5191

HELPERS = r"""
window.__fit = S.cam.s;
const st = document.createElement('style');
st.textContent = `body.clean #top, body.clean #lenses, body.clean #legend, body.clean #panel {display:none!important}
 body.clean #map{top:0;height:100%} body.map #panel{display:none!important} #tooltip{display:none!important}
 body.map #map, body.full #map {top:50px}`;
document.head.appendChild(st);
window.setUI = ui => { document.body.className = ui; resize(); };
window.camTo = (lon, lat, z, panel) => {
  let best = 0, bd = 1e18;
  for (let i = 0; i < H.N; i++) { const d = (H.lon[i] - lon) ** 2 + (H.lat[i] - lat) ** 2; if (d < bd) { bd = d; best = i; } }
  S.cam.s = window.__fit * z; S.cam.x = H.x[best] + (panel ? 200 / S.cam.s : 0); S.cam.y = H.y[best];
};
window.camXY = (x, y, z) => { S.cam.s = window.__fit * z; S.cam.x = x; S.cam.y = y; };
window.ll2xy = (lon, lat) => { let best = 0, bd = 1e18;
  for (let i = 0; i < H.N; i++) { const d = (H.lon[i] - lon) ** 2 + (H.lat[i] - lat) ** 2; if (d < bd) { bd = d; best = i; } }
  return [H.x[best], H.y[best]]; };
window.reset = () => { document.getElementById('modal').classList.add('hidden'); document.getElementById('panel').classList.add('hidden'); S.sel = -1; S.highlight = null; S.hover = -1; };
window.openCity = n => { const c = CITIES.find(c => c.n === n); cityView(c); };
window.openAdvisors = () => document.getElementById('btnAdvisors').click();
window.openAdvisor = id => { const a = ADVISORS.find(x => x.id === id); openModal(`<h2>${a.face} ${a.name}</h2><a href="#" class="muted">← all advisors</a>` + a.fn()); };
window.openExplorer = () => { EX = { x: 'literacy', y: 'gdp_pc', sort: 'gdp_pc', asc: false, state: '', logy: true }; explorer(); S.exSel = D.codes[D.cols.name.indexOf('Bangalore')] || null; exRender(); };
window.customLens = () => { S.custom = { id: 'custom', label: 'women at work vs literacy', icon: '🧭', kind: 'district', col: 'pct_internet', scale: 'viridis', log: true, fmt: v => v, note: 'custom lens from Explorer' }; S.custom.label = '% internet'; setLens('custom'); };
"""


def ease(u, kind):
    if kind == 'out':
        return 1 - (1 - u) ** 3
    if kind == 'expo':
        return 1 if u >= 1 else 1 - 2 ** (-10 * u)
    return u * u * (3 - 2 * u)


def main(only):
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--directory', os.path.join(ROOT, 'public')],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as p:
            br = p.chromium.launch()
            pg = br.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
            pg.goto('http://localhost:%d/' % PORT)
            pg.wait_for_function('typeof H !== "undefined" && H && !document.getElementById("loading")', timeout=60000)
            pg.evaluate('document.fonts.ready')
            time.sleep(1.0)
            pg.evaluate(HELPERS)
            for sh in SHOTS:
                if only and sh['id'] not in only:
                    continue
                out = os.path.join(FR, sh['id'])
                shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
                pg.evaluate('reset()')
                pg.evaluate('setUI(%r)' % sh['ui'])
                if sh['lens'] != 'custom':
                    pg.evaluate('setLens(%r)' % sh['lens'])
                if sh['action']:
                    pg.evaluate(sh['action'])
                    time.sleep(0.25)
                n = max(1, round((sh['t1'] - sh['t0']) * FPS)) if not sh['still'] else 1
                # interpolate in projected space (straight camera paths)
                x0, y0 = pg.evaluate('ll2xy(%f,%f)' % sh['cam0'][:2]); x1, y1 = pg.evaluate('ll2xy(%f,%f)' % sh['cam1'][:2])
                fit = pg.evaluate('window.__fit')
                off = 200 if sh['panel'] else 0
                z0, z1 = sh['cam0'][2], sh['cam1'][2]
                for f in range(n):
                    u = ease(f / max(1, n - 1), sh['ease'])
                    z = math.exp(math.log(z0) + (math.log(z1) - math.log(z0)) * u)   # zoom in log space
                    x = x0 + (x1 - x0) * u + off / (fit * z); y = y0 + (y1 - y0) * u
                    pg.evaluate('camXY(%f,%f,%f); render()' % (x, y, z))
                    pg.screenshot(path=os.path.join(out, '%04d.jpg' % f), type='jpeg', quality=93)
                print(sh['id'], n, 'frames', flush=True)
            br.close()
    finally:
        srv.terminate()


if __name__ == '__main__':
    main(set(sys.argv[1:]))
