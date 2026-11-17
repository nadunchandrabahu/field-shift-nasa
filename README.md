# FieldShift: a satellite-informed sowing planner

### 🌱 [Try the live app → nasafieldshift.netlify.app](https://nasafieldshift.netlify.app)

**No download or sign-up needed.** Open the link in any browser, on a computer or a phone. Enter a farm location (Perth, Brisbane or Melbourne) and pick a crop. The app shows the best weeks to start sowing and lays out the whole growing season.

---

FieldShift is a prototype web app that tells a farmer **which weeks to start sowing** a crop. It works from a land-surface temperature (LST) model fitted to 26 years of NASA MODIS satellite readings, with an optional rainfall check based on NASA POWER precipitation data. The farmer picks a farm location and a crop (wheat, barley or corn), and the app lays out the whole season as a timeline and a calendar: sowing, crop growth, harvesting and post-harvest.

This repository holds the whole project, not just the app. It includes the raw satellite exports, the Jupyter notebooks I used to explore the data and choose a model, the rainfall fitting script, and the web app itself. This README walks through how the project was built, step by step.

> The front end (`webapp-v1/`) was generated with **Claude Code**, Anthropic's AI coding tool. The data work, model selection and coefficients came from the notebooks described below, and were then handed to Claude Code to turn into an interactive app. See [Building the web app](#6-building-the-web-app-with-claude-code).

---

## Repository layout

```
field-shift-nasa/
├── day_1km-towoomba.csv                        MODIS MOD11A1 daily LST, one 1 km pixel near Toowoomba, QLD (2000–2026)
├── day_1km-perth.csv                           MODIS MOD11A1 export with a south-west WA pixel (see Known issues)
├── day_1km_harmonic_regression-Queensland.ipynb  Main analysis: cleaning, model comparison, spread curves (the app's model)
├── day_1km_harmonic_regression-Perth.ipynb     Same workflow repeated on the WA export (the app's Perth model)
├── day_1km_Towoomba_rateOfChange.ipynb         Per-day-of-year warming/cooling trend
├── rate_of_change.csv                          Output of the trend notebook (slope m and intercept c for each day)
├── rainfall/
│   ├── fit_rainfall.py                         Downloads and fits NASA POWER rainfall for each location
│   └── brisbane.csv, melbourne.csv, perth.csv, toowoomba.csv   Cached daily rainfall, 2001–2025
├── webapp-v1/                                  The web app (HTML/CSS/JS, no build step) and its technical README
└── presentation/NASA-FieldShift/               Copy of the app with higher-contrast chart styling for projecting
```

---

## The process

### 1. Getting the satellite data

The starting point was **MODIS Terra MOD11A1 (v061)**, NASA's daily land-surface temperature product at 1 km resolution. I pulled a point-sample time series for one pixel on the Darling Downs, west of Brisbane (lat −27.9633, lon 151.6189, tile h31v11). This is prime grain country, so it made a sensible first test site.

The export (`day_1km-towoomba.csv`) has one row per day from **24 Feb 2000** (the start of the MODIS record) to **Nov 2026**. That's about 9,700 days. Each row carries the daytime LST in Kelvin plus the MODIS quality-control flags (cloud, data quality, emissivity error, LST error).

### 2. Cleaning and preparing it

The same preprocessing is used in every notebook:

- **Drop the zeros.** MODIS writes `0` when no LST was produced, almost always because of cloud. Only about 45% of days survive (4,332 valid readings for Toowoomba), but the notebook confirms that **every day of the year (1–365) still has data** in at least one year.
- **Remove 29 February** so every year has 365 days.
- **Renumber the days.** In leap years, days after February are shifted back by one, so that "day 100" means the same point in the season every year.
- The result is a tidy table of `Year`, `Day` and `LST_K`.

### 3. Choosing a temperature model

*Notebook: `day_1km_harmonic_regression-Queensland.ipynb`*

I compared three candidate models with a **time-based split**: train on 2000–2021 and test on 2022–2026, so the models are judged on years they haven't seen.

| Model | Formula | Train R² | Test R² | Test RMSE (K) | AIC |
|---|---|---|---|---|---|
| Linear | `LST ~ Yr + Day` | 0.005 | −0.264 | 8.52 | 24,040 |
| Quadratic | `LST ~ Yr + Yr² + Day + Day²` | 0.628 | 0.051 | 7.39 | 20,676 |
| **Harmonic** | `LST ~ Yr + sin(t) + cos(t) + sin(2t) + cos(2t)` | **0.755** | **0.593** | **4.84** | **19,252** |

*t = 2π · day / 365, and `Yr` = year − 2000*

The harmonic model wins on every measure. That makes sense, because temperature follows a yearly cycle that a straight line or a parabola in day-of-year can't capture. The first sine/cosine pair models the annual cycle. The second pair (the half-year harmonic) lets the season be lopsided, with a slower cool-down than warm-up or the other way round. The `Yr` term captures a long-run trend.

I also refitted with **HAC (Newey–West) standard errors**. Daily readings are autocorrelated, so ordinary OLS standard errors would overstate how certain the coefficients are. The fitted equation used by the app is:

```python
def predict_lst(year, day):          # returns Kelvin
    t = 2 * np.pi * day / 365
    return (302.008 - 0.0549 * (year - 2000)
            - 0.651 * np.sin(t)   + 9.866 * np.cos(t)
            - 0.395 * np.sin(2*t) - 1.668 * np.cos(2*t))
```

Over a year this runs from about 15.8 °C (late June) to about 35.9 °C (early January).

### 4. Describing the spread around the curve

A single curve hides how much real years vary, and that variation matters to a farmer deciding when to sow. In the same notebook I fitted four more curves with the same harmonic terms:

- **Quantile regression** at the 30th and 70th percentiles (`statsmodels` `quantreg`). These give an upper and a lower curve for a typically warm year and a typically cool one.
- **Maximum and minimum envelopes**, solved as linear programs with `scipy.optimize.linprog`. The max curve is the tightest harmonic curve that lies on or above every reading. The min curve is the tightest one on or below every reading. The notebook checks that both constraints hold for all points.

In the app, the upper and lower curves become the shaded band and the **sowing start range** (the earliest-to-latest reasonable start date). The max and min curves are drawn as faint dotted lines.

### 5. Supporting analysis

**Rate of change per day** (`day_1km_Towoomba_rateOfChange.ipynb`). For each day of the year I fitted a straight line of LST against year (`np.polyfit`). This asks whether, say, early April is getting warmer or cooler over the 26-year record. The slopes are plotted as a bar chart and saved to `rate_of_change.csv`. The CSV is copied into the app folder but the app doesn't use it yet.

**Rainfall** (`rainfall/fit_rainfall.py`). Temperature alone can pick a window that is usually too dry or too wet. This script downloads daily corrected precipitation (`PRECTOTCORR`, MERRA-2 bias-corrected) from the **NASA POWER** API for Perth, Brisbane, Melbourne and the Toowoomba pixel, covering 2001–2025. It caches each download as a CSV so it can be re-run offline. It uses the same day numbering as the LST notebooks and fits a **3-harmonic curve** with no year trend, because rainfall's seasonal shape is lumpier and its long-run trend is mostly noise. It prints the coefficients ready to paste into the app.

| Location | Typical weekly rain (driest to wettest) | Pattern | R² vs 30-day climatology |
|---|---|---|---|
| Perth | 3–29 mm | wet winter, dry summer | 0.99 |
| Brisbane | 7–38 mm | wet summer, dry late winter | 0.96 |
| Melbourne | 10–18 mm | fairly even | 0.81 |

**A second site** (`day_1km_harmonic_regression-Perth.ipynb`). I repeated the whole workflow, including the quantile and max/min curves, on a Western Australia export so that Perth could have its own model. Harmonic was again the clear winner (test R² 0.645, RMSE 4.82 K), and these five curves now drive the app when Perth is selected. The CSV does still contain a second pixel, though (see [Known issues](#known-issues-and-open-questions)).

### 6. Building the web app with Claude Code

With the model settled, I used **Claude Code** to generate the web app in `webapp-v1/`. I gave it the fitted equations, the crop calendars and the behaviour I wanted, and iterated on the result. The app is plain HTML, CSS and JavaScript, with no framework and no build step. Leaflet provides the satellite map, and all the planning maths runs in the browser.

The git history of `webapp-v1` shows how it grew:

| Commit | What was added |
|---|---|
| **Initial commit** | Address search over a satellite map of Australia (Perth and Brisbane), wheat and barley, a target-temperature slider, sowing window search, season timeline and calendar, phase cards. Corn was shown as "coming soon". |
| **Secondary sowing period** | Because the temperature curve is cyclical, a target is usually crossed twice a year: once while cooling in autumn and once while warming in spring. The app now offers a second sowing date when it's a genuinely separate match, and lets the farmer choose between the two. |
| **Added Melbourne** | A third location. |
| **Final app** | Corn, the per-location **rainfall check**, the spread band, max/min curves, the **start-date range** built from the upper and lower curves, and a rain strip under the timeline. |

**How the app picks a sowing date.** For every possible start day it scores the sowing window (6 weeks for wheat and barley, 2 weeks for corn) by the **RMSE** of the predicted daily LST against the farmer's target temperature. RMSE is used instead of a simple average because it rewards windows that *stay* near the target, rather than ones that swing above and below it. With the rainfall check on, a window only qualifies if the typical rain over the 2 weeks before sowing and during the sowing window falls inside the crop's range. From that start date the app chains the remaining phases (growth, harvest, post-harvest) into a full season plan.

**Where the model numbers live.** To keep this first version simple, all of the model parameters are written directly into `webapp-v1/app.js`. That includes the temperature and rainfall coefficients, the target temperatures, the rain ranges and the length of each crop phase. This works well for three locations and three crops, but it doesn't scale. Every new location needs its own fitted coefficients, and every new crop needs its own settings, so editing the code each time would quickly become unmanageable.

As the project grows, these values can and should move into a separate database (or at least a data file the app loads). That database would hold:
- **One record per location:** its coordinates and its fitted temperature and rainfall coefficients.
- **One record per crop:** its target sowing temperature, rain range and phase lengths.

The app would then look up the right numbers for whichever location and crop the farmer picks. Adding a new region or crop would mean adding a row of data, with no code changes. It would also let the models be refitted on fresh satellite data and updated without redeploying the app. The right setup depends on where the project goes next. A simple JSON file would do for a handful of regions, and a proper database with an API would suit nationwide coverage.

How I checked it:
- Ran `node --check` on the JavaScript.
- Took screenshots in headless Microsoft Edge at desktop (1440 px) and phone (390 px) widths across the main states.
- Cross-checked the sowing window rankings against a standalone Node script that uses the same equation.

After those commits, the app was extended so that each location can carry its own temperature curves. Brisbane uses the Queensland fit, Perth uses the Perth fit, and Melbourne falls back to Brisbane's curves until it has its own.

The full technical write-up is in [`webapp-v1/README.md`](webapp-v1/README.md). It covers every UI element, the window-selection algorithm, a code map, URL parameters for demos, and how to add crops or locations.

### 7. Preparing the presentation

`presentation/NASA-FieldShift/` is a copy of the final app with bolder chart colours: a solid start-range pill, thicker min/max lines, and a brighter rain band. These changes make it read clearly on a projector. The logic is identical to `webapp-v1`.

---

## Running it

**The app:** the easiest way is the live version at **[nasafieldshift.netlify.app](https://nasafieldshift.netlify.app)**. To run it locally, open `webapp-v1/index.html` in a browser. No install or server is needed, just an internet connection for the map tiles, Leaflet and fonts. Query parameters make demos easier, for example:

```
webapp-v1/index.html?loc=brisbane&crop=corn&sow=2
webapp-v1/index.html?loc=perth&crop=wheat&view=calendar
```

**The analysis:** the notebooks need Python with `pandas`, `numpy`, `statsmodels`, `scikit-learn`, `scipy` and `matplotlib`. Run them from the repository root so the CSV paths resolve.

```bash
pip install pandas numpy statsmodels scikit-learn scipy matplotlib jupyter
jupyter notebook
```

**The rainfall fit:** `python rainfall/fit_rainfall.py`. It uses the cached CSVs if they're present and downloads from NASA POWER if they're not.

---

## Known issues and open questions

- **Recent years read colder.** On the 2022–2026 test set the harmonic model's residuals are consistently negative: −4.2, −1.1, −2.9, −4.5 and −5.2 K by year at Toowoomba. The annual-mean plot shows a step down from about 2021. This could be a real climate signal, a change in the sensor or its processing, or a drift in the satellite's overpass time. Terra's orbit has been drifting since its inclination adjustments ended, which shifts when daytime LST is sampled. It isn't resolved yet.
- **Melbourne has no temperature model of its own yet.** Brisbane and Perth each have their own fitted curves, but Melbourne borrows Brisbane's, so its sowing dates are only a rough guide. The app says so on screen.
- **`day_1km-perth.csv` contains two pixels.** Alongside a south-west WA pixel (−34.09, 116.43), the export also contains the full Toowoomba series, so the Perth curves in the app are fitted on mixed data. This is why Perth's max curve is identical to Brisbane's. The WA pixel is also about 240 km south of Perth city. Refitting on the WA pixel alone (filtering to `Latitude < -30`) would give a cleaner Perth model.
- **Spread curve labelling.** The upper and lower curves were fitted at the 30th and 70th percentiles, so the band covers roughly the middle 40% of training readings. Some comments in the app describe it as "20% above / 20% below, middle 60%", which needs correcting. Because of the cold bias above, 70.6% of test readings fall below the lower curve.
- **LST is not air or soil temperature.** Daytime land-surface temperature runs warmer than air temperature, so the crop targets (wheat 20 °C, barley 17.5 °C, corn 21 °C) are set against LST, not textbook air-temperature values.
- **Rainfall is a typical-year curve, not a forecast**, and the crop rain ranges are placeholders.

## Next steps

- Clean single-pixel exports for each location, and a separate fitted model for each one.
- Move the model coefficients and crop details out of the code and into a database, so that adding a location or crop is a data change, not a code change (see [Building the web app](#6-building-the-web-app-with-claude-code)).
- Investigate the post-2021 cold bias, starting with the QC flags and comparing against MODIS Aqua (MYD11A1).
- Use `rate_of_change.csv` in the app to show whether a sowing window is warming or cooling over the decades.
- Add soil moisture (NASA SMAP) as a more direct seedbed signal than rainfall.
- Real geocoding for any Australian address, and export of the season plan to a calendar file.

---

## Data sources and credits

- **MODIS Terra MOD11A1 v061**: daily land-surface temperature and emissivity, 1 km (NASA LP DAAC).
- **NASA POWER**: daily `PRECTOTCORR` precipitation (MERRA-2, bias-corrected), via the POWER API.
- **Map imagery**: Esri World Imagery, displayed with [Leaflet](https://leafletjs.com/).
- **Web app**: generated with [Claude Code](https://claude.com/claude-code).
