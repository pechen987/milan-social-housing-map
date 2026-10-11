#!/usr/bin/env python3
"""Helper for adding and checking cities.  Standard library only (Python 3.8+).

  python3 tools/city.py new turin --name Turin       create cities/turin/ from the template and register it
  python3 tools/city.py geocode cities/turin/source/addresses.csv --city turin --email you@example.org
                                                     turn a CSV of addresses into cities/turin/addresses.json
  python3 tools/city.py validate turin               check one city   (or: validate --all)
  python3 tools/city.py index                        refresh each city's position and address count in site.json
  python3 tools/city.py list                         show the registered cities

See README.md, section "Adding a city".
"""
import argparse
import csv
import json
import math
import os
import re
import shutil
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CITIES = ROOT / "cities"
SITE = ROOT / "site.json"
TEMPLATE = CITIES / "_template"
CACHE = Path(__file__).resolve().parent / ".geocode-cache.json"
NOMINATIM = os.environ.get("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search")
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

KNOWN_CONFIG_KEYS = {
    "id", "name", "country", "data", "about", "credits",
    "introHeading", "intro", "mapLabel", "searchPlaceholder", "footnote",
    "terms", "managers", "sources", "map", "studyArea", "labels", "fallbackBasemap", "geocoding", "export",
    "checkRadii", "listLimit", "coverageWarnMeters",
}

# settings that existed in earlier versions: tell people what to do instead of just "unknown key"
REMOVED_KEYS = {
    "title": "the page title is site-wide now (site.json 'title'); use 'introHeading' for the sidebar heading",
    "subtitle": "use 'introHeading' / 'intro' instead",
    "pageTitle": "the browser title is built from the city name and site.json 'title'",
    "eyebrow": "set it once for the whole site in site.json",
    "areas": "the neighbourhood-outline feature was removed (the area filter still works from your data)",
}

# CSV header -> field name (lower-case, accents not handled on purpose: keep it predictable)
HEADER_ALIASES = {
    "address": "address", "indirizzo": "address", "street": "address", "adresse": "address", "direccion": "address",
    "manager": "manager", "gestore": "manager", "operator": "manager", "owner": "manager", "landlord": "manager",
    "area": "area", "neighbourhood": "area", "neighborhood": "area", "quartiere": "area", "nil": "area", "zone": "area",
    "district": "district", "municipio": "district", "borough": "district", "arrondissement": "district",
    "lat": "lat", "latitude": "lat", "y": "lat",
    "lon": "lon", "lng": "lon", "long": "lon", "longitude": "lon", "x": "lon",
    "source": "source", "fonte": "source", "page": "page", "pagina": "page",
    "original": "original", "note": "note", "notes": "note", "precision": "precision", "url": "url", "id": "id",
}


# ----------------------------------------------------------------------------- helpers
def die(msg, code=1):
    print("error: " + msg, file=sys.stderr)
    sys.exit(code)


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def write_records(path, records):
    """One record per line: compact, and git diffs stay readable."""
    with open(path, "w", encoding="utf-8") as f:
        f.write("[\n" + ",\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n]\n")


def city_dir(city_id):
    d = CITIES / city_id
    if not d.is_dir():
        die("no folder cities/%s (try: python3 tools/city.py list)" % city_id)
    return d


def num(v):
    try:
        x = float(str(v).strip().replace(",", "."))
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def in_ring(ring, lat, lon):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def polygons_of(gj):
    feats = gj.get("features") if gj.get("type") == "FeatureCollection" else [gj] if gj.get("type") == "Feature" else [{"geometry": gj}]
    polys = []
    for f in feats:
        g = (f or {}).get("geometry") or {}
        if g.get("type") == "Polygon":
            polys.append(g["coordinates"])
        elif g.get("type") == "MultiPolygon":
            polys.extend(g["coordinates"])
    return polys


def load_site():
    if not SITE.exists():
        die("site.json not found at %s" % SITE)
    return read_json(SITE)


# ----------------------------------------------------------------------------- new
def cmd_new(a):
    cid = a.id.strip().lower()
    if not ID_RE.match(cid):
        die("city id must be lower-case letters, digits and dashes (e.g. 'turin' or 'new-york'), got %r" % a.id)
    if cid.startswith("_"):
        die("city ids cannot start with an underscore")
    dest = CITIES / cid
    if dest.exists():
        die("cities/%s already exists" % cid)
    if not TEMPLATE.is_dir():
        die("template folder cities/_template is missing")
    name = a.name or cid.replace("-", " ").title()
    shutil.copytree(TEMPLATE, dest)

    cfg = read_json(dest / "config.json")
    cfg["id"], cfg["name"] = cid, name
    if a.country:
        cfg["country"] = a.country
    cfg.setdefault("geocoding", {})["suffix"] = ", " + name
    write_json(dest / "config.json", cfg)
    write_records(dest / "addresses.json", [])

    site = load_site()
    if not any(c.get("id") == cid for c in site.get("cities", [])):
        site.setdefault("cities", []).append({"id": cid, "name": name})
        write_json(SITE, site)

    print("Created cities/%s/ and registered it in site.json.\n" % cid)
    print("Next:")
    print("  1. Put your addresses in cities/%s/source/addresses.csv (see the example rows there)." % cid)
    print("  2. python3 tools/city.py geocode cities/%s/source/addresses.csv --city %s --email YOU@EXAMPLE.ORG" % (cid, cid))
    print("  3. Edit cities/%s/config.json (managers, sources, texts) and cities/%s/about.html." % (cid, cid))
    print("  4. python3 tools/city.py validate %s" % cid)
    print("  5. python3 -m http.server 8000   and open  http://localhost:8000/?city=%s" % cid)


# ----------------------------------------------------------------------------- index
def city_facts(cid):
    """(country, [lat, lon] median, count) for a city folder; tolerant of missing/broken files."""
    d = CITIES / cid
    country, center, count = None, None, None
    try:
        cfg = read_json(d / "config.json")
        country = cfg.get("country")
        raw = read_json(d / (cfg.get("data") or "addresses.json"))
        if isinstance(raw, dict) and raw.get("type") == "FeatureCollection":
            pts = [(f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0]) for f in raw.get("features", [])
                   if (f.get("geometry") or {}).get("type") == "Point" and (f.get("properties") or {}).get("address")]
        else:
            pts = [(num(r.get("lat")), num(r.get("lon", r.get("lng")))) for r in raw if isinstance(r, dict) and r.get("address")]
        pts = [(a, b) for a, b in pts if a is not None and b is not None and not (a == 0 and b == 0)]
        if pts:
            count = len(pts)
            center = [round(statistics.median(p[0] for p in pts), 4), round(statistics.median(p[1] for p in pts), 4)]
    except (OSError, ValueError, KeyError, TypeError, IndexError, AttributeError):
        pass
    return country, center, count


def update_index(only=None, quiet=False):
    """Refresh country / center / count of the cities in site.json (used by the Europe overview map)."""
    site = load_site()
    changed = False
    order = ["id", "name", "country", "center", "count"]
    for c in site.get("cities", []):
        if only and c.get("id") != only:
            continue
        country, center, count = city_facts(c["id"])
        want = dict(c)
        if country:
            want["country"] = country
        if center:
            want["center"] = center
        if count is not None:
            want["count"] = count
        want = dict([(k, want[k]) for k in order if k in want] + [(k, v) for k, v in want.items() if k not in order])
        if want != c:
            c.clear()
            c.update(want)
            changed = True
            if not quiet:
                print("  site.json: updated %s (%s addresses)" % (c["id"], c.get("count", "?")))
    if changed:
        write_json(SITE, site)
    return changed


def cmd_index(_):
    if not update_index():
        print("site.json is already up to date.")


# ----------------------------------------------------------------------------- geocode
def load_cache():
    try:
        return read_json(CACHE)
    except (OSError, ValueError):
        return {}


def save_cache(cache):
    try:
        write_json(CACHE, cache)
    except OSError:
        pass


def nominatim(query, cfg_geo, email, country_override=None):
    """Return a list of Nominatim results (dicts). Retries politely on 429/5xx."""
    params = {"q": query, "format": "jsonv2", "limit": "3", "addressdetails": "1", "accept-language": "en"}
    cc = country_override or cfg_geo.get("countrycodes")
    if cc:
        params["countrycodes"] = cc
    bbox = cfg_geo.get("bbox")
    if bbox and len(bbox) == 4:
        w, s, e, n = bbox
        params["viewbox"] = "%s,%s,%s,%s" % (w, n, e, s)
        params["bounded"] = "0"
    url = NOMINATIM + ("&" if "?" in NOMINATIM else "?") + urllib.parse.urlencode(params)
    ua = "housing-atlas-city-tool/1.0" + (" (contact: %s)" % email if email else "")
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503, 504) and attempt < 3:
                wait = 30 * (attempt + 1)
                print("  server busy (HTTP %d), waiting %ds…" % (e.code, wait), file=sys.stderr)
                time.sleep(wait)
                continue
            raise
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(5)
                continue
            raise
    return []


def read_csv_rows(path):
    raw = Path(path).read_text(encoding="utf-8-sig")
    try:
        dialect = csv.Sniffer().sniff(raw[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(raw.splitlines(), dialect=dialect)
    rows = []
    for r in reader:
        row = {}
        for k, v in r.items():
            if k is None:
                continue
            key = HEADER_ALIASES.get(k.strip().lower(), k.strip())
            if key and v is not None and str(v).strip() != "":
                row[key] = str(v).strip()
        rows.append(row)
    return rows


def cmd_geocode(a):
    d = city_dir(a.city)
    cfg = read_json(d / "config.json") if (d / "config.json").exists() else {}
    geo = cfg.get("geocoding", {})
    name = cfg.get("name", a.city)
    suffix = geo.get("suffix", ", " + name)
    if not a.email and "NOMINATIM_URL" not in os.environ:
        print("note: please pass --email so the OpenStreetMap operators can contact you if your script misbehaves.\n", file=sys.stderr)

    rows = read_csv_rows(a.csv)
    if not rows:
        die("no rows found in %s" % a.csv)
    if not any("address" in r for r in rows):
        die("the CSV needs an 'address' column (found: %s)" % ", ".join(sorted({k for r in rows for k in r})))

    cache = {} if a.no_cache else load_cache()
    records, problems = [], []
    stats = {"given": 0, "geocoded": 0, "approx": 0, "failed": 0}
    last_request = 0.0
    bbox = geo.get("bbox")

    for i, r in enumerate(rows):
        addr = r.get("address", "").strip()
        if not addr:
            continue
        rec = {k: v for k, v in r.items() if k not in ("lat", "lon")}
        for k in ("page", "district", "id"):
            if k in rec and re.fullmatch(r"\d+", rec[k]):
                rec[k] = int(rec[k])
        lat, lon = num(r.get("lat")), num(r.get("lon"))
        if lat is not None and lon is not None:
            rec["lat"], rec["lon"] = lat, lon
            stats["given"] += 1
            records.append(rec)
            continue

        query = addr if (suffix and name.lower() in addr.lower()) else addr + suffix
        key = query.lower()
        hit = cache.get(key, "missing")
        if hit == "missing" or (hit is None and a.retry_missing):
            wait = a.delay - (time.time() - last_request)
            if wait > 0:
                time.sleep(wait)
            try:
                results = nominatim(query, geo, a.email, a.countrycodes)
            except Exception as e:  # network trouble: report and keep going, do not cache
                problems.append(dict(r, problem="lookup failed: %s" % e))
                stats["failed"] += 1
                print("  ✗ %s  (lookup failed: %s)" % (addr, e))
                last_request = time.time()
                continue
            last_request = time.time()
            hit = None
            for res in results:
                rl, ro = num(res.get("lat")), num(res.get("lon"))
                if rl is None or ro is None:
                    continue
                if bbox and len(bbox) == 4 and not (bbox[0] <= ro <= bbox[2] and bbox[1] <= rl <= bbox[3]):
                    continue
                hit = {"lat": rl, "lon": ro, "house": bool((res.get("address") or {}).get("house_number")), "display": res.get("display_name", "")}
                break
            cache[key] = hit
            if not a.no_cache:
                save_cache(cache)
        if not hit:
            problems.append(dict(r, problem="no match inside the city area"))
            stats["failed"] += 1
            print("  ✗ %s  (no match)" % addr)
            continue
        rec["lat"], rec["lon"] = round(hit["lat"], 6), round(hit["lon"], 6)
        if "precision" not in rec:
            rec["precision"] = "Geocoded address (OpenStreetMap)" if hit["house"] else "Geocoded street, approximate (OpenStreetMap)"
        stats["geocoded"] += 1
        if not hit["house"]:
            stats["approx"] += 1
        records.append(rec)

    out = Path(a.out) if a.out else d / "addresses.json"
    if a.dry_run:
        print("\n(dry run: nothing written)")
    else:
        write_records(out, records)
        print("\nWrote %d records to %s" % (len(records), out))
    if problems:
        pfile = Path(a.csv).with_suffix(".problems.csv")
        cols = sorted({k for p in problems for k in p})
        if not a.dry_run:
            with open(pfile, "w", encoding="utf-8-sig", newline="") as f:
                w = csv.DictWriter(f, fieldnames=cols)
                w.writeheader()
                w.writerows(problems)
            print("%d rows need attention → %s" % (len(problems), pfile))
    print("Summary: %(given)d had coordinates · %(geocoded)d geocoded (%(approx)d street-level only) · %(failed)d failed" % stats)
    if stats["approx"]:
        print("Street-level matches are approximate: check them on the map, or add exact lat/lon in the CSV and re-run.")
    if records and not a.dry_run and not a.out:
        update_index(a.city)
    if records:
        print("Next: python3 tools/city.py validate %s" % a.city)


# ----------------------------------------------------------------------------- validate
class Report:
    def __init__(self, label):
        self.label, self.errors, self.warnings = label, [], []

    def err(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)

    def show(self, limit=15):
        status = "FAIL" if self.errors else ("ok (with warnings)" if self.warnings else "ok")
        print("[%s] %s" % (self.label, status))
        for tag, items in (("ERROR", self.errors), ("warn ", self.warnings)):
            for m in items[:limit]:
                print("   %s  %s" % (tag, m))
            if len(items) > limit:
                print("   %s  … and %d more" % (tag, len(items) - limit))


def check_city(cid, site):
    rep = Report(cid)
    d = CITIES / cid
    if not d.is_dir():
        rep.err("folder cities/%s does not exist" % cid)
        return rep
    registered = {c.get("id") for c in site.get("cities", [])}
    entry = next((c for c in site.get("cities", []) if c.get("id") == cid), None)
    if entry is not None:
        _, center, count = city_facts(cid)
        if count is not None and (entry.get("count") != count or entry.get("center") != center):
            rep.warn("site.json has an outdated position/count for this city: run  python3 tools/city.py index")
    if cid not in registered:
        rep.warn("not listed in site.json, so it will not appear in the city picker (it still works at ?city=%s)" % cid)

    # --- config
    cfg_path = d / "config.json"
    if not cfg_path.exists():
        rep.err("config.json is missing")
        return rep
    try:
        cfg = read_json(cfg_path)
    except ValueError as e:
        rep.err("config.json is not valid JSON: %s" % e)
        return rep
    if cfg.get("id") != cid:
        rep.err("config.json id is %r but the folder is %r" % (cfg.get("id"), cid))
    if not ID_RE.match(cid):
        rep.err("folder name %r: use lower-case letters, digits and dashes" % cid)
    if not cfg.get("name"):
        rep.err("config.json needs a 'name'")
    if cfg.get("name") == "Your City":
        rep.warn("config.json still has the template name 'Your City'")
    if re.search(r"example\.(org|com)", json.dumps(cfg)):
        rep.warn("config.json still contains example.org / example.com placeholder links")
    for k in cfg:
        if k in REMOVED_KEYS:
            rep.warn("config.json: %r is no longer used: %s" % (k, REMOVED_KEYS[k]))
        elif k not in KNOWN_CONFIG_KEYS:
            rep.warn("config.json: unknown key %r (typo? it is ignored)" % k)

    managers = cfg.get("managers")
    mkeys = None
    if managers is not None:
        if not isinstance(managers, list) or not all(isinstance(m, dict) and "key" in m for m in managers):
            rep.err("config.json: 'managers' must be a list of objects with a 'key'")
        else:
            mkeys = {str(m["key"]) for m in managers}
            for m in managers:
                if "color" in m and not re.fullmatch(r"#[0-9a-fA-F]{3,8}", str(m["color"])):
                    rep.warn("manager %r: color %r is not a #hex colour" % (m["key"], m["color"]))
    sources = cfg.get("sources")
    skeys = None
    if sources is not None:
        skeys = set()
        for s in sources:
            if not isinstance(s, dict) or "key" not in s:
                rep.err("config.json: every source needs a 'key'")
                continue
            if str(s["key"]) in skeys:
                rep.err("duplicate source key %r" % s["key"])
            skeys.add(str(s["key"]))
            if s.get("url") and not re.match(r"https?://", s["url"]):
                rep.err("source %r: url must start with http:// or https://" % s["key"])
    for lab in cfg.get("labels", []):
        if num(lab.get("lat")) is None or num(lab.get("lon")) is None or not lab.get("name"):
            rep.err("labels: each needs name, lat and lon (%r)" % lab)
    geo = cfg.get("geocoding", {})
    if "bbox" in geo and not (isinstance(geo["bbox"], list) and len(geo["bbox"]) == 4 and all(num(x) is not None for x in geo["bbox"])):
        rep.err("geocoding.bbox must be [west, south, east, north]")
    elif "bbox" in geo:
        w, s, e, n = geo["bbox"]
        if not (w < e and s < n):
            rep.err("geocoding.bbox must be [west, south, east, north] with west<east and south<north")
    if "checkRadii" in cfg and not (isinstance(cfg["checkRadii"], list) and all(num(x) for x in cfg["checkRadii"])):
        rep.err("checkRadii must be a list of metres, e.g. [100, 250, 500]")

    for key, label in (("about", "about"),):
        f = cfg.get(key) or "about.html"
        if not (d / f).exists():
            rep.warn("%s file %s not found: the app will show a generic text instead" % (label, f))
    fb = cfg.get("fallbackBasemap")
    if fb:
        if not (d / fb.get("image", "")).is_file():
            rep.err("fallbackBasemap.image %r not found in cities/%s/" % (fb.get("image"), cid))
        b = fb.get("bounds")
        if not (isinstance(b, list) and len(b) == 2 and all(isinstance(p, list) and len(p) == 2 for p in b)):
            rep.err("fallbackBasemap.bounds must be [[south, west], [north, east]]")
    # --- study area
    rings = None
    sa = cfg.get("studyArea")
    if sa:
        sf = d / sa.get("file", "")
        if not sf.is_file():
            rep.err("studyArea.file %r not found" % sa.get("file"))
        else:
            try:
                polys = polygons_of(read_json(sf))
                if not polys:
                    rep.err("%s has no Polygon / MultiPolygon" % sa["file"])
                else:
                    rings = [p[0] for p in polys]
                    for r in rings:
                        if len(r) < 4:
                            rep.err("study area ring has fewer than 4 points")
                        elif r[0] != r[-1]:
                            rep.warn("study area ring is not closed (first point != last point); it is closed automatically")
                        if any(not (-180 <= p[0] <= 180 and -90 <= p[1] <= 90) for p in r):
                            rep.err("study area coordinates out of range: GeoJSON order is [longitude, latitude]")
            except ValueError as e:
                rep.err("%s is not valid JSON: %s" % (sa["file"], e))

    # --- addresses
    df = d / (cfg.get("data") or "addresses.json")
    if not df.is_file():
        rep.err("%s is missing (run the geocode command)" % df.name)
        return rep
    try:
        raw = read_json(df)
    except ValueError as e:
        rep.err("%s is not valid JSON: %s" % (df.name, e))
        return rep
    if isinstance(raw, dict) and raw.get("type") == "FeatureCollection":
        rows = [dict(f.get("properties") or {}, lon=(f.get("geometry") or {}).get("coordinates", [None, None])[0],
                     lat=(f.get("geometry") or {}).get("coordinates", [None, None])[1]) for f in raw.get("features", [])]
    elif isinstance(raw, list):
        rows = raw
    else:
        rep.err("%s must be a list of records (or a GeoJSON FeatureCollection of points)" % df.name)
        return rep
    if not rows:
        rep.warn("%s has no records yet" % df.name)
        return rep

    good, seen, ids = [], {}, {}
    for i, r in enumerate(rows):
        where = "row %d" % (i + 1)
        if not isinstance(r, dict):
            rep.err("%s: not an object" % where)
            continue
        addr = str(r.get("address", "")).strip()
        if addr:
            where += " (%s)" % addr[:40]
        else:
            rep.err("%s: missing 'address'" % where)
        lat, lon = num(r.get("lat")), num(r.get("lon", r.get("lng")))
        if lat is None or lon is None:
            rep.err("%s: lat/lon missing or not a number" % where)
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            rep.err("%s: lat/lon out of range (%s, %s). lat is first, lon second" % (where, lat, lon))
            continue
        if lat == 0 and lon == 0:
            rep.err("%s: coordinates are 0,0 (geocoding probably failed)" % where)
            continue
        good.append((where, r, lat, lon))
        k = (addr.lower(), round(lat, 5), round(lon, 5))
        if addr and k in seen:
            rep.warn("%s: duplicate of row %d (same address and position)" % (where, seen[k]))
        seen.setdefault(k, i + 1)
        if "id" in r:
            if not isinstance(r["id"], int):
                rep.warn("%s: id should be an integer (ignored otherwise)" % where)
            elif r["id"] in ids:
                rep.err("%s: id %s already used by row %d" % (where, r["id"], ids[r["id"]]))
            else:
                ids[r["id"]] = i + 1
        if mkeys is not None and r.get("manager") and str(r["manager"]) not in mkeys:
            rep.warn("%s: manager %r is not listed in config.json (it gets an automatic colour)" % (where, r["manager"]))
        if skeys is not None and r.get("source") and str(r["source"]) not in skeys:
            rep.warn("%s: source %r is not listed in config.json 'sources', so it gets no link" % (where, r["source"]))
        if r.get("url") and not re.match(r"https?://", str(r["url"])):
            rep.err("%s: url must start with http:// or https://" % where)
        if r.get("page") not in (None, "") and num(r.get("page")) is None:
            rep.warn("%s: page %r is not a number" % (where, r["page"]))
        if isinstance(r.get("edge"), str):
            rep.warn("%s: 'edge' should be true/false (or leave it out: it is computed from the study area)" % where)

    if good:
        mlat = statistics.median(g[2] for g in good)
        mlon = statistics.median(g[3] for g in good)
        far = [(w, haversine_km(mlat, mlon, la, lo)) for w, _, la, lo in good if haversine_km(mlat, mlon, la, lo) > 40]
        for w, km in far[:10]:
            rep.warn("%s is %.0f km from the rest of the data: wrong geocoding match?" % (w, km))
        if rings:
            outside = [w for w, _, la, lo in good if not any(in_ring(r, la, lo) for r in rings)]
            if outside:
                rep.warn("%d address(es) lie outside the study area, e.g. %s" % (len(outside), "; ".join(outside[:3])))
        approx = sum(1 for _, r, _, _ in good if "approx" in str(r.get("precision", "")).lower())
        if approx:
            rep.warn("%d address(es) are marked approximate; worth a visual check" % approx)
    if not rep.errors:
        rep.label = "%s · %d addresses" % (cid, len(good))
    return rep


def cmd_validate(a):
    site = load_site()
    ids = [c.get("id") for c in site.get("cities", [])]
    report_ids = []
    if a.all or not a.cities:
        report_ids = sorted({*ids, *[p.name for p in CITIES.iterdir() if p.is_dir() and not p.name.startswith("_")]})
    else:
        report_ids = a.cities
    rc = 0
    # site.json
    sr = Report("site.json")
    if len(ids) != len(set(ids)):
        sr.err("duplicate city ids in site.json")
    for c in site.get("cities", []):
        if not c.get("id") or not c.get("name"):
            sr.err("every entry in 'cities' needs an id and a name: %r" % c)
    if site.get("defaultCity") and site["defaultCity"] not in ids:
        sr.err("defaultCity %r is not in 'cities'" % site["defaultCity"])
    sr.show()
    rc |= bool(sr.errors)
    for cid in report_ids:
        r = check_city(cid, site)
        r.show()
        rc |= bool(r.errors) or (a.strict and bool(r.warnings))
    sys.exit(1 if rc else 0)


def cmd_list(_):
    site = load_site()
    for c in site.get("cities", []):
        mark = "*" if c.get("id") == site.get("defaultCity") else " "
        print(" %s %-18s %s" % (mark, c.get("id"), c.get("name")))
    if site.get("defaultCity"):
        print("\n(* = opens first)")
    elif len(site.get("cities", [])) > 1:
        print("\nNo defaultCity set: visitors land on the all-cities overview map.")


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("new", help="create a city folder from the template")
    p.add_argument("id", help="lower-case id used in the URL and folder name, e.g. turin")
    p.add_argument("--name", help="display name, e.g. 'Turin'")
    p.add_argument("--country", help="optional, e.g. Italy")
    p.set_defaults(fn=cmd_new)

    p = sub.add_parser("geocode", help="turn a CSV of addresses into addresses.json")
    p.add_argument("csv", help="CSV with at least an 'address' column")
    p.add_argument("--city", required=True, help="city id (folder name)")
    p.add_argument("--email", help="your email, sent to OpenStreetMap in the User-Agent (their policy asks for it)")
    p.add_argument("--delay", type=float, default=1.1, help="seconds between lookups (OSM allows 1 per second; default 1.1)")
    p.add_argument("--countrycodes", help="override geocoding.countrycodes, e.g. it or fr,be")
    p.add_argument("--out", help="write somewhere else than cities/<city>/addresses.json")
    p.add_argument("--no-cache", action="store_true", help="ignore and do not update the lookup cache")
    p.add_argument("--retry-missing", action="store_true", help="retry addresses that failed on an earlier run")
    p.add_argument("--dry-run", action="store_true", help="look up but do not write any files")
    p.set_defaults(fn=cmd_geocode)

    p = sub.add_parser("validate", help="check cities for mistakes")
    p.add_argument("cities", nargs="*", help="city ids (default: all)")
    p.add_argument("--all", action="store_true")
    p.add_argument("--strict", action="store_true", help="treat warnings as failures")
    p.set_defaults(fn=cmd_validate)

    p = sub.add_parser("index", help="refresh each city's map position and address count in site.json")
    p.set_defaults(fn=cmd_index)

    p = sub.add_parser("list", help="list registered cities")
    p.set_defaults(fn=cmd_list)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
