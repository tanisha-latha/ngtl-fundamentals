import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from pipeline.parse import parse_daily_flow, split_outage_description


def test_split_single_facility():
    assert split_outage_description("Meikle River C - Compressor Station Maintenance") == [
        {"facility": "Meikle River C", "activity_type": "Compressor Station Maintenance"}
    ]


def test_split_multiple_facilities():
    text = "Meikle River C - Compressor Station Maintenance; Latornell A1 - Compressor Station Maintenance"
    result = split_outage_description(text)
    assert result == [
        {"facility": "Meikle River C", "activity_type": "Compressor Station Maintenance"},
        {"facility": "Latornell A1", "activity_type": "Compressor Station Maintenance"},
    ]


def test_split_strips_whitespace():
    text = "  NPS 36 Grande Prairie Mainline - Pipeline Modification  "
    assert split_outage_description(text) == [
        {"facility": "NPS 36 Grande Prairie Mainline", "activity_type": "Pipeline Modification"}
    ]


def test_split_handles_no_activity_type():
    assert split_outage_description("Some Facility Name") == [
        {"facility": "Some Facility Name", "activity_type": ""}
    ]


def test_split_handles_blank_and_nan():
    assert split_outage_description("") == []
    assert split_outage_description(None) == []
    assert split_outage_description(float("nan")) == []


def test_split_uses_last_hyphen_for_facility_names_containing_dashes():
    # Facility name itself contains " - " (e.g. a segment range); the activity
    # type is always the last ' - '-delimited piece.
    text = "Segment 4 - 7 - Pipeline Maintenance"
    assert split_outage_description(text) == [
        {"facility": "Segment 4 - 7", "activity_type": "Pipeline Maintenance"}
    ]


def _sample_chart_df():
    return pd.DataFrame({
        "Gas Day": ["30-Jan-25", "31-Jan-25"],
        "USJR Actual Flow (10^3m^3/d)": [367000.0, None],  # second row is a future/forecast row
        "USJR Base Capability (10^3m^3/d)": [385000.0, 385000.0],
        "USJR Outage Capability (10^3m^3/d)": [380000.0, None],
        "USJR Impact (10^3m^3/d)": [5000.0, None],
        "USJR Outage Description": ["Facility A - Maintenance", None],
        "USJR Assumed Heat Value (GJ/10^3m^3)": [40.5, 40.5],
        "AB/BC FT-D (TJ/d)": [3322.0, 3322.0],
        "AB/BC Actual Flow (10^3m^3/d)": [87000.0, None],
        "AB/BC Base Capability (10^3m^3/d)": [90000.0, 90000.0],
        "AB/BC Outage Capability (10^3m^3/d)": [87000.0, None],
        "AB/BC Impact (10^3m^3/d)": [3000.0, None],
        "AB/BC Outage Description": ["Facility A - Maintenance", None],
        "AB/BC Assumed Heat Value (GJ/10^3m^3)": [38.5, 38.5],
        "EGAT FT-D (TJ/d)": [5431.0, 5431.0],
        "EGAT Actual Flow (10^3m^3/d)": [157000.0, None],
        "EGAT Base Capability (10^3m^3/d)": [156000.0, 156000.0],
        "EGAT Outage Capability (10^3m^3/d)": [148000.0, None],
        "EGAT Impact (10^3m^3/d)": [8000.0, None],
        "EGAT Outage Description": ["Facility A - Maintenance", None],
        "EGAT Assumed Heat Value (GJ/10^3m^3)": [38.5, 38.5],
        "OSDA Actual Flow (10^3m^3/d)": [93000.0, None],
        "OSDA Base Capability (10^3m^3/d)": [100000.0, 100000.0],
        "OSDA Outage Capability (10^3m^3/d)": [None, None],
        "OSDA Impact (10^3m^3/d)": [None, None],
        "OSDA Outage Description": [None, None],
        "OSDA Assumed Heat Value (GJ/10^3m^3)": [39.5, 39.5],
    })


def test_parse_daily_flow_drops_unrealized_future_rows():
    result = parse_daily_flow(_sample_chart_df())
    # 4 zones x 1 realized gas day = 4 rows; the 31-Jan-25 forecast row (no
    # actual flow) must not appear at all.
    assert len(result) == 4
    assert set(result["gas_day"]) == {"2025-01-30"}


def test_parse_daily_flow_normalizes_date_and_zone_columns():
    result = parse_daily_flow(_sample_chart_df())
    usjr = result[result["zone"] == "USJR"].iloc[0]
    assert usjr["gas_day"] == "2025-01-30"
    assert usjr["actual_flow_e3m3d"] == 367000.0
    assert usjr["outage_description"] == "Facility A - Maintenance"

    osda = result[result["zone"] == "OSDA"].iloc[0]
    assert pd.isna(osda["outage_capability_e3m3d"])  # OSDA had no active outage that day
