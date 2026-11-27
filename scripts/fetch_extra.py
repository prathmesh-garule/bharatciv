"""Fetch climate (NASA POWER) and point features (Wikidata) for India.
Run: python -I scripts/fetch_extra.py  (writes into data/raw)"""
import json, time, os, sys, urllib.parse, urllib.request

RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'raw')
UA = {'User-Agent': 'india-civ-map/1.0 (open-data research)', 'Accept': 'application/sparql-results+json'}


def get(url, headers=UA, tries=3):
    # curl uses the OS cert store (this Python's bundled CA store is outdated)
    import subprocess
    args = ['curl', '-sSfL', '--max-time', '180']
    for k, v in headers.items():
        args += ['-H', '%s: %s' % (k, v)]
    for i in range(tries):
        try:
            return subprocess.run(args + [url], capture_output=True, check=True).stdout
        except Exception as e:  # retry with backoff
            print('  retry', i, e, file=sys.stderr)
            time.sleep(5 * (i + 1))
    raise RuntimeError('failed ' + url)


def power():
    out = {}
    for p in ['PRECTOTCORR', 'T2M']:
        cells = []
        for lon0 in range(66, 100, 10):
            for lat0 in range(6, 38, 10):
                url = ('https://power.larc.nasa.gov/api/temporal/climatology/regional?parameters=%s&community=AG'
                       '&longitude-min=%d&longitude-max=%d&latitude-min=%d&latitude-max=%d&format=json'
                       % (p, lon0, lon0 + 10, lat0, min(lat0 + 10, 38)))
                d = json.loads(get(url, {'User-Agent': UA['User-Agent']}))
                for f in d.get('features', []):
                    lon, lat = f['geometry']['coordinates'][:2]
                    cells.append([lon, lat, f['properties']['parameter'][p]['ANN']])
                print(p, lon0, lat0, len(cells))
        out[p] = cells
    json.dump(out, open(os.path.join(RAW, 'power_climate.json'), 'w'))


SPARQL = {
    'wd_parks': 'SELECT ?s ?sLabel ?coord ?area WHERE { ?s wdt:P31 wd:Q46169; wdt:P17 wd:Q668; wdt:P625 ?coord. OPTIONAL{?s wdt:P2046 ?area} SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }',
    'wd_tiger': 'SELECT ?s ?sLabel ?coord WHERE { ?s wdt:P31 wd:Q1365179; wdt:P17 wd:Q668; wdt:P625 ?coord. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }',
    'wd_univ': 'SELECT ?s ?sLabel ?coord ?students ?inception WHERE { ?s wdt:P31/wdt:P279* wd:Q3918; wdt:P17 wd:Q668; wdt:P625 ?coord. OPTIONAL{?s wdt:P2196 ?students} OPTIONAL{?s wdt:P571 ?inception} SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }',
    'wd_ports': 'SELECT ?s ?sLabel ?coord WHERE { ?s wdt:P31/wdt:P279* wd:Q44782; wdt:P17 wd:Q668; wdt:P625 ?coord. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }',
    'wd_mines': 'SELECT ?s ?sLabel ?coord ?prodLabel WHERE { ?s wdt:P31/wdt:P279* wd:Q820477; wdt:P17 wd:Q668; wdt:P625 ?coord. OPTIONAL{?s wdt:P1056 ?prod} SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }',
    'wd_dams': 'SELECT ?s ?sLabel ?coord WHERE { ?s wdt:P31 wd:Q12323; wdt:P17 wd:Q668; wdt:P625 ?coord. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }',
}


def wikidata():
    for name, q in SPARQL.items():
        url = 'https://query.wikidata.org/sparql?' + urllib.parse.urlencode({'query': q})
        d = json.loads(get(url))
        rows = d['results']['bindings']
        json.dump(rows, open(os.path.join(RAW, name + '.json'), 'w'))
        print(name, len(rows))
        time.sleep(2)


if __name__ == '__main__':
    which = sys.argv[1:] or ['wikidata', 'power']
    if 'wikidata' in which: wikidata()
    if 'power' in which: power()
