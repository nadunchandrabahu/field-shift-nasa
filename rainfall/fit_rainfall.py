"""Fit a seasonal rainfall curve for each FieldShift location.

Data: NASA POWER daily point data, parameter PRECTOTCORR (MERRA-2 precipitation,
bias-corrected), mm/day, 2001-2025. Raw downloads are cached as <city>.csv next
to this script, so re-running works offline.

Model (same idea as the LST regression, but with 3 harmonics and no year trend,
because rainfall's seasonal shape is lumpier and its long-run trend is noise):

    rain_mm_day(day) = a0 + sum_k (s_k * sin(k t) + c_k * cos(k t)),  t = 2*pi*day/365,  k = 1..3

Run:  python fit_rainfall.py
Paste the printed `rain:` lines into LOCATIONS in webapp-v1/app.js.
"""
import json
import pathlib
import urllib.request

import numpy as np
import pandas as pd

HERE = pathlib.Path(__file__).parent
SITES = {
    "perth": (-31.9523, 115.8613),
    "brisbane": (-27.4698, 153.0251),
    "melbourne": (-37.8136, 144.9631),
    "toowoomba": (-27.9633, 151.6189),  # the LST training pixel, for reference
}
START, END = "20010101", "20251231"
K = 3  # harmonics


def load(name, lat, lng):
    path = HERE / f"{name}.csv"
    if not path.exists():
        url = ("https://power.larc.nasa.gov/api/temporal/daily/point"
               f"?parameters=PRECTOTCORR&community=AG&latitude={lat}&longitude={lng}"
               f"&start={START}&end={END}&format=JSON")
        with urllib.request.urlopen(url, timeout=180) as r:
            data = json.load(r)["properties"]["parameter"]["PRECTOTCORR"]
        pd.DataFrame({"Date": pd.to_datetime(list(data)), "Rain_mm": list(data.values())}).to_csv(path, index=False)
    df = pd.read_csv(path, parse_dates=["Date"])
    df = df[df["Rain_mm"] >= 0]  # drop fill values (-999)
    # Same day numbering as the LST notebook: drop 29 Feb, shift later leap-year days back by 1
    df = df[~((df["Date"].dt.month == 2) & (df["Date"].dt.day == 29))]
    after_feb_leap = df["Date"].dt.is_leap_year & (df["Date"].dt.month > 2)
    df["Day"] = df["Date"].dt.dayofyear - after_feb_leap.astype(int)
    return df


def design(day):
    t = 2 * np.pi * np.asarray(day) / 365
    cols = [np.ones_like(t)]
    for k in range(1, K + 1):
        cols += [np.sin(k * t), np.cos(k * t)]
    return np.column_stack(cols)


for name, (lat, lng) in SITES.items():
    df = load(name, lat, lng)
    coef, *_ = np.linalg.lstsq(design(df["Day"]), df["Rain_mm"].to_numpy(), rcond=None)

    # How well the smooth curve matches the observed average for each day of year (30-day smoothed)
    clim = df.groupby("Day")["Rain_mm"].mean().reindex(range(1, 366))
    clim_s = pd.concat([clim.iloc[-15:], clim, clim.iloc[:15]]).rolling(30, center=True).mean().iloc[15:-15]
    fit = design(np.arange(1, 366)) @ coef
    r2 = 1 - ((clim_s - fit) ** 2).sum() / ((clim_s - clim_s.mean()) ** 2).sum()

    weekly = fit * 7
    print(f"{name:10s} {len(df)} days  annual {fit.sum():.0f} mm  "
          f"weekly {weekly.min():.1f}-{weekly.max():.1f} mm  R2 vs 30-day climatology {r2:.3f}")
    keys = ["a0"] + [f"{p}{k}" for k in range(1, K + 1) for p in ("s", "c")]
    print("      rain: { " + ", ".join(f"{k}: {v:.4f}" for k, v in zip(keys, coef)) + " },")
