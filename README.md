# Public Housing Atlas

An interactive map of documented social-housing addresses. It started as a map of Milan's *case popolari* and is built so that **any town can be added without touching the code**: a town is just a folder with a few data files.

Live example: <https://socialmap.hd-apps.com/>

Features: clustering, satellite view, Street View links, neighbourhood outlines, "check a rental address" (distance to the nearest documented address), shareable links, CSV/GeoJSON export, mobile layout.

> **Documented locations, not a live census.** The map shows addresses that appear in public registers. Absence from the map never proves absence of social housing. Please keep that honesty in every town's texts.

---

## Contents

1. [Project layout](#project-layout)
2. [Run it locally](#run-it-locally)
3. [Publish it](#publish-it)
4. [Adding a town](#adding-a-town) ← start here to contribute
5. [Data format: `addresses.json`](#data-format-addressesjson)
6. [Configuration: `config.json`](#configuration-configjson)
7. [Optional extras](#optional-extras): study area, neighbourhood outlines, local basemap, about text
8. [The `city.py` helper](#the-citypy-helper)
9. [Checklist for pull requests](#checklist-for-pull-requests)
10. [How it works](#how-it-works) · [Scaling](#scaling) · [Troubleshooting](#troubleshooting) · [Credits & licences](#credits--licences)

---

## Project layout

```
index.html                 generic page shell (no city data in it)
site.json                  list of cities, default city, CARTO map key
assets/
  app.js  app.css          the application: city-agnostic
  vendor/                  Leaflet and Leaflet.markercluster (unmodified, with licences)
cities/
  milan/                   one folder per town
    config.json            names, texts, colours, sources, optional extras
    addresses.json         the data: one record per address
    ring.geojson           optional: the study-area outline
    about.html             optional: the "Sources & coverage" pop-up text
    milan-municipal-basemap.png   optional: offline fallback basemap image
  _template/               copied by `city.py new` (not shown on the site)
tools/city.py              helper: create a town, geocode a CSV, validate
.github/workflows/         runs the validator on every push / pull request
.nojekyll                  lets GitHub Pages serve the _template folder name
```

Each town is shown at `https://your-site/?city=<id>`, for example `?city=milan`. When more than one town is registered, a picker appears in the header automatically.

## Run it locally

Browsers will not let a page read its own data files from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

No build step, no `npm install`.

## Publish it

**GitHub Pages:** Settings → Pages → *Deploy from a branch* → `main` / root. The map key in `site.json` is already set up.

**Basemap key.** The map uses [CARTO](https://carto.com/basemaps/apikey/) tiles (free for non-commercial use, up to 5 M requests a month) and falls back to OpenStreetMap's own tile server, then to the town's local image if it has one. The CARTO key sits in `site.json` under `cartoKey`. It is public by design (it ships to every browser), so restrict it to your domain in CARTO's dashboard (*Restrict to specific websites*, `yourdomain.example`). Leave `cartoKey` empty to use OpenStreetMap tiles only. Heavy traffic on OpenStreetMap's server is against its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

---

## Adding a town

You need: Python 3.8+ (nothing to install) and a list of addresses. About 15 minutes for a small town, longer for the research.

### 1. Create the folder

```bash
python3 tools/city.py new turin --name Turin --country Italy
```

This copies `cities/_template/` to `cities/turin/` and adds Turin to `site.json`. The id (`turin`) is lower-case letters, digits and dashes; it goes in the URL.

### 2. Put your addresses in a CSV

Edit `cities/turin/source/addresses.csv`. The only required column is `address`. Everything else is optional:

| column | meaning |
|---|---|
| `address` | **required.** Street and number, as you would type it, e.g. `Via Roma 12` |
| `manager` | who runs it (housing company, council…). Becomes the colour and the filter chips |
| `area` | neighbourhood, used for the area filter |
| `district` | larger district / borough, shown in the popup |
| `source` | which source document it comes from; must match a `key` under `sources` in `config.json` (this is what makes the popup link work) |
| `page` | page in that document (adds `#page=N` to the link for PDFs) |
| `original` | the text exactly as it appears in the register: great for audits |
| `note` | anything a reader should know about this record |
| `lat`, `lon` | if you already have coordinates, add them and the address is not looked up |

Comma, semicolon and tab delimited files all work, as do common header names in other languages (`indirizzo`, `gestore`, `quartiere`, `municipio`…).

### 3. Turn it into `addresses.json` (geocoding)

```bash
python3 tools/city.py geocode cities/turin/source/addresses.csv --city turin --email you@example.org
```

For every row without coordinates this asks OpenStreetMap's free [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) service, one request per second (their rule; a thousand addresses take about 20 minutes). The script:

- identifies itself with your email (**please pass `--email`**: OSM asks for this),
- remembers results in `tools/.geocode-cache.json`, so re-runs are instant and polite,
- marks matches that found only the street, not the house number, as *"Geocoded street, approximate"*,
- writes rows it could not place to `addresses.problems.csv` next to your CSV. Fix them (or add exact `lat`/`lon`) and run again.

Nominatim is good but not perfect. **Look at the result on the map before publishing.** Better coordinates from an official source (a city's open "civic numbers" dataset, for example) beat geocoding; put them in the `lat`/`lon` columns.

Already have coordinates, or exported from a GIS? Write `addresses.json` yourself (see the [format](#data-format-addressesjson)), or save a GeoJSON file of **points** with an `address` property as `addresses.json`; both are accepted.

### 4. Describe the town

Edit `cities/turin/config.json`. The template gives you the minimum; every setting is explained in the [reference](#configuration-configjson). The ones that matter most:

- `managers`: names and colours (`key` must match the `manager` values in your data),
- `sources`: where the data comes from, with links,
- `title`, `intro`, `footnote`: what readers see.

Then write `cities/turin/about.html`, the "Sources & coverage" pop-up. Say what the sources are, what is excluded, how current they are. This is the most important text on the page.

### 5. Validate

```bash
python3 tools/city.py validate turin
```

It checks the JSON, coordinates (swapped lat/lon, `0,0`, points far from the rest), duplicates, unknown manager/source names, missing files, typos in `config.json` and leftover placeholder text. The same check runs automatically on every push and pull request, so a broken file is caught before it goes live.

### 6. Look at it

```bash
python3 -m http.server 8000
# open http://localhost:8000/?city=turin
```

Click around: a few popups, the source links, the address check, the filters, the phone layout (your browser's device mode).

### 7. Contribute it

Open a pull request with the new `cities/turin/` folder and the one-line change in `site.json`. See the [checklist](#checklist-for-pull-requests).

---

## Data format: `addresses.json`

A JSON list with one object per address. Only the first three fields are required.

```json
[
  {"address": "Via Roma 12", "lat": 45.0703, "lon": 7.6869, "manager": "ATC",
   "area": "Centro", "district": 1, "source": "ATC register 2024", "page": 3,
   "original": "ROMA, 12", "precision": "Civic address", "note": "Listed as 12-14; 12 shown"}
]
```

| field | type | notes |
|---|---|---|
| `address` | text | **required** |
| `lat`, `lon` | number | **required.** WGS84 decimal degrees, latitude first. Rows without valid coordinates are skipped (and counted in a notice) |
| `manager` | text | optional. Missing → one default colour called "Social housing" |
| `area` | text | optional. Enables the area filter. ALL-CAPS names are shown in Title Case |
| `district` | text or number | optional. Shown as "*District* N" (the word comes from `terms.district`) |
| `source` | text | matches a `sources[].key` in `config.json` to build the link |
| `page` | number | page of the source document |
| `url` | `http(s)://…` | a link for this one record; overrides the source link |
| `original` | text | original register entry |
| `precision` | text | e.g. "Civic address", "Approximate". Shown in the popup |
| `note` | text | free text, shown in the popup |
| `edge` | true / false | optional override of the "near boundary" flag (normally computed) |
| `id` | whole number | optional; unique. Used in share links. Generated from the row order if missing: **keep the row order stable** if you want old share links to keep working |

Any extra fields are kept and included in exports. All text is escaped before display, and only `http(s)` links are ever rendered.

## Configuration: `config.json`

Everything is optional except `id` and `name`. A town with only `{"id": "x", "name": "X"}` and an `addresses.json` already works.

**Identity and texts**

| key | default | meaning |
|---|---|---|
| `id` | – | must equal the folder name |
| `name` | – | display name; also used to complete address searches ("Via X" → "Via X, Name") |
| `country` | – | informational |
| `title`, `subtitle` | name, none | big heading, small text next to it |
| `pageTitle` | from title + name | browser tab title |
| `eyebrow` | "Name · A public housing atlas" | small line above the title |
| `introHeading`, `intro` | generic | text at the top of the sidebar |
| `footnote` | generic disclaimer | HTML allowed (`<b>`, `<a>`); scripts are stripped |
| `searchPlaceholder` | built from your areas | hint in the search box |
| `mapLabel` | "Interactive map of Name" | screen-reader label |
| `credits` | – | extra text appended to the credits line |
| `terms` | `{area, allAreas, district}` | words for your local terms, e.g. `{"area":"Neighbourhood / NIL","allAreas":"All neighbourhoods","district":"Municipio"}` |

**Data and look**

| key | default | meaning |
|---|---|---|
| `managers` | inferred from the data | `[{"key","label","color","caption"}]`. `key` matches the data; `label` is shown on chips and the legend; `caption` replaces "*label* managed" in the stats; `color` is a `#hex` (nice defaults otherwise). Managers present in the data but not listed get automatic colours |
| `sources` | – | `[{"key","label","url","pageAnchor"}]`; `pageAnchor: true` appends `#page=N` for PDFs |
| `map` | – | `{"center":[lat,lon],"zoom":13,"minZoom":9}`. By default the map fits the study area, or all the data |
| `labels` | – | `[{"name","lat","lon"}]`: neighbourhood names printed on the map |
| `checkRadii` | `[100,250,500]` | metres, for the address check |
| `listLimit` | `300` | most cards drawn in the sidebar (every dot is always on the map) |
| `geocoding` | see below | settings for the address check |
| `export.metadata` | – | any key/value pairs written into the GeoJSON download |
| `data`, `about` | `addresses.json`, `about.html` | different file names, if you like |

**Address check (`geocoding`)**

| key | default | meaning |
|---|---|---|
| `suffix` | `", " + name` | appended to searches that do not already mention the city |
| `countrycodes` | any | e.g. `"it"` or `"fr,be"`: restricts results to those countries |
| `bbox` | the data's extent + about 13 km | `[west, south, east, north]`: matches outside are ignored |
| `example` | first address | the placeholder in the box |

The same settings are used by `city.py geocode`.

---

## Optional extras

### Study area (a boundary)

If your data covers a defined zone ("inside the ring road", "the municipality"), give the town an outline:

```json
"studyArea": {
  "file": "boundary.geojson",
  "name": "the ring road",
  "edgeMeters": 100,
  "edgeLabel": "Near boundary",
  "edgeWarning": "Within 100 m of the approximate boundary. Check before treating this as inside."
}
```

What it does: draws the dashed outline and fits the map to it; marks addresses within `edgeMeters` of the edge (gold ring, "near edge" tag, popup warning, computed automatically); makes the address check say "outside the study area" instead of giving misleading numbers; adds the outline to the GeoJSON export.

**Drawing one:** open <https://geojson.io>, draw a polygon, copy the JSON, save it as `boundary.geojson`. Polygons and multi-polygons are fine; GeoJSON order is `[longitude, latitude]`. Without `studyArea` none of this appears and the town is simply shown as a cloud of points.

### Neighbourhood outlines (the "Areas" button)

```json
"areas": {
  "label": "Areas",
  "files": ["areas.geojson", "https://example.org/open-data/areas.geojson"],
  "nameProperty": "NAME",
  "attribution": "Area boundaries: City Council (CC BY 4.0)"
}
```

`files` are tried in order (relative paths are inside the town's folder). Prefer **committing a copy** to your repo (`areas.geojson`) over linking to a city portal: portals may block other websites from loading their files, change URLs, or go offline. Files in Web Mercator coordinates (very large numbers) are converted automatically. Area names are matched to your data's `area` values, ignoring case; hovering shows the name and the number of addresses, clicking filters the list to that area. Omit `areas` and the button is not shown.

*Milan:* the Comune's NIL boundaries are published as GeoJSON at <https://dati.comune.milano.it/en/dataset/ds964-nil-vigenti-pgt-2030>. The config tries a local `nil.geojson` first; download the GeoJSON from that page, save it as `cities/milan/nil.geojson`, and the button works regardless of the portal's settings.

### Local fallback basemap

```json
"fallbackBasemap": {
  "image": "basemap.png",
  "bounds": [[45.438, 9.14], [45.502, 9.224]],
  "attribution": "Basemap: City Council"
}
```

An image (placed in the town's folder) shown only if every online tile source fails. `bounds` is `[[south, west], [north, east]]`. Without it, readers just see a "tiles could not load" notice; dots and filters still work.

### The "Sources & coverage" pop-up

`about.html` is a fragment of plain HTML (headings, paragraphs, links). The page stylesheet already styles `<div class="eyebrow">`, `<h2>`, `<h3>`, `<p>` and `<div class="source">` blocks; copy the template. Scripts, event handlers and `javascript:` links are stripped. If the file is missing, a generic text with your `sources` list is shown instead.

---

## The `city.py` helper

```
python3 tools/city.py new <id> [--name N] [--title T] [--country C]
python3 tools/city.py geocode <csv> --city <id> [--email E] [--delay S] [--countrycodes cc]
                                    [--out file] [--no-cache] [--retry-missing] [--dry-run]
python3 tools/city.py validate [<id> ...] [--all] [--strict]
python3 tools/city.py list
```

- `validate` exits with an error code on problems (so CI can fail) and prints warnings for things worth a look. `--strict` makes warnings fail too.
- `geocode` is repeatable: edit the CSV and run again; cached lookups cost nothing. Use `--retry-missing` to re-ask about addresses that failed earlier, and `--dry-run` to preview.
- Set `NOMINATIM_URL` to use another Nominatim-compatible server (for large jobs, run your own or use a commercial geocoder and put the results into the CSV).

## Checklist for pull requests

- [ ] `python3 tools/city.py validate <id>` passes without errors
- [ ] Every record comes from a source named in `config.json`; `original` and `page` filled in where the source has them
- [ ] Street-level (approximate) matches were checked or fixed
- [ ] `about.html` says what the sources are, their dates, and what is **not** covered
- [ ] No personal data: addresses of buildings only, never residents, flat numbers or tenant names
- [ ] The data is public, and you may redistribute it (say under what licence in `credits` / `about.html`)
- [ ] Looked at it on the map, on desktop and on a phone

Reviewers: `about.html`, `footnote` and link URLs come from contributors. The app strips scripts and non-http links, but a human should still read them.

---

## How it works

1. `index.html` loads Leaflet, the clustering plugin and `assets/app.js`.
2. `app.js` reads `site.json`, picks the city from `?city=` (or the default), then loads that city's `config.json`, `addresses.json` and optional study-area file in parallel.
3. It validates and normalises the records (bad rows are skipped and counted), works out colours and counts, builds the sidebar, legend and filters from the config, and draws the map.
4. Everything the reader changes (view, filters, selected address, pin, layers) is written to the URL hash, which is what the **Share** button copies. The city is in the query string (`?city=`).

Basemaps are tried in order (CARTO → OpenStreetMap → the town's local image), moving on after three failed tiles. Satellite imagery is Esri World Imagery, loaded on demand.

**Privacy.** There is no server and no analytics. The only third parties contacted are the tile providers, Nominatim (only when someone uses the address check, and only the text they type), and Google Maps (only when someone clicks a Street View link).

## Scaling

- **Thousands of addresses per town** are fine: dots are drawn on a canvas, clustered, and popups are built on demand. The sidebar draws at most `listLimit` cards, and search is debounced.
- **Tens of thousands**: raise `listLimit` carefully, and consider splitting by district into separate towns, or moving the points into vector tiles.
- **Many towns**: each is loaded only when opened, so the number of towns costs nothing for readers. The city picker is a plain `<select>`; for dozens of cities, replace it with a landing page.
- **Different topic.** Nothing in `app.js` is specific to social housing apart from default wording; the terms can be changed in `config.json`.

## Troubleshooting

| symptom | cause / fix |
|---|---|
| "Could not load the map" on your computer | opened as a file; use `python3 -m http.server` |
| Blank map, dots visible | tiles blocked or key restricted to another domain; check the CARTO dashboard; the OSM fallback loads after three failed tiles |
| "Areas" says outlines could not be loaded | the portal blocks other sites, or the file is missing. Download the GeoJSON into the town folder (see above) |
| Addresses missing from the map | rows without valid `address`/`lat`/`lon` are skipped, and a notice says how many. `validate` lists them |
| Dots in the wrong place | swapped lat/lon, or a wrong geocoding match: `validate` flags points far from the rest |
| Old share links open the wrong address | record `id`s changed; keep row order stable or set explicit `id`s |
| `validate`: unknown key | a typo in `config.json`; the setting is ignored until fixed |
| Geocoding says "server busy" | OSM rate limit; the script waits and retries. Do not lower `--delay` below 1 |

## Credits & licences

- Map library: [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause) and [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) 1.5.3 (MIT), both in `assets/vendor/` with their licences.
- Basemap © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL), tiles by [CARTO](https://carto.com/attributions); satellite imagery © Esri and its data providers; address search by [Nominatim](https://nominatim.org).
- Each town's data has its own sources and licences: state them in that town's `config.json` / `about.html`.
- Choose a licence for the code and data in this repository (e.g. MIT for the code, CC BY 4.0 for original data compilations) and add a `LICENSE` file.
