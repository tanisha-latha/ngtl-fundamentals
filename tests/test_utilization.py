import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from analysis.utilization import compute_utilization


def _daily_flow_df():
    return pd.DataFrame([
        # Active outage that day -> denominator should be outage capability, not base.
        {
            "zone": "USJR", "gas_day": "2025-01-30", "actual_flow_e3m3d": 380000.0,
            "base_capability_e3m3d": 400000.0, "outage_capability_e3m3d": 380000.0,
            "impact_e3m3d": 20000.0, "outage_description": "Facility A - Maintenance",
        },
        # No outage that day -> denominator should fall back to base capability.
        {
            "zone": "USJR", "gas_day": "2025-01-31", "actual_flow_e3m3d": 400000.0,
            "base_capability_e3m3d": 400000.0, "outage_capability_e3m3d": None,
            "impact_e3m3d": None, "outage_description": None,
        },
    ])


def test_utilization_uses_outage_capability_when_present():
    result = compute_utilization(_daily_flow_df())
    row = result[result["gas_day"] == "2025-01-30"].iloc[0]
    assert row["effective_capability_e3m3d"] == 380000.0
    assert row["utilization_pct"] == 100.0
    assert row["outage_adjusted"] is True or bool(row["outage_adjusted"]) is True


def test_utilization_falls_back_to_base_capability_without_outage():
    result = compute_utilization(_daily_flow_df())
    row = result[result["gas_day"] == "2025-01-31"].iloc[0]
    assert row["effective_capability_e3m3d"] == 400000.0
    assert row["utilization_pct"] == 100.0
    assert bool(row["outage_adjusted"]) is False


def test_utilization_can_exceed_100_percent():
    df = pd.DataFrame([{
        "zone": "USJR", "gas_day": "2025-02-13", "actual_flow_e3m3d": 397000.0,
        "base_capability_e3m3d": 385000.0, "outage_capability_e3m3d": None,
        "impact_e3m3d": None, "outage_description": None,
    }])
    result = compute_utilization(df)
    assert result.iloc[0]["utilization_pct"] > 100.0
