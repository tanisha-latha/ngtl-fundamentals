"""Seasonal-normal comparison: each zone-month's utilization vs. the average
of that same calendar month in *prior* years only (never including the
current year, so this is never circular).

This dataset's history starts January 2025, so seasonal normals only exist
starting January 2026 (one prior year available) and only get more reliable
as more Januaries, Februaries, etc. accumulate. n_prior_years is carried on
every row so nothing downstream states a seasonal comparison without saying
how many years it's built on.
"""
from __future__ import annotations

import pandas as pd


def compute_seasonal_normals(utilization: pd.DataFrame) -> pd.DataFrame:
    df = utilization.copy()
    df["gas_day"] = pd.to_datetime(df["gas_day"])
    df["year"] = df["gas_day"].dt.year
    df["month"] = df["gas_day"].dt.month

    monthly = (
        df.groupby(["zone", "year", "month"])["utilization_pct"]
        .mean()
        .reset_index()
        .rename(columns={"utilization_pct": "month_avg_utilization_pct"})
    )

    results = []
    for (zone, month), group in monthly.groupby(["zone", "month"]):
        group = group.sort_values("year")
        for _, row in group.iterrows():
            prior = group[group["year"] < row["year"]]
            seasonal_normal = prior["month_avg_utilization_pct"].mean() if len(prior) else None
            results.append({
                "zone": zone,
                "year": int(row["year"]),
                "month": int(month),
                "month_avg_utilization_pct": row["month_avg_utilization_pct"],
                "seasonal_normal_pct": seasonal_normal,
                "n_prior_years": len(prior),
            })
    return pd.DataFrame(results)


def attach_seasonal_deviation(utilization: pd.DataFrame, seasonal_normals: pd.DataFrame) -> pd.DataFrame:
    df = utilization.copy()
    df["gas_day"] = pd.to_datetime(df["gas_day"])
    df["year"] = df["gas_day"].dt.year
    df["month"] = df["gas_day"].dt.month

    merged = df.merge(
        seasonal_normals[["zone", "year", "month", "seasonal_normal_pct", "n_prior_years"]],
        on=["zone", "year", "month"], how="left",
    )
    merged["deviation_from_seasonal_normal_pct"] = (
        merged["utilization_pct"] - merged["seasonal_normal_pct"]
    )
    merged["gas_day"] = merged["gas_day"].dt.strftime("%Y-%m-%d")
    return merged.drop(columns=["year", "month"])
