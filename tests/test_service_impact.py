import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from analysis.service_impact import classify_restriction, compute_service_impact


def test_classify_firm_receipt_risk():
    assert classify_restriction(" Potential impact to FT-R") == {"category": "firm_risk", "firm_leg": "receipt"}


def test_classify_firm_delivery_risk():
    assert classify_restriction(" Potential impact to FT-D") == {"category": "firm_risk", "firm_leg": "delivery"}
    assert classify_restriction(" Potential Impact to FT-D") == {"category": "firm_risk", "firm_leg": "delivery"}


def test_classify_no_firm_impact():
    assert classify_restriction(" No impact to FT-D anticipated") == {"category": "no_firm_impact", "firm_leg": "delivery"}


def test_classify_blank_is_unclassified():
    assert classify_restriction(None) == {"category": "unclassified", "firm_leg": None}
    assert classify_restriction("") == {"category": "unclassified", "firm_leg": None}
    assert classify_restriction(float("nan")) == {"category": "unclassified", "firm_leg": None}


def _sample_outage_events():
    return pd.DataFrame([
        {"uid": "1", "facility": "Meikle River C", "zone_table": "USJR", "restriction_type": " Potential impact to FT-R", "start_date": "2026-08-04", "end_date": "2026-08-08"},
        {"uid": "2", "facility": "Latornell A1", "zone_table": "EGAT", "restriction_type": " No impact to FT-D anticipated", "start_date": "2026-08-17", "end_date": "2026-08-21"},
        {"uid": "3", "facility": "Crammond", "zone_table": "LCLR", "restriction_type": None, "start_date": "2026-08-04", "end_date": "2026-08-07"},
        {"uid": "4", "facility": "Meikle River C", "zone_table": "EGAT", "restriction_type": " Potential impact to FT-D", "start_date": "2026-08-04", "end_date": "2026-08-08"},
    ])


def test_compute_service_impact_counts_and_share():
    result = compute_service_impact(_sample_outage_events())
    assert result["total_events"] == 4
    assert result["firm_risk_events"] == 2
    assert result["firm_risk_share_pct"] == 50.0


def test_compute_service_impact_facility_repeat_offenders():
    result = compute_service_impact(_sample_outage_events())
    top = result["facility_firm_risk_counts"][0]
    assert top["facility"] == "Meikle River C"
    assert top["firm_risk_events"] == 2
