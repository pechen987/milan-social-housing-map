'use strict';
/* ==========================================================================
   Public-housing atlas — generic app.
   Boot order:  site.json  ->  cities/<id>/config.json  ->  addresses + study area  ->  render.
   Nothing city-specific lives in this file; see README.md ("Adding a city").
   ========================================================================== */

/* ---------- small helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const titleCase = s => s.toLowerCase().replace(/(^|[\s'’(\/-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const prettyArea = s => (s === s.toUpperCase() && s !== s.toLowerCase()) ? titleCase(s) : s;   // only "SHOUTING" names get re-cased
const isHttp = u => /^https?:\/\//i.test(u || '');
const safeUrl = u => isHttp(u) ? u : '';
const isAbsolute = p => /^([a-z][a-z0-9+.-]*:)?\/\//i.test(p) || p.startsWith('/');
const rel = (base, p) => isAbsolute(p) ? p : base + p;
const PALETTE = ['#167869', '#bb593e', '#4a6fa5', '#b08a2e', '#7a5a99', '#3a8f9b', '#8a6d4b', '#6b8e3d'];
const DEFAULT_MANAGER = 'Social housing';

async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' → HTTP ' + r.status); return r.json(); }
async function getText(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' → HTTP ' + r.status); return r.text(); }

/* Config/about HTML comes from files that contributors can edit, so strip anything executable. */
function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form').forEach(n => n.remove());
  doc.body.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(a => {
      const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
      if (n.startsWith('on') || ((n === 'href' || n === 'src' || n === 'xlink:href') && /^(javascript|data|vbscript):/.test(v))) el.removeAttribute(a.name);
    });
    if (el.tagName === 'A' && el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener');
  });
  return doc.body.innerHTML;
}

/* ---------- state ---------- */
let SITE, CFG, CITY_ID, BASE;
let DATA = [], BY_ID = new Map(), DATA_BOUNDS = null;
let STUDY = null;                       // { rings, features, bounds } when the city has a study area
let MGR = {}, MGR_LIST = [], SRC = {};
let map, layer, pinLayer, satLayer;
let areaLayers = [];
let visible = [], selected = null, markers = new Map();
let pin = null, satOn = false, clustering = false, picking = false, hashReady = false;
let hasCluster = false, geoBusy = false, aboutLoaded = false, H;

/* ==========================================================================
   Boot
   ========================================================================== */
function fatal(title, html) {
  document.title = title;
  document.body.innerHTML = '<div class="fatal"><h2>' + esc(title) + '</h2>' + html + '</div>';
}

async function boot() {
  H = new URLSearchParams(location.hash.slice(1));
  try {
    SITE = await getJSON('site.json');
  } catch (e) {
    const local = location.protocol === 'file:';
    return fatal('Could not load the map', local
      ? '<p>This page was opened as a local file, and browsers block a page from reading its own data files that way.</p><p>Start a tiny local web server in this folder instead:</p><p><code>python3 -m http.server 8000</code></p><p>then open <code>http://localhost:8000</code>. (Published on GitHub Pages it just works.)</p>'
      : '<p>Could not read <code>site.json</code>.</p><p>' + esc(e.message) + '</p>');
  }
  SITE.title = SITE.title || 'Social housing in Europe';
  SITE.eyebrow = SITE.eyebrow || 'Europe · A social housing atlas';
  SITE.intro = SITE.intro || 'Documented social-housing addresses, city by city. Pick a city to explore it.';
  const cities = SITE.cities || [];
  const ids = cities.map(c => c.id);
  if (!cities.length) return fatal('No cities yet', '<p><code>site.json</code> lists no cities. Add one with <code>python3 tools/city.py new &lt;id&gt;</code>.</p>');
  const qs = new URLSearchParams(location.search);
  CITY_ID = qs.get('city');
  if (!CITY_ID) {
    if (qs.get('view') === 'overview' || (!SITE.defaultCity && cities.length > 1)) return bootOverview(cities);
    CITY_ID = SITE.defaultCity || ids[0];
  }
  if (!ids.includes(CITY_ID)) {
    return fatal('Unknown city', '<p>There is no city called <code>' + esc(CITY_ID) + '</code>. Available:</p><ul>' +
      cities.map(c => '<li><a href="?city=' + encodeURIComponent(c.id) + '">' + esc(c.name || c.id) + '</a></li>').join('') + '</ul>');
  }
  BASE = 'cities/' + CITY_ID + '/';
  let raw, rawData, studyGJ = null;
  try {
    raw = await getJSON(BASE + 'config.json');
    const dataFile = rel(BASE, raw.data || 'addresses.json');
    const studyFile = raw.studyArea && raw.studyArea.file ? rel(BASE, raw.studyArea.file) : null;
    [rawData, studyGJ] = await Promise.all([getJSON(dataFile), studyFile ? getJSON(studyFile) : null]);
  } catch (e) {
    return fatal('Could not load ' + CITY_ID, '<p>' + esc(e.message) + '</p><p>Check that the files exist in <code>' + esc(BASE) + '</code> and that the JSON is valid. <code>python3 tools/city.py validate ' + esc(CITY_ID) + '</code> will tell you what is wrong.</p>');
  }

  const skipped = loadRecords(rawData);
  if (!DATA.length) return fatal('No addresses to show', '<p><code>' + esc(BASE) + 'addresses.json</code> has no usable rows (each needs an <code>address</code>, <code>lat</code> and <code>lon</code>).</p>');
  DATA_BOUNDS = L.latLngBounds(DATA.map(d => [d.lat, d.lon]));
  CFG = buildConfig(raw);
  if (studyGJ) { try { STUDY = loadStudy(studyGJ); } catch (e) { console.warn('Study area ignored:', e.message); } }
  buildManagers(raw.managers);
  SRC = Object.fromEntries((CFG.sources || []).map(s => [String(s.key), s]));
  DATA.forEach(d => {
    d.edge = typeof d._edge === 'boolean' ? d._edge : !!(STUDY && STUDY.edgeMeters > 0 && studyDistM(d.lat, d.lon) <= STUDY.edgeMeters);
    d._hay = [d.address, d.area, d.manager, d.original].join(' ').toLowerCase();
  });

  buildUI();
  startMap();
  startFeatures();
  if (skipped) toast(skipped + ' row' + (skipped === 1 ? ' was' : 's were') + ' skipped: missing address or coordinates.');
}

/* ==========================================================================
   Overview: a map of all cities (shown when no city is chosen and there are 2+ cities)
   ========================================================================== */
function bootOverview(cities) {
  document.body.classList.add('overview');
  document.title = SITE.title;
  $('eyebrow').textContent = SITE.eyebrow;
  $('title').innerHTML = esc(SITE.title) + '<span>All cities</span>';
  $('paneltoggle').hidden = true;
  fillPicker(null);
  const total = cities.reduce((n, c) => n + (c.count || 0), 0);
  $('introH').textContent = 'Social housing, city by city.';
  $('introP').textContent = SITE.intro;
  $('stats').innerHTML = '<div class="stat"><strong>' + cities.length + '</strong><span>cities</span></div>' + (total ? '<div class="stat"><strong>' + total + '</strong><span>address locations</span></div>' : '');
  const sorted = cities.slice().sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  $('list').innerHTML = sorted.map(c => '<a class="card" href="?city=' + encodeURIComponent(c.id) + '"><span class="cardtop">' + esc(c.country || 'City') + '</span><span class="addr">' + esc(c.name || c.id) + '</span><span class="neighbourhood">' + (c.count ? c.count + ' documented addresses' : 'open the map') + '</span></a>').join('');
  $('footnote').innerHTML = sanitizeHTML(SITE.footnote || '<b>Documented locations, not a live census.</b> Each city lists the addresses found in its public registers; absence from a map never proves absence of social housing.') +
    (isHttp(SITE.repo) ? ' <a href="' + esc(SITE.repo) + '" target="_blank" rel="noopener">Add your city ↗</a>' : '');
  map = L.map('map', { zoomControl: false, minZoom: 3, maxZoom: 12, zoomSnap: 0.25 });
  L.control.zoom({ position: 'topleft' }).addTo(map);
  addBasemaps(map, null);
  const pts = [];
  cities.forEach(c => {
    if (!Array.isArray(c.center) || c.center.length !== 2) return;
    const r = Math.max(9, Math.min(28, 7 + Math.sqrt(c.count || 1) * 1.4));
    const m = L.circleMarker(c.center, { radius: r, fillColor: '#167869', color: '#fffdf6', weight: 2, fillOpacity: .85 }).addTo(map);
    m.bindTooltip(esc(c.name || c.id) + (c.count ? ' · ' + c.count : ''), { permanent: true, direction: 'right', offset: [r + 2, 0], className: 'citylabel' });
    m.on('click', () => { location.href = '?city=' + encodeURIComponent(c.id); });
    pts.push(c.center);
  });
  if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [70, 70], paddingBottomRight: [90, 120], maxZoom: 7 });
  else if (pts.length === 1) map.setView(pts[0], 9);
  else map.setView([50, 10], 4);
}

/* ---------- data ---------- */
function loadRecords(raw) {
  let rows, skipped = 0;
  if (Array.isArray(raw)) rows = raw;
  else if (raw && raw.type === 'FeatureCollection') {
    rows = raw.features.filter(f => f.geometry && f.geometry.type === 'Point')
      .map(f => Object.assign({}, f.properties, { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
    skipped += raw.features.length - rows.length;          // features that are not points
  } else rows = [];
  const out = [];
  rows.forEach((r, i) => {
    const lat = Number(r.lat), lon = Number(r.lon ?? r.lng);
    if (!r.address || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) { skipped++; return; }
    const d = Object.assign({}, r, { lat, lon, address: String(r.address).trim() });
    delete d.lng;
    d.manager = String(r.manager ?? '').trim() || DEFAULT_MANAGER;
    d.area = r.area != null && r.area !== '' ? String(r.area).trim() : '';
    if (typeof r.edge === 'boolean') d._edge = r.edge;
    delete d.edge;
    d.id = Number.isInteger(r.id) ? r.id : i;
    out.push(d);
  });
  if (new Set(out.map(d => d.id)).size !== out.length) out.forEach((d, i) => d.id = i);     // ids must be unique
  DATA = out;
  BY_ID = new Map(out.map(d => [d.id, d]));
  return skipped;
}

function buildManagers(cfgManagers) {
  MGR_LIST = (cfgManagers || []).map((m, i) => ({
    key: String(m.key), label: m.label || String(m.key), color: m.color || PALETTE[i % PALETTE.length],
    caption: m.caption || (m.label || m.key) + ' managed'
  }));
  const seen = new Set(MGR_LIST.map(m => m.key));
  DATA.forEach(d => {
    if (seen.has(d.manager)) return;
    seen.add(d.manager);
    MGR_LIST.push({ key: d.manager, label: d.manager, color: PALETTE[MGR_LIST.length % PALETTE.length], caption: d.manager === DEFAULT_MANAGER ? 'address locations' : d.manager + ' managed' });
  });
  MGR = Object.fromEntries(MGR_LIST.map(m => [m.key, m]));
}

function buildConfig(raw) {
  const name = raw.name || raw.id || CITY_ID;
  const pad = 0.12, b = DATA_BOUNDS;
  return Object.assign({}, raw, {
    name,
    introHeading: raw.introHeading || 'Social housing in ' + name + '.',
    intro: raw.intro || 'Explore documented social-housing addresses in ' + name + '.',
    mapLabel: raw.mapLabel || 'Interactive map of ' + name,
    footnote: raw.footnote || '<b>Documented locations, not a live census.</b> Counts are addresses, not apartments or unique buildings.',
    terms: Object.assign({ area: 'Neighbourhood', allAreas: 'All areas', district: 'District' }, raw.terms),
    map: Object.assign({ minZoom: 9 }, raw.map),
    sources: raw.sources || [],
    labels: raw.labels || [],
    fallbackBasemap: raw.fallbackBasemap || null,
    geocoding: Object.assign({
      suffix: ', ' + name, countrycodes: '',
      bbox: [b.getWest() - pad, b.getSouth() - pad, b.getEast() + pad, b.getNorth() + pad]
    }, raw.geocoding),
    export: Object.assign({ metadata: {} }, raw.export),
    checkRadii: raw.checkRadii || [100, 250, 500],
    listLimit: raw.listLimit || 300,
    coverageWarnMeters: raw.coverageWarnMeters || 3000
  });
}

/* ---------- study area (optional polygon) ---------- */
function loadStudy(gj) {
  const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', properties: {}, geometry: gj }];
  const polys = [];
  feats.forEach(f => {
    const g = f.geometry; if (!g) return;
    if (g.type === 'Polygon') polys.push(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => polys.push(p));
  });
  if (!polys.length) throw new Error('no Polygon found');
  const sa = CFG.studyArea || {};
  return {
    rings: polys.map(p => p[0]), features: feats, geojson: gj,
    bounds: L.geoJSON(gj).getBounds(),
    edgeMeters: sa.edgeMeters ?? 100,
    edgeLabel: sa.edgeLabel || 'Near boundary',
    edgeWarning: sa.edgeWarning || 'Close to the study-area boundary. Check the street before treating this as definitely inside.',
    name: sa.name || ''
  };
}
const inRing = (ring, lat, lon) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const inStudy = (lat, lon) => !STUDY || STUDY.rings.some(r => inRing(r, lat, lon));
function studyDistM(lat, lon) {                        // metres from a point to the nearest edge of the study area
  const k = 111320, cl = Math.cos(lat * Math.PI / 180);
  let best = Infinity;
  STUDY.rings.forEach(ring => {
    for (let i = 0; i < ring.length; i++) {
      const A = ring[i], B = ring[(i + 1) % ring.length];
      const ax = (A[0] - lon) * k * cl, ay = (A[1] - lat) * k, bx = (B[0] - lon) * k * cl, by = (B[1] - lat) * k;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      let t = l2 ? -(ax * dx + ay * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  });
  return best;
}
const sourceURL = d => {
  if (d.url) return safeUrl(d.url);
  const s = SRC[d.source];
  if (!s || !s.url) return '';
  return safeUrl(s.url) + (s.pageAnchor && d.page ? '#page=' + encodeURIComponent(d.page) : '');
};

/* ==========================================================================
   UI that depends on the city
   ========================================================================== */
function buildUI() {
  document.title = CFG.name + ' · ' + SITE.title;
  $('eyebrow').textContent = SITE.eyebrow;
  $('title').innerHTML = esc(SITE.title) + '<span>' + esc(CFG.name + (CFG.country ? ', ' + CFG.country : '')) + '</span>';
  $('introH').textContent = CFG.introHeading;
  $('introP').textContent = CFG.intro;
  $('mapwrap').setAttribute('aria-label', CFG.mapLabel);
  $('footnote').innerHTML = sanitizeHTML(CFG.footnote) + ' <button class="linkbtn" id="coverage">Read coverage notes</button>';

  // city picker (only when there is more than one city)
  fillPicker(CITY_ID);
  const setPanel = open => {
    document.querySelector('main').classList.toggle('panel-collapsed', !open);
    $('paneltoggle').textContent = open ? 'Hide panel' : 'Show panel';
    $('paneltoggle').setAttribute('aria-expanded', String(open));
    try { localStorage.setItem('housing-atlas-panel-open', open ? '1' : '0'); } catch (e) { /* optional preference */ }
    setTimeout(() => map && map.invalidateSize(), 220);
  };
  let panelOpen = true;
  try { panelOpen = localStorage.getItem('housing-atlas-panel-open') !== '0'; } catch (e) { /* default open */ }
  setPanel(panelOpen);
  $('paneltoggle').onclick = () => setPanel(document.querySelector('main').classList.contains('panel-collapsed'));

  // Provider is retained on individual location cards, while all cities use one neutral map symbol and citywide total.
  $('stats').innerHTML = '<div class="stat"><strong id="total">—</strong><span>documented locations</span></div>';

  // area select (only if the data has areas)
  const areas = [...new Set(DATA.map(d => d.area).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (areas.length) {
    $('areawrap').hidden = false;
    $('areaLabel').textContent = CFG.terms.area;
    $('area').innerHTML = '<option value="">' + esc(CFG.terms.allAreas) + '</option>' + areas.map(a => '<option value="' + esc(a) + '">' + esc(prettyArea(a)) + '</option>').join('');
    $('area').onchange = render;
  }
  $('searchLabel').textContent = areas.length ? 'Find an address or ' + CFG.terms.area.split('/')[0].trim().toLowerCase() : 'Find an address';
  $('search').placeholder = CFG.searchPlaceholder || (areas.length ? 'Try ' + areas.slice(0, 3).map(prettyArea).join(', ') + '…' : 'Search an address…');
  $('addr').placeholder = 'e.g. ' + (CFG.geocoding.example || DATA[0].address);

  // The legend only explains study-area warnings; providers appear on individual cards.
  $('legend').innerHTML = STUDY && STUDY.edgeMeters > 0 ? '<span><i style="width:10px;height:10px;border:2px solid #be8e32;border-radius:50%"></i>' + esc(STUDY.edgeLabel) + '</span>' : '';
  $('legend').hidden = !$('legend').innerHTML;

  // download dialog
  $('downloadText').textContent = 'Export the currently filtered addresses, including source pages and coordinate precision' + (STUDY ? ', and boundary flags. GeoJSON also includes the study area.' : '.');

  // credits
  const credits = ['Basemap: © OpenStreetMap contributors, tiles by CARTO (OpenStreetMap standard tiles as a fallback)',
    'satellite imagery © Esri and its data providers'];
  if (CFG.fallbackBasemap && CFG.fallbackBasemap.attribution) credits.push(CFG.fallbackBasemap.attribution);
  if (CFG.credits) credits.push(CFG.credits);
  $('credits').textContent = credits.join('; ') + '. The address check uses OpenStreetMap Nominatim, so the text you type is sent to OpenStreetMap. Libraries: Leaflet 1.9.4 (BSD-2-Clause) and Leaflet.markercluster 1.5.3 (MIT).';

  // buttons
  $('reset').onclick = () => { $('search').value = ''; $('area').value = ''; render(); home(); };
  $('fit').onclick = () => { if (visible.length) map.fitBounds(L.latLngBounds(visible.map(d => [d.lat, d.lon])), { padding: [60, 70], maxZoom: 16 }); };
  $('sources').onclick = $('coverage').onclick = openAbout;
  $('closeAbout').onclick = () => $('about').close();
  $('export').onclick = () => $('download').showModal();
  $('closeDownload').onclick = () => $('download').close();
  $('csv').onclick = exportCSV;
  $('geojson').onclick = exportGeoJSON;
  let rt; $('search').oninput = () => { clearTimeout(rt); rt = setTimeout(render, 140); };
  $('list').onclick = e => { const c = e.target.closest('.card'); if (c) select(+c.dataset.id); };
}

function fillPicker(currentId) {
  const cities = SITE.cities || [], sel = $('citypick');
  if (cities.length < 2) return;
  sel.innerHTML = '<option value="__all"' + (currentId ? '' : ' selected') + '>All cities</option>' +
    cities.map(c => '<option value="' + esc(c.id) + '"' + (c.id === currentId ? ' selected' : '') + '>' + esc(c.name || c.id) + '</option>').join('');
  sel.hidden = false;
  sel.onchange = () => { location.href = sel.value === '__all' ? '?view=overview' : '?city=' + encodeURIComponent(sel.value); };
}

async function openAbout() {
  if (!aboutLoaded) {
    aboutLoaded = true;
    let html = '';
    try { html = await getText(rel(BASE, CFG.about || 'about.html')); if (/^\s*<!doctype html|<html[\s>]/i.test(html)) html = ''; } catch (e) { /* use the default text */ }
    if (!html) {
      html = '<div class="eyebrow">About this map</div><h2>What this map shows.</h2><p>Documented public-housing addresses in ' + esc(CFG.name) + ', collected from the sources below. It is <b>not</b> a verified, complete inventory.</p>' +
        CFG.sources.filter(s => safeUrl(s.url)).map(s => '<div class="source"><b>' + esc(s.key) + '</b><p><a href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener">Open the source ↗</a></p></div>').join('');
    }
    $('aboutBody').innerHTML = sanitizeHTML(html);
  }
  $('about').showModal();
}

/* ==========================================================================
   Map
   ========================================================================== */
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3600); }
function setBtn(id, on) { const b = $(id); if (b) { b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', String(!!on)); } }

function home() {
  if (STUDY) map.fitBounds(STUDY.bounds, { padding: [16, 20] });
  else if (CFG.map.center) map.setView(CFG.map.center, CFG.map.zoom || 13);
  else map.fitBounds(DATA_BOUNDS, { padding: [40, 40], maxZoom: 15 });
}

/* Basemaps are tried in order (CARTO -> OpenStreetMap -> the city's local image); after 3 failed tiles the next one is used. */
function addBasemaps(map, fb) {
  const fallbackImg = fb && fb.image ? L.imageOverlay(rel(BASE, fb.image), fb.bounds, { opacity: .92, interactive: false, attribution: fb.attribution || '' }) : null;
  const osmAttr = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const BASEMAPS = [];
  if (SITE.cartoKey) BASEMAPS.push({ url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=' + encodeURIComponent(SITE.cartoKey), opts: { maxZoom: 19, attribution: osmAttr + ', © <a href="https://carto.com/attributions">CARTO</a>' } });
  BASEMAPS.push({ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { maxZoom: 19, attribution: osmAttr } });
  let bmIndex = -1, bmLayer = null;
  const next = () => {
    if (bmLayer) { map.removeLayer(bmLayer); bmLayer = null; }
    bmIndex++;
    if (bmIndex >= BASEMAPS.length) { if (fallbackImg) fallbackImg.addTo(map); else $('mapfail').style.display = 'block'; return; }
    const cfg = BASEMAPS[bmIndex], l = L.tileLayer(cfg.url, cfg.opts).addTo(map);
    bmLayer = l;
    let errors = 0;
    l.on('tileerror', () => { if (bmLayer === l && ++errors >= 3) next(); });
  };
  next();
}


/* ---------- administrative / neighbourhood areas ---------- */
function initAreaLayers() {
  const specs = CFG.areaLayers || [];
  if (!specs.length) return;
  map.on('zoomend', syncAreaLayers);
  specs.forEach((spec, i) => {
    const url = spec.url || (spec.file ? rel(BASE, spec.file) : '');
    if (!url) return;
    getJSON(url).then(gj => {
      const pane = 'areas-' + i;
      map.createPane(pane);
      map.getPane(pane).style.zIndex = String(spec.zIndex || 370);
      map.getPane(pane).style.pointerEvents = 'none';
      const style = Object.assign({ color: '#38645e', weight: 1.15, opacity: .62, fillColor: '#86a89a', fillOpacity: .035 }, spec.style || {}, { pane });
      const shapes = L.geoJSON(gj, { pane, interactive: false, style });
      const labels = L.layerGroup();
      if (spec.labels !== false) shapes.eachLayer(shape => {
        const p = shape.feature && shape.feature.properties || {};
        const keys = Array.isArray(spec.labelField) ? spec.labelField : [spec.labelField];
        const value = keys.filter(Boolean).map(k => p[k]).find(v => v !== undefined && v !== null && String(v).trim());
        if (value === undefined) return;
        const text = (spec.labelPrefix || '') + value;
        const center = shape.getBounds && shape.getBounds().getCenter();
        if (center) L.marker(center, { pane, interactive: false, icon: L.divIcon({ className: 'arealabel', html: esc(text), iconSize: [150, 18], iconAnchor: [75, 9] }) }).addTo(labels);
      });
      areaLayers.push({ spec, shapes, labels });
      syncAreaLayers();
    }).catch(e => console.warn('Area layer unavailable:', spec.id || url, e.message));
  });
}
function syncAreaLayers() {
  const z = map.getZoom();
  areaLayers.forEach(({ spec, shapes, labels }) => {
    const visible = z >= (spec.minZoom ?? 0) && (spec.maxZoom == null || z <= spec.maxZoom);
    const showLabels = visible && z >= (spec.labelZoom ?? spec.minZoom ?? 0);
    if (visible && !map.hasLayer(shapes)) shapes.addTo(map);
    if (!visible && map.hasLayer(shapes)) map.removeLayer(shapes);
    if (showLabels && !map.hasLayer(labels)) labels.addTo(map);
    if (!showLabels && map.hasLayer(labels)) map.removeLayer(labels);
  });
}

function startMap() {
  map = L.map('map', { zoomControl: false, minZoom: CFG.map.minZoom, maxZoom: 19, zoomSnap: 0.25, preferCanvas: true });
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

  addBasemaps(map, CFG.fallbackBasemap);
  initAreaLayers();

  // --- study area outline ---
  if (STUDY) L.geoJSON(STUDY.geojson, { style: { color: '#9d894e', weight: 2, dashArray: '6 6', fillColor: '#759e7b', fillOpacity: .035 }, interactive: false }).addTo(map);
  home();

  // --- place labels ---
  const labelLayer = L.layerGroup().addTo(map);
  CFG.labels.forEach(({ name, lat, lon }) => L.marker([lat, lon], { icon: L.divIcon({ className: 'placelabel', html: esc(name), iconSize: [130, 15], iconAnchor: [65, 8] }), interactive: false }).addTo(labelLayer));

  // --- dots (clustered or plain) ---
  hasCluster = typeof L.markerClusterGroup === 'function';
  clustering = hasCluster && H.get('c') !== '0';
  layer = makeLayer();
  pinLayer = L.layerGroup().addTo(map);
}

function clusterIcon(c) {
  const n = c.getChildCount(), sz = n < 10 ? 34 : n < 40 ? 40 : 48;
  return L.divIcon({ className: 'mcl', iconSize: [sz, sz], html: '<div class="mclin neutral"><span>' + n + '</span></div>' });
}
function makeLayer() {
  return (clustering
    ? L.markerClusterGroup({ maxClusterRadius: 38, showCoverageOnHover: false, spiderfyOnMaxZoom: false, disableClusteringAtZoom: 18, animate: false, animateAddingMarkers: false, iconCreateFunction: clusterIcon })
    : L.layerGroup()).addTo(map);
}
function setClustering(on) { clustering = !!on && hasCluster; map.removeLayer(layer); layer = makeLayer(); setBtn('cluster', clustering); render(); }

/* ---------- popup, list, markers ---------- */
function popup(d) {
  const src = SRC[d.source], url = sourceURL(d);
  const where = [d.area, d.district != null && d.district !== '' ? CFG.terms.district + ' ' + d.district : ''].filter(Boolean).join(' · ');
  return '<span class="badge">' + esc(d.manager) + (d.source ? ' · ' + esc(d.source) : '') + '</span><h3>' + esc(d.address) + '</h3>' +
    (where ? '<div class="detail-row"><small>' + esc(CFG.terms.area) + '</small>' + esc(where) + '</div>' : '') +
    '<div class="detail-row"><small>Mapped position</small>' + (d.precision ? esc(d.precision) + '<br>' : '') + '<small>' + d.lat.toFixed(6) + ', ' + d.lon.toFixed(6) + '</small></div>' +
    (d.note ? '<p>' + esc(d.note) + '</p>' : '') +
    (d.edge && STUDY ? '<p class="warning">' + esc(STUDY.edgeWarning) + '</p>' : '') +
    (d.original ? '<div class="detail-row"><small>Original register entry</small>' + esc(d.original) + '</div>' : '') +
    (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc((src && src.label) || 'Source') + (d.page ? ' · page ' + esc(d.page) : '') + ' ↗</a><br>' : '') +
    '<a href="https://www.openstreetmap.org/?mlat=' + d.lat + '&mlon=' + d.lon + '#map=18/' + d.lat + '/' + d.lon + '" target="_blank" rel="noopener">View street location ↗</a><br>' +
    '<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + d.lat + ',' + d.lon + '" target="_blank" rel="noopener">Open in Street View ↗</a>';
}

function select(id, pan = true) {
  selected = id;
  setTimeout(pushHash, 0);
  document.querySelectorAll('.card').forEach(c => c.classList.toggle('selected', +c.dataset.id === id));
  markers.forEach((m, k) => m.setRadius(k === id ? 10 : 6));
  const d = BY_ID.get(id), m = markers.get(id);
  if (m && d) {
    if (pan || (clustering && !m._map)) map.setView([d.lat, d.lon], Math.max(map.getZoom(), clustering ? 18 : 16), { animate: !clustering && pan });
    m.openPopup();
  }
  const c = document.querySelector('.card[data-id="' + id + '"]');
  if (c) { const list = $('list'); list.scrollTop = c.offsetTop - list.offsetTop - 15; }
  if (pan && window.innerWidth <= 780) $('mapwrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function render() {
  const q = $('search').value.toLowerCase().trim(), area = $('area').value;
  visible = DATA.filter(d => (!area || d.area === area) && (!q || d._hay.includes(q)));
  layer.clearLayers(); markers.clear(); map.closePopup();

  $('resultcount').textContent = visible.length + ' of ' + DATA.length + ' addresses';
  $('total').textContent = visible.length;

  const shown = visible.slice(0, CFG.listLimit);
  $('list').innerHTML = visible.length
    ? shown.map(d => {
        const where = [d.area.toLowerCase(), d.district != null && d.district !== '' ? CFG.terms.district + ' ' + d.district : ''].filter(Boolean).join(' · ');
        return '<button class="card' + (selected === d.id ? ' selected' : '') + '" data-id="' + d.id + '"><span class="cardtop">' + esc(d.manager || 'Social housing') +
          (d.edge && STUDY ? '<span class="tag">NEAR EDGE</span>' : '') + '</span><span class="addr">' + esc(d.address) + '</span>' + (where ? '<span class="neighbourhood">' + esc(where) + '</span>' : '') + '</button>';
      }).join('') + (visible.length > shown.length ? '<div class="more">Showing the first ' + shown.length + ' of ' + visible.length + '. Search or filter to narrow the list; all of them are on the map.</div>' : '')
    : '<div class="empty">No matching addresses.<br>Try a street name or reset the filters.</div>';

  visible.forEach(d => {
    const m = L.circleMarker([d.lat, d.lon], {
      radius: selected === d.id ? 10 : 6, fillColor: '#167869', color: d.edge ? '#bd8e36' : '#fffdf6',
      weight: d.edge ? 2.5 : 1.5, fillOpacity: .94
    }).bindPopup(() => popup(d), { maxWidth: 290 }).bindTooltip(esc(d.address), { direction: 'top', offset: [0, -5] }).addTo(layer);
    m.on('click', () => select(d.id, false));
    markers.set(d.id, m);
  });
  pushHash();
}

/* ---------- exports ---------- */
function save(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const pub = d => { const o = {}; Object.keys(d).forEach(k => { if (k[0] !== '_') o[k] = d[k]; }); if (!STUDY) delete o.edge; return o; };
function exportCSV() {
  const base = ['address', 'manager', 'area', 'district', 'lat', 'lon', 'precision', ...(STUDY ? ['edge'] : []), 'source', 'page', 'original', 'note'];
  const extra = [...new Set(visible.flatMap(d => Object.keys(pub(d))))].filter(k => !base.includes(k) && k !== 'id' && k !== 'url').sort();
  const cols = [...base, ...extra, 'source_url'];
  const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [cols.join(','), ...visible.map(d => cols.map(k => cell(k === 'source_url' ? sourceURL(d) : d[k])).join(','))];
  save('\uFEFF' + rows.join('\r\n'), CITY_ID + '-housing.csv', 'text/csv;charset=utf-8');
}
function exportGeoJSON() {
  const feats = [
    ...(STUDY ? STUDY.features.filter(f => f.geometry).map(f => ({ type: 'Feature', properties: Object.assign({ type: 'Study area' }, f.properties), geometry: f.geometry })) : []),
    ...visible.map(d => ({ type: 'Feature', properties: Object.assign(pub(d), { source_url: sourceURL(d) }), geometry: { type: 'Point', coordinates: [d.lon, d.lat] } }))
  ];
  save(JSON.stringify({ type: 'FeatureCollection', metadata: Object.assign({ city: CFG.name }, CFG.export.metadata), features: feats }, null, 2), CITY_ID + '-housing.geojson', 'application/geo+json');
}

/* ==========================================================================
   Features: share link, satellite, neighbourhood outlines, address check
   ========================================================================== */
function pushHash() {
  if (!hashReady) return;
  const c = map.getCenter(), p = new URLSearchParams();
  p.set('ll', c.lat.toFixed(5) + ',' + c.lng.toFixed(5)); p.set('z', String(+map.getZoom().toFixed(2)));
  const a = $('area').value; if (a) p.set('a', a);
  const q = $('search').value.trim(); if (q) p.set('q', q);
  if (selected != null) p.set('s', selected);
  if (pin) { p.set('p', pin.lat.toFixed(5) + ',' + pin.lon.toFixed(5)); p.set('pl', pin.label); }
  if (satOn) p.set('sat', '1');
  if (hasCluster && !clustering) p.set('c', '0');
  try { history.replaceState(null, '', '#' + p.toString()); } catch (e) { /* ignore */ }
}

/* address check */
function setPin(lat, lon, label, o = {}) {
  pin = { lat, lon, label }; pinLayer.clearLayers(); $('clearpin').hidden = false;
  const ll = L.latLng(lat, lon), res = $('checkresult');
  L.marker(ll, { icon: L.divIcon({ className: 'pinwrap', html: '<div class="pinicon"></div>', iconSize: [28, 28], iconAnchor: [14, 26] }), keyboard: false, zIndexOffset: 1000 }).addTo(pinLayer);
  if (!inStudy(lat, lon)) {
    res.innerHTML = '<div class="res warn"><b>' + esc(label) + '</b>This spot is outside the study area' + (STUDY.name ? ' (' + esc(STUDY.name) + ')' : '') + ', where this map has no data. Results would be misleading, so none are shown.</div>';
    if (o.fit !== false) map.setView(ll, Math.max(map.getZoom(), 15));
    pushHash(); return;
  }
  CFG.checkRadii.forEach(r => L.circle(ll, { radius: r, color: '#203a37', weight: 1, opacity: .55, dashArray: '4 4', fill: false, interactive: false }).addTo(pinLayer));
  const list = DATA.map(d => ({ d, m: map.distance(ll, [d.lat, d.lon]) })).sort((a, b) => a.m - b.m), n = list[0];
  L.polyline([ll, [n.d.lat, n.d.lon]], { color: '#167869', weight: 2, dashArray: '2 5', interactive: false }).addTo(pinLayer);
  const row = r => {
    const w = list.filter(x => x.m <= r);
    return '<tr><td>Within ' + r + ' m</td><td><b>' + w.length + '</b></td></tr>';
  };
  const notes = ['Counts are documented addresses, not apartments.'];
  if (STUDY && studyDistM(lat, lon) < 500) notes.push('<b>Close to the edge of the study area:</b> addresses outside it are not included.');
  if (!STUDY && n.m > CFG.coverageWarnMeters) notes.push('<b>The nearest address is ' + (n.m / 1000).toFixed(1) + ' km away:</b> this spot may be outside the area this map covers.');
  notes.push('The map is not a complete census, so “none nearby” does not prove there is none.');
  res.innerHTML = '<div class="res"><b>' + esc(label) + '</b><div class="near">' + Math.round(n.m) + ' m</div><div>to the nearest documented address: <a href="#" id="nearlink">' + esc(n.d.address) + '</a> (' + esc(n.d.manager) + ')</div><table>' + CFG.checkRadii.map(row).join('') + '</table><div class="note">' + notes.join(' ') + '</div></div>';
  $('nearlink').onclick = e => { e.preventDefault(); select(n.d.id); };
  if (o.fit !== false) map.fitBounds(ll.toBounds(Math.max(...CFG.checkRadii) * 2.2), { maxZoom: 17, padding: [20, 20] });
  pushHash();
}
async function geocode(q) {
  const g = CFG.geocoding, [w, s, e, n] = g.bbox;
  const full = g.suffix && !q.toLowerCase().includes(CFG.name.toLowerCase()) ? q + g.suffix : q;
  const params = { q: full, format: 'jsonv2', limit: '5', viewbox: [w, n, e, s].join(','), bounded: '0', 'accept-language': 'en' };
  if (g.countrycodes) params.countrycodes = g.countrycodes;
  const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams(params), { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function runCheck() {
  const q = $('addr').value.trim(); if (!q || geoBusy) return;
  geoBusy = true; $('addrgo').disabled = true; $('checkresult').innerHTML = '<div class="res">Looking up…</div>';
  try {
    const [w, s, e, n] = CFG.geocoding.bbox;
    const rs = (await geocode(q)).filter(r => +r.lat > s && +r.lat < n && +r.lon > w && +r.lon < e), short = r => r.display_name.split(',').slice(0, 3).join(',').trim();
    if (!rs.length) $('checkresult').innerHTML = '<div class="res warn">No match in ' + esc(CFG.name) + '. Try adding the street number, or pick the spot on the map.</div>';
    else {
      setPin(+rs[0].lat, +rs[0].lon, short(rs[0]));
      if (rs.length > 1) {
        const d = document.createElement('div'); d.className = 'alts'; d.innerHTML = '<span class="offline">Other matches:</span>';
        rs.slice(1, 4).forEach(r => { const b = document.createElement('button'); b.textContent = short(r); b.onclick = () => setPin(+r.lat, +r.lon, short(r)); d.appendChild(b); });
        $('checkresult').appendChild(d);
      }
    }
  } catch (err) { $('checkresult').innerHTML = '<div class="res warn">The address lookup is not available right now. You can still pick the spot on the map.</div>'; }
  setTimeout(() => { geoBusy = false; $('addrgo').disabled = false; }, 1100);   // Nominatim allows ~1 request per second
}
function stopPicking() { picking = false; $('mapwrap').classList.remove('map-picking'); $('pickmap').textContent = 'or pick a spot on the map'; }

function startFeatures() {
  // share
  $('share').onclick = () => {
    pushHash(); const u = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(() => toast('Link to this view copied'), () => window.prompt('Copy this link', u));
    else window.prompt('Copy this link', u);
  };
  // clustering
  if (hasCluster) $('cluster').onclick = () => setClustering(!clustering); else $('cluster').hidden = true;
  // satellite
  map.createPane('satPane').style.zIndex = 250;
  satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { pane: 'satPane', maxZoom: 19, attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community' });
  const setSat = on => { satOn = !!on; if (satOn) satLayer.addTo(map); else map.removeLayer(satLayer); setBtn('sat', satOn); $('sat').textContent = satOn ? 'Map' : 'Satellite'; pushHash(); };
  $('sat').onclick = () => setSat(!satOn);
  // address check
  $('addrgo').onclick = runCheck;
  $('addr').addEventListener('keydown', e => { if (e.key === 'Enter') runCheck(); });
  $('pickmap').onclick = () => {
    if (picking) { stopPicking(); return; }
    picking = true; $('mapwrap').classList.add('map-picking'); $('pickmap').textContent = 'Cancel — tap the map'; toast('Tap the map where you want to check.');
    if (window.innerWidth <= 780) $('mapwrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  map.on('click', e => { if (!picking) return; stopPicking(); setPin(e.latlng.lat, e.latlng.lng, 'Dropped pin'); });
  $('clearpin').onclick = () => { pin = null; pinLayer.clearLayers(); $('checkresult').innerHTML = ''; $('clearpin').hidden = true; $('addr').value = ''; stopPicking(); pushHash(); };

  // restore state from the link, then start recording it
  const a = H.get('a'); if (a && [...$('area').options].some(o => o.value === a)) $('area').value = a;
  const q = H.get('q'); if (q) $('search').value = q;
  render(); setBtn('cluster', clustering);
  const ll = (H.get('ll') || '').split(',').map(Number), z = parseFloat(H.get('z')), haveView = ll.length === 2 && ll.every(isFinite) && isFinite(z);
  if (haveView) map.setView(ll, z, { animate: false });
  if (H.get('sat') === '1') setSat(true);
  const p = (H.get('p') || '').split(',').map(Number);
  if (p.length === 2 && p.every(isFinite)) { $('addr').value = H.get('pl') && H.get('pl') !== 'Dropped pin' ? H.get('pl') : ''; setPin(p[0], p[1], H.get('pl') || 'Dropped pin', { fit: !haveView }); }
  const s = H.get('s'); if (s !== null && BY_ID.has(+s)) select(+s, false);
  hashReady = true; map.on('moveend', pushHash); pushHash();
}

boot();
