"""Günlük snapshot: tüm evren için opsiyon metriklerini çekip kaydeder.

Kapanıştan sonra otomatik (16:30 ET) ya da arayüzden elle çalıştırılır.
Böylece IV geçmişi birikir ve IV Pos / IV Rank gibi tarihsel metrikler oluşur.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import Counter
from datetime import datetime

from . import db
from .analytics import market, metrics
from .analytics.chain import Chain
from .config import ET
from .data import cboe
from .data.cache import market_is_open
from .data.earnings import earnings_map
from .data.rates import risk_free_rate

log = logging.getLogger("snapshot")

VIX_SYMBOLS = ["VIX", "VIX9D", "VIX3M", "VIX6M", "VVIX", "SKEW"]

_last_auto_attempt = 0.0

progress: dict = {"running": False, "done": 0, "total": 0, "failed": 0, "current": None,
                  "started": None, "finished": None, "trade_date": None, "errors": []}


async def fetch_vix() -> dict:
    quotes = {}
    for s in VIX_SYMBOLS:
        try:
            quotes[s] = await cboe.quote(s)
        except Exception:
            quotes[s] = {}
    try:
        hist = await cboe.history("VIX")
    except Exception:
        hist = []
    return market.vix_block(quotes, hist)


async def _one(t: str, rate: float, earn: dict, sem: asyncio.Semaphore) -> dict:
    async with sem:
        progress["current"] = t
        raw = await cboe.raw_chain(t, fresh=True, store=False)
        chain = Chain(raw, rate)
        if chain.spot <= 0 or not chain.options:
            raise cboe.DataError("Fiyat ya da zincir yok")
        try:
            hist = await cboe.history(t)
        except Exception:
            hist = []
        return metrics.compute(chain, hist, earn.get(t))


async def run_snapshot(tickers: list[str] | None = None) -> dict:
    if progress["running"]:
        return progress
    tickers = tickers or db.get_universe()
    progress.update(running=True, done=0, total=len(tickers), failed=0, current=None,
                    started=datetime.now().isoformat(timespec="seconds"), finished=None, errors=[])
    run_id = db.start_run()
    ok_rows: list[dict] = []
    errors: list[str] = []
    try:
        rate = await risk_free_rate()
        try:
            earn = await earnings_map()
        except Exception as e:  # bilanço takvimi alınamazsa devam et
            log.warning("Bilanço takvimi alınamadı: %s", e)
            earn = {}
        sem = asyncio.Semaphore(6)

        async def wrapped(t: str):
            try:
                m = await _one(t, rate, earn, sem)
                ok_rows.append(m)
            except Exception as e:
                progress["failed"] += 1
                errors.append(f"{t}: {e}")
            finally:
                progress["done"] += 1

        await asyncio.gather(*[wrapped(t) for t in tickers])

        if ok_rows:
            dates = Counter(m["as_of"][:10] for m in ok_rows)
            trade_date = dates.most_common(1)[0][0]
            progress["trade_date"] = trade_date
            for m in ok_rows:
                db.save_snapshot(trade_date, m["ticker"], m)
            db.strip_alts(before=trade_date)
            agg = market.aggregate(ok_rows)
            vix = await fetch_vix()
            vix.pop("vix_series", None)
            db.save_market_snapshot(trade_date, {"agg": agg, "vix": vix, "rate": rate})
            from . import services  # döngüsel içe aktarmayı önlemek için burada
            services.invalidate()
        else:
            trade_date = None
        db.finish_run(run_id, trade_date, len(ok_rows), len(errors), errors)
    except Exception as e:
        errors.append(f"genel: {e}")
        db.finish_run(run_id, None, len(ok_rows), len(errors), errors)
        log.exception("Snapshot hatası")
    finally:
        progress.update(running=False, current=None, finished=datetime.now().isoformat(timespec="seconds"),
                        errors=errors[:50])
    return progress


async def scheduler() -> None:
    """Her 10 dakikada kontrol eder; hafta içi 16:30 ET sonrası o günün snapshot'ı yoksa çalıştırır."""
    global _last_auto_attempt
    await asyncio.sleep(5)
    try:
        await cboe.ensure_names(db.get_universe())
    except Exception:
        log.exception("Şirket adları alınamadı")
    if not db.snapshot_dates(1) and not progress["running"]:
        log.info("İlk snapshot başlatılıyor…")
        asyncio.create_task(run_snapshot())
    while True:
        try:
            now = datetime.now(ET)
            if now.weekday() < 5 and (now.hour, now.minute) >= (16, 30) and not market_is_open(now):
                today = now.date().isoformat()
                dates = db.snapshot_dates(1)
                # Başarısız denemeleri en fazla saatte bir tekrarla
                if (not dates or dates[0] < today) and not progress["running"] and time.time() - _last_auto_attempt > 3600:
                    _last_auto_attempt = time.time()
                    log.info("Günlük snapshot başlatılıyor (%s)", today)
                    await run_snapshot()
        except Exception:
            log.exception("Zamanlayıcı hatası")
        await asyncio.sleep(600)
