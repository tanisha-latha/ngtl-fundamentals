"""Orchestrates one pipeline run: fetch all sources, normalize, append any
new rows to the SQLite database. Safe to run repeatedly -- see db.py.

Usage: python -m pipeline.run [--db data/ngtl.db]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from pipeline import db, fetch, parse


def main(db_path: str) -> None:
    conn = db.connect(db_path)
    counts = {}

    print("Fetching capability & historical flow (chart/csv)...")
    chart_df = fetch.fetch_chart()
    daily_flow = parse.parse_daily_flow(chart_df)
    counts["daily_flow"] = db.insert_daily_flow(conn, daily_flow)
    print(f"  {counts['daily_flow']} new daily_flow rows")

    print("Fetching raw outage register...")
    outages_df = fetch.fetch_outages()
    outage_events = parse.parse_outage_events(outages_df)
    counts["outage_events"] = db.insert_outage_events(conn, outage_events)
    print(f"  {counts['outage_events']} new outage_events rows")

    print("Fetching plant turnaround activity...")
    pta_df = fetch.fetch_plant_turnaround()
    plant_turnaround = parse.parse_plant_turnaround(pta_df)
    counts["plant_turnaround"] = db.insert_plant_turnaround(conn, plant_turnaround)
    print(f"  {counts['plant_turnaround']} new plant_turnaround rows")

    print("Fetching base capabilities outlook...")
    cap_df = fetch.fetch_capabilities()
    capability_outlook = parse.parse_capability_outlook(cap_df)
    counts["capability_outlook"] = db.insert_capability_outlook(conn, capability_outlook)
    print(f"  {counts['capability_outlook']} new capability_outlook rows")

    print("Fetching AER natural gas reference price...")
    try:
        price_df = fetch.fetch_aer_reference_price()
        counts["aer_reference_price"] = db.insert_aer_reference_price(conn, price_df)
        print(f"  {counts['aer_reference_price']} new aer_reference_price rows")
    except Exception as exc:  # AER page is scraped HTML, not a stable API -- don't let it break the rest of the run
        print(f"  WARNING: AER reference price fetch failed ({exc}); skipping this source for this run")
        counts["aer_reference_price"] = 0

    db.record_run(conn, counts)
    conn.close()
    print("Done.", counts)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(REPO_ROOT / "data" / "ngtl.db"))
    args = parser.parse_args()
    main(args.db)
