"""Pulls raw data from NGTL/Foothills public endpoints and the AER reference
price page. Every function here returns a pandas DataFrame (or, for the AER
page, two) that mirrors the source as closely as possible -- no filtering,
no derived columns. Filtering and normalization happen in parse.py.
"""
from __future__ import annotations

from io import StringIO

import pandas as pd
import requests

BASE = "https://f51561ras5.execute-api.us-west-2.amazonaws.com/production"
CAPABILITIES_URL = f"{BASE}/csv/capabilities"
CHART_URL = f"{BASE}/chart/csv"
PLANT_TURNAROUND_URL = f"{BASE}/plantturnaroundactivity/csv"
OUTAGES_URL = f"{BASE}/csv/outages/"
AER_PRICE_URL = "https://www.alberta.ca/alberta-natural-gas-reference-price"

TIMEOUT = 30
HEADERS = {"User-Agent": "ngtl-fundamentals-pipeline/1.0 (portfolio project; github.com)"}


def _get_csv(url: str) -> str:
    resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.text


def fetch_capabilities() -> pd.DataFrame:
    """Forward monthly capability outlook by zone. Header row 6 carries a
    'Last updated' note mixed into the columns; the data starts at row 2.
    """
    text = _get_csv(CAPABILITIES_URL)
    df = pd.read_csv(StringIO(text))
    return df


def fetch_chart() -> pd.DataFrame:
    """Daily gas-day flow/capability/outage-description history by zone
    (USJR, AB/BC, EGAT, OSDA). Includes future rows with capability but no
    actual flow yet -- those are dropped in parse.py.
    """
    text = _get_csv(CHART_URL)
    df = pd.read_csv(StringIO(text))
    return df


def fetch_plant_turnaround() -> pd.DataFrame:
    text = _get_csv(PLANT_TURNAROUND_URL)
    df = pd.read_csv(StringIO(text))
    return df


def fetch_outages() -> pd.DataFrame:
    """Raw outage register: one row per outage/zone-table combination, with
    an explicit start/end date and stated capability during the outage.
    """
    text = _get_csv(OUTAGES_URL)
    df = pd.read_csv(StringIO(text))
    return df


def fetch_aer_reference_price() -> pd.DataFrame:
    """Scrapes Table 1 ("Gas reference prices from 1994 to present") off the
    Alberta government reference-price page. Returns long-format rows of
    (year, month, price_gj). Blank cells (months not yet published) are
    dropped, not zero-filled.
    """
    resp = requests.get(AER_PRICE_URL, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    tables = pd.read_html(StringIO(resp.text))

    # Table 1 is the one whose header is Year + 12 month names and whose
    # first data year is the most recent one on the page (Table 2, "average
    # market prices 1988-1993", uses the same header shape but only covers
    # 1988-1993 and has no clickable per-year publication link).
    month_cols = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]
    reference_table = None
    for t in tables:
        cols = [str(c).strip() for c in t.columns]
        if cols[:1] == ["Year"] and cols[1:13] == month_cols:
            reference_table = t
            break
    if reference_table is None:
        raise RuntimeError("Could not locate the AER reference-price table on the page")

    long_rows = []
    for _, row in reference_table.iterrows():
        year = int(row["Year"])
        for month_num, month_name in enumerate(month_cols, start=1):
            raw = row[month_name]
            if pd.isna(raw):
                continue
            raw_str = str(raw).strip()
            if raw_str in ("", "\xa0"):
                continue
            try:
                price = float(raw_str)
            except ValueError:
                continue
            long_rows.append({"year": year, "month": month_num, "price_gj": price})
    return pd.DataFrame(long_rows)
