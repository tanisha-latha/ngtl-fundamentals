"""Per zone, per gas-day utilization: actual flow over outage-adjusted
capability (the outage capability the source already publishes when an
outage is active that day, falling back to base/nameplate capability
otherwise).
"""
from __future__ import annotations

import pandas as pd


def compute_utilization(daily_flow: pd.DataFrame) -> pd.DataFrame:
    df = daily_flow.copy()
    effective_capability = df["outage_capability_e3m3d"].fillna(df["base_capability_e3m3d"])
    df["effective_capability_e3m3d"] = effective_capability
    df["utilization_pct"] = (df["actual_flow_e3m3d"] / effective_capability) * 100
    df["outage_adjusted"] = df["outage_capability_e3m3d"].notna()
    return df[[
        "zone", "gas_day", "actual_flow_e3m3d", "base_capability_e3m3d",
        "outage_capability_e3m3d", "effective_capability_e3m3d",
        "utilization_pct", "outage_adjusted", "outage_description",
    ]]
