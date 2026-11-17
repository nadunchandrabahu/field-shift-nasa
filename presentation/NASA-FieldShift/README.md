# FieldShift — Sowing Planner (webapp-v1)

A web app for farmers that recommends **when to start sowing** a crop, based on a land-surface temperature (LST) model fitted to NASA MODIS satellite data, plus an optional rainfall check using NASA POWER precipitation data. The farmer picks a farm location and a crop, and the app lays out the whole season (sowing → crop growth → harvesting → post-harvest) as a timeline and a calendar.

This is a prototype. It supports three locations (Perth, Brisbane and Melbourne) and has data for three crops (wheat, barley and corn).

---

## Quick start

There is no build step and no server. **Open `index.html` in a browser.**

An internet connection is needed for:
- Leaflet map library (cdnjs)
- Satellite map tiles (Esri World Imagery)
- Fonts (Google Fonts)

All planning maths runs in the browser. No data is fetched.

### Handy URLs

The app reads query parameters, which is useful for demos and screenshots:

| Parameter | Values | Example |
|---|---|---|
| `loc` | `perth`, `brisbane`, `melbourne` | `index.html?loc=perth` |
| `crop` | `wheat`, `barley`, `corn` | `index.html?loc=perth&crop=barley` |
| `target` | sowing target in °C (16–34, rounded to 0.5) | `index.html?loc=brisbane&target=24` |
| `view` | `timeline` (default), `calendar` | `index.html?loc=perth&view=calendar` |
| `sow` | `1`, `2`: which sowing date to plan when the season has two (in date order) | `index.html?loc=brisbane&crop=corn&sow=2` |
| `rain` | `0` turns the rainfall check off (it's on by default) | `index.html?loc=brisbane&crop=corn&rain=0` |

---

## Files

```
webapp-v1/
├── index.html   Page structure: header, map + search, crop picker, slider, plan panel, model section
├── styles.css   All styling: dark theme tokens, components, timeline/calendar, responsive rules
├── app.js       All logic: model, planning, map, search, rendering
└── README.md    This guide
```

The temperature model came from `../day_1km_regression-Towoomba.ipynb`, which was fitted on `../day_1km-towoomba.csv`.

The rainfall curves came from `../rainfall/fit_rainfall.py`, which fits the cached NASA POWER downloads in `../rainfall/<city>.csv`. If a CSV is missing, the script downloads it again.

---

## What the user sees

1. **01 · Farm location**: an address box over a satellite map of Australia.
   - Typing *Perth*, *Brisbane*, *Melbourne*, a street address containing one of those cities, a postcode (`6xxx` → Perth, `4xxx` → Brisbane, `3xxx` → Melbourne), or a nearby suburb (e.g. Fremantle, Ipswich, Geelong) resolves to that region. Arrow keys and Enter work in the suggestion list.
   - Anything else shows: *"This preview covers Perth, Brisbane and Melbourne only."*
   - You can also click the glowing city markers or the **Jump to** buttons.
   - The map then zooms to the location and draws a dashed **1 km square**, the footprint of one MODIS pixel.
2. **02 · Crop**: Wheat, Barley and Corn (all "Data ready").
   - Below the crops is the **Target sowing temperature** slider (16–34 °C, 0.5 steps).
   - Below that is the **Consider rainfall** switch (on by default), with the crop's rain range.
3. **Recommendation card**:
   - the **sowing start range** (e.g. *24 Apr – 12 May*), the aim date inside it, and when the range opens or closes. A note says which end suits a warmer or cooler year than usual
   - the window's average predicted LST, the target, how closely the window fits (RMSE), and the typical rain (mm/week, over the 2 weeks before sowing plus the sowing window)
   - a blue **Rainfall check** note when rain moved or dropped a date compared with temperature alone (e.g. *"12 Aug dropped (7.8 mm/week typical, too dry)"*), or an amber warning when no window in the season meets the rain range
   - a bar showing each phase's share of the season, and key end dates
   - when the season has **two sowing dates**, a chooser (*Date 1* / *Date 2*, in date order). Each date is tagged *Best fit* or *Passed*, and shows whether temperatures are ↘ cooling or ↗ warming at that point and how closely it fits. The farmer picks one, and the rest of the card, the timeline and the phase cards follow that choice.
4. **03 · Season plan**: a **Season** dropdown (next 5 seasons) and a **Timeline / Calendar** toggle.
   - **Timeline:** the predicted LST curve for the period, with a shaded band between the two 20% curves (the middle 60% of readings), the target line, and faint dotted min and max curves. The **sowing start range** is highlighted as a full-height teal band, tagged *Start 24 Apr – 12 May*. The aim date is a quieter dashed line inside it, labelled *aim 1 May*. The Sowing phase bar below still starts on the aim date and runs its full length (e.g. 6 weeks). If the other sowing date's range falls inside the chart, it's drawn as a faint dashed band. Under the LST chart is a separate **rain strip** on the same date axis: typical weekly rain, with the crop's rain range as a dashed band (when the rain check is on) and the window the rain check looks at shaded. Below it are four phase bars on the same date axis. Hovering shows the date, temperature, typical rain and phase.
   - **Calendar:** one small grid per month, with days coloured by phase, the start of each phase highlighted, and the start range outlined with a dashed line. The calendar starts from the month the range opens.
5. **Phase cards**: dates, length, average and range of predicted LST, and typical total rain for each phase, plus a short note.
6. **About the temperature model**: a collapsed, deliberately low-key section showing the equation and notes.

---

## How it works

### 1. Temperature model

From the regression notebook (MODIS Terra **MOD11A1** daytime LST, 1 km):

```python
def predict_lst(year, day):
    t = 2 * np.pi * day / 365
    return (302.008 - 0.0549 * (year - 2000)
            - 0.651 * np.sin(t)   + 9.866 * np.cos(t)
            - 0.395 * np.sin(2*t) - 1.668 * np.cos(2*t))
```

- `day` is the day of the year (1–365, or 366 in leap years).
- The two sine/cosine pairs model the annual and half-yearly cycle. The `year` term is a long-run trend.
- **The output is in Kelvin.** The app converts it with `tempC = predictLST(...) - 273.15`.
- Over a year it ranges from about **15.8 °C** (late June) to about **35.9 °C** (early January).

In `app.js` this is `predictLST(year, day, loc)`, and `tempC(date, loc)` wraps it for a JS `Date`. Each location has its own set of curves in `LST_MODELS` (Brisbane from `../day_1km_harmonic_regression-Queensland.ipynb`, Perth from `../day_1km_harmonic_regression-Perth.ipynb`), linked through `LOCATIONS[...].lst`. Melbourne doesn't have a fit yet and uses Brisbane's. `lstFor(loc)` picks the right set and falls back to Brisbane when no location is chosen. The coefficients above are Brisbane's.

**Spread band.** Two more harmonic curves with the same terms, also fitted on the Brisbane (Toowoomba) pixel, show how far real readings stray from the centre curve:

| Curve | Intercept | Year | sin t | cos t | sin 2t | cos 2t |
|---|---|---|---|---|---|---|
| Centre (`mid`) | 302.008 | −0.0549 | −0.651 | 9.866 | −0.395 | −1.668 |
| 20% of readings above (`upper`) | 304.535 | −0.0709 | −0.994 | 10.758 | −0.665 | −1.726 |
| 20% of readings below (`lower`) | 299.831 | −0.0393 | −0.503 | 9.085 | −0.441 | −1.884 |
| Maximum (`max`) | 312.917 | −0.0849 | −1.543 | 13.005 | −1.158 | −2.124 |
| Minimum (`min`) | 289.016 | −0.1710 | 1.661 | 5.388 | 1.353 | −0.900 |

So the middle 60% of readings fall between `lower` and `upper`, a band about 2–6 °C wide. `max` and `min` run from about 22–49.5 °C and 4–18 °C. All five live in `LST_MODEL`, `harmonicLST(coef, year, day)` evaluates any of them, and `tempBand(date)` returns `{ lo, hi, min, max }` in °C. The timeline draws the band as a fill and min/max as faint dotted lines, which is why its axis runs 0–50 °C. Sowing dates are picked from the centre curve, and the start range comes from `upper`/`lower` (see *Picking the sowing window*). `min`/`max` are drawn and shown in the tooltip only.

### 2. Rainfall model

Daily precipitation from **NASA POWER** (`PRECTOTCORR`, MERRA-2 bias-corrected, mm/day, 2001–2025), fitted **separately for each location** with three harmonics and no year trend:

```
rain_mm_day(day) = a0 + Σ(k=1..3) [ s_k·sin(k·t) + c_k·cos(k·t) ],  t = 2π·day/365   (clamped at 0)
```

| Location | Typical weekly rain (driest–wettest) | Pattern | R² vs 30-day climatology |
|---|---|---|---|
| Perth | 3–29 mm | wet winter, dry summer | 0.99 |
| Brisbane | 7–38 mm | wet summer, dry late winter | 0.96 |
| Melbourne | 10–18 mm | fairly even | 0.81 |

The coefficients live in each `LOCATIONS[...].rain`. `predictRain(loc, day)` evaluates the curve, `rainDay(loc, date)` wraps it for a JS `Date`, and `rainWeekly(loc, start, len)` gives typical mm/week over the **2 weeks before sowing plus the sowing window** (`RAIN_LEAD = 14`), since earlier rain sets seedbed moisture.

Each crop has a rain range in `CROPS[...].rain`: wheat and barley **5–25 mm/week**, corn **10–35 mm/week**. These are starting placeholders; change them there.

### 3. Picking the sowing window

`findSowingWindows(year, crop, target, loc, useRain)`:

1. For every possible start day in the season year, score the **sowing-phase window** (42 days for wheat and barley, 14 days for corn). The score is the **RMSE** of each day's predicted LST against the target.
2. **Rainfall is a hard constraint.** With the rain check on, a window is only *eligible* if its `rainWeekly` is inside the crop's range. If no window in the year qualifies, it falls back to temperature only and sets `rainLimited`, which triggers the amber warning.
3. **Best** = the eligible window with the lowest RMSE. RMSE is used instead of "average closest to target" because it rewards windows that *stay* near the target. A simple average can match the target while swinging well above and below it.
4. **Second sowing date.** The LST curve is cyclical, so a target is usually crossed twice a year: once while cooling (autumn) and once while warming (spring). A second date is offered only when it's a genuinely separate crossing:
   - it's eligible and a separate dip (local minimum) in the RMSE-by-start-day curve, ignoring windows that fail the rain check;
   - both windows' averages are within **1 °C** of the target (`MATCH_TOL`), so both are real matches and not just the least-bad option;
   - the two sowing windows don't overlap;
   - between the two dates the temperature strays at least **1.5 °C** from the target and comes back (`SWING_MIN`), checked both ways round the year. This rules out the "two" dips either side of the winter low (or summer peak) when the target sits right next to it. Those dips are really one window.

   With the current model, wheat and barley get one date at targets of 17.5 °C or below and two dates above that. Corn's shorter 2-week window separates sooner, so it gets two dates from 17.5 °C up. The search is circular, so a window that crosses New Year counts as one dip.

   `options` holds one or two windows in date order. `isBest` marks the lowest-RMSE one, `warming` says whether temperatures are rising across it, and `rain` is its typical mm/week.
5. **Start-date range.** Each option also gets a `range` of start dates, built from the two 20% curves. Starting at the centre date, `nearestDip` walks downhill in RMSE (same window length, same target) on the `upper` curve and on the `lower` curve until it reaches the nearest dip, which is the same crossing of the target. It only steps through windows that pass the rain check. In a warmer-than-usual year the target arrives on the `upper` date, and in a cooler one on the `lower` date. `range = { start, end, warm, cool }`, where `start`/`end` are the earliest and latest of the three dates. While temperatures are cooling (autumn), the warm-year date is the later one. While warming (spring), it's the earlier one. Typical width is 2–4 weeks. It gets wider near the winter low or summer peak, where the curve is flat (e.g. barley at 17.5 °C gives 31 days, wheat at 34 °C gives 52). The centre date is the **aim date**, and the season plan is built from it.

   A date counts as open until its range closes (`isOpen`). This is used by `resolvePick`, `seasonOptions` and the *Passed* tag.
6. **Explaining the rain effect.** `render` also runs the temperature-only search, and `rainChanges` lists any date the rain check moved (matched on the same warming/cooling side) or dropped.
7. **Choosing.** `state.sowPick` is `null` (automatic) or the index the farmer clicked. `resolvePick` uses the farmer's choice if it still exists and hasn't passed, otherwise the best fit, otherwise whichever date is still ahead. The choice carries over when you change the season or target, and resets when you change crop.

Results are cached per `crop:year:target:location:rainOn`.

### 4. Building the plan

`buildPlan(start, crop, loc)` chains the phases one after another from the sowing start:

| Crop | Default target | Sowing | Crop growth | Harvesting | Post-harvest |
|---|---|---|---|---|---|
| Wheat | 20 °C | 6 weeks (42 d) | 6 months | 6 weeks (42 d) | 2 weeks (14 d) |
| Barley | 17.5 °C | 6 weeks (42 d) | 5 months | 4 weeks (28 d) | 2 weeks (14 d) |
| Corn | 21 °C | 2 weeks (14 d) | 5 months | 5 weeks (35 d) | 2 weeks (14 d) |

- Phases defined in `days` use exact day counts. Phases defined in `months` use calendar months (`addMonths`).
- Each phase's end date is exclusive internally. The UI shows the last day (`last = end − 1 day`).
- `rangeStats` works out the average, minimum and maximum predicted LST and the typical total rain for each phase.

### 5. Seasons

`seasonOptions` lists the next **5 season years that still have at least one sowing date ahead**. A date that has already passed is shown in the chooser but greyed out. The first one is labelled "next". The list is recalculated when the crop, target, location or rain switch changes, because all of them can move the date.

### 6. Example results (2027 season, default targets, temperature only)

| Crop | Sowing start | Window avg | Season ends |
|---|---|---|---|
| Wheat (20 °C) | Sat 1 May 2027 (best fit) | 19.7 °C | 6 Feb 2028 (281 days) |
| | *or* Tue 20 Jul 2027 | 19.5 °C | |
| Barley (17.5 °C) | Tue 25 May 2027 (only date) | 16.9 °C | 17 Jan 2028 (237 days) |
| Corn (21 °C) | Fri 7 May 2027 (best fit) | 20.9 °C | 8 Dec 2027 (216 days) |
| | *or* Thu 12 Aug 2027 | 20.9 °C | 15 Mar 2028 (216 days) |

With the rainfall check on, these change:

| Location · crop | Temperature only | With rain check | Why |
|---|---|---|---|
| Brisbane · corn | 7 May *or* 12 Aug | 7 May only | the 12 Aug window averages ~8 mm/week, under corn's 10 |
| Perth · wheat | 1 May *or* 20 Jul | 1 May *or* 23 Jul | the 20 Jul window averages 25.5 mm/week, just over 25 |
| Melbourne · all | unchanged | unchanged | rain is 10–18 mm/week all year, inside every range |

---

## Code map (`app.js`)

| Area | Key pieces |
|---|---|
| Model | `LST_MODEL`, `harmonicLST`, `predictLST`, `tempC`, `tempBand`, `KELVIN`; `predictRain`, `rainDay`, `rainWeekly`, `RAIN_LEAD` |
| Dates | `addDays`, `addMonths`, `daysBetween`, `dayOfYear` (local time, whole days) |
| Data | `LOCATIONS` (name, coordinates, match patterns, rain coefficients), `CROPS` (target, rain range, phases, notes) |
| Planning | `scoreWindow`, `findSowingWindows` (+ `MATCH_TOL`, `SWING_MIN`, `nearestDip` for the start range), `isOpen`, `resolvePick`, `rainChanges`, `buildPlan`, `rangeStats`, `phaseAt`, `seasonOptions` |
| State | `state` = `{ location, address, crop, season, view, targetC, sowPick, useRain }`, plus `targetMemory` (each crop's slider value) |
| Map | Leaflet setup, `siteIcon`, `showPixel` (1 km square), `updateHud`, a `ResizeObserver` that keeps the map sized to its panel |
| Search | `matchLocations`, `renderSuggestions`, keyboard handling, `choose` → `selectLocation` |
| Controls | `selectCrop`, `setTarget` (throttled to one render per animation frame), season select, view toggle, rain switch |
| Rendering | `render` (top-level), `renderKpi`, `renderPicker`, `renderEmptyKpi`, `renderLegend`, `renderPlanBody`, `renderTimeline`, `renderCalendar`, `renderCards` |
| Deep links | Query-param handling at the bottom of the file |

Every change goes through **`render()`**, which rebuilds the plan from `state` and redraws all panels. There's no framework; the views are template strings.

---

## Extending it

### Add or enable a crop
1. In `CROPS` (`app.js`), set `available: true`, then add `idealSowC` and a `phases` array. Each phase has `key` (`sowing` | `growth` | `harvest` | `post`), `name`, `days` **or** `months`, `label` and `note`. In the sowing note, `{T}` is replaced with the current target.
2. In `index.html`, change the crop's tag from `Coming soon` to `<span class="crop-tag tag-ready">Data ready</span>`.
3. Update the defaults listed in the model notes in `index.html`.

The first phase is always treated as the sowing window that gets scored.

### Add a location
Add an entry to `LOCATIONS` with `id`, `name`, `region`, `state`, `lat`, `lng`, regex `patterns` for matching addresses, and `rain` coefficients (add the site to `SITES` in `../rainfall/fit_rainfall.py`, run it, and paste the printed line). Then add a **Jump to** button in `index.html` (`data-loc="<id>"`). City markers on the map are created from `LOCATIONS` automatically.

### Use a different model for each location
Add a set of `mid`/`upper`/`lower`/`max`/`min` coefficients to `LST_MODELS` and point the location's `lst` at it. Everything else (`tempC`, `tempBand`, the window search and its cache) already picks curves by location.

### Real address search
`matchLocations` is a simple keyword/postcode matcher. To accept any address, swap it for a geocoding API and pick the nearest supported region, or the nearest location that has its own model.

---

## Design system

All colours, radii and fonts are CSS variables in `:root` at the top of `styles.css`.

- **Theme:** dark only. Near-black green background, frosted-glass panels, a faint grid and glow in the background.
- **Accent:** lime `--accent: #c8f169`.
- **Phase colours:** sowing `--sow` (teal), growth `--grow` (lime green), harvest `--harvest` (amber), post-harvest `--post` (terracotta). The `.c-sowing` / `.c-growth` / `.c-harvest` / `.c-post` classes set `--c`, which bars, calendar days and cards use.
- **Fonts:** Space Grotesk (headings), Inter (body), JetBrains Mono (numbers, dates, labels).
- **Responsive:** one column below 1080 px and a mobile layout below 720 px. Checked at 390 px wide.
- **Motion:** bars grow in and cards rise in. These are switched off while dragging the slider and under `prefers-reduced-motion`.

---

## Assumptions and limitations

- **Melbourne has no temperature model of its own.** Brisbane (MODIS pixel at about −27.96, 151.62, on the Darling Downs) and Perth have their own curves. Melbourne borrows Brisbane's, but it's about 1,300 km further south with a much cooler climate, so its dates are especially rough. A note in the app says so.
- **The model predicts land-surface temperature, not air or soil temperature.** Daytime LST runs warmer than air temperature, so targets like 20 °C are compared against LST.
- **The barley target is near the bottom of the curve.** 17.5 °C is only about 1.7 °C above the coldest predicted point, so barley's best window sits across the winter low, and small changes to the target move its date a lot.
- **"Best fit" is about temperature only.** For corn at 21 °C the autumn date (early May) scores very slightly better than the spring one (mid-August). Corn is normally a spring/summer crop, so Date 2 is usually the sensible choice. The farmer chooses, and the ↗ warming / ↘ cooling label is there to help.
- **Rainfall is a typical-year curve, not a forecast.** Real rain is lumpy and varies a lot from year to year. The check says whether a window *usually* gets enough rain, not whether it will this year. The rain ranges are rough placeholders.
- **The Perth temperature fit uses mixed data.** `../day_1km-perth.csv` contains the Toowoomba pixel as well as the WA one, so Perth's curves are partly shaped by Queensland readings (its max curve is identical to Brisbane's).
- **The slider warns at the extremes.** If the best window's average is more than 1 °C from the target, an amber note appears.
- **"Today"** comes from the user's device clock. Dates are worked out in local time, in whole days.
- **The map tiles need internet** and are © Esri. Leaflet and the fonts also load from CDNs.

## How it was checked

- `node --check app.js` for JavaScript syntax.
- Screenshots in headless Microsoft Edge at 1440 px (desktop) and 390 px (phone, inside an iframe, because headless Edge won't make a window narrower than about 500 px). States covered: empty, Perth/Brisbane, wheat/barley, calendar view, and targets of 16 °C and 26 °C. Added later and checked at desktop width only: corn, two sowing dates (`sow=2`), Melbourne, and the rainfall check (Brisbane corn, Perth wheat).
- Window rankings were cross-checked with a standalone Node script using the same equation.

No automated test suite yet.

## Ideas for next steps

- Separate fitted models for each location, plus a real geocoder for any Australian address.
- Show uncertainty: how well the model fit its data (e.g. residual spread) as a band around the curve.
- Export the plan to a calendar file (.ics) or PDF.
- Soil moisture (NASA SMAP L3/L4, not the raw L1A file in the parent folder) as a more direct seedbed signal than rainfall.
- A weighted temperature + rain score instead of the hard rain constraint, once the rain ranges are confirmed.
