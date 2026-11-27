# BharatCiv: India as a Civilization map

A Civilization-style hex map of India built from real public data. Inspired by Andrej Karpathy's [USA Civ](https://karpathy.ai/usaciv/).

Every tile, yield, city district, wonder and advisor comes from real datasets, all placed on one 25 km hex grid. The grid uses an equal-area Lambert projection and has about 6,100 land tiles, inside India's official outline.

## What's in it

- **Terrain** comes from SRTM elevation and relief (hills and mountains) plus NASA POWER rainfall and temperature (desert, plains, grassland, tundra, snow). Forests go where it is wet and sparsely populated. Floodplains go on rivers in dry plains.
- **Yields:** Food = terrain + rivers + farm workforce. Production = hills/forest + power stations + mines + non-farm jobs. **Gold = GDP**: state GSDP split to districts by Census household-income brackets, then to tiles by town populations. Science = graduates + universities. Culture = World Heritage sites + national parks. Faith = pilgrimage sites.
- **469 cities** (100k+ people) each have a **City View**. Their Civ districts come from real specialisations: Campus, Industrial Zone, Harbor, Aerodrome, Holy Site, Theater Square, Artisan Quarter, Granary, Preserve and others. The **Citizens** section is the district's real workforce, compared with the national share.
- **Wonders:** UNESCO World Heritage sites, the 12 largest national parks, the NIRF 2024 top-10 institutions, and major pilgrimage sites of each faith.
- **25 lenses:** elevation, rainfall, temperature, population, food, production, GDP, science, income, literacy, degrees, internet, faith, tribal share, farm workforce, power, trade routes (railways), disasters (quakes + cyclones), sanitation, electricity, cars, sex ratio, women at work…
- **9 advisors** and an **Explorer**. The Explorer turns any of 50+ columns for 640 districts into a sortable table and a scatter plot, linked to the map, and can turn any column into a lens.

## Data sources

Census of India 2011 (district tables + DataMeet boundaries) · State GSDP (MoSPI via Wikipedia) · SRTM 90 m (OpenTopoData) · NASA POWER climatology · Natural Earth rivers · WRI Global Power Plant Database · DataMeet Indian Railways stations & trains · OurAirports · USGS earthquakes · NOAA IBTrACS cyclones · GeoNames · Wikidata (World Heritage, national parks, universities, ports, mines, dams) · NIRF 2024.

## Rebuild the data

```bash
pip install -r requirements.txt
# download raw sources into data/raw (see the URLs in scripts/*.py and the About dialog)
python scripts/fetch_extra.py   # Wikidata + NASA POWER
python scripts/grid.py          # hex grid + SRTM elevation (cached in data/work/elev.json)
python scripts/build.py         # writes public/data/*.json
```

The site itself is static: open `public/` with any web server.

## Caveats

- Census figures are from 2011, the latest full census. Districts follow 2011 boundaries, with Telangana and Ladakh split out for GDP.
- GDP below state level is a modelled estimate.
- Terrain is derived from climate and elevation, not from satellite land cover.
