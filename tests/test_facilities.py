import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from analysis.facilities import extract_facility_mentions, summarize_constraint_log


def _daily_flow_df():
    return pd.DataFrame([
        {
            "zone": "USJR", "gas_day": "2025-01-30", "outage_description": "Facility A - Maintenance",
            "impact_e3m3d": 5000.0,
        },
        {
            "zone": "USJR", "gas_day": "2025-01-31", "outage_description": "Facility A - Maintenance",
            "impact_e3m3d": 6000.0,
        },
        {
            "zone": "AB/BC", "gas_day": "2025-01-30",
            "outage_description": "Facility A - Maintenance; Facility B - Pipeline Modification",
            "impact_e3m3d": 3000.0,
        },
        {
            "zone": "EGAT", "gas_day": "2025-02-01", "outage_description": None,
            "impact_e3m3d": None,
        },
    ])


def test_extract_facility_mentions_splits_concurrent_facilities():
    mentions = extract_facility_mentions(_daily_flow_df())
    # Facility A appears on 3 zone-days, Facility B on 1.
    assert (mentions["facility"] == "Facility A").sum() == 3
    assert (mentions["facility"] == "Facility B").sum() == 1


def test_extract_facility_mentions_ignores_blank_descriptions():
    mentions = extract_facility_mentions(_daily_flow_df())
    assert "EGAT" not in mentions["zone"].values


def test_summarize_constraint_log_counts_distinct_days_and_sums_impact():
    mentions = extract_facility_mentions(_daily_flow_df())
    summary = summarize_constraint_log(mentions)

    facility_a = summary[summary["facility"] == "Facility A"].iloc[0]
    # days_active counts distinct calendar gas_days, not zone-days: 2025-01-30
    # appears for both USJR and AB/BC but is the same gas day, so this is 2
    # (2025-01-30, 2025-01-31), not 3.
    assert facility_a["days_active"] == 2
    assert facility_a["total_impact_e3m3d"] == 5000.0 + 6000.0 + 3000.0

    facility_b = summary[summary["facility"] == "Facility B"].iloc[0]
    assert facility_b["days_active"] == 1
    assert facility_b["total_impact_e3m3d"] == 3000.0


def test_summarize_constraint_log_sorted_by_impact_descending():
    mentions = extract_facility_mentions(_daily_flow_df())
    summary = summarize_constraint_log(mentions)
    impacts = summary["total_impact_e3m3d"].tolist()
    assert impacts == sorted(impacts, reverse=True)


def test_summarize_constraint_log_handles_empty_input():
    empty = pd.DataFrame(columns=["facility", "activity_type", "zone", "gas_day", "impact_e3m3d"])
    summary = summarize_constraint_log(empty)
    assert summary.empty
