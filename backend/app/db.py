"""SQLite katmanı: snapshot geçmişi, işlem defteri, hisseler, ayarlar."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator

from .config import DB_PATH, DEFAULT_SETTINGS, DEFAULT_UNIVERSE

SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    date   TEXT NOT NULL,
    ticker TEXT NOT NULL,
    data   TEXT NOT NULL,
    PRIMARY KEY (date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_ticker ON snapshots(ticker, date);

CREATE TABLE IF NOT EXISTS market_snapshots (
    date TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshot_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    started    TEXT NOT NULL,
    finished   TEXT,
    trade_date TEXT,
    ok         INTEGER DEFAULT 0,
    failed     INTEGER DEFAULT 0,
    errors     TEXT
);

CREATE TABLE IF NOT EXISTS universe (
    ticker TEXT PRIMARY KEY,
    added  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker      TEXT NOT NULL,
    strategy    TEXT NOT NULL,
    opt_type    TEXT NOT NULL CHECK (opt_type IN ('P', 'C')),
    side        TEXT NOT NULL CHECK (side IN ('sell', 'buy')),
    strike      REAL NOT NULL,
    expiry      TEXT NOT NULL,
    qty         INTEGER NOT NULL,
    open_date   TEXT NOT NULL,
    open_price  REAL NOT NULL,
    fees        REAL NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'open',
    close_date  TEXT,
    close_price REAL,
    close_fees  REAL NOT NULL DEFAULT 0,
    notes       TEXT,
    rolled_from INTEGER,
    stock_pl    REAL,
    created     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holdings (
    ticker     TEXT PRIMARY KEY,
    shares     REAL NOT NULL,
    cost_basis REAL NOT NULL,
    notes      TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
        conn.executescript(SCHEMA)
        count = conn.execute("SELECT COUNT(*) FROM universe").fetchone()[0]
        if count == 0:
            now = datetime.now().isoformat(timespec="seconds")
            conn.executemany(
                "INSERT OR IGNORE INTO universe(ticker, added) VALUES (?, ?)",
                [(t, now) for t in DEFAULT_UNIVERSE],
            )


# --- Evren -----------------------------------------------------------------

def get_universe() -> list[str]:
    with db() as conn:
        return [r[0] for r in conn.execute("SELECT ticker FROM universe ORDER BY ticker")]


def set_universe(tickers: list[str]) -> list[str]:
    clean = sorted({t.strip().upper() for t in tickers if t and t.strip()})
    now = datetime.now().isoformat(timespec="seconds")
    with db() as conn:
        conn.execute("DELETE FROM universe")
        conn.executemany("INSERT INTO universe(ticker, added) VALUES (?, ?)", [(t, now) for t in clean])
    return clean


# --- Ayarlar ---------------------------------------------------------------

def get_settings() -> dict[str, Any]:
    out = dict(DEFAULT_SETTINGS)
    with db() as conn:
        for row in conn.execute("SELECT key, value FROM settings"):
            out[row["key"]] = json.loads(row["value"])
    return out


def update_settings(values: dict[str, Any]) -> dict[str, Any]:
    with db() as conn:
        for k, v in values.items():
            if k in DEFAULT_SETTINGS:
                conn.execute(
                    "INSERT INTO settings(key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (k, json.dumps(v)),
                )
    return get_settings()


# --- Snapshot --------------------------------------------------------------

def save_snapshot(date: str, ticker: str, data: dict) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO snapshots(date, ticker, data) VALUES (?, ?, ?) "
            "ON CONFLICT(date, ticker) DO UPDATE SET data = excluded.data",
            (date, ticker, json.dumps(data)),
        )


def save_market_snapshot(date: str, data: dict) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO market_snapshots(date, data) VALUES (?, ?) "
            "ON CONFLICT(date) DO UPDATE SET data = excluded.data",
            (date, json.dumps(data)),
        )


def snapshot_dates(limit: int = 400) -> list[str]:
    with db() as conn:
        rows = conn.execute(
            "SELECT DISTINCT date FROM snapshots ORDER BY date DESC LIMIT ?", (limit,)
        ).fetchall()
    return [r[0] for r in rows]


def load_snapshot(date: str) -> dict[str, dict]:
    with db() as conn:
        rows = conn.execute("SELECT ticker, data FROM snapshots WHERE date = ?", (date,)).fetchall()
    return {r["ticker"]: json.loads(r["data"]) for r in rows}


def load_market_snapshots(limit: int = 120) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT date, data FROM market_snapshots ORDER BY date DESC LIMIT ?", (limit,)
        ).fetchall()
    return [{"date": r["date"], **json.loads(r["data"])} for r in reversed(rows)]


def ticker_history(ticker: str, fields: list[str], limit: int = 400) -> list[dict]:
    """Bir hissenin snapshot geçmişinden seçili alanları döndürür (eskiden yeniye)."""
    with db() as conn:
        rows = conn.execute(
            "SELECT date, data FROM snapshots WHERE ticker = ? ORDER BY date DESC LIMIT ?",
            (ticker, limit),
        ).fetchall()
    out = []
    for r in reversed(rows):
        d = json.loads(r["data"])
        out.append({"date": r["date"], **{f: d.get(f) for f in fields}})
    return out


def iv30_history_all(limit_days: int = 260) -> dict[str, list[float]]:
    """Tüm hisseler için son N snapshot'taki iv30 değerleri (IV Pos hesabı için)."""
    dates = snapshot_dates(limit_days)
    if not dates:
        return {}
    oldest = dates[-1]
    out: dict[str, list[float]] = {}
    with db() as conn:
        rows = conn.execute(
            "SELECT ticker, json_extract(data, '$.iv30') AS iv FROM snapshots WHERE date >= ? ORDER BY date",
            (oldest,),
        ).fetchall()
    for r in rows:
        if r["iv"] is not None:
            out.setdefault(r["ticker"], []).append(float(r["iv"]))
    return out


def start_run() -> int:
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO snapshot_runs(started) VALUES (?)", (datetime.now().isoformat(timespec="seconds"),)
        )
        return int(cur.lastrowid)


def finish_run(run_id: int, trade_date: str | None, ok: int, failed: int, errors: list[str]) -> None:
    with db() as conn:
        conn.execute(
            "UPDATE snapshot_runs SET finished = ?, trade_date = ?, ok = ?, failed = ?, errors = ? WHERE id = ?",
            (datetime.now().isoformat(timespec="seconds"), trade_date, ok, failed, json.dumps(errors[:200]), run_id),
        )


def last_run() -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM snapshot_runs ORDER BY id DESC LIMIT 1").fetchone()
    if not row:
        return None
    d = dict(row)
    d["errors"] = json.loads(d["errors"]) if d.get("errors") else []
    return d


# --- Defter ----------------------------------------------------------------

TRADE_FIELDS = [
    "ticker", "strategy", "opt_type", "side", "strike", "expiry", "qty", "open_date", "open_price",
    "fees", "status", "close_date", "close_price", "close_fees", "notes", "rolled_from", "stock_pl",
]


def list_trades() -> list[dict]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM trades ORDER BY open_date DESC, id DESC").fetchall()
    return [dict(r) for r in rows]


def get_trade(trade_id: int) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM trades WHERE id = ?", (trade_id,)).fetchone()
    return dict(row) if row else None


def insert_trade(t: dict) -> dict:
    vals = {k: t.get(k) for k in TRADE_FIELDS}
    vals["ticker"] = vals["ticker"].upper()
    vals["fees"] = vals.get("fees") or 0
    vals["close_fees"] = vals.get("close_fees") or 0
    vals["status"] = vals.get("status") or "open"
    with db() as conn:
        cur = conn.execute(
            f"INSERT INTO trades({', '.join(TRADE_FIELDS)}, created) VALUES ({', '.join('?' * len(TRADE_FIELDS))}, ?)",
            [vals[k] for k in TRADE_FIELDS] + [datetime.now().isoformat(timespec="seconds")],
        )
        new_id = int(cur.lastrowid)
    return get_trade(new_id)  # type: ignore[return-value]


def update_trade(trade_id: int, changes: dict) -> dict | None:
    sets = {k: v for k, v in changes.items() if k in TRADE_FIELDS}
    if "ticker" in sets and sets["ticker"]:
        sets["ticker"] = sets["ticker"].upper()
    if sets:
        with db() as conn:
            conn.execute(
                f"UPDATE trades SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?",
                [*sets.values(), trade_id],
            )
    return get_trade(trade_id)


def delete_trade(trade_id: int) -> None:
    with db() as conn:
        conn.execute("DELETE FROM trades WHERE id = ?", (trade_id,))


# --- Hisseler --------------------------------------------------------------

def list_holdings() -> list[dict]:
    with db() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM holdings ORDER BY ticker")]


def upsert_holding(ticker: str, shares: float, cost_basis: float, notes: str | None = None) -> None:
    with db() as conn:
        if shares <= 0:
            conn.execute("DELETE FROM holdings WHERE ticker = ?", (ticker.upper(),))
            return
        conn.execute(
            "INSERT INTO holdings(ticker, shares, cost_basis, notes) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(ticker) DO UPDATE SET shares = excluded.shares, cost_basis = excluded.cost_basis, "
            "notes = COALESCE(excluded.notes, holdings.notes)",
            (ticker.upper(), shares, cost_basis, notes),
        )


def get_holding(ticker: str) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM holdings WHERE ticker = ?", (ticker.upper(),)).fetchone()
    return dict(row) if row else None


def delete_holding(ticker: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM holdings WHERE ticker = ?", (ticker.upper(),))
