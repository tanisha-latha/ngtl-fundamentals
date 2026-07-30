"""Append-only SQLite writes. Every insert here is INSERT OR IGNORE keyed on
a natural primary key, so re-running the pipeline against overlapping data
is always safe -- rows that already exist are silently skipped, nothing is
ever updated or deleted.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pandas as pd

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def connect(db_path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        conn.executescript(f.read())
    return conn


def _insert_or_ignore(conn: sqlite3.Connection, table: str, df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    cols = list(df.columns)
    placeholders = ", ".join(["?"] * len(cols))
    col_list = ", ".join(cols)
    sql = f"INSERT OR IGNORE INTO {table} ({col_list}) VALUES ({placeholders})"
    cur = conn.cursor()
    before = conn.total_changes
    cur.executemany(sql, df[cols].itertuples(index=False, name=None))
    conn.commit()
    return conn.total_changes - before


def insert_daily_flow(conn: sqlite3.Connection, df: pd.DataFrame) -> int:
    return _insert_or_ignore(conn, "daily_flow", df)


def insert_outage_events(conn: sqlite3.Connection, df: pd.DataFrame) -> int:
    return _insert_or_ignore(conn, "outage_events", df)


def insert_plant_turnaround(conn: sqlite3.Connection, df: pd.DataFrame) -> int:
    return _insert_or_ignore(conn, "plant_turnaround", df)


def insert_capability_outlook(conn: sqlite3.Connection, df: pd.DataFrame) -> int:
    return _insert_or_ignore(conn, "capability_outlook", df)


def insert_aer_reference_price(conn: sqlite3.Connection, df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    df = df.assign(ingested_at=pd.Timestamp.now(tz="UTC").isoformat(timespec="seconds"))
    return _insert_or_ignore(conn, "aer_reference_price", df)


def record_run(conn: sqlite3.Connection, counts: dict) -> None:
    conn.execute(
        """
        INSERT INTO pipeline_runs (
            run_at, daily_flow_rows_added, outage_rows_added,
            turnaround_rows_added, capability_snapshot_rows_added, price_rows_added
        ) VALUES (datetime('now'), ?, ?, ?, ?, ?)
        """,
        (
            counts.get("daily_flow", 0),
            counts.get("outage_events", 0),
            counts.get("plant_turnaround", 0),
            counts.get("capability_outlook", 0),
            counts.get("aer_reference_price", 0),
        ),
    )
    conn.commit()


def read_table(conn: sqlite3.Connection, table: str) -> pd.DataFrame:
    return pd.read_sql_query(f"SELECT * FROM {table}", conn)
