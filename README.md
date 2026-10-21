# NGTL Fundamentals

A small data system I built to watch TC Energy's NGTL gas pipeline: how full each zone runs, which facilities are down, and whether any of it lines up with the Alberta gas price.

I built it as a portfolio project for a gas trading fundamentals internship. Everything in it comes from free public sources listed below. No employer data, no paid terminals, no proprietary feeds.

A [GitHub Actions workflow](.github/workflows/daily_pipeline.yml) adds any new gas days to the database and commits the result, so the commit history is the data history. It ran daily until late September 2026, when the fetch step started failing. The schedule is paused until I fix that, and I run it by hand from the Actions tab.

## Why utilization

NGTL publishes capability, but capability alone doesn't tell you much. What tells you whether a zone is actually tight is how much of that capability is being used, and which facility is the reason it's reduced. A zone at 100% during a compressor station outage is a different situation from the same zone at 60% with room to spare. That's why this runs continuously instead of being a one-off chart: the pattern over time is the useful part.

## What I found so far

Based on 597 gas days, January 30, 2025 to September 18, 2026, across four zones.

- **EGAT is always full.** It runs at about 105% of published capability on average, and sits within half a percent of capability, or above it, on roughly 76% of days. Flow above 100% suggests the published capability is conservative for that zone, but I still need to check how TC Energy defines it.
- **AB/BC is the zone with the most room**, averaging about 84%. In March to May 2026 it dropped to roughly 61% to 64%, compared with 84% to 93% in the same months of 2025. I don't know why yet. That is the first thing I want to dig into.
- **Wolf Lake A2 is the facility that shows up most**, with 83 days of reductions between September 2025 and July 2026, but none of its events were flagged as a risk to firm service. Otter Lake was active on fewer days (39) but has 6 events flagged as potential firm impact.
- **About 36% of outage events (40 of 112) are flagged as a potential risk to firm service.** Another 43 events have no restriction type in the source, so that share could be higher or lower.
- **Monthly utilization and the AER reference price correlate at 0.66, but only across 19 months.** That is below the 24 months I set as the minimum for taking a correlation seriously. Winter months push both numbers up, and I haven't separated that seasonal effect out yet, so I wouldn't read this as utilization moving price.

## What's in it

- A daily heatmap of utilization for each zone
- A log of every facility named in an outage, ranked by impact
- Monthly utilization against the AER reference price, with the sample size shown next to every correlation
- Each zone-month compared with the same month in earlier years (this needs more history to be useful)
- A split of outages by whether they put firm or interruptible service at risk

## Data sources and limits

| Source | What it gives | Limit |
|---|---|---|
| [NGTL/Foothills base capabilities](https://f51561ras5.execute-api.us-west-2.amazonaws.com/production/csv/capabilities) | Forward monthly capability by zone | A forecast. TC Energy updates it in place |
| [Capability and historical flow](https://f51561ras5.execute-api.us-west-2.amazonaws.com/production/chart/csv) | Daily flow, capability and outage notes | Only four zones have both flow and capability |
| [Plant turnaround activity](https://f51561ras5.execute-api.us-west-2.amazonaws.com/production/plantturnaroundactivity/csv) | Receipt and delivery impact windows | No facility names |
| [Raw outage register](https://f51561ras5.execute-api.us-west-2.amazonaws.com/production/csv/outages/) | Outage events with start and end dates | A revised outage is published as a new record, see [`docs/schema.md`](docs/schema.md) |
| [AER reference price](https://www.alberta.ca/alberta-natural-gas-reference-price) | Monthly Alberta gas price, $/GJ | Monthly only. Daily AECO prices need a paid subscription, so I don't use or estimate them |

## Layout

```
pipeline/     fetch, parse and append source data to SQLite
analysis/     utilization, facilities, seasonal comparison, monthly rollup, JSON export
site/         static HTML, CSS and JS that reads site/data/*.json
data/ngtl.db  the database, committed and growing daily
tests/        tests for the parsing and analysis code
docs/         schema notes
```

## Run it

Needs Python 3.10 or newer.

```bash
pip install -r requirements.txt
python -m pipeline.run              # fetch sources, add new rows to data/ngtl.db
python -m analysis.export_snapshot  # rebuild site/data/*.json
python -m pytest tests/             # run the tests
```

To view the site, serve the `site/` folder (it won't load as a `file://` page):

```bash
cd site && python -m http.server 8000
```

## A note on sample size

Every number that depends on a small sample shows that sample next to it. With under two years of history, most of the time the honest answer is "not enough data yet", and the site says that where it matters.
