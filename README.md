# Social Housing in Europe

An interactive atlas of documented social-housing addresses, **city by city across Europe**. Milan (its *case popolari*) is the first city. Any other city can be added without touching the code: a city is just a folder with a few data files.

Live: <https://socialmap.hd-apps.com/>

Features: a Europe overview map of all cities, per-city maps with clustering, satellite view, Street View links, "check a rental address" (distance to the nearest documented address), shareable links, CSV/GeoJSON export, mobile layout.

> **Documented locations, not a live census.** The map shows addresses that appear in public registers. Absence from the map never proves absence of social housing. Please keep that honesty in every city's texts.

---

## Contents

1. [Project layout](#project-layout) and [how visitors navigate](#how-visitors-navigate)
2. [Run it locally](#run-it-locally)
3. [Publish it](#publish-it)
4. [Adding a city](#adding-a-city) ← start here to contribute
5. [Data format: `addresses.json`](#data-format-addressesjson)
6. [Configuration: `config.json`](#configuration-configjson)
7. [Optional extras](#optional-extras): study area, local basemap, about text
8. [The `city.py` helper](#the-citypy-helper)
9. [Research methodology](#research-methodology-version-1) and [Checklist for pull requests](#checklist-for-pull-requests)
10. [How it works](#how-it-works) · [Scaling](#scaling) · [Troubleshooting](#troubleshooting) · [Credits & licences](#credits--licences)

---

## Research methodology (version 1)

**Target: one marker represents one physical residential building with documented social housing.** It never represents one apartment, household, staircase, financing award or entire estate. Several entrances to one building are one entity; several detached buildings in one estate are separate entities only when evidence distinguishes them. Mixed-tenure buildings are eligible: the presence of social homes does not mean all homes are social housing.

### What is actually published today

The existing import mixes buildings, addresses, programmes and property assets. We must not relabel those as buildings without evidence. During migration every record carries an explicit `entity_type` and `verification_status`, shown on its card and in exports. The site counts **documented records** separately from **source-verified buildings**. Legacy entries remain discoverable but are not included in verified-building totals. The [complete entity audit](docs/entity-audit.md) and [record-level review queue](docs/entity-audit.json) track this work. “Source-verified” verifies identity against a published source, not current occupancy or exhaustive city coverage.

### The same research process for every city

1. **Define scope:** use the municipal boundary, with its source/version, and list every district and public/social housing provider. Record boundary changes and cross-border estates. Do not use arbitrary ring roads for citywide coverage. Commercial rentals, offices, community facilities and proposed developments are not existing social-housing buildings. Planned/demolished/former housing belongs in a separate research log until a lifecycle layer exists.
2. **Inventory sources:** first use municipal/regional housing registers and housing-provider GIS or inventories; then official asset registers, allocation documents and redevelopment reports. OpenStreetMap, aerial images and street imagery establish position or shape, never social-housing status. A general public-property register alone does not prove social tenure.
3. **Preserve evidence:** log publisher, URL, source identifier/page, publication/as-of date (unknown explicitly), retrieval date, licence/redistribution basis, query/filter and known exclusions. Preserve source IDs and a checksum where practical. Keep raw evidence outside published personal data; never publish tenants, individual-flat identifiers or residents. An access date is not the date of the housing stock.
4. **Extract candidates before mapping:** record the source’s actual unit: building, address, programme, property asset, estate or dwelling. Keep original wording and relationships. Public ownership or the word “residential” is insufficient without housing evidence. Never create one marker per listed dwelling. Never sum different programme awards as unique homes without reconciliation.
5. **Resolve buildings:** prefer a stable official building ID/footprint; otherwise require explicit single-building evidence and an unambiguous address match. Preserve multiple addresses, sources and providers as relationships rather than multiplying buildings. Split estates only with building-level evidence. Ambiguous candidates stay in `cities/<id>/source/` with a reason and next action.
6. **Locate honestly:** prefer a point inside a verified building footprint (check centroids of concave shapes); a matched civic entrance is acceptable when building identity is independently established. Store `coordinate_method` and coordinate source separately from housing evidence. Street centres, postcode/neighbourhood centres and fuzzy number matches are not acceptable for new published buildings. Do not move a point onto the nearest rooftop without evidence. Do not add random offsets to separate overlapping points.
7. **Deduplicate by identity:** compare building IDs, source IDs, address aliases, footprints and date. Same coordinates can represent a shared geocoder point; different coordinates can be entrances of one building. Neither condition alone proves a duplicate. Retain the evidence and stable share-link IDs when merging; document redirects/retired IDs before removing existing records.
8. **Verify and release:** run both validators below; inspect every new/changed building against its source, boundary and position. Record reviewer/date and uncertainties. Compare counts to source totals using the same unit and date. Publish city/provider/district coverage and outstanding research; never describe a subset as complete. Repeat source review at least annually and when a register changes, recording removals and changes rather than silently overwriting history.

### Shared record contract

All cities use the same fields; unknown values must remain unknown.

| Field | Meaning |
|---|---|
| `record_uid`, `id` | Stable `<city>:<id>` identity and numeric share-link ID. Do not regenerate on sorting. |
| `methodology_version` | `1` for this contract. |
| `entity_type` | `building`, or legacy `address`, `programme`, `property_asset`. |
| `verification_status` | `source_verified` for a documented single building; `legacy_review_required` for imports awaiting individual review. All **new** mapped records must be source-verified buildings. |
| `building_ref` | Stable, namespaced building identity; required for verified buildings. Never an apartment count. |
| `source`, `source_record_id`, `page`, `original` | Traceable housing evidence, with the source key linked in the city config. |
| `source_as_of`, `reviewed_on`, `verification_note` | Evidence date (nullable), actual verification date and how identity was checked. Source dates must not be invented. |
| `coordinate_method`, `coordinate_source`, `precision` | Machine-readable method, evidence URL and human-readable positional limitation. Legacy programme/asset/street points are explicitly distinguished. |
| `tenure_scope` | `unknown`, `all_social_reported` or `mixed_reported`. Public ownership alone does not establish tenure share. |
| `homes` | Optional sourced social-dwelling count and date in the evidence; never used as a cluster weight or building count. |
| `manager`, `area`, `district` | Provider and administrative context. Unknown district assignments remain blank until matched to official boundaries. |

Cluster numbers count displayed **records**, not apartments or verified buildings. Until legacy migration finishes, comparisons of raw city totals are not comparable building-stock statistics. Address-check distance describes proximity to published points and their positional accuracy; it is not a measure of crime, safety or neighbourhood quality.

### Required audit and contribution gate

```bash
python3 tools/city.py validate --all
python3 tools/audit_data.py --write
```

Include the updated audit, city source/research log, coverage text and index in each data PR. The structural audit checks every row and lists collision candidates; it does not replace source review. Existing legacy records are grandfathered explicitly, not silently certified. New unresolved candidates must remain unpublished. To refresh the audit without writing files, omit `--write`.

## Project layout

```
index.html                 generic page shell (no city data in it)
site.json                  site title and texts, the list of cities, CARTO map key
assets/
  app.js  app.css          the application: city-agnostic
  vendor/                  Leaflet and Leaflet.markercluster (unmodified, with licences)
cities/
  milan/                   one folder per city
    config.json            names, texts, sources, optional extras
    addresses.json         the data: one record per address
    ring.geojson           optional: the study-area outline
    about.html             optional: the "Sources & coverage" pop-up text
    milan-municipal-basemap.png   optional: offline fallback basemap image
  _template/               copied by `city.py new` (not shown on the site)
tools/city.py              helper: create a city, geocode a CSV, validate
.github/workflows/         runs the validator on every push / pull request
.nojekyll                  lets GitHub Pages serve the _template folder name
```

### How visitors navigate

- **One city registered:** the site opens straight onto that city.
- **Two or more cities:** the site opens on the **Europe overview**, a map with one bubble per city (sized by number of addresses) and a list. Clicking a bubble or a list entry opens that city, and a picker in the header (with an "All cities" entry) switches between them.
- Direct links: `?city=<id>` opens a city (e.g. `?city=milan`); `?view=overview` opens the overview. The map position, filters and so on live in the part after `#`, which is what the **Share** button copies.
- To make the site open on one particular city instead of the overview, add `"defaultCity": "milan"` to `site.json`.

### `site.json`

```json
{
  "title": "Social housing in Europe",
  "eyebrow": "Europe · A social housing atlas",
  "intro": "Documented social-housing addresses, city by city…",
  "repo": "https://github.com/you/your-repo",
  "cartoKey": "…",
  "cities": [
    { "id": "milan", "name": "Milan", "country": "Italy", "center": [45.4639, 9.1844], "count": 129 }
  ]
}
```

`title`, `eyebrow`, `intro` and `footnote` (HTML allowed) are the site-wide branding; `repo` adds an "Add your city" link on the overview. For each city, `country`, `center` and `count` place its bubble on the overview map. **You do not edit those by hand**: `python3 tools/city.py index` fills them in from the city's own files (and `geocode` does it for you).

## Run it locally

Browsers will not let a page read its own data files from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

No build step, no `npm install`.

## Publish it

**GitHub Pages:** Settings → Pages → *Deploy from a branch* → `main` / root. The map key in `site.json` is already set up.

**Basemap key.** The map uses [CARTO](https://carto.com/basemaps/apikey/) tiles (free for non-commercial use, up to 5 M requests a month) and falls back to OpenStreetMap's own tile server, then to the city's local image if it has one. The CARTO key sits in `site.json` under `cartoKey`. It is public by design (it ships to every browser), so restrict it to your domain in CARTO's dashboard (*Restrict to specific websites*, `yourdomain.example`). Leave `cartoKey` empty to use OpenStreetMap tiles only. Heavy traffic on OpenStreetMap's server is against its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

---

## Adding a city

Start with the research methodology above. A list of addresses alone is not a verified building inventory; research and building resolution take as long as the sources require.

### 1. Create the folder

```bash
python3 tools/city.py new turin --name Turin --country Italy
```

This copies `cities/_template/` to `cities/turin/` and adds Turin to `site.json`. Once the site has two cities, visitors land on the Europe overview and Turin appears on it, with no other change needed. The id (`turin`) is lower-case letters, digits and dashes; it goes in the URL.

### 2. Put your addresses in a CSV

Edit `cities/turin/source/addresses.csv`. The geocoder requires `address`. The following columns support candidate preparation; the result still needs methodology metadata and building verification before publication:

| column | meaning |
|---|---|
| `address` | **required.** Street and number, as you would type it, e.g. `Via Roma 12` |
| `manager` | who runs it (housing company, council…). Shown on each location card and retained in exports |
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

### 4. Describe the city

Edit `cities/turin/config.json`. The template gives you the minimum; every setting is explained in the [reference](#configuration-configjson). The ones that matter most:

- `country` (shown in the header and on the overview),
- `sources`: where the data comes from, with links,
- `introHeading`, `intro`, `footnote`: what readers see.

Then write `cities/turin/about.html`, the "Sources & coverage" pop-up. Say what the sources are, what is excluded, how current they are. This is the most important text on the page.

### 5. Validate

```bash
python3 tools/city.py validate turin
python3 tools/city.py index        # only needed if you edited addresses by hand: refreshes Turin's bubble on the overview
```

`validate` checks the JSON, coordinates (swapped lat/lon, `0,0`, points far from the rest), duplicates, unknown manager/source names, missing files, typos in `config.json` and leftover placeholder text. The same check runs automatically on every push and pull request, so a broken file is caught before it goes live.

### 6. Look at it

```bash
python3 -m http.server 8000
# open http://localhost:8000/?city=turin
```

Click around: a few popups, the source links, the address check, the filters, the phone layout (your browser's device mode).

### 7. Contribute it

Open a pull request with the new `cities/turin/` folder and the updated `site.json`. See the [checklist](#checklist-for-pull-requests).

---

## Data format: `addresses.json`

A JSON list with one object per mapped entity. The renderer requires address and coordinates; publication also requires the methodology fields above. Legacy examples below show the renderer format, not a sufficient publication record.

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
| `manager` | text | optional. Missing → `Social housing`; shown on location cards and retained in exports |
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

Everything is optional except `id` and `name`. The site title and the small line above it are site-wide (`site.json`), not per city. A city with only `{"id": "x", "name": "X"}` and an `addresses.json` already works.

**Identity and texts**

| key | default | meaning |
|---|---|---|
| `id` | – | must equal the folder name |
| `name` | – | display name, shown next to the site title; also used to complete address searches ("Via X" → "Via X, Name") |
| `country` | – | shown next to the name and on the overview |
| `introHeading`, `intro` | "Social housing in *Name*." and a generic sentence | text at the top of the sidebar |
| `footnote` | generic disclaimer | HTML allowed (`<b>`, `<a>`); scripts are stripped |
| `searchPlaceholder` | built from your areas | hint in the search box |
| `mapLabel` | "Interactive map of Name" | screen-reader label |
| `credits` | – | extra text appended to the credits line |
| `terms` | `{area, allAreas, district}` | words for your local terms, e.g. `{"area":"Neighbourhood / NIL","allAreas":"All neighbourhoods","district":"Municipio"}` |

**Data and look**

| key | default | meaning |
|---|---|---|
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

If your data covers a defined zone ("inside the ring road", "the municipality"), give the city an outline:

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

**Drawing one:** open <https://geojson.io>, draw a polygon, copy the JSON, save it as `boundary.geojson`. Polygons and multi-polygons are fine; GeoJSON order is `[longitude, latitude]`. Without `studyArea` none of this appears and the city is simply shown as a cloud of points.

### Local fallback basemap

```json
"fallbackBasemap": {
  "image": "basemap.png",
  "bounds": [[45.438, 9.14], [45.502, 9.224]],
  "attribution": "Basemap: City Council"
}
```

An image (placed in the city's folder) shown only if every online tile source fails. `bounds` is `[[south, west], [north, east]]`. Without it, readers just see a "tiles could not load" notice; dots and filters still work.

### The "Sources & coverage" pop-up

`about.html` is a fragment of plain HTML (headings, paragraphs, links). The page stylesheet already styles `<div class="eyebrow">`, `<h2>`, `<h3>`, `<p>` and `<div class="source">` blocks; copy the template. Scripts, event handlers and `javascript:` links are stripped. If the file is missing, a generic text with your `sources` list is shown instead.

---

## The `city.py` helper

```
python3 tools/city.py new <id> [--name N] [--title T] [--country C]
python3 tools/city.py geocode <csv> --city <id> [--email E] [--delay S] [--countrycodes cc]
                                    [--out file] [--no-cache] [--retry-missing] [--dry-run]
python3 tools/city.py validate [<id> ...] [--all] [--strict]
python3 tools/city.py index                       # refresh country / position / count in site.json
python3 tools/city.py list
```

- `validate` exits with an error code on problems (so CI can fail) and prints warnings for things worth a look. `--strict` makes warnings fail too.
- `geocode` is repeatable: edit the CSV and run again; cached lookups cost nothing. Use `--retry-missing` to re-ask about addresses that failed earlier, and `--dry-run` to preview.
- Set `NOMINATIM_URL` to use another Nominatim-compatible server (for large jobs, run your own or use a commercial geocoder and put the results into the CSV).

## Checklist for pull requests

- [ ] `python3 tools/city.py validate <id>` and `python3 tools/audit_data.py` pass without errors
- [ ] New mapped entries are individually evidenced buildings, not raw geocoder or programme rows; source and position evidence are recorded
- [ ] Updated the audit and city research log; stable IDs preserved
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
2. `app.js` reads `site.json`. With no `?city=` and two or more cities it draws the Europe overview; otherwise it picks the city and loads that city's `config.json`, `addresses.json` and optional study-area file in parallel.
3. It validates and normalises the records (bad rows are skipped and counted), works out the citywide count, builds the sidebar and area filter from the config, and draws the map. Provider information remains on individual location cards.
4. Everything the reader changes (view, filters, selected address, pin, layers) is written to the URL hash, which is what the **Share** button copies. The city is in the query string (`?city=`).

Basemaps are tried in order (CARTO → OpenStreetMap → the city's local image), moving on after three failed tiles. Satellite imagery is Esri World Imagery, loaded on demand.

**Privacy.** There is no server of our own, no ads and no cookies. The site uses PostHog (EU Cloud) for anonymous, cookie-free usage statistics: page views and a handful of button clicks (data downloads, city choice, Support, Share, Sources, and that the address check was used). Nothing a visitor types is sent to PostHog, session recording and surveys are off, no profiles are created, IP addresses are discarded, and Do Not Track is honoured. The other third parties contacted are the tile providers, Nominatim (only when someone uses the address check, and only the text they type), and Google Maps (only when someone clicks a Street View link).

## Scaling

- **Thousands of addresses per city** are fine: dots are drawn on a canvas, clustered, and popups are built on demand. The sidebar draws at most `listLimit` cards, and search is debounced.
- **Tens of thousands**: raise `listLimit` carefully, and consider splitting by district into separate cities, or moving the points into vector tiles.
- **Many cities**: each is loaded only when opened, so the number of cities costs nothing for readers; the overview reads only `site.json`. The picker is a plain `<select>`, fine for dozens of cities.
- **Different topic.** Nothing in `app.js` is specific to social housing apart from default wording; the terms can be changed in `config.json`.

## Troubleshooting

| symptom | cause / fix |
|---|---|
| "Could not load the map" on your computer | opened as a file; use `python3 -m http.server` |
| Blank map, dots visible | tiles blocked or key restricted to another domain; check the CARTO dashboard; the OSM fallback loads after three failed tiles |
| Addresses missing from the map | rows without valid `address`/`lat`/`lon` are skipped, and a notice says how many. `validate` lists them |
| Dots in the wrong place | swapped lat/lon, or a wrong geocoding match: `validate` flags points far from the rest |
| Old share links open the wrong address | record `id`s changed; keep row order stable or set explicit `id`s |
| `validate`: unknown or "no longer used" key | a typo, or a setting from an older version; it is ignored until fixed |
| A city is missing from the overview map | its entry in `site.json` has no `center`: run `python3 tools/city.py index` |
| Geocoding says "server busy" | OSM rate limit; the script waits and retries. Do not lower `--delay` below 1 |

## Credits & licences

- Map library: [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause) and [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) 1.5.3 (MIT), both in `assets/vendor/` with their licences.
- Basemap © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL), tiles by [CARTO](https://carto.com/attributions); satellite imagery © Esri and its data providers; address search by [Nominatim](https://nominatim.org).
- Each city's data has its own sources and licences: state them in that city's `config.json` / `about.html`.
- Choose a licence for the code and data in this repository (e.g. MIT for the code, CC BY 4.0 for original data compilations) and add a `LICENSE` file.

## Support the project

This map is free, ad-free and cookie-free. If it is useful to you, you can help cover hosting and research time:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-donate-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/pechen)

| Method | Address |
|---|---|
| Lightning address | `trustless@pay.hd-apps.com` |
| Bitcoin on-chain | `bc1q835gw6aqf6jmgs5pja5xf5xzcp76w75cqfvek6` |

QR codes and copy buttons: <https://socialmap.hd-apps.com/donate.html>
