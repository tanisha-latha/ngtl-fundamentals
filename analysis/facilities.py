"""Facility-level constraint log: every named facility that appears in a
daily outage description, how many gas days it was active, and its total
impact volume.

Reuses pipeline.parse.split_outage_description -- the exact same ';'-split /
' - '-strip logic used at ingest time for the raw outage register -- so a
facility name is parsed identically everywhere in this project.

Simplification, documented here because it's the one judgment call in this
module: when more than one facility is named on the same zone-day, each
gets credited with that day's full zone-level impact volume (the source
does not sub-allocate impact across concurrent outages). Overlap is rare in
this dataset, but it means total_impact_e3m3d is a "days this facility was
part of a constraint, at what impact" figure, not a precise per-facility
volume attribution.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from pipeline.parse import split_outage_description


def extract_facility_mentions(daily_flow: pd.DataFrame) -> pd.DataFrame:
    records = []
    for row in daily_flow.itertuples(index=False):
        mentions = split_outage_description(row.outage_description)
        for m in mentions:
            records.append({
                "facility": m["facility"],
                "activity_type": m["activity_type"],
                "zone": row.zone,
                "gas_day": row.gas_day,
                "impact_e3m3d": row.impact_e3m3d,
            })
    return pd.DataFrame(records, columns=["facility", "activity_type", "zone", "gas_day", "impact_e3m3d"])


def summarize_constraint_log(mentions: pd.DataFrame) -> pd.DataFrame:
    if mentions.empty:
        return pd.DataFrame(columns=[
            "facility", "days_active", "total_impact_e3m3d", "zones", "activity_types",
            "first_seen", "last_seen",
        ])

    grouped = mentions.groupby("facility").agg(
        days_active=("gas_day", "nunique"),
        total_impact_e3m3d=("impact_e3m3d", lambda s: s.fillna(0).sum()),
        zones=("zone", lambda s: sorted(set(s))),
        activity_types=("activity_type", lambda s: sorted({x for x in s if x})),
        first_seen=("gas_day", "min"),
        last_seen=("gas_day", "max"),
    ).reset_index()

    return grouped.sort_values("total_impact_e3m3d", ascending=False).reset_index(drop=True)
