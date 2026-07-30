# NGTL Fundamentals

A running data system that tracks TC Energy's NGTL/Foothills pipeline
capacity, flow, and outages, and correlates zone utilization against the
Alberta natural gas reference price. Built as a portfolio project for a gas
trading fundamentals internship — **no employer data, proprietary feed, or
paid terminal (Bloomberg, Refinitiv, ICE, NGI, Nasdaq Data Link, or any
other) was used anywhere in this project.** Every number in this repo comes
from a free, public source, listed below.

A [GitHub Actions workflow](.github/workflows/daily_pipeline.yml) runs the
pipeline daily, appends any new gas days to the database, and commits the
result — this repo's history *is* the data history.

## Why utilization matters as a trading signal

NGTL publishes forward capability, but actual flow relative to that
capability — utilization — is what tells you whether a zone is actually
constrained on a given day, and constraints move basis. A receipt point
running near 100% of its outage-adjusted capability during a compressor
station's maintenance window is a very different situation from the same
zone running at 60% with capacity to spare. Reading utilization alongside
*which specific facility* is driving a constraint, and how that compares to
what's normal for that time of year, is closer to how a fundamentals
analyst actually watches a pipeline system than a single capability number
ever is. That's the case for building this as a running system instead of a
one-off chart: the signal is in the pattern over time, not any single day.

## What's in here

- **Zone utilization heatmap** — one row per zone, one cell per gas day,
  color-mapped to utilization %, spanning the full history collected so
  far.
- **Facility constraint log** — every facility named in an outage
  description, how many gas days it was active, ranked by total impact
  volume.
- **Monthly utilization vs. AER reference price** — with the correlation
  coefficient always shown next to its sample size (n = months of overlap),
  and an explicit note that n below ~24 months (two years) isn't
  statistically meaningful. This project will not show you a correlation
  number without that context.
- **Seasonal-normal comparison** — each zone-month's utilization against the
  average of that same calendar month in *prior* years only. This starts
  sparse (history begins January 2025, so the first seasonal comparisons
  don't exist until January 2026) and gets more reliable every year the
  pipeline keeps running — same honesty-about-sample-size principle as the
  correlation.
- **Annotated constraint events** — named-facility outages paired with what
  happened to utilization on their zone while they were active.

## Data sources and their limitations

| Source | What it provides | Limitation |
|---|---|---|
| [NGTL/Foothills base capabilities](https://f51561ras5.execute-api.us-west-2.amazonaws.com/production/csv/capabilities) | Forward monthly capability by zone | Guidance, not history — TC Energy updates it in place |
| [Capability & historical flow (`chart/csv`)](https://f51561ras5.execute-api.us-west-2.amazonaws.com/production/chart/csv) | Daily gas-day flow, capability, and outage descriptions by zone | Only the four zones with a paired flow/capability series (USJR, AB/BC, EGAT, OSDA) |
| [Plant turnaround activity](https://f51561ras5.execute-api.us-west-2.amazonaws.com/production/plantturnaroundactivity/csv) | Receipt/delivery impact windows | No facility name attached |
| [Raw outage register (`csv/outages/`)](https://f51561ras5.execute-api.us-west-2.amazonaws.com/production/csv/outages/) | Per-event outage records with explicit start/end dates | Revisions to a still-upcoming outage publish under a new ID rather than updating the original — see [`docs/schema.md`](docs/schema.md) |
| [AER natural gas reference price](https://www.alberta.ca/alberta-natural-gas-reference-price) | Monthly Alberta reference price, $/GJ, 1994–present — the official input to Crown royalty valuation | **Monthly only.** Daily AECO spot prices are not freely available (NGI, ICE, and Nasdaq Data Link all require paid subscriptions) and are **not** scraped, estimated, or fabricated anywhere in this project. Every price figure shown is this monthly reference price, and every place a price appears says so explicitly. |

## Design

The heatmap-first layout and paper/ink color palette are a deliberate
departure from both the dark-mode-neon "AI dashboard" look and the
light-broadsheet "AI report" look. The visual language is drawn from actual
gas-measurement chart recorders — the pen-and-ink instruments historically
used to record pipeline flow and pressure — rather than software-dashboard
conventions. See the design rationale in the project's build history for the
full palette and typography reasoning.

## Repo structure

```
pipeline/     fetch, parse, and append raw source data to SQLite (append-only)
analysis/     utilization, facility extraction, seasonal normals, monthly
              rollup + correlation, and JSON export for the site
site/         static HTML/CSS/JS, no build step — reads site/data/*.json
data/ngtl.db  the database itself, committed and growing daily
tests/        unit tests for the parsing and analysis logic
docs/         schema documentation
```

## Running it locally

Requires Python 3.10+.

```bash
pip install -r requirements.txt
python -m pipeline.run              # fetch all sources, append new rows to data/ngtl.db
python -m analysis.export_snapshot  # regenerate site/data/*.json from the database
python -m pytest tests/             # run the test suite
```

To view the site, serve the `site/` directory with any static file server
(it fetches its JSON snapshots relative to `index.html`, so it can't be
opened directly as a `file://` URL in most browsers):

```bash
cd site && python -m http.server 8000
```

## A note on statistical honesty

This project's ground rule, applied everywhere a number could be
misread as more certain than it is: **never show a correlation coefficient,
a seasonal comparison, or a facility-impact figure without also showing what
it's built on** — the sample size, the years of history available, or the
attribution method used. A pipeline system with 18 months of history cannot
tell you whether utilization *causes* price movement, or even whether an
18-month correlation will hold up over a full multi-year cycle. The honest
answer, most of the time this project is young, is "not enough data yet" —
and it says so, in the UI, not just in this README.
