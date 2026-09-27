"""Uygulama genel ayarları ve varsayılan hisse evreni."""
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"
DB_PATH = DATA_DIR / "options.db"
FRONTEND_DIST = ROOT / "frontend" / "dist"

DATA_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(exist_ok=True)

ET = ZoneInfo("America/New_York")

CBOE_BASE = "https://cdn-api.cboe.com/api/global/delayed_quotes"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"

# CBOE'de endeksler alt çizgi ile sorgulanır.
INDEX_SYMBOLS = {"SPX", "XSP", "NDX", "RUT", "VIX", "VIX9D", "VIX3M", "VIX6M", "VVIX", "SKEW", "DJX"}

# Varsayılan varsayımlar (Ayarlar sekmesinden değiştirilebilir)
DEFAULT_SETTINGS = {
    "cash": 10000.0,               # Portföy planı için nakit
    "cash_reserve_pct": 20.0,      # Nakitin kullanılmayacak kısmı (%)
    "max_position_pct": 35.0,      # Tek pozisyona ayrılabilecek maksimum nakit (%)
    "commission_per_contract": 0.65,
    "risk_free_override": None,    # None ise ^IRX'ten çekilir
}

# ~190 likit, opsiyonu işlem gören hisse ve ETF.
DEFAULT_UNIVERSE = [
    # Endeks ve sektör ETF'leri
    "SPY", "QQQ", "IWM", "DIA", "TLT", "GLD", "SLV", "XLF", "XLE", "XLK", "SMH", "ARKK",
    "KRE", "XBI", "GDX", "HYG", "EEM", "FXI", "USO", "TQQQ", "SOXL", "IBIT", "ETHA",
    # Mega ve büyük teknoloji
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "NFLX", "AMD", "ORCL",
    "CRM", "ADBE", "INTC", "MU", "QCOM", "TXN", "ARM", "SMCI", "DELL", "IBM", "CSCO", "TSM",
    "ASML", "ON", "MRVL", "LRCX", "AMAT", "WDC", "STX", "APP",
    # Yazılım ve internet
    "PLTR", "SNOW", "NET", "CRWD", "PANW", "ZS", "DDOG", "MDB", "U", "RBLX", "ROKU", "SNAP",
    "PINS", "SPOT", "TTD", "SHOP", "UBER", "LYFT", "DASH", "ABNB", "CVNA", "CPNG", "SE", "MELI",
    # Finans ve fintech
    "JPM", "BAC", "WFC", "C", "GS", "MS", "SCHW", "V", "MA", "AXP", "PYPL", "XYZ", "COIN",
    "HOOD", "SOFI", "AFRM", "UPST",
    # Tüketim
    "WMT", "COST", "TGT", "HD", "LOW", "NKE", "SBUX", "MCD", "DIS", "KO", "PEP", "PG", "CMG",
    "LULU", "CELH", "DKNG", "CCL", "NCLH", "AAL", "DAL", "UAL", "WBD", "CMCSA", "T", "VZ",
    # Otomotiv ve EV
    "F", "GM", "RIVN", "LCID", "NIO", "XPEV", "LI",
    # Çin ve gelişen piyasalar
    "BABA", "JD", "PDD", "BIDU", "GRAB", "NU",
    # Sağlık
    "PFE", "MRK", "JNJ", "ABBV", "LLY", "UNH", "CVS", "MRNA", "BMY", "GILD", "AMGN", "HIMS",
    "NVO", "TEVA",
    # Enerji, emtia, sanayi
    "XOM", "CVX", "OXY", "SLB", "HAL", "DVN", "FCX", "NEM", "CLF", "AA", "VALE",
    "BA", "CAT", "DE", "GE", "LMT", "RTX", "UPS", "FDX", "VST", "CEG", "FSLR", "ENPH",
    # Kripto madencileri ve yapay zeka altyapısı
    "MSTR", "MARA", "RIOT", "CLSK", "IREN", "CIFR", "WULF", "HUT", "CORZ", "APLD", "CRWV", "NBIS",
    # Yüksek volatiliteli büyüme
    "RKLB", "ASTS", "LUNR", "IONQ", "RGTI", "QBTS", "SOUN", "BBAI", "ACHR", "JOBY", "OKLO",
    "SMR", "TEM", "OPEN", "PLUG", "GME", "AMC", "NOK",
]
