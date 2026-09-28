"""Risksiz faiz: 3 aylık T-Bill (FRED DTB3, anahtarsız CSV), yedek olarak Yahoo ^IRX."""
from __future__ import annotations

from datetime import date, timedelta

from .. import db
from .cache import disk_get, disk_set
from .cboe import client

FALLBACK_RATE = 0.04


async def _fred() -> float | None:
    start = (date.today() - timedelta(days=20)).isoformat()
    r = await client().get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTB3&cosd={start}")
    if r.status_code != 200:
        return None
    for line in reversed(r.text.strip().splitlines()[1:]):
        parts = line.split(",")
        if len(parts) == 2 and parts[1] not in (".", ""):
            return float(parts[1]) / 100.0
    return None


async def _yahoo() -> float | None:
    r = await client().get("https://query1.finance.yahoo.com/v8/finance/chart/%5EIRX?range=5d&interval=1d")
    if r.status_code != 200:
        return None
    return float(r.json()["chart"]["result"][0]["meta"]["regularMarketPrice"]) / 100.0


async def risk_free_rate() -> float:
    override = db.get_settings().get("risk_free_override")
    if override is not None:
        try:
            return float(override) / 100.0
        except (TypeError, ValueError):
            pass
    cached = disk_get("rate_tbill", max_age_hours=12)
    if cached is not None:
        return float(cached)
    for src in (_fred, _yahoo):
        try:
            rate = await src()
        except Exception:
            rate = None
        if rate is not None and 0 <= rate < 0.2:
            disk_set("rate_tbill", rate)
            return rate
    # Kısa süreli önbellek: her istekte tekrar denemeyelim
    disk_set("rate_tbill", FALLBACK_RATE)
    return FALLBACK_RATE
