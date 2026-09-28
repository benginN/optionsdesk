"""CBOE ücretsiz gecikmeli (15 dk) veri uçları.

- /options/{SYM}.json         : tüm opsiyon zinciri + dayanak kotasyonu (iv30 dahil)
- /quotes/{SYM}.json          : kotasyon (VIX ailesi için)
- /charts/historical/{SYM}.json : günlük OHLCV geçmişi
"""
from __future__ import annotations

import asyncio
import random
from datetime import datetime

import httpx

from ..config import CBOE_BASE, ET, INDEX_SYMBOLS, USER_AGENT
from .cache import disk_get, disk_set, live_ttl, memory

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            follow_redirects=True,
            timeout=httpx.Timeout(45.0, connect=15.0),
            limits=httpx.Limits(max_connections=16, max_keepalive_connections=8),
        )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def cboe_symbol(sym: str) -> str:
    sym = sym.upper().lstrip("^_")
    return f"_{sym}" if sym in INDEX_SYMBOLS else sym


class DataError(Exception):
    pass


class _Pacer:
    """CBOE'nin istek limitine uyum sağlayan uyarlanabilir aralıklandırıcı.

    Limit yaklaşık 5 dakikada ~100 istek. 429 gelince Retry-After kadar herkes bekler ve
    aralık büyür; başarılı isteklerle aralık yavaşça tekrar küçülür.
    """

    def __init__(self, interval: float = 2.0, floor: float = 1.2, ceiling: float = 6.0):
        self.interval = interval
        self.floor = floor
        self.ceiling = ceiling
        self.next_at = 0.0
        self.lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self.lock:
            loop = asyncio.get_running_loop()
            while True:
                delay = self.next_at - loop.time()
                if delay <= 0:
                    break
                await asyncio.sleep(delay)
            self.next_at = loop.time() + self.interval

    def ok(self) -> None:
        self.interval = max(self.floor, self.interval * 0.98)

    def backoff(self, seconds: float) -> None:
        loop = asyncio.get_running_loop()
        self.interval = min(self.ceiling, self.interval * 1.4)
        self.next_at = max(self.next_at, loop.time() + seconds)


pacer = _Pacer()


async def get_json(url: str, retries: int = 4, max_throttled: int = 10) -> dict:
    last: Exception | None = None
    attempt = throttled = 0
    while attempt < retries and throttled < max_throttled:
        await pacer.wait()
        try:
            r = await client().get(url)
            if r.status_code == 404 or r.status_code == 403:
                raise DataError(f"Bulunamadı ({r.status_code})")
            if r.status_code == 429:
                try:
                    wait = float(r.headers.get("retry-after", "30"))
                except ValueError:
                    wait = 30.0
                pacer.backoff(min(wait, 90) + 1)
                throttled += 1
                last = DataError("CBOE istek limiti (429)")
                continue
            if r.status_code >= 500:
                raise httpx.HTTPStatusError("geçici hata", request=r.request, response=r)
            r.raise_for_status()
            data = r.json()
            pacer.ok()
            return data
        except DataError:
            raise
        except (httpx.HTTPError, ValueError) as e:  # ValueError: bozuk JSON
            last = e
            attempt += 1
            await asyncio.sleep(0.8 * (2 ** attempt) + random.random() * 0.4)
    raise DataError(f"Veri alınamadı: {last}")


async def _fetch_chain(sym: str) -> dict:
    data = await get_json(f"{CBOE_BASE}/options/{cboe_symbol(sym)}.json")
    if not data.get("data") or not data["data"].get("options"):
        raise DataError(f"{sym} için opsiyon zinciri boş")
    return data


async def raw_chain(sym: str, fresh: bool = False, store: bool = True) -> dict:
    """Ham zincir verisi (bellek önbellekli).

    fresh=True önbelleği atlar; store=False sonucu belleğe yazmaz (toplu snapshot için).
    """
    key = f"chain:{sym.upper()}"
    if fresh:
        data = await _fetch_chain(sym)
        if store:
            memory.set(key, data, live_ttl())
        return data
    return await memory.get_or_fetch(key, live_ttl(), lambda: _fetch_chain(sym))


async def quote(sym: str) -> dict:
    key = f"quote:{sym.upper()}"

    async def fetch() -> dict:
        data = await get_json(f"{CBOE_BASE}/quotes/{cboe_symbol(sym)}.json")
        return data.get("data") or {}

    return await memory.get_or_fetch(key, live_ttl(), fetch)


async def _yahoo_history(sym: str) -> list[dict]:
    ysym = f"^{sym.upper().lstrip('^_')}" if cboe_symbol(sym).startswith("_") else sym.upper().replace(".", "-")
    r = await client().get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}?range=3y&interval=1d",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    if r.status_code != 200:
        raise DataError(f"Yahoo {r.status_code}")
    res = r.json()["chart"]["result"][0]
    meta = res.get("meta") or {}
    name = meta.get("longName") or meta.get("shortName")
    if name:
        save_name(sym, name)
    ts = res.get("timestamp") or []
    q = res["indicators"]["quote"][0]
    rows = []
    for i, t in enumerate(ts):
        c = q["close"][i]
        if c is None:
            continue
        d = datetime.fromtimestamp(t, ET).date().isoformat()
        rows.append({
            "date": d, "open": float(q["open"][i] or c), "high": float(q["high"][i] or c),
            "low": float(q["low"][i] or c), "close": float(c), "volume": float(q["volume"][i] or 0),
        })
    return rows


_names: dict[str, str] | None = None


def _load_names() -> dict[str, str]:
    global _names
    if _names is None:
        _names = disk_get("company_names", max_age_hours=24 * 365) or {}
    return _names


def save_name(sym: str, name: str) -> None:
    names = _load_names()
    clean = name.replace(", Inc.", "").replace(" Inc.", "").replace(" Corporation", "").replace(" Holdings", "").strip()
    if names.get(sym.upper()) != clean:
        names[sym.upper()] = clean
        disk_set("company_names", names)


def company_name(sym: str) -> str | None:
    return _load_names().get(sym.upper())


async def ensure_names(symbols: list[str]) -> int:
    """Adı bilinmeyen semboller için Yahoo'dan kısa bir istekle şirket adını çeker."""
    missing = [s for s in symbols if not company_name(s)]
    sem = asyncio.Semaphore(4)

    async def one(sym: str) -> None:
        ysym = f"^{sym.upper().lstrip('^_')}" if cboe_symbol(sym).startswith("_") else sym.upper().replace(".", "-")
        async with sem:
            try:
                r = await client().get(f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}?range=1d&interval=1d",
                                       headers={"User-Agent": "Mozilla/5.0"})
                meta = r.json()["chart"]["result"][0].get("meta") or {}
                name = meta.get("longName") or meta.get("shortName")
                if name:
                    save_name(sym, name)
            except Exception:
                pass

    await asyncio.gather(*[one(s) for s in missing])
    return len(missing)


async def _cboe_history(sym: str) -> list[dict]:
    data = await get_json(f"{CBOE_BASE}/charts/historical/{cboe_symbol(sym)}.json")
    rows = []
    for r in data.get("data") or []:
        try:
            rows.append({
                "date": r["date"], "open": float(r["open"]), "high": float(r["high"]),
                "low": float(r["low"]), "close": float(r["close"]), "volume": float(r.get("volume") or 0),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return rows


async def history(sym: str) -> list[dict]:
    """Günlük fiyat geçmişi (Yahoo, yedek CBOE). Disk önbelleği 6 saat."""
    name = f"hist_{cboe_symbol(sym)}"
    cached = disk_get(name, max_age_hours=6)
    if cached is not None:
        return cached
    mem = memory.get(name)
    if mem is not None:
        return mem
    try:
        rows = await _yahoo_history(sym)
    except Exception:
        rows = []
    if len(rows) < 30:
        rows = await _cboe_history(sym)
    # Aynı güne ait mükerrer satırları temizle, sırala
    by_date = {r["date"]: r for r in rows}
    rows = [by_date[d] for d in sorted(by_date)][-800:]
    disk_set(name, rows)
    memory.set(name, rows, 3600)
    return rows


def parse_cboe_time(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "")).replace(tzinfo=ET)
    except ValueError:
        return None
