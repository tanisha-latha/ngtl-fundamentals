-- NGTL fundamentals database schema.
-- Every table here is a raw, append-only record of what the source published.
-- Derived metrics (utilization, facility rollups, correlations) are computed
-- on read by the analysis/ modules -- nothing derived is stored here, so the
-- database never gets out of sync with its own analysis.

-- One row per (zone, gas_day), only for days that have a realized actual flow.
-- Forecast/placeholder rows (future gas days with no actual flow yet) are
-- skipped on ingest -- a gas_day only ever enters this table once it has
-- happened, and once inserted a row is never updated or deleted. This is
-- what makes the table append-only without needing UPSERT logic.
CREATE TABLE IF NOT EXISTS daily_flow (
    zone                    TEXT    NOT NULL,   -- USJR, AB/BC, EGAT, OSDA
    gas_day                 TEXT    NOT NULL,   -- ISO date, YYYY-MM-DD
    actual_flow_e3m3d       REAL,               -- actual flow, 10^3 m3/d
    base_capability_e3m3d   REAL,               -- nameplate capability, 10^3 m3/d
    outage_capability_e3m3d REAL,               -- capability after active outages, 10^3 m3/d (NULL = no active outage)
    impact_e3m3d            REAL,               -- base - outage capability, 10^3 m3/d
    outage_description      TEXT,               -- raw free text, ';'-separated when multiple facilities
    heat_value_gj_e3m3      REAL,               -- assumed heating value, GJ / 10^3 m3
    ft_d_tjd                REAL,               -- firm transportation demand, TJ/d (AB/BC, EGAT only)
    ingested_at             TEXT    NOT NULL,   -- UTC timestamp of the pipeline run that inserted this row
    PRIMARY KEY (zone, gas_day)
);

-- One row per outage record from the raw outages/ endpoint. Keyed on the
-- source's own UID, which is stable and unique per zone-table row, so this
-- is also a pure INSERT-OR-IGNORE append. Note: if TC Energy revises a still
-- upcoming outage's dates or capability, the revision is a *new* UID and
-- both the original and the revision remain in this table -- this is a
-- known limitation, documented in docs/schema.md.
CREATE TABLE IF NOT EXISTS outage_events (
    uid                     TEXT    PRIMARY KEY,
    outage_id               TEXT    NOT NULL,
    zone_table               TEXT    NOT NULL,   -- source "Table" column: USJR, LCLR, WGAT, FHZ8, EGAT, NEDA, LCLD, OSDA, ...
    start_date               TEXT    NOT NULL,
    end_date                 TEXT    NOT NULL,
    capability               REAL,
    typical_flow             TEXT,
    restriction_type         TEXT,
    area                     TEXT,
    other_segments           TEXT,
    description               TEXT,
    facility                 TEXT,               -- parsed: text before the last ' - '
    activity_type             TEXT,               -- parsed: text after the last ' - '
    local_base_capability     REAL,
    local_outage_capability   REAL,
    ingested_at               TEXT    NOT NULL
);

-- Plant turnaround receipt/delivery impact windows. No facility name in the
-- source, so this stays a flat, deduplicated append log.
CREATE TABLE IF NOT EXISTS plant_turnaround (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date  TEXT    NOT NULL,
    end_date    TEXT    NOT NULL,
    type        TEXT    NOT NULL,   -- Receipt / Delivery
    impact      REAL,
    ingested_at TEXT    NOT NULL,
    UNIQUE (start_date, end_date, type, impact)
);

-- Forward-looking monthly capability outlook. This is guidance, not history
-- -- TC Energy updates it in place -- so instead of overwriting we keep every
-- daily snapshot, each stamped with the date it was pulled.
CREATE TABLE IF NOT EXISTS capability_outlook (
    pulled_date     TEXT    NOT NULL,
    effective_date  TEXT    NOT NULL,
    zone            TEXT    NOT NULL,
    capability_e6m3d REAL,
    PRIMARY KEY (pulled_date, effective_date, zone)
);

-- AER monthly reference price, $/GJ. The only price series in this project --
-- see README for why no daily AECO price is included.
CREATE TABLE IF NOT EXISTS aer_reference_price (
    year        INTEGER NOT NULL,
    month       INTEGER NOT NULL,
    price_gj    REAL,
    ingested_at TEXT    NOT NULL,
    PRIMARY KEY (year, month)
);

-- One row per pipeline run, for auditing what each run actually added.
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at                          TEXT    NOT NULL,
    daily_flow_rows_added           INTEGER,
    outage_rows_added               INTEGER,
    turnaround_rows_added           INTEGER,
    capability_snapshot_rows_added  INTEGER,
    price_rows_added                INTEGER
);
