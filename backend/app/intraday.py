"""Gün içi dönen tarama: piyasa açıkken evrendeki hisseleri sırayla, sabit tempoda yeniden hesaplar.

Neden: günlük snapshot yalnız kapanıştan sonra alınır; gün boyunca fikirler ve piyasa özeti bir önceki
kapanışta kalıyordu. Bu katman her hisseyi (CBOE, 15 dk gecikmeli) sırayla tazeler ve sonuçları
snapshot'ın ÜSTÜNE bindirir (services.current_rows). Günlük snapshot ve IV geçmişi değişmez; gün içi
satırlar yalnız bellekte tutulur ve gece snapshot'ı alınınca kendiliğinden devreden çıkar.

CBOE istek bütçesi (~5 dakikada 100) sayfalarla paylaşıldığı için tarama yavaş ve sabittir:
her INTRADAY_PACE_SEC saniyede bir hisse (varsayılan 6 sn → ~200 hisse / 20 dk). CBOE bizi
yavaşlatırsa (429) tarama kendini duraklatır, sayfalar öncelik kazanır.

Açmak için INTRADAY_REFRESH=1. Varsayılan kapalı: ücretsiz veri kaynağını gereksiz yere yormamak için.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime
from typing import Callable

from . import db
from .analytics import metrics
from .analytics.chain import Chain
from .config import ET
from .data import cboe
from .data.cache import market_is_open
from .data.earnings import earnings_map
from .data.rates import risk_free_rate

ENABLED = os.environ.get("INTRADAY_REFRESH", "0").strip().lower() in ("1", "true", "yes", "on")
PACE = max(3.0, float(os.environ.get("INTRADAY_PACE_SEC", "6") or 6))
STALE_FOR_HOLIDAY = 3      # art arda bu kadar hissenin fiyatı dünden kalmışsa piyasa tatildedir
THROTTLED_INTERVAL = 3.0   # CBOE aralayıcısı bu kadar yavaşladıysa (429 sonrası) taramayı duraklat

log = logging.getLogger("intraday")

rows: dict[str, dict] = {}        # ticker -> metrics.compute çıktısı (en son gün içi hesap)
_tried: dict[str, float] = {}     # ticker -> son deneme zamanı (başarısız olanlar da sıraya döner)
state: dict = {"version": 0, "running": False, "paused": None, "last": None, "errors": 0}


def valid_rows(snapshot_date: str | None) -> dict[str, dict]:
    """Son kapanış snapshot'ından YENİ olan gün içi satırlar."""
    return {t: m for t, m in rows.items() if not snapshot_date or m.get("as_of", "")[:10] > snapshot_date}


def summary(snapshot_date: str | None, universe_size: int) -> dict:
    v = valid_rows(snapshot_date)
    times = sorted(m["as_of"] for m in v.values() if m.get("as_of"))
    return {
        "enabled": ENABLED, "active": bool(v), "running": state["running"], "paused": state["paused"],
        "count": len(v), "total": universe_size, "oldest": times[0] if times else None,
        "newest": times[-1] if times else None, "delay_min": 15,
        "cycle_min": round(PACE * max(universe_size, 1) / 60),
    }


async def _refresh(t: str, rate: float, earn: dict) -> tuple[Chain, dict]:
    # store=False: ham zincirler büyük (hisse başına MB'larca); 200'ünü önbellekte tutmak Pi'de ~800 MB
    # ediyordu (28 Eyl ölçümü). Hesaplanan satır yeter; sayfalar gerekince kendi zincirini çeker.
    raw = await cboe.raw_chain(t, fresh=True, store=False)
    ch = Chain(raw, rate)
    if ch.spot <= 0 or not ch.options:
        raise cboe.DataError("Fiyat ya da zincir yok")
    try:
        hist = await cboe.history(t)   # disk önbellekli (Yahoo), CBOE bütçesini yemez
    except Exception:
        hist = []
    return ch, metrics.compute(ch, hist, earn.get(t))


async def loop(busy: Callable[[], bool], on_update: Callable[[], None] | None = None) -> None:
    """Sonsuz döngü: piyasa açıkken en uzun süredir tazelenmemiş hisseyi yeniler."""
    if not ENABLED:
        return
    await asyncio.sleep(45)
    stale = 0
    while True:
        try:
            if not market_is_open() or busy():
                state.update(running=False, paused=None if not market_is_open() else "snapshot")
                await asyncio.sleep(120)
                continue
            if cboe.pacer.interval > THROTTLED_INTERVAL:
                state.update(running=False, paused="throttle")
                await asyncio.sleep(60)
                continue
            state.update(running=True, paused=None)
            uni = db.get_universe()
            if not uni:
                await asyncio.sleep(300)
                continue
            t = min(uni, key=lambda x: _tried.get(x, 0.0))
            _tried[t] = time.time()
            started = time.monotonic()
            try:
                rate = await risk_free_rate()
                try:
                    earn = await earnings_map()
                except Exception:
                    earn = {}
                ch, m = await _refresh(t, rate, earn)
                if ch.as_of.astimezone(ET).date() < datetime.now(ET).date():
                    # Saat "açık" diyor ama fiyat bugünden değil. Tek hisse bunu tek başına yapabilir
                    # (29 Eyl: bir hisse yüzünden normal günde 30 dk durdu); art arda birkaç hisse
                    # bayatsa resmi tatildir, yarım saat bekle. Bayat satır kaydedilmez.
                    stale += 1
                    if stale >= STALE_FOR_HOLIDAY:
                        stale = 0
                        state.update(running=False, paused="holiday")
                        await asyncio.sleep(1800)
                        continue
                else:
                    stale = 0
                    rows[t] = m
                    state["version"] += 1
                    state["last"] = datetime.now(ET).isoformat(timespec="seconds")
                    if on_update:
                        on_update()
            except Exception as e:
                state["errors"] += 1
                log.debug("Gün içi tarama %s: %s", t, e)
            await asyncio.sleep(max(0.0, PACE - (time.monotonic() - started)))
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Gün içi tarama hatası")
            await asyncio.sleep(60)
