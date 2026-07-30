"""Annotated events: pairs specific named-facility outages with what
actually happened to utilization on their zone while they were active.

Two signals are computed per event, and either can be present without the
other:
  - avg_capability_reduction_pct: how far outage capability fell below base
    capability during the event window. Always available from day one --
    it's a direct read of numbers the source publishes.
  - avg_deviation_from_seasonal_normal_pct: utilization vs. the seasonal
    normal (see seasonal.py). Only populated once at least one prior year
    of history exists for that zone/month, which is why this starts sparse
    and fills in over time -- same honesty-about-sample-size principle as
    the monthly correlation.

Only outage_events rows whose zone_table maps onto one of the four
utilization zones (USJR, AB/BC, EGAT, OSDA) can be tied to a utilization
series at all; local receipt/delivery laterals and the Foothills BC zone
table don't have a matching flow series in this project and are skipped.
"""
from __future__ import annotations

import pandas as pd

ZONE_TABLE_TO_UTILIZATION_ZONE = {
    "USJR": "USJR",
    "EGAT": "EGAT",
    "OSDA": "OSDA",
    "WGAT": "AB/BC",
}


def compute_annotated_events(outage_events: pd.DataFrame, utilization_with_deviation: pd.DataFrame) -> pd.DataFrame:
    events = outage_events.copy()
    events["zone"] = events["zone_table"].map(ZONE_TABLE_TO_UTILIZATION_ZONE)
    events = events.dropna(subset=["zone", "facility"])

    util = utilization_with_deviation.copy()
    util["gas_day"] = pd.to_datetime(util["gas_day"])

    records = []
    for ev in events.itertuples(index=False):
        start = pd.to_datetime(ev.start_date)
        end = pd.to_datetime(ev.end_date)
        window = util[(util["zone"] == ev.zone) & (util["gas_day"] >= start) & (util["gas_day"] <= end)]
        if window.empty:
            continue

        avg_base = window["base_capability_e3m3d"].mean()
        avg_outage_cap = window["outage_capability_e3m3d"].mean()
        capability_reduction_pct = (
            (1 - avg_outage_cap / avg_base) * 100
            if pd.notna(avg_base) and avg_base and pd.notna(avg_outage_cap)
            else None
        )
        avg_deviation = window["deviation_from_seasonal_normal_pct"].mean()
        n_prior_years = window["n_prior_years"].max()

        records.append({
            "facility": ev.facility,
            "activity_type": ev.activity_type,
            "zone": ev.zone,
            "start_date": ev.start_date,
            "end_date": ev.end_date,
            "avg_utilization_pct_during": round(float(window["utilization_pct"].mean()), 1),
            "avg_capability_reduction_pct": (
                round(float(capability_reduction_pct), 1) if capability_reduction_pct is not None else None
            ),
            "avg_deviation_from_seasonal_normal_pct": (
                round(float(avg_deviation), 1) if pd.notna(avg_deviation) else None
            ),
            "n_prior_years_for_seasonal_normal": (
                int(n_prior_years) if pd.notna(n_prior_years) else 0
            ),
        })

    events_df = pd.DataFrame(records)
    if events_df.empty:
        return events_df
    return events_df.sort_values(
        "avg_capability_reduction_pct", ascending=False, na_position="last"
    ).reset_index(drop=True)
