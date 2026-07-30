"""Joins average zone utilization against the AER monthly reference price
for the same month, and reports correlation *with* its sample size.

Per the project's own ground rule: never surface a correlation coefficient
without n sitting right next to it, and always say plainly that n below
~24 months (two years) isn't statistically meaningful.
"""
from __future__ import annotations

import pandas as pd

MIN_MEANINGFUL_MONTHS = 24


def compute_monthly_rollup(utilization: pd.DataFrame, price: pd.DataFrame) -> dict:
    price = price[["year", "month", "price_gj"]]
    df = utilization.copy()
    df["gas_day"] = pd.to_datetime(df["gas_day"])
    df["year"] = df["gas_day"].dt.year
    df["month"] = df["gas_day"].dt.month

    system_monthly = (
        df.groupby(["year", "month"])["utilization_pct"]
        .mean()
        .reset_index()
        .rename(columns={"utilization_pct": "avg_utilization_pct"})
    )
    zone_monthly = (
        df.groupby(["zone", "year", "month"])["utilization_pct"]
        .mean()
        .reset_index()
        .rename(columns={"utilization_pct": "avg_utilization_pct"})
    )

    system_merged = system_monthly.merge(price, on=["year", "month"], how="inner").sort_values(["year", "month"])
    zone_merged = zone_monthly.merge(price, on=["year", "month"], how="inner").sort_values(["zone", "year", "month"])

    n_months = len(system_merged)
    correlation = system_merged["avg_utilization_pct"].corr(system_merged["price_gj"]) if n_months >= 2 else None

    return {
        "system_monthly": system_merged.to_dict(orient="records"),
        "by_zone_monthly": zone_merged.to_dict(orient="records"),
        "correlation": None if correlation is None or pd.isna(correlation) else round(float(correlation), 3),
        "n_months": n_months,
        "statistically_meaningful": n_months >= MIN_MEANINGFUL_MONTHS,
        "min_meaningful_months": MIN_MEANINGFUL_MONTHS,
        "note": (
            f"Correlation is shown with n = number of months with both a utilization "
            f"average and a published AER reference price. With n below "
            f"{MIN_MEANINGFUL_MONTHS} (two years), this is not statistically meaningful "
            f"and should be read as directional at most."
        ),
    }
