"""Nasdaq ücretsiz bilanço takvimi. Önümüzdeki ~60 günü tarar, günlük önbelleğe alır."""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta

from ..config import ET
from .cache import disk_get, disk_set
from .cboe import client

_lock = asyncio.Lock()


async def _fetch_day(d: date, sem: asyncio.Semaphore) -> list[dict]:
    url = f"https://api.nasdaq.com/api/calendar/earnings?date={d.isoformat()}"
    async with sem:
        for attempt in range(3):
            try:
                r = await client().get(url, headers={"Accept": "application/json", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"})
                if r.status_code != 200:
                    await asyncio.sleep(1 + attempt)
                    continue
                rows = ((r.json().get("data") or {}).get("rows")) or []
                return [{"symbol": x.get("symbol"), "time": x.get("time"), "date": d.isoformat()} for x in rows]
            except Exception:
                await asyncio.sleep(1 + attempt)
    return []


async def earnings_map(days: int = 60) -> dict[str, dict]:
    """{SYM: {'date': 'YYYY-MM-DD', 'time': 'time-pre-market' | 'time-after-hours' | ...}}"""
    today = datetime.now(ET).date()
    name = f"earnings_{today.isoformat()}"
    cached = disk_get(name, max_age_hours=20)
    if cached is not None:
        return cached
    async with _lock:
        cached = disk_get(name, max_age_hours=20)
        if cached is not None:
            return cached
        sem = asyncio.Semaphore(4)
        days_list = [today + timedelta(days=i) for i in range(days) if (today + timedelta(days=i)).weekday() < 5]
        results = await asyncio.gather(*[_fetch_day(d, sem) for d in days_list])
        out: dict[str, dict] = {}
        for rows in results:
            for x in rows:
                sym = (x.get("symbol") or "").upper()
                if sym and sym not in out:
                    out[sym] = {"date": x["date"], "time": x.get("time")}
        if out:
            disk_set(name, out)
        return out
