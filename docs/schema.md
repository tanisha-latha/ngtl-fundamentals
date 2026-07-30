# Database schema

`data/ngtl.db` is a SQLite database. Every table is a raw, append-only record
of what a source published — no table here has ever been updated or
overwritten, only ever inserted into. Derived numbers (utilization %,
facility rollups, correlations) are computed on read by the `analysis/`
modules and are never stored in the database, so there's nothing to keep in
sync.

The canonical table definitions are in [`pipeline/schema.sql`](../pipeline/schema.sql).
This document explains the *why* behind each table and the judgment calls
made turning messy public CSVs into a stable schema.

## `daily_flow`

One row per `(zone, gas_day)`, for the four zones with a paired actual-flow /
capability series: `USJR`, `AB/BC`, `EGAT`, `OSDA`. Source:
[`chart/csv`](https://f51561ras5.execute-api.us-west-2.amazonaws.com/production/chart/csv).

The source publishes capability for future gas days before they happen (so
the market can see planned capacity), but `actual_flow` is only populated
once a gas day is realized. **A row only enters this table once it has a
realized `actual_flow_e3m3d`** — forecast/placeholder rows are dropped at
parse time (`pipeline/parse.py::parse_daily_flow`). This is what makes the
table append-only without any update logic: a given `(zone, gas_day)` is
either not yet in the table (still in the future) or permanently in the
table (it happened, and that fact doesn't change).

`outage_capability_e3m3d` is NULL on days with no active outage; utilization
(`analysis/utilization.py`) falls back to `base_capability_e3m3d` on those
days.

## `outage_events`

One row per outage record from the raw
[`csv/outages/`](https://f51561ras5.execute-api.us-west-2.amazonaws.com/production/csv/outages/)
endpoint, keyed on the source's own `UID`, which is stable and unique per
zone-table row. `facility` / `activity_type` are parsed out of `description`
at ingest time using the same split rule as the daily-level extraction (see
below).

**Known limitation:** if TC Energy revises a still-upcoming outage's dates
or capability before it happens, the revision publishes under a *new* UID —
this table will then hold both the original and the revised record, with no
way to tell from this table alone that one supersedes the other. This
project treats that as an acceptable tradeoff for staying strictly
append-only rather than adding update/versioning logic for a case that
mainly affects outages that haven't happened yet.

`zone_table` is the source's own zone code (`USJR`, `LCLR`, `WGAT`, `FHZ8`,
`EGAT`, `NEDA`, `LCLD`, `OSDA`, ...) — a finer-grained set than the four
`daily_flow` zones. `analysis/events.py` maps the subset that has a matching
flow series (`USJR`→`USJR`, `EGAT`→`EGAT`, `OSDA`→`OSDA`, `WGAT`→`AB/BC`) and
skips the rest (local receipt/delivery laterals, Foothills BC) since there's
no utilization series to pair them with in this project.

## `plant_turnaround`

Receipt/delivery impact windows from
[`plantturnaroundactivity/csv`](https://f51561ras5.execute-api.us-west-2.amazonaws.com/production/plantturnaroundactivity/csv).
No facility name in the source, so this is a flat, deduplicated log (unique
on start/end/type/impact) rather than something joined into the facility
constraint log.

## `capability_outlook`

The forward monthly capability outlook from
[`csv/capabilities`](https://f51561ras5.execute-api.us-west-2.amazonaws.com/production/csv/capabilities).
This is guidance that TC Energy updates in place, not a historical record —
so instead of overwriting it, every pipeline run stores its own dated
snapshot (`pulled_date`), giving a history of how the outlook itself has
changed over time.

## `aer_reference_price`

Monthly Alberta natural gas reference price, $/GJ, scraped from
[alberta.ca](https://www.alberta.ca/alberta-natural-gas-reference-price)'s
"Gas reference prices from 1994 to present" table (not the separate
1988–1993 "average market prices" table, which uses a different
methodology). This is the **only** price series in this project — see the
README for why no daily AECO price is included.

## `pipeline_runs`

One row per pipeline execution, recording how many new rows each source
contributed that run. Purely an audit log.

## Facility-name extraction rule

Used in two places — `outage_events.facility`/`activity_type` at ingest
time, and `analysis/facilities.py` when extracting facility mentions from
`daily_flow.outage_description` — via the same shared function,
`pipeline.parse.split_outage_description`:

1. Split the free-text field on `;` (multiple facilities can be under
   outage on the same zone-day).
2. For each piece, split on the **last** ` - ` and treat everything before
   it as the facility name, everything after as the activity type (handles
   facility names that themselves contain a hyphenated range, e.g.
   `"Segment 4 - 7 - Pipeline Maintenance"` → facility `"Segment 4 - 7"`).

**Documented simplification:** when multiple facilities are named on the
same zone-day, each is credited with that day's *full* zone-level impact
volume in the facility constraint log — the source does not sub-allocate
impact across concurrent outages, and this project doesn't attempt to
estimate a split either. In this dataset concurrent same-day outages are
uncommon, but `total_impact_e3m3d` in the facility log should be read as "the
impact on days this facility was part of a constraint," not a precise
per-facility volume attribution.
