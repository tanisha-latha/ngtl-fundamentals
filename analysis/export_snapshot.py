"""Runs the full analysis stack against the current database and writes the
JSON snapshots the static site reads. The site never queries the database
or a live endpoint directly -- it only ever reads these generated files.

Usage: python -m analysis.export_snapshot [--db data/ngtl.db] [--out site/data]
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from analysis.events import compute_annotated_events
from analysis.facilities import extract_facility_mentions, summarize_constraint_log
from analysis.monthly_rollup import compute_monthly_rollup
from analysis.seasonal import attach_seasonal_deviation, compute_seasonal_normals
from analysis.utilization import compute_utilization
from pipeline import db
from pipeline.parse import split_outage_description


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, default=str)


def main(db_path: str, out_dir: str) -> None:
    out = Path(out_dir)
    conn = sqlite3.connect(db_path)

    daily_flow = db.read_table(conn, "daily_flow")
    outage_events_raw = db.read_table(conn, "outage_events")
    price = db.read_table(conn, "aer_reference_price")
    conn.close()

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    utilization = compute_utilization(daily_flow)
    seasonal_normals = compute_seasonal_normals(utilization)
    utilization_with_deviation = attach_seasonal_deviation(utilization, seasonal_normals)

    # --- heatmap.json: one cell per (zone, gas_day) ---
    heatmap_cells = utilization_with_deviation[[
        "zone", "gas_day", "utilization_pct", "outage_adjusted",
        "deviation_from_seasonal_normal_pct", "n_prior_years", "outage_description",
    ]].copy()
    heatmap_cells["utilization_pct"] = heatmap_cells["utilization_pct"].round(1)
    heatmap_cells["deviation_from_seasonal_normal_pct"] = heatmap_cells["deviation_from_seasonal_normal_pct"].round(1)
    heatmap_cells["facilities"] = heatmap_cells["outage_description"].apply(
        lambda text: [m["facility"] for m in split_outage_description(text)]
    )
    heatmap_cells = heatmap_cells.drop(columns=["outage_description"])
    zones = sorted(daily_flow["zone"].unique().tolist())
    _write_json(out / "heatmap.json", {
        "generated_at": generated_at,
        "zones": zones,
        "date_range": {
            "start": daily_flow["gas_day"].min(),
            "end": daily_flow["gas_day"].max(),
        },
        "cells": json.loads(heatmap_cells.to_json(orient="records")),
    })

    # --- facilities.json: constraint log ---
    mentions = extract_facility_mentions(daily_flow)
    constraint_log = summarize_constraint_log(mentions)
    _write_json(out / "facilities.json", {
        "generated_at": generated_at,
        "facilities": json.loads(constraint_log.to_json(orient="records")),
    })

    # --- monthly_correlation.json: utilization vs AER price ---
    rollup = compute_monthly_rollup(utilization, price)
    rollup["generated_at"] = generated_at
    _write_json(out / "monthly_correlation.json", rollup)

    # --- events.json: annotated facility-outage-vs-utilization events ---
    annotated = compute_annotated_events(outage_events_raw, utilization_with_deviation)
    _write_json(out / "events.json", {
        "generated_at": generated_at,
        "events": json.loads(annotated.to_json(orient="records")) if not annotated.empty else [],
    })

    print(f"Wrote snapshots to {out}/: heatmap.json, facilities.json, monthly_correlation.json, events.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(REPO_ROOT / "data" / "ngtl.db"))
    parser.add_argument("--out", default=str(REPO_ROOT / "site" / "data"))
    args = parser.parse_args()
    main(args.db, args.out)
