(() => {
  'use strict';

  /* =========================================================
   * Temperature model (MODIS MOD11A1 daytime LST regression)
   * Returns Kelvin. year = calendar year, day = day of year.
   * ========================================================= */
  // One set of curves per fitted site. Coefficients: [intercept, year trend, sin t, cos t, sin 2t, cos 2t]
  // mid = OLS centre fit; upper/lower = quantile fits (q = 0.7 / 0.3); max/min = LP envelopes of all readings
  const LST_MODELS = {
    // Brisbane: day_1km_harmonic_regression-Queensland.ipynb (Toowoomba pixel, Darling Downs)
    brisbane: {
      mid:   [302.008, -0.0549, -0.651,  9.866, -0.395, -1.668],
      upper: [304.535, -0.0709, -0.994, 10.758, -0.665, -1.726],
      lower: [299.831, -0.0393, -0.503,  9.085, -0.441, -1.884],
      max:   [312.917, -0.0849, -1.543, 13.005, -1.158, -2.124],
      min:   [289.016, -0.1710,  1.661,  5.388,  1.353, -0.900],
    },
    // Perth: day_1km_harmonic_regression-Perth.ipynb (mid taken from the OLS summary)
    perth: {
      mid:   [298.1296, -0.0305,  0.4874, 9.6956, -0.1114, -1.0188],
      upper: [301.808,  -0.0581, -0.691,  9.968,  -0.415,  -1.994],
      lower: [294.383,   0.0100,  1.422,  9.365,   0.032,  -0.309],
      max:   [312.917,  -0.0849, -1.543, 13.005,  -1.158,  -2.124],
      min:   [282.590,  -0.0704,  3.249,  7.084,   1.142,  -0.372],
    },
  };
  // Locations without their own fit (Melbourne, or no location yet) fall back to Brisbane's curves
  const lstFor = loc => (loc && loc.lst) || LST_MODELS.brisbane;
  function harmonicLST(c, year, day) {
    const t = 2 * Math.PI * day / 365;
    return c[0] + c[1] * (year - 2000)
      + c[2] * Math.sin(t) + c[3] * Math.cos(t)
      + c[4] * Math.sin(2 * t) + c[5] * Math.cos(2 * t);
  }
  const predictLST = (year, day, loc) => harmonicLST(lstFor(loc).mid, year, day);
  const KELVIN = 273.15;

  /* ---------- Date helpers (local, day-granular) ---------- */
  const MS_DAY = 86400000;
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const addMonths = (d, n) => {
    const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d.getDate(), last));
    return target;
  };
  const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / MS_DAY);
  const dayOfYear = d => daysBetween(new Date(d.getFullYear(), 0, 0), d);
  const daysInYear = y => daysBetween(new Date(y, 0, 1), new Date(y + 1, 0, 1));
  const curveC = (coef, d) => harmonicLST(coef, d.getFullYear(), dayOfYear(d)) - KELVIN;
  const tempC = (d, loc) => curveC(lstFor(loc).mid, d);
  // Spread of readings for a date at a location, in °C: the quantile band (lo–hi) and the min/max curves
  const tempBand = (d, loc) => {
    const m = lstFor(loc);
    return { lo: curveC(m.lower, d), hi: curveC(m.upper, d), min: curveC(m.min, d), max: curveC(m.max, d) };
  };

  /* =========================================================
   * Rainfall model (NASA POWER daily PRECTOTCORR, MERRA-2 bias-corrected, 2001–2025)
  
   * Fitted separately for each location in ../rainfall/fit_rainfall.py. Returns typical mm/day.
   * ========================================================= */
  function predictRain(loc, day) {
    const r = loc.rain, t = 2 * Math.PI * day / 365;
    return Math.max(0, r.a0
      + r.s1 * Math.sin(t) + r.c1 * Math.cos(t)
      + r.s2 * Math.sin(2 * t) + r.c2 * Math.cos(2 * t)
      + r.s3 * Math.sin(3 * t) + r.c3 * Math.cos(3 * t));
  }
  const rainDay = (loc, d) => predictRain(loc, dayOfYear(d));

  // Rain in the 2 weeks before sowing counts too: it sets seedbed moisture at sowing
  const RAIN_LEAD = 14;
  function rainWeekly(loc, start, len) { // typical mm/week over [start − RAIN_LEAD, start + len)
    let sum = 0;
    for (let i = -RAIN_LEAD; i < len; i++) sum += rainDay(loc, addDays(start, i));
    return (sum / (RAIN_LEAD + len)) * 7;
  }

  const fmt = (d, opts) => d.toLocaleDateString('en-AU', opts);
  const fmtShort = d => fmt(d, { day: 'numeric', month: 'short' });
  const fmtLong = d => fmt(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const fmtC = v => `${v.toFixed(1)}°C`;
  // "24 Apr – 12 May", or "10–29 July" within one month
  const fmtRange = r => {
    if (+r.start === +r.end) return fmtShort(r.start);
    if (r.start.getMonth() === r.end.getMonth() && r.start.getFullYear() === r.end.getFullYear())
      return `${r.start.getDate()}–${fmtShort(r.end)}`;
    return `${fmtShort(r.start)} – ${fmtShort(r.end)}`;
  };

  /* ---------- Data ---------- */
  const LOCATIONS = {
    perth: {
      id: 'perth', name: 'Perth', region: 'Western Australia', state: 'WA',
      lat: -31.9523, lng: 115.8613,
      lst: LST_MODELS.perth,
      rain: { a0: 1.7200, s1: -0.3661, c1: -1.7134, s2: 0.1700, c2: 0.5263, s3: -0.0028, c3: -0.0764 },
      patterns: [/\bperth\b/, /\bwa\b/, /western australia/, /\b6\d{3}\b/,
        /\b(fremantle|joondalup|subiaco|midland|armadale|rockingham|mandurah|swan valley|northam|york)\b/],
    },
    brisbane: {
      id: 'brisbane', name: 'Brisbane', region: 'Queensland', state: 'QLD',
      lat: -27.4698, lng: 153.0251,
      lst: LST_MODELS.brisbane,
      rain: { a0: 3.0382, s1: 1.0769, c1: 1.5261, s2: 0.1884, c2: 0.0705, s3: 0.0834, c3: -0.4432 },
      patterns: [/\bbrisbane\b/, /\bqld\b/, /queensland/, /\b4\d{3}\b/,
        /\b(ipswich|logan|redcliffe|toowoomba|caboolture|gatton|lockyer|redland|moreton)\b/],
    },
    melbourne: {
      id: 'melbourne', name: 'Melbourne', region: 'Victoria', state: 'VIC',
      lat: -37.8136, lng: 144.9631,
      lst: LST_MODELS.brisbane, // no Melbourne fit yet
      rain: { a0: 2.0090, s1: -0.2983, c1: -0.0756, s2: -0.2480, c2: -0.0261, s3: -0.0854, c3: -0.0815 },
      // "victoria", but not Perth's (East) Victoria Park
      patterns: [/\bmelbourne\b/, /\bvic\b/, /\bvictoria\b(?! park)/, /\b3\d{3}\b/,
        /\b(geelong|werribee|dandenong|frankston|st kilda|footscray|box hill|ringwood|craigieburn|sunbury|melton|pakenham|cranbourne|mornington|lilydale|yarra valley)\b/],
    },
  };

  const CROPS = {
    wheat: {
      id: 'wheat', name: 'Wheat', available: true, idealSowC: 20,
      rain: { min: 5, max: 25 }, // typical mm/week over the 2 weeks before sowing + the sowing window
      phases: [
        { key: 'sowing', name: 'Sowing', days: 42, label: '6 weeks',
          note: 'Target ~{T} °C land-surface temperature for even germination and strong early establishment.' },
        { key: 'growth', name: 'Crop growth', months: 6, label: '6 months',
          note: 'Tillering through stem elongation, flowering and grain fill. Monitor moisture and heat stress.' },
        { key: 'harvest', name: 'Harvesting', days: 42, label: '6 weeks',
          note: 'Book headers and storage early. Harvest as grain moisture drops to safe levels.' },
        { key: 'post', name: 'Post-harvest', days: 14, label: '2 weeks',
          note: 'Stubble management, ground cover and soil prep for the next rotation.' },
      ],
    },
    barley: {
      id: 'barley', name: 'Barley', available: true, idealSowC: 17.5,
      rain: { min: 5, max: 25 },
      phases: [
        { key: 'sowing', name: 'Sowing', days: 42, label: '6 weeks',
          note: 'Target ~{T} °C land-surface temperature. Barley prefers a cooler start than wheat for even emergence.' },
        { key: 'growth', name: 'Crop growth', months: 5, label: '5 months',
          note: 'Faster-maturing than wheat. Watch for frost at flowering and moisture stress during grain fill.' },
        { key: 'harvest', name: 'Harvesting', days: 28, label: '4 weeks',
          note: 'Harvest promptly once grain is dry to protect malting quality and limit head loss.' },
        { key: 'post', name: 'Post-harvest', days: 14, label: '2 weeks',
          note: 'Stubble management, ground cover and soil prep for the next rotation.' },
      ],
    },
    corn: {
      id: 'corn', name: 'Corn', available: true, idealSowC: 21,
      rain: { min: 10, max: 35 }, // corn wants a moister seedbed
      phases: [
        { key: 'sowing', name: 'Sowing', days: 14, label: '2 weeks',
          note: 'Target ~{T} °C land-surface temperature. Corn needs warm soil for fast, even emergence, so sowing is a short, tight window.' },
        { key: 'growth', name: 'Crop growth', months: 5, label: '5 months',
          note: 'Rapid vegetative growth through tasselling, silking and grain fill. Most sensitive to moisture and heat stress around silking.' },
        { key: 'harvest', name: 'Harvesting', days: 35, label: '5 weeks',
          note: 'Harvest once grain reaches safe moisture. Line up drying and storage before the header goes in.' },
        { key: 'post', name: 'Post-harvest', days: 14, label: '2 weeks',
          note: 'Manage the heavy stubble load, maintain ground cover and prepare soil for the next rotation.' },
      ],
    },
  };

  const PHASE_CLASS = { sowing: 'c-sowing', growth: 'c-growth', harvest: 'c-harvest', post: 'c-post' };

  /* ---------- Planning ---------- */
  function scoreWindow(start, len, ideal, coef) {
    let ss = 0, sum = 0;
    for (let i = 0; i < len; i++) {
      const v = curveC(coef, addDays(start, i));
      sum += v; ss += (v - ideal) ** 2;
    }
    return { rmse: Math.sqrt(ss / len), mean: sum / len };
  }

  // The LST curve is cyclical, so a target is usually crossed twice a year: once while cooling, once while warming.
  // A second sowing date is only offered when it is a genuinely separate crossing:
  const MATCH_TOL = 1;   // °C: a window's average must be this close to the target to count as a match
  const SWING_MIN = 1.5; // °C: between the two dates the temperature must stray at least this far from the target, both ways round the year

  // Rainfall is a hard constraint: temperature still ranks the windows, but only windows whose typical rain
  // (2 weeks before sowing + the sowing window) sits inside the crop's range are eligible.
  // If no window in the year qualifies, it falls back to temperature only and flags `rainLimited`.
  const windowCache = new Map();
  function findSowingWindows(year, crop, target, loc = null, useRain = false) {
    const rainOn = Boolean(useRain && loc && crop.rain);
    const key = `${crop.id}:${year}:${target}:${loc ? loc.id : '-'}:${rainOn}`;
    if (windowCache.has(key)) return windowCache.get(key);
    const model = lstFor(loc);
    const len = crop.phases[0].days;
    const n = daysInYear(year);
    const all = [];
    for (let i = 0; i < n; i++) {
      const start = new Date(year, 0, 1 + i);
      const rain = loc ? rainWeekly(loc, start, len) : null;
      const rainOk = !rainOn || (rain >= crop.rain.min && rain <= crop.rain.max);
      all.push({ i, start, rain, rainOk, ...scoreWindow(start, len, target, model.mid) });
    }
    const at = k => all[((k % n) + n) % n]; // circular, so a window straddling New Year is one dip, not two

    const rainLimited = rainOn && !all.some(w => w.rainOk);
    const eligible = w => w.rainOk || rainLimited;
    const cost = w => (eligible(w) ? w.rmse : Infinity);

    const best = all.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    const isMatch = w => Math.abs(w.mean - target) <= MATCH_TOL;

    // Largest departure from the target walking forward from window a to window b
    const swing = (a, b) => {
      let m = 0;
      for (let s = 1; s < (b.i - a.i + n) % n; s++) m = Math.max(m, Math.abs(at(a.i + s).mean - target));
      return m;
    };
    const isSeparate = w => {
      const gap = Math.abs(w.i - best.i);
      return Math.min(gap, n - gap) >= len            // sowing windows don't overlap
        && swing(best, w) >= SWING_MIN && swing(w, best) >= SWING_MIN;
    };

    // Other eligible dips (local minima of RMSE, ignoring windows that fail the rain check) that also match the target
    const second = !isMatch(best) ? null : all
      .filter(w => w !== best && eligible(w) && isMatch(w) && cost(w) <= cost(at(w.i - 1)) && cost(w) < cost(at(w.i + 1)) && isSeparate(w))
      .sort((a, b) => a.rmse - b.rmse)[0] || null;

    // Start-date range: run the same search on the two 20% curves. In a warmer-than-usual year (upper curve)
    // the target arrives on a different day than in a cooler one (lower curve), so any start from one to the
    // other is reasonable. Each is found by walking downhill in RMSE from the centre date to the nearest dip
    // (the same crossing of the target), only through windows that pass the rain check.
    const okAt = d => {
      if (!rainOn || rainLimited) return true;
      const r = rainWeekly(loc, d, len);
      return r >= crop.rain.min && r <= crop.rain.max;
    };
    const nearestDip = (coef, from) => {
      const memo = new Map();
      const costAt = k => {
        if (!memo.has(k)) { const d = addDays(from, k); memo.set(k, okAt(d) ? scoreWindow(d, len, target, coef).rmse : Infinity); }
        return memo.get(k);
      };
      let k = 0;
      for (let step = 0; step < 120; step++) {
        const here = costAt(k), back = costAt(k - 1), fwd = costAt(k + 1);
        if (back < here && back <= fwd) k--;
        else if (fwd < here) k++;
        else break;
      }
      return addDays(from, k);
    };
    const withRange = o => {
      const warm = nearestDip(model.upper, o.start), cool = nearestDip(model.lower, o.start);
      const ds = [o.start, warm, cool];
      return { ...o, range: { start: new Date(Math.min(...ds)), end: new Date(Math.max(...ds)), warm, cool } };
    };

    // Options in date order; `isBest` marks the lowest-RMSE one
    const options = (second ? [best, second] : [best])
      .map(w => withRange({ ...w, isBest: w === best, warming: tempC(addDays(w.start, len - 1), loc) > tempC(w.start, loc) }))
      .sort((a, b) => a.start - b.start);
    const result = { best, options, rainOn, rainLimited };
    windowCache.set(key, result);
    return result;
  }

  function rangeStats(start, end, loc) {
    let min = Infinity, max = -Infinity, sum = 0, rain = 0;
    const n = daysBetween(start, end);
    for (let i = 0; i < n; i++) {
      const d = addDays(start, i), v = tempC(d, loc);
      sum += v; min = Math.min(min, v); max = Math.max(max, v);
      if (loc) rain += rainDay(loc, d);
    }
    return { mean: sum / n, min, max, rain: loc ? rain : null }; // rain = typical total mm over the phase
  }

  function buildPlan(start, crop, loc) {
    let cursor = start;
    const phases = crop.phases.map(p => {
      const s = cursor;
      const e = p.months ? addMonths(s, p.months) : addDays(s, p.days); // exclusive end
      cursor = e;
      return { ...p, start: s, end: e, last: addDays(e, -1), length: daysBetween(s, e), stats: rangeStats(s, e, loc) };
    });
    return { start, end: cursor, last: addDays(cursor, -1), phases };
  }

  function phaseAt(plan, date) {
    return plan.phases.find(p => date >= p.start && date < p.end) || null;
  }

  function seasonOptions(crop, target, loc, useRain) {
    const today = startOfDay(new Date());
    const out = [];
    for (let y = today.getFullYear(); out.length < 5; y++) {
      const w = findSowingWindows(y, crop, target, loc, useRain);
      if (!w.options.some(isOpen)) continue; // keep a season while any of its start ranges hasn't closed
      out.push({ year: y, windows: w });
    }
    return out;
  }

  /* ---------- State ---------- */
  // sowPick: null = automatic (best fit), or 0/1 = the farmer's chosen sowing date (in date order) when a season has two
  const state = { location: null, address: '', crop: 'wheat', season: null, view: 'timeline', targetC: CROPS.wheat.idealSowC, sowPick: null, useRain: true };
  const targetMemory = {}; // per-crop slider position, so switching crops keeps each farmer's setting
  const cropDefault = () => CROPS[state.crop].idealSowC ?? CROPS.wheat.idealSowC;
  const today = startOfDay(new Date());
  const isOpen = o => o.range.end >= today; // a sowing date stays usable until its start range closes

  /* ---------- DOM ---------- */
  const $ = sel => document.querySelector(sel);
  const el = {
    today: $('#todayLabel'),
    input: $('#addressInput'),
    sugg: $('#suggestions'),
    hud: $('#hudCoords'),
    kpi: $('#kpi'),
    season: $('#seasonSelect'),
    legend: $('#legend'),
    plan: $('#planBody'),
    cards: $('#phaseCards'),
    targetCtl: $('#targetCtl'),
    range: $('#targetRange'),
    targetOut: $('#targetOut'),
    targetReset: $('#targetReset'),
    rangeDefault: $('#rangeDefault'),
    rainToggle: $('#rainToggle'),
    rainHint: $('#rainHint'),
  };
  el.today.textContent = fmtLong(today);

  const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>';
  const ICON_SEED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20v-8M12 12c-3.5 0-5.5-2.2-5.5-5.5 3.5 0 5.5 2 5.5 5.5zM12 14c3 0 4.8-1.9 4.8-4.8-3 0-4.8 1.8-4.8 4.8z"/><path d="M7 20h10"/></svg>';
  const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';

  /* =========================================================
   * Map
   * ========================================================= */
  const map = L.map('map', { zoomControl: false, worldCopyJump: true, minZoom: 3 })
    .setView([-27.5, 134], 4);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18, opacity: 0.85,
  }).addTo(map);

  const siteIcon = (loc, active) => L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div class="site${active ? ' is-active' : ''}"><span class="site-ring"></span><span class="site-ring"></span><span class="site-dot"></span><span class="site-label">${loc.name}</span></div>`,
  });
  const siteMarkers = {};
  Object.values(LOCATIONS).forEach(loc => {
    siteMarkers[loc.id] = L.marker([loc.lat, loc.lng], { icon: siteIcon(loc, false), keyboard: false })
      .addTo(map)
      .on('click', () => selectLocation(loc, `${loc.name}, ${loc.state}`));
  });

  let pixel = null;
  function showPixel(loc) {
    if (pixel) pixel.remove();
    const dLat = 0.5 / 111.32; // 1 km square (±500 m)
    const dLng = 0.5 / (111.32 * Math.cos(loc.lat * Math.PI / 180));
    pixel = L.rectangle([[loc.lat - dLat, loc.lng - dLng], [loc.lat + dLat, loc.lng + dLng]], {
      color: '#c8f169', weight: 1.5, dashArray: '4 4', fillColor: '#c8f169', fillOpacity: 0.08, interactive: false,
    }).addTo(map);
  }

  function updateHud() {
    const c = map.getCenter();
    const coords = `${c.lat.toFixed(4)}°, ${c.lng.toFixed(4)}°`;
    el.hud.innerHTML = state.location
      ? `<b>${state.location.name}</b> · ${coords}`
      : coords;
  }
  // The map panel stretches with the side column, so keep Leaflet's size in sync
  if ('ResizeObserver' in window) new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById('map'));
  map.on('move', updateHud);
  updateHud();

  /* =========================================================
   * Address search (Perth / Brisbane / Melbourne only for now)
   * ========================================================= */
  function matchLocations(q) {
    const s = q.trim().toLowerCase();
    if (!s) return Object.values(LOCATIONS);
    return Object.values(LOCATIONS).filter(l =>
      l.patterns.some(p => p.test(s)) ||
      l.name.toLowerCase().startsWith(s) ||
      l.region.toLowerCase().startsWith(s));
  }

  let activeIdx = -1;
  let currentMatches = [];

  function renderSuggestions() {
    const q = el.input.value.trim();
    currentMatches = matchLocations(q);
    const typedAddress = q && !Object.values(LOCATIONS).some(l => l.name.toLowerCase().startsWith(q.toLowerCase()));
    let html = '';
    if (!q) html += '<li class="s-head" role="presentation">Supported regions</li>';
    if (currentMatches.length) {
      html += currentMatches.map((l, i) => `
        <li role="option" id="opt-${l.id}" data-id="${l.id}" aria-selected="${i === activeIdx}">
          <span class="s-pin">${ICON_PIN}</span>
          <span>
            <div class="s-main">${typedAddress ? escapeHtml(q) : `${l.name}, ${l.region}`}</div>
            <div class="s-sub">${typedAddress ? `→ ${l.name} region · ` : ''}${l.lat.toFixed(3)}, ${l.lng.toFixed(3)}</div>
          </span>
        </li>`).join('');
    } else {
      html += '<li class="s-note" role="presentation">No supported match. This preview covers <b>Perth</b>, <b>Brisbane</b> and <b>Melbourne</b> only.</li>';
    }
    el.sugg.innerHTML = html;
    el.sugg.hidden = false;
    el.input.setAttribute('aria-expanded', 'true');
  }
  function closeSuggestions() {
    el.sugg.hidden = true;
    el.input.setAttribute('aria-expanded', 'false');
    activeIdx = -1;
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  el.input.addEventListener('focus', renderSuggestions);
  el.input.addEventListener('input', () => { activeIdx = -1; renderSuggestions(); });
  el.input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (el.sugg.hidden) renderSuggestions();
      if (!currentMatches.length) return;
      activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + currentMatches.length) % currentMatches.length;
      renderSuggestions();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = el.input.value.trim();
      const matches = matchLocations(q);
      const pick = matches[Math.max(activeIdx, 0)];
      if (q && pick) choose(pick, q);
      else renderSuggestions();
    } else if (e.key === 'Escape') {
      closeSuggestions();
    }
  });
  el.sugg.addEventListener('mousedown', e => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    e.preventDefault();
    choose(LOCATIONS[li.dataset.id], el.input.value.trim());
  });
  document.addEventListener('click', e => { if (!e.target.closest('#search')) closeSuggestions(); });

  function choose(loc, typed) {
    const isJustName = !typed || Object.values(LOCATIONS).some(l => l.name.toLowerCase().startsWith(typed.toLowerCase()));
    selectLocation(loc, isJustName ? `${loc.name}, ${loc.state}` : typed);
    closeSuggestions();
    el.input.blur();
  }

  document.querySelectorAll('.map-quick button').forEach(b =>
    b.addEventListener('click', () => {
      const loc = LOCATIONS[b.dataset.loc];
      selectLocation(loc, `${loc.name}, ${loc.state}`);
    }));

  function selectLocation(loc, address) {
    state.location = loc;
    state.address = address;
    el.input.value = address;
    Object.values(LOCATIONS).forEach(l => siteMarkers[l.id].setIcon(siteIcon(l, l.id === loc.id)));
    document.querySelectorAll('.map-quick button').forEach(b => b.classList.toggle('is-active', b.dataset.loc === loc.id));
    showPixel(loc);
    map.flyTo([loc.lat, loc.lng], 13, { duration: 1.8 });
    map.once('moveend', () => {
      L.popup({ offset: [0, -10], closeButton: true, autoPan: false })
        .setLatLng([loc.lat, loc.lng])
        .setContent(`<div class="pp-title">${escapeHtml(address)}</div><div class="pp-sub">${loc.lat.toFixed(4)}°, ${loc.lng.toFixed(4)}° · MODIS 1 km pixel</div>`)
        .openOn(map);
    });
    render();
  }

  /* =========================================================
   * Crop + controls
   * ========================================================= */
  function selectCrop(id) {
    targetMemory[state.crop] = state.targetC;
    if (id !== state.crop) state.sowPick = null;
    state.crop = id;
    document.querySelectorAll('.crop').forEach(b => b.setAttribute('aria-checked', String(b.dataset.crop === id)));
    setTarget(targetMemory[id] ?? cropDefault());
  }
  document.querySelectorAll('.crop').forEach(btn =>
    btn.addEventListener('click', () => selectCrop(btn.dataset.crop)));

  el.season.addEventListener('change', () => { state.season = Number(el.season.value); render(); });

  // Sowing-date chooser lives inside the (re-rendered) KPI card
  el.kpi.addEventListener('click', e => {
    const b = e.target.closest('[data-pick]');
    if (!b || b.disabled) return;
    state.sowPick = Number(b.dataset.pick);
    render();
  });

  /* ---------- Target sowing temperature ---------- */
  const rMin = Number(el.range.min), rMax = Number(el.range.max);

  function setTarget(v, { scrubbing = false } = {}) {
    const def = cropDefault();
    state.targetC = Math.min(rMax, Math.max(rMin, v));
    el.range.value = state.targetC;
    el.targetOut.innerHTML = `${state.targetC.toFixed(1)}<span>°C</span>`;
    el.rangeDefault.style.left = `calc(11px + (100% - 22px) * ${(def - rMin) / (rMax - rMin)})`;
    el.targetReset.textContent = `Reset to ${def % 1 ? def.toFixed(1) : def} °C`;
    el.targetReset.hidden = state.targetC === def;
    document.body.classList.toggle('is-scrubbing', scrubbing);
    scheduleRender();
  }
  let rafId = 0;
  function scheduleRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; render(); });
  }
  el.range.addEventListener('input', () => setTarget(Number(el.range.value), { scrubbing: true }));
  el.range.addEventListener('change', () => document.body.classList.remove('is-scrubbing'));
  el.targetReset.addEventListener('click', () => setTarget(cropDefault()));
  el.rainToggle.addEventListener('change', () => { state.useRain = el.rainToggle.checked; render(); });

  document.querySelectorAll('.segmented button').forEach(btn =>
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      document.querySelectorAll('.segmented button').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
      render();
    }));

  /* =========================================================
   * Rendering
   * ========================================================= */
  let currentPlan = null;
  let currentWindows = null;
  let currentPick = 0;

  function render() {
    const crop = CROPS[state.crop];
    const ready = state.location && crop.available;

    el.targetCtl.classList.toggle('is-disabled', !crop.available);
    el.range.disabled = !crop.available;
    el.rainToggle.checked = state.useRain;
    if (crop.rain) el.rainHint.textContent = `${crop.name} needs ${crop.rain.min}–${crop.rain.max} mm/week of typical rain over the 2 weeks before and during sowing.`;

    // Season options follow the selected crop (fall back to wheat so the control stays populated)
    const opts = seasonOptions(crop.available ? crop : CROPS.wheat, state.targetC, state.location, state.useRain);
    if (!state.season || !opts.some(o => o.year === state.season)) state.season = opts[0].year;
    el.season.innerHTML = opts.map(o =>
      `<option value="${o.year}"${o.year === state.season ? ' selected' : ''}>${o.year}${o === opts[0] ? ' · next' : ''}</option>`).join('');
    el.season.disabled = !ready;

    if (!state.location) {
      currentPlan = null;
      renderEmptyKpi('location');
      renderLegend(false);
      renderPlanBody(null, 'location');
      el.cards.innerHTML = '';
      return;
    }
    if (!crop.available) {
      currentPlan = null;
      renderEmptyKpi('crop', crop);
      renderLegend(false);
      renderPlanBody(null, 'crop', crop);
      el.cards.innerHTML = '';
      return;
    }

    currentWindows = findSowingWindows(state.season, crop, state.targetC, state.location, state.useRain);
    const pick = currentPick = resolvePick(currentWindows.options);
    currentPlan = buildPlan(currentWindows.options[pick].start, crop, state.location);
    // Temperature-only result, to explain what the rainfall check changed
    const plain = currentWindows.rainOn ? findSowingWindows(state.season, crop, state.targetC, state.location, false) : null;
    renderKpi(currentPlan, currentWindows, pick, plain);
    renderLegend(true);
    renderPlanBody(currentPlan);
    renderCards(currentPlan);
  }

  // Which sowing date to plan: the farmer's choice if it still exists and its range hasn't closed, else the best fit, else whichever is still open
  function resolvePick(options) {
    const open = i => i >= 0 && i < options.length && isOpen(options[i]);
    if (state.sowPick !== null && open(state.sowPick)) return state.sowPick;
    const bi = options.findIndex(o => o.isBest);
    if (open(bi)) return bi;
    const next = options.findIndex(isOpen);
    return next >= 0 ? next : bi;
  }

  function renderEmptyKpi(kind, crop) {
    const msg = kind === 'location'
      ? { h: 'Where is your farm?', p: 'Enter your address or tap a supported region on the map. We will work out the best week to start sowing.' }
      : { h: `${crop.name} data is on the way`, p: `We are still assembling phenology data for ${crop.name.toLowerCase()}. Wheat and barley are ready to plan now.` };
    el.kpi.innerHTML = `
      <div class="kpi-label">Recommended sowing start</div>
      <div class="empty">
        <div class="empty-icon">${kind === 'location' ? ICON_PIN : ICON_SEED}</div>
        <h3>${msg.h}</h3>
        <p>${msg.p}</p>
      </div>`;
  }

  function renderPicker(options, pick) {
    if (options.length < 2) return '';
    return `
      <div class="sow-pick-head">2 sowing dates this season · choose one</div>
      <div class="sow-pick" role="radiogroup" aria-label="Sowing date">
        ${options.map((o, i) => {
          const passed = !isOpen(o);
          const tag = passed ? 'Passed' : o.isBest ? 'Best fit' : '';
          return `
          <button type="button" role="radio" data-pick="${i}" aria-checked="${i === pick}"${passed ? ' disabled' : ''}>
            <span class="sp-k">Date ${i + 1}${tag ? ` · <em>${tag}</em>` : ''}</span>
            <span class="sp-v">${fmtRange(o.range)}</span>
            <span class="sp-s">aim ${fmtShort(o.start)} · ${o.warming ? '↗ warming' : '↘ cooling'}</span>
          </button>`;
        }).join('')}
      </div>`;
  }

  // Dates the rainfall check moved or dropped, compared with the temperature-only result
  function rainChanges(windows, plain, crop) {
    if (!plain || windows.rainLimited) return [];
    const has = (list, d) => list.options.some(o => +o.start === +d.start);
    return plain.options.filter(p => !has(windows, p)).map(p => {
      const why = `${p.rain.toFixed(1)} mm/week typical, ${p.rain < crop.rain.min ? 'too dry' : 'too wet'}`;
      const moved = windows.options.find(o => o.warming === p.warming && !has(plain, o));
      return moved
        ? `<b>${fmtShort(p.start)}</b> → <b>${fmtShort(moved.start)}</b> (${why})`
        : `<b>${fmtShort(p.start)}</b> dropped (${why})`;
    });
  }

  function renderKpi(plan, windows, pick, plain) {
    const best = windows.options[pick];
    const sow = plan.phases[0];
    const crop = CROPS[state.crop];
    const changes = rainChanges(windows, plain, crop);
    const r = best.range;
    const opensIn = daysBetween(today, r.start), closesIn = daysBetween(today, r.end);
    const count = opensIn > 0 ? `Opens in ${opensIn} day${opensIn === 1 ? '' : 's'}`
      : `Open now · closes ${closesIn === 0 ? 'today' : `in ${closesIn} day${closesIn === 1 ? '' : 's'}`}`;
    const rangeDays = daysBetween(r.start, r.end) + 1;
    const total = daysBetween(plan.start, plan.end);
    el.kpi.innerHTML = `
      <div class="kpi-label">${CROPS[state.crop].name} sowing start · ${state.location.name}</div>
      <div class="kpi-date is-range">${fmtRange(r)}
        <small>Aim for ${fmt(plan.start, { weekday: 'short', day: 'numeric', month: 'short' })}${rangeDays > 1 ? ` · ${rangeDays}-day range` : ''} · ${plan.start.getFullYear()} season</small>
      </div>
      <span class="kpi-count">${ICON_CLOCK.replace('<svg', '<svg width="14" height="14"')}${count}</span>
      ${renderPicker(windows.options, pick)}
      <div class="kpi-stats">
        <div class="stat"><div class="stat-k">Window avg LST</div><div class="stat-v">${best.mean.toFixed(1)}<span class="u">°C</span></div></div>
        <div class="stat"><div class="stat-k">Target</div><div class="stat-v">${state.targetC.toFixed(1)}<span class="u">°C</span></div></div>
        <div class="stat"><div class="stat-k">Fit (RMSE)</div><div class="stat-v">±${best.rmse.toFixed(1)}<span class="u">°C</span></div></div>
        <div class="stat"><div class="stat-k">Typical rain</div><div class="stat-v">${best.rain.toFixed(1)}<span class="u">mm/wk</span></div></div>
      </div>
      ${windows.rainLimited ? `
      <div class="kpi-warn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5M12 17.5v.01"/></svg>
        <span>No sowing window this season typically gets ${crop.rain.min}–${crop.rain.max} mm/week of rain in ${state.location.name}, so this date is based on temperature only. Plan to irrigate, or wait for a good rain.</span>
      </div>` : ''}
      ${changes.length ? `
      <div class="kpi-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5c3.2 4.2 6 7.6 6 10.9a6 6 0 0 1-12 0c0-3.3 2.8-6.7 6-10.9z"/></svg>
        <span>Rainfall check: ${changes.join('; ')}.</span>
      </div>` : ''}
      ${Math.abs(best.mean - state.targetC) > 1 ? `
      <div class="kpi-warn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5M12 17.5v.01"/></svg>
        <span>${state.targetC.toFixed(1)} °C is at the edge of the predicted range. The closest ${sow.length}-day window averages ${best.mean.toFixed(1)} °C.</span>
      </div>` : ''}
      <div class="kpi-track" aria-hidden="true">
        ${plan.phases.map(p => `<span class="${PHASE_CLASS[p.key]}" style="flex:${p.length};background:var(--c)"></span>`).join('')}
      </div>
      <div class="kpi-track-labels"><span>${fmtShort(plan.start)}</span><span>${total} days</span><span>${fmtShort(plan.last)}</span></div>
      <div class="kpi-foot">
        ${+r.warm !== +r.cool ? `Start any day in the range: a warmer year than usual suits <b>${fmtShort(r.warm)}</b>, a cooler one <b>${fmtShort(r.cool)}</b>. ` : ''}Starting on the aim date, sowing runs <b>${fmtShort(sow.start)} – ${fmtShort(sow.last)}</b>, harvest finishes by <b>${fmtShort(plan.phases[2].last)}</b> and land is ready for the next rotation on <b>${fmtLong(plan.end)}</b>.
      </div>`;
  }

  function renderLegend(show) {
    if (!show) { el.legend.innerHTML = ''; return; }
    el.legend.innerHTML = CROPS[state.crop].phases.map(p =>
      `<span class="${PHASE_CLASS[p.key]}"><i style="background:var(--c)"></i>${p.name}</span>`).join('') +
      (state.view === 'timeline'
        ? `<span class="lg-temp"><i></i>Predicted LST</span><span class="lg-band"><i></i>Middle 60% of readings</span><span class="lg-extreme"><i></i>Min / max</span><span class="lg-ideal"><i></i>${state.targetC.toFixed(1)} °C sowing target</span>` +
          '<span class="lg-range"><i></i>Sowing start range</span>' +
          '<span class="lg-rain"><i></i>Typical rain</span>' +
          (state.useRain ? `<span class="lg-rainband"><i></i>${CROPS[state.crop].rain.min}–${CROPS[state.crop].rain.max} mm/wk rain range</span>` : '')
        : '<span><i style="outline:1px dashed var(--sow);outline-offset:-1px"></i>Sowing start range</span>' +
          '<span><i style="outline:1.5px solid var(--text);outline-offset:-1.5px"></i>Today</span>');
  }

  function renderPlanBody(plan, emptyKind, crop) {
    if (!plan) {
      const msg = emptyKind === 'crop'
        ? { h: `No ${crop ? crop.name.toLowerCase() : ''} timeline yet`, p: 'Switch to wheat or barley to see a full four-phase season plan.' }
        : { h: 'Your season timeline appears here', p: 'Pick a farm location to see sowing, growth, harvest and post-harvest phases mapped against predicted land-surface temperature.' };
      el.plan.innerHTML = `<div class="empty" style="min-height:220px"><div class="empty-icon">${ICON_CLOCK}</div><h3>${msg.h}</h3><p>${msg.p}</p></div>`;
      return;
    }
    renderLegend(true);
    if (state.view === 'calendar') renderCalendar(plan);
    else renderTimeline(plan);
  }

  /* ---------- Timeline ---------- */
  const T_MIN = 0, T_MAX = 50; // the max curve peaks near 49.5 °C in January, the min curve dips to ~0–4 °C in winter
  const yPct = v => ((T_MAX - v) / (T_MAX - T_MIN)) * 100;

  function renderTimeline(plan) {
    const rStart = new Date(plan.start.getFullYear(), plan.start.getMonth() - 1, 1);
    const rEnd = new Date(plan.last.getFullYear(), plan.last.getMonth() + 2, 1);
    const N = daysBetween(rStart, rEnd);
    const xPct = d => (daysBetween(rStart, d) / N) * 100;

    // Temperature curve
    const temps = [], bands = [];
    for (let i = 0; i <= N; i++) {
      const d = addDays(rStart, i);
      temps.push(tempC(d, state.location));
      bands.push(tempBand(d, state.location));
    }
    const pathOf = vals => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${i},${yPct(v).toFixed(2)}`).join('');
    const line = pathOf(temps);
    // 20% curves: the filled band runs along the upper curve, then back along the lower one
    const hiLine = pathOf(bands.map(b => b.hi)), loLine = pathOf(bands.map(b => b.lo));
    const band = `${hiLine}${bands.map((b, i) => `L${i},${yPct(b.lo).toFixed(2)}`).reverse().join('')}Z`;
    const maxLine = pathOf(bands.map(b => b.max)), minLine = pathOf(bands.map(b => b.min));

    const sow = plan.phases[0];
    const sx = daysBetween(rStart, sow.start), sw = sow.length;
    const gridVals = [10, 20, 30, 40];

    // Rain strip: its own small chart under the LST chart, sharing the date axis (never a second y-axis)
    const loc = state.location, cropRain = CROPS[state.crop].rain;
    const RAIN_MAX = 40; // mm/week; the wettest fitted week (Brisbane, Feb) is ~38
    const ry = v => (1 - Math.min(v, RAIN_MAX) / RAIN_MAX) * 100;
    const rains = [];
    for (let i = 0; i <= N; i++) rains.push(rainDay(loc, addDays(rStart, i)) * 7);
    const rainLine = rains.map((v, i) => `${i === 0 ? 'M' : 'L'}${i},${ry(v).toFixed(2)}`).join('');
    const rainArea = `${rainLine}L${N},100L0,100Z`;
    const rwx = sx - RAIN_LEAD, rww = RAIN_LEAD + sw; // the window the rainfall check looks at

    // Month ticks
    const months = [];
    for (let m = new Date(rStart); m < rEnd; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      months.push({ d: m, left: xPct(m), width: xPct(next) - xPct(m) });
    }

    const showToday = today >= rStart && today < rEnd;

    // Sowing start range: a full-height band from the first to the last good start day (inclusive).
    // The aim date is a faint dashed line inside it; the Sowing phase bar below still starts on the aim date.
    const rng = currentWindows.options[currentPick].range;
    const span = rg => {
      const x = Math.max(0, daysBetween(rStart, rg.start));
      return { x, w: Math.min(N, daysBetween(rStart, rg.end) + 1) - x };
    };
    const rs = span(rng);
    const ax = daysBetween(rStart, plan.start) + 0.5; // middle of the aim day
    const inRange = d => d >= rng.start && d <= rng.end;

    // The other sowing date's range (if the season has two), drawn faintly when it falls inside the chart
    const others = (currentWindows ? currentWindows.options : [])
      .map((o, i) => ({ ...o, n: i + 1 }))
      .filter((o, i) => i !== currentPick && o.range.start >= rStart && o.range.end < rEnd)
      .map(o => ({ ...o, s: span(o.range) }));

    el.plan.innerHTML = `
      <div class="tl">
        <div class="tl-plot" id="tlPlot">
          <div class="tl-chart">
            <div class="tl-yaxis">
              <span class="tl-ytitle">LST °C</span>
              ${gridVals.map(v => `<span style="top:${yPct(v)}%">${v}°</span>`).join('')}
            </div>
            <svg viewBox="0 0 ${N} 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="lstStroke" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
                  <stop offset="0" stop-color="#ff8a4c"/>
                  <stop offset="${(yPct(26) / 100).toFixed(3)}" stop-color="#f4b544"/>
                  <stop offset="${(yPct(20) / 100).toFixed(3)}" stop-color="#a6e35a"/>
                  <stop offset="1" stop-color="#4cc3ff"/>
                </linearGradient>
                <linearGradient id="lstBand" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
                  <stop offset="0" stop-color="#ff8a4c" stop-opacity=".2"/>
                  <stop offset="${(yPct(26) / 100).toFixed(3)}" stop-color="#f4b544" stop-opacity=".18"/>
                  <stop offset="${(yPct(20) / 100).toFixed(3)}" stop-color="#a6e35a" stop-opacity=".16"/>
                  <stop offset="1" stop-color="#4cc3ff" stop-opacity=".16"/>
                </linearGradient>
                <linearGradient id="sowBand" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#5ff5dd" stop-opacity=".5"/>
                  <stop offset="1" stop-color="#5ff5dd" stop-opacity=".18"/>
                </linearGradient>
              </defs>
              ${gridVals.map(v => `<line x1="0" x2="${N}" y1="${yPct(v)}" y2="${yPct(v)}" stroke="rgba(255,255,255,0.05)" vector-effect="non-scaling-stroke"/>`).join('')}
              <rect x="${rs.x}" y="0" width="${rs.w}" height="100" fill="url(#sowBand)"/>
              <line x1="${rs.x}" x2="${rs.x}" y1="0" y2="100" stroke="#5ff5dd" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
              <line x1="${rs.x + rs.w}" x2="${rs.x + rs.w}" y1="0" y2="100" stroke="#5ff5dd" stroke-opacity=".85" stroke-width="2" vector-effect="non-scaling-stroke"/>
              <line x1="${ax}" x2="${ax}" y1="0" y2="100" stroke="#5ff5dd" stroke-opacity=".85" stroke-width="1.5" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
              ${others.map(o => `<rect class="tl-alt" x="${o.s.x}" y="0" width="${o.s.w}" height="100" fill="#5ff5dd" fill-opacity=".12" stroke="#5ff5dd" stroke-opacity=".7" stroke-width="1.5" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`).join('')}
              <path d="${maxLine}" fill="none" stroke="#ff9a5c" stroke-opacity=".95" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="0.5 7" vector-effect="non-scaling-stroke"/>
              <path d="${minLine}" fill="none" stroke="#5fd3ff" stroke-opacity=".95" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="0.5 7" vector-effect="non-scaling-stroke"/>
              <path d="${band}" fill="url(#lstBand)"/>
              <path d="${hiLine}" fill="none" stroke="url(#lstStroke)" stroke-opacity=".75" stroke-width="1.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
              <path d="${loLine}" fill="none" stroke="url(#lstStroke)" stroke-opacity=".75" stroke-width="1.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
              <line x1="0" x2="${N}" y1="${yPct(state.targetC)}" y2="${yPct(state.targetC)}" stroke="#e9f0ea" stroke-opacity=".55" stroke-dasharray="5 5" vector-effect="non-scaling-stroke"/>
              <path d="${line}" fill="none" stroke="url(#lstStroke)" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
            </svg>
            <span class="tl-ideal-tag" style="top:${yPct(state.targetC)}%">${state.targetC.toFixed(1)} °C target</span>
            <span class="tl-window-tag is-start" style="left:${(rs.x / N) * 100}%">Start ${fmtRange(rng)}</span>
            <span class="tl-aim-tag" style="left:${(ax / N) * 100}%">aim ${fmtShort(plan.start)}</span>
            ${others.map(o => `<span class="tl-window-tag is-alt" style="left:${((o.s.x + o.s.w / 2) / N) * 100}%">Date ${o.n}</span>`).join('')}
          </div>
          <div class="tl-rain">
            <div class="tl-yaxis">
              <span class="tl-ytitle">Rain<br>mm/wk</span>
              <span style="top:${ry(0)}%">0</span><span style="top:${ry(20)}%">20</span><span style="top:${ry(40)}%">40</span>
            </div>
            <svg viewBox="0 0 ${N} 100" preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" x2="${N}" y1="${ry(20)}" y2="${ry(20)}" stroke="rgba(255,255,255,0.05)" vector-effect="non-scaling-stroke"/>
              <rect x="${rwx}" y="0" width="${rww}" height="100" fill="#3fd5c0" fill-opacity=".07"/>
              ${state.useRain ? `<rect x="0" y="${ry(cropRain.max)}" width="${N}" height="${ry(cropRain.min) - ry(cropRain.max)}" fill="#4cc3ff" fill-opacity=".14"/>
              <line x1="0" x2="${N}" y1="${ry(cropRain.max)}" y2="${ry(cropRain.max)}" stroke="#9be8ff" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"/>
              <line x1="0" x2="${N}" y1="${ry(cropRain.min)}" y2="${ry(cropRain.min)}" stroke="#9be8ff" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"/>` : ''}
              <path d="${rainArea}" fill="#4cc3ff" fill-opacity=".16"/>
              <path d="${rainLine}" fill="none" stroke="#4cc3ff" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
            </svg>
          </div>
          <div class="tl-months">
            ${months.map(m => `<span class="${m.d.getMonth() === 0 ? 'yr' : ''}" style="left:${m.left}%;width:${m.width}%">${fmt(m.d, { month: 'short' })}${m.d.getMonth() === 0 || m === months[0] ? ` ’${String(m.d.getFullYear()).slice(2)}` : ''}</span>`).join('')}
          </div>
          <div class="tl-lanes">
            ${plan.phases.map((p, i) => {
              const w = xPct(p.end) - xPct(p.start);
              const narrow = w < 16 ? (xPct(p.end) > 70 ? ' is-narrow to-left' : ' is-narrow') : '';
              return `
              <div class="lane">
                <div class="lane-label"><b>${p.name}</b><small>${p.label}</small></div>
                <div class="lane-track"></div>
                <div class="bar ${PHASE_CLASS[p.key]}${narrow}" style="left:${xPct(p.start)}%;width:${w}%;animation-delay:${i * 0.12}s">
                  <span class="bar-text">${fmtShort(p.start)} – ${fmtShort(p.last)}</span>
                </div>
              </div>`;
            }).join('')}
          </div>
          ${showToday ? `<div class="tl-today" style="left:${xPct(today)}%"><span>Today</span></div>` : ''}
          <div class="tl-cursor" id="tlCursor"><span class="tl-cursor-dot" id="tlDot"></span><div class="tl-tip" id="tlTip"></div></div>
        </div>
      </div>`;

    // Hover read-out
    const plot = $('#tlPlot'), cursor = $('#tlCursor'), tip = $('#tlTip'), dot = $('#tlDot');
    const chartH = plot.querySelector('.tl-chart').offsetHeight;
    const move = clientX => {
      const r = plot.getBoundingClientRect();
      const f = Math.min(Math.max((clientX - r.left) / r.width, 0), 0.9999);
      const i = Math.floor(f * N);
      const d = addDays(rStart, i);
      const v = temps[i];
      const ph = phaseAt(plan, d);
      cursor.style.display = 'block';
      cursor.style.left = `${(i / N) * 100}%`;
      cursor.classList.toggle('flip', f > 0.68);
      dot.style.top = `${(yPct(v) / 100) * chartH}px`;
      tip.innerHTML = `
        <div class="t-date">${fmtLong(d)}</div>
        <div class="t-temp">${fmtC(v)}</div>
        <div class="t-band">middle 60%: ${bands[i].lo.toFixed(1)}–${fmtC(bands[i].hi)}</div>
        <div class="t-band">min–max: ${bands[i].min.toFixed(1)}–${fmtC(bands[i].max)}</div>
        <div class="t-rain">~${rains[i].toFixed(0)} mm/week rain</div>
        ${inRange(d) ? `<div class="t-range">${+d === +plan.start ? 'Aim date to start sowing' : 'In sowing start range'}</div>` : ''}
        <div class="t-phase ${ph ? PHASE_CLASS[ph.key] : ''}"><i></i>${ph ? ph.name : 'Off-season'}</div>`;
    };
    plot.addEventListener('mousemove', e => move(e.clientX));
    plot.addEventListener('touchmove', e => move(e.touches[0].clientX), { passive: true });
    plot.addEventListener('mouseleave', () => { cursor.style.display = 'none'; });
  }

  /* ---------- Calendar ---------- */
  function renderCalendar(plan) {
    const rng = currentWindows.options[currentPick].range;
    const first = rng.start < plan.start ? rng.start : plan.start; // the start range can open before the aim date's month
    const planMonth = new Date(plan.start.getFullYear(), plan.start.getMonth(), 1);
    const months = [];
    for (let m = new Date(first.getFullYear(), first.getMonth(), 1);
      m <= plan.last; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) months.push(m);

    const dow = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    el.plan.innerHTML = `<div class="cal">${months.map(m => {
      const n = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      const lead = (m.getDay() + 6) % 7;
      const monthLabel = m < planMonth ? 'Start range' : (phaseAt(plan, m) || phaseAt(plan, plan.start)).name;
      let cells = dow.map(d => `<div class="cal-dow">${d}</div>`).join('');
      cells += '<div></div>'.repeat(lead);
      for (let day = 1; day <= n; day++) {
        const d = new Date(m.getFullYear(), m.getMonth(), day);
        const ph = phaseAt(plan, d);
        const isStart = ph && d.getTime() === ph.start.getTime();
        const inRange = d >= rng.start && d <= rng.end;
        const cls = ['cal-day', ph ? `in ${PHASE_CLASS[ph.key]}` : '', isStart ? 'start' : '', inRange ? 'range' : '', d.getTime() === today.getTime() ? 'today' : ''].join(' ');
        const title = `${fmtLong(d)} · ${fmtC(tempC(d, state.location))}${ph ? ` · ${ph.name}${isStart ? ' begins' : ''}` : ''}${inRange ? ' · in sowing start range' : ''}`;
        cells += `<div class="${cls}" title="${title}">${day}</div>`;
      }
      return `
        <div class="cal-month">
          <div class="cal-title"><b>${fmt(m, { month: 'long', year: 'numeric' })}</b><span>${monthLabel}</span></div>
          <div class="cal-grid">${cells}</div>
        </div>`;
    }).join('')}</div>`;
  }

  /* ---------- Phase cards ---------- */
  function renderCards(plan) {
    el.cards.innerHTML = plan.phases.map((p, i) => `
      <article class="phase ${PHASE_CLASS[p.key]}" style="animation-delay:${i * 0.08}s">
        <div class="phase-top">
          <span class="phase-idx">Phase ${i + 1}</span>
          <span class="phase-dur">${p.label} · ${p.length}d</span>
        </div>
        <h3>${p.name}</h3>
        <div class="phase-dates">${fmtShort(p.start)} → ${fmt(p.last, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
        <div class="phase-temp"><b>${p.stats.mean.toFixed(1)}°</b><span>avg predicted LST</span></div>
        <div class="phase-range">range ${p.stats.min.toFixed(1)}° – ${p.stats.max.toFixed(1)}°C · ~${p.stats.rain.toFixed(0)} mm rain</div>
        <p>${p.note.replace('{T}', state.targetC.toFixed(1))}</p>
      </article>`).join('');
  }

  /* ---------- Deep links: ?loc=perth&crop=wheat&view=calendar ---------- */
  setTarget(state.targetC); // initialise slider UI (default tick, reset label)
  const params = new URLSearchParams(location.search);
  const pCrop = params.get('crop');
  if (pCrop && CROPS[pCrop]) selectCrop(pCrop);
  if (params.get('view') === 'calendar') {
    state.view = 'calendar';
    document.querySelectorAll('.segmented button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === 'calendar')));
  }
  const pTarget = parseFloat(params.get('target'));
  if (Number.isFinite(pTarget)) setTarget(Math.round(pTarget * 2) / 2);
  const pSow = params.get('sow');
  if (pSow === '1' || pSow === '2') state.sowPick = Number(pSow) - 1;
  if (params.get('rain') === '0') state.useRain = false;
  const pLoc = LOCATIONS[params.get('loc')];
  if (pLoc) selectLocation(pLoc, `${pLoc.name}, ${pLoc.state}`);
  else render();
})();
