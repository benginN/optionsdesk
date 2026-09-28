"""Basit TTL önbellek (bellek) ve günlük disk önbelleği."""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable

from ..config import CACHE_DIR, ET


class TTLCache:
    def __init__(self) -> None:
        self._store: dict[str, tuple[float, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._last_purge = 0.0

    def get(self, key: str) -> Any | None:
        item = self._store.get(key)
        if not item:
            return None
        expires, value = item
        if time.time() > expires:
            self._store.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any, ttl: float) -> None:
        now = time.time()
        self._store[key] = (now + ttl, value)
        # Süresi dolan kayıt yalnız okunurken silinirse, bir daha okunmayan (ör. bir kez bakılan hisse
        # zinciri) bellekte sonsuza kadar kalır. Dakikada bir süpür.
        if now - self._last_purge > 60:
            self._last_purge = now
            for k in [k for k, (exp, _) in self._store.items() if exp < now]:
                self._store.pop(k, None)
                lock = self._locks.get(k)
                if lock is not None and not lock.locked():
                    self._locks.pop(k, None)

    async def get_or_fetch(self, key: str, ttl: float, fetch: Callable[[], Awaitable[Any]]) -> Any:
        hit = self.get(key)
        if hit is not None:
            return hit
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self.get(key)
            if hit is not None:
                return hit
            value = await fetch()
            if value is not None:
                self.set(key, value, ttl)
            return value

    def clear(self) -> None:
        self._store.clear()


memory = TTLCache()


def market_is_open(now: datetime | None = None) -> bool:
    """ABD piyasası açık mı? (resmi tatiller dikkate alınmaz)"""
    now = now or datetime.now(ET)
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return 9 * 60 + 30 <= minutes <= 16 * 60 + 15


def live_ttl() -> float:
    return 90.0 if market_is_open() else 1800.0


def _disk_path(name: str) -> Path:
    return CACHE_DIR / f"{name}.json"


def disk_get(name: str, max_age_hours: float) -> Any | None:
    p = _disk_path(name)
    if not p.exists():
        return None
    if (time.time() - p.stat().st_mtime) > max_age_hours * 3600:
        return None
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def disk_set(name: str, value: Any) -> None:
    p = _disk_path(name)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(value))
    tmp.replace(p)
