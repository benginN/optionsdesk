"""Uç noktaların ortak kullandığı yardımcılar: canlı zincir, snapshot zenginleştirme."""
from __future__ import annotations

import asyncio

from . import db
from .analytics import history as H
from .analytics import scoring
from .analytics.chain import Chain
from .data import cboe
from .data.earnings import earnings_map
from .data.rates import risk_free_rate

_enriched_cache: dict = {"key": None, "rows": {}}


async def get_chain(sym: str, fresh: bool = False) -> Chain:
    rate = await risk_free_rate()
    raw = await cboe.raw_chain(sym.upper(), fresh=fresh)
    return Chain(raw, rate)


async def hist_summary(sym: str) -> dict:
    try:
        rows = await cboe.history(sym)
    except Exception:
        return {}
    return H.summarize(rows)


async def safe_earnings() -> dict:
    try:
        return await earnings_map()
    except Exception:
        return {}


def latest_dates() -> list[str]:
    return db.snapshot_dates(2)


def enriched_snapshot(date: str | None = None) -> tuple[str | None, dict[str, dict]]:
    """Belirtilen (varsayılan: en son) snapshot'ı IV Pos ve skorlarla zenginleştirir."""
    dates = db.snapshot_dates(2)
    if not dates:
        return None, {}
    d = date or dates[0]
    key = (d, len(db.snapshot_dates(400)))
    if _enriched_cache["key"] == key:
        return d, _enriched_cache["rows"]
    snap = db.load_snapshot(d)
    ivh = db.iv30_history_all()
    rows = {t: scoring.enrich(m, ivh.get(t)) for t, m in snap.items()}
    if date is None or date == dates[0]:
        _enriched_cache.update(key=key, rows=rows)
    return d, rows


def invalidate() -> None:
    _enriched_cache.update(key=None, rows={})


async def gather_limited(coros, limit: int = 6):
    sem = asyncio.Semaphore(limit)

    async def run(c):
        async with sem:
            return await c

    return await asyncio.gather(*[run(c) for c in coros], return_exceptions=True)
