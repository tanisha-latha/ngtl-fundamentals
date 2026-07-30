"""Normalizes raw fetch.py DataFrames into the shapes db.py expects.

No filtering decision here is silent: a gas day is only "realized" once it
has an actual flow value, and that's the one filter this module applies.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

import pandas as pd

ZONES = {
    "USJR": {"ft_d": False},
    "AB/BC": {"ft_d": True},
    "EGAT": {"ft_d": True},
    "OSDA": {"ft_d": False},
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def split_outage_description(text: str | float) -> list[dict]:
    """Splits a raw outage-description field into individual facility
    mentions: split on ';', then for each piece strip the activity type
    after the final ' - '. Returns [] for blank/NaN input.

    e.g. "Meikle River C - Compressor Station Maintenance" ->
         [{"facility": "Meikle River C", "activity_type": "Compressor Station Maintenance"}]
    """
    if text is None or (isinstance(text, float) and pd.isna(text)):
        return []
    text = str(text).strip()
    if not text:
        return []

    mentions = []
    for piece in text.split(";"):
        piece = piece.strip()
        if not piece:
            continue
        if " - " in piece:
            facility, activity_type = piece.rsplit(" - ", 1)
            facility = facility.strip()
            activity_type = activity_type.strip()
        else:
            facility, activity_type = piece, ""
        if facility:
            mentions.append({"facility": facility, "activity_type": activity_type})
    return mentions


def parse_daily_flow(chart_df: pd.DataFrame) -> pd.DataFrame:
    """Long-format: one row per (zone, gas_day), realized days only."""
    gas_day = pd.to_datetime(chart_df["Gas Day"], format="%d-%b-%y").dt.strftime("%Y-%m-%d")
    ingested_at = _now_iso()

    rows = []
    for zone, spec in ZONES.items():
        actual_flow = chart_df[f"{zone} Actual Flow (10^3m^3/d)"]
        base_capability = chart_df[f"{zone} Base Capability (10^3m^3/d)"]
        outage_capability = chart_df[f"{zone} Outage Capability (10^3m^3/d)"]
        impact = chart_df[f"{zone} Impact (10^3m^3/d)"]
        outage_description = chart_df[f"{zone} Outage Description"]
        heat_value = chart_df[f"{zone} Assumed Heat Value (GJ/10^3m^3)"]
        ft_d = chart_df[f"{zone} FT-D (TJ/d)"] if spec["ft_d"] else pd.Series([None] * len(chart_df))

        zone_df = pd.DataFrame({
            "zone": zone,
            "gas_day": gas_day,
            "actual_flow_e3m3d": actual_flow,
            "base_capability_e3m3d": base_capability,
            "outage_capability_e3m3d": outage_capability,
            "impact_e3m3d": impact,
            "outage_description": outage_description,
            "heat_value_gj_e3m3": heat_value,
            "ft_d_tjd": ft_d.values,
            "ingested_at": ingested_at,
        })
        rows.append(zone_df)

    combined = pd.concat(rows, ignore_index=True)
    # A gas day only enters history once it has a realized actual flow.
    combined = combined.dropna(subset=["actual_flow_e3m3d"])
    return combined.reset_index(drop=True)


def parse_outage_events(outages_df: pd.DataFrame) -> pd.DataFrame:
    ingested_at = _now_iso()
    df = outages_df.copy()
    df.columns = [c.strip() for c in df.columns]

    start_date = pd.to_datetime(df["Start"], format="%d-%b-%y").dt.strftime("%Y-%m-%d")
    end_date = pd.to_datetime(df["End"], format="%d-%b-%y").dt.strftime("%Y-%m-%d")

    facility, activity_type = [], []
    for desc in df["Description"]:
        mentions = split_outage_description(desc)
        if mentions:
            facility.append(mentions[0]["facility"])
            activity_type.append(mentions[0]["activity_type"])
        else:
            facility.append(None)
            activity_type.append(None)

    out = pd.DataFrame({
        "uid": df["UID"].astype(str),
        "outage_id": df["Outage Id"].astype(str),
        "zone_table": df["Table"].astype(str).str.strip(),
        "start_date": start_date,
        "end_date": end_date,
        "capability": pd.to_numeric(df["Capability"], errors="coerce"),
        "typical_flow": df["Typical Flow"].astype(str).str.strip(),
        "restriction_type": df["Type of Restriction"].astype(str).str.strip(),
        "area": df["Area for Stated Capability"].astype(str).str.strip(),
        "other_segments": df["Other Restricted Segments"].astype(str).str.strip(),
        "description": df["Description"].astype(str).str.strip(),
        "facility": facility,
        "activity_type": activity_type,
        "local_base_capability": pd.to_numeric(df["Local Base Capability"], errors="coerce"),
        "local_outage_capability": pd.to_numeric(df["Local Outage Capability"], errors="coerce"),
        "ingested_at": ingested_at,
    })
    return out


def parse_plant_turnaround(pta_df: pd.DataFrame) -> pd.DataFrame:
    ingested_at = _now_iso()
    df = pta_df.copy()
    return pd.DataFrame({
        "start_date": pd.to_datetime(df["Start"], format="%d-%b-%y").dt.strftime("%Y-%m-%d"),
        "end_date": pd.to_datetime(df["End"], format="%d-%b-%y").dt.strftime("%Y-%m-%d"),
        "type": df["Type"].astype(str).str.strip(),
        "impact": pd.to_numeric(df["Impact"], errors="coerce"),
        "ingested_at": ingested_at,
    })


def parse_capability_outlook(cap_df: pd.DataFrame) -> pd.DataFrame:
    """The capabilities CSV has a stray 'Last updated' note embedded in the
    header row alongside a units row; both land as extra all-NaN-ish
    columns / a units-only first data row, which we drop.
    """
    df = cap_df.copy()
    df.columns = [c.strip() for c in df.columns]
    # Source header is: dd-mmm-yyyy, <5 zone columns>, "Last updated: ...", "Units: ...".
    # The trailing two columns are metadata, not data, and carry no values in
    # any row, so we identify zone columns positionally rather than by name.
    zone_cols = [c for c in df.columns[1:] if not c.lower().startswith(("last updated", "units"))]

    pulled_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = []
    for _, row in df.iterrows():
        raw_date = str(row["dd-mmm-yyyy"]).strip()
        try:
            effective_date = datetime.strptime(raw_date, "%d-%b-%Y").strftime("%Y-%m-%d")
        except ValueError:
            continue  # units row or malformed row
        for zone in zone_cols:
            value = pd.to_numeric(row.get(zone), errors="coerce")
            if pd.isna(value):
                continue
            rows.append({
                "pulled_date": pulled_date,
                "effective_date": effective_date,
                "zone": zone,
                "capability_e6m3d": float(value),
            })
    return pd.DataFrame(rows)
