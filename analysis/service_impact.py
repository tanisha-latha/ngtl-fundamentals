"""Classifies outages by which transportation service they actually put at
risk -- the distinction gas traders care about that a raw outage count or
even a raw utilization number doesn't capture.

NGTL's tariff, like most North American pipelines, curtails interruptible
(IT) flow before it touches firm (FT) contracts -- FT-R (firm receipt) and
FT-D (firm delivery) sit ahead of IT in the priority-of-service stack. So a
capacity reduction on a given day doesn't automatically mean a firm shipper
is at risk: it might just mean interruptible flow gets trimmed, which is
routine and priced into IT service. The raw outage register's own
"Type of Restriction" field already tells you which case you're in --
this project just hadn't surfaced it until now.

Three buckets, read directly off that field (no inference, no scoring):
  - firm_risk:        field explicitly says "Potential impact to FT-R/FT-D/FT"
  - no_firm_impact:   field explicitly says "No impact to FT-D anticipated"
  - unclassified:     field is blank -- mostly local receipt/delivery
                       laterals (zone_table LCLR/LCLD) that don't carry a
                       stated restriction type in the source at all

Volume-at-risk per bucket is deliberately NOT computed here: local_base /
local_outage_capability (the only fields that would support that) are NULL
on most rows in this dataset, and estimating a volume from Capability alone
would overstate precision the source doesn't provide.
"""
from __future__ import annotations

import pandas as pd


def classify_restriction(restriction_type) -> dict:
    if restriction_type is None or (isinstance(restriction_type, float) and pd.isna(restriction_type)):
        return {"category": "unclassified", "firm_leg": None}
    text = str(restriction_type).strip()
    if not text or text.lower() == "none":
        return {"category": "unclassified", "firm_leg": None}

    t = text.lower()
    if t.startswith("no impact"):
        return {"category": "no_firm_impact", "firm_leg": "delivery" if "ft-d" in t else None}
    if "potential" in t and ("ft-r" in t or "ft-d" in t or "to ft" in t):
        leg = "receipt" if "ft-r" in t else ("delivery" if "ft-d" in t else "unspecified")
        return {"category": "firm_risk", "firm_leg": leg}
    return {"category": "unclassified", "firm_leg": None}


def compute_service_impact(outage_events: pd.DataFrame) -> dict:
    df = outage_events.copy()
    classified = df["restriction_type"].apply(classify_restriction)
    df["service_category"] = classified.apply(lambda c: c["category"])
    df["firm_leg"] = classified.apply(lambda c: c["firm_leg"])
    df["event_days"] = (
        pd.to_datetime(df["end_date"]) - pd.to_datetime(df["start_date"])
    ).dt.days + 1

    total_events = len(df)
    by_category = (
        df.groupby("service_category")
        .agg(events=("uid", "count"), total_event_days=("event_days", "sum"))
        .reindex(["firm_risk", "no_firm_impact", "unclassified"])
        .fillna(0)
        .astype({"events": int, "total_event_days": int})
        .reset_index()
        .to_dict(orient="records")
    )

    by_zone = (
        df.groupby(["zone_table", "service_category"])
        .size()
        .unstack(fill_value=0)
        .reindex(columns=["firm_risk", "no_firm_impact", "unclassified"], fill_value=0)
        .reset_index()
        .to_dict(orient="records")
    )

    firm_risk = df[df["service_category"] == "firm_risk"]
    facility_firm_risk_counts = (
        firm_risk.groupby("facility")
        .agg(firm_risk_events=("uid", "count"), zones=("zone_table", lambda s: sorted(set(s))))
        .reset_index()
        .sort_values("firm_risk_events", ascending=False)
        .to_dict(orient="records")
    )

    n_firm_risk = int((df["service_category"] == "firm_risk").sum())

    return {
        "total_events": total_events,
        "firm_risk_events": n_firm_risk,
        "firm_risk_share_pct": round(100 * n_firm_risk / total_events, 1) if total_events else None,
        "by_category": by_category,
        "by_zone": by_zone,
        "facility_firm_risk_counts": facility_firm_risk_counts,
        "note": (
            "Categorized directly from the source's own 'Type of Restriction' field on "
            "each outage record -- not inferred or modeled. 'firm_risk' means the source "
            "explicitly flagged potential impact to FT-R or FT-D; 'no_firm_impact' means "
            "the source explicitly said none was anticipated; 'unclassified' means the "
            "field was blank in the source, which is common for local receipt/delivery "
            "laterals rather than mainline segments."
        ),
    }


def facility_firm_risk_lookup(outage_events: pd.DataFrame) -> dict:
    """facility -> count of its outage_events rows classified firm_risk, for
    tagging the daily-flow-derived facility constraint log.
    """
    df = outage_events.copy()
    df["service_category"] = df["restriction_type"].apply(lambda r: classify_restriction(r)["category"])
    counts = df[df["service_category"] == "firm_risk"].groupby("facility").size()
    return counts.to_dict()
