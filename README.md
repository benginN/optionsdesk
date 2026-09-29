# Options Desk (Opsiyon Masası)

A self-hosted analytics site for US equity options: a daily market brief, strategy-based stock and
contract screeners, a weekly portfolio plan, an anomaly/arbitrage scanner, a strategy lab and a trade
journal. It runs entirely on **free data sources**, so it costs **$0 per month**.

The UI is available in **English and Turkish** (EN / TR toggle, top right) and has two modes: **Simple**
(plain language, suggestions, explanations) and **Pro** (every table and metric).

## Quick start (Docker)

```bash
mkdir optionsdesk && cd optionsdesk
curl -O https://raw.githubusercontent.com/benginN/optionsdesk/main/docker-compose.yml
docker compose up -d
```

Then open `http://<server-ip>:8000`.

On first launch the app snapshots its ~200-symbol universe automatically (takes ~6–10 min). While the
server is running, it takes a new snapshot every weekday after **4:30 PM ET**, which is how the
implied-volatility history builds up. That's why an always-on server (homelab, NAS, VPS) is the best
place to run it: no days are skipped.

## Docker

A prebuilt image is published to GitHub Container Registry on every push to `main`:
`ghcr.io/benginn/optionsdesk` (amd64 + arm64, so it runs on a Raspberry Pi too).

One-liner without Compose:

```bash
docker run -d --name optionsdesk --restart unless-stopped \
  -p 8000:8000 -v "$PWD/data:/app/data" ghcr.io/benginn/optionsdesk:latest
```

To build from source, clone the repo, comment out the `image:` line in `docker-compose.yml`, uncomment
`build: .`, and run `docker compose up -d --build`.

| Setting | Default | Description |
|---|---|---|
| `-v ./data:/app/data` | — | SQLite database (snapshot history, trade journal, holdings, settings) and cache. **This is the only folder you need to back up.** |
| `PORT` | `8000` | Port inside the container |
| `PUID` / `PGID` | `1000` | User the server runs as; it also owns the `data/` folder |
| `INTRADAY_REFRESH` | `0` | `1` turns on the intraday scan: while the market is open, stocks are re-priced one by one (15-min delayed CBOE data) and ideas, the market summary and the strategy compass use the fresher numbers. The daily closing snapshot (IV history) is unchanged. Off by default to go easy on the free data source. |
| `INTRADAY_PACE_SEC` | `6` | Seconds between intraday requests (min. 3). 6 s ≈ the whole ~200-stock universe every ~20 min, leaving headroom under CBOE's ~100 requests / 5 min for page loads. |

Update: `docker compose pull && docker compose up -d`. Your data stays in `data/`.

> ⚠️ The app has no login. Keep it on your local network. If you expose it to the internet, put an
> authenticating reverse proxy in front of it (Authelia, Authentik, Cloudflare Access, Tailscale, etc.).

### Glance

You can add it to a [Glance](https://github.com/glanceapp/glance) dashboard in two ways:

- **Link / monitor:** add `http://<server-ip>:8000` to a `bookmarks` or `monitor` widget.
  The health endpoint for the monitor is `/api/health`.
- **Docker containers widget:** `docker-compose.yml` already has `glance.*` labels, so Glance's
  `docker-containers` widget shows the container with its name, icon and link. Change the
  `glance.url` label to your server's address.

```yaml
- type: monitor
  title: Homelab
  sites:
    - title: Options Desk
      url: http://192.168.1.10:8000
      check-url: http://192.168.1.10:8000/api/health
      icon: mdi:chart-bell-curve
```

## Running without Docker

Requires Python 3.10+ and Node.js 18+.

```bash
./run.sh
```

The first run sets up the Python environment and builds the UI, then opens `http://localhost:8000`.
If you've changed the frontend code, run `REBUILD=1 ./run.sh`.

On macOS you can also double-click **Opsiyon Masası.app** in the project folder. It starts the server
in the background if it isn't already running and opens the site.

## Sections

| Section | What it does |
|---|---|
| **Today** | Market mood and conditions for premium sellers (gauges), a plain-language summary, a **strategy compass** (which strategy type fits the current regime — trend, VIX level, term-structure stress, premium richness, dealer gamma — with suggested delta/expiry/structure/size, the reasons and what would change the view), "What can you do today?" (top ideas per strategy, re-checked against live prices), weekly expected moves for the indices, upcoming earnings and large trades. Pro mode adds the daily movers table, VIX and leaders. |
| **Ideas** | Three steps: pick a goal (sell cash-secured puts / write calls on your shares / buy long-dated calls) → set a budget range (e.g. $2k–5k), risk and time frame (1 week / 2 weeks / 1 month = 20–45 days) → get stock cards. The ranking itself follows your choices: each stock is scored on the contract that matches your time frame and risk (with its expected move to expiry), and the earnings filter looks at that contract's expiry. "See contracts" explains each contract in a single sentence, with Simulate / Save. Pro mode adds a table view and an advanced multi-screener (including credit spreads). |
| **Stock page** | "What are options saying about this stock?", the 30-day expected range, a "how expensive are options?" gauge and strategy cards. The detailed view shows term structure, volatility smile, open interest, gamma and unusual activity. |
| **My portfolio** | *My plan:* a numbered weekly plan for your shares and cash (puts, covered calls, premium-funded LEAPS). *My trades:* a trade journal, live position cards, 50%-rule and ITM alerts, assignment and expire-worthless rates. |
| **Tools** | Strategy lab (plain-language summary, P&L curve, probabilities, scenarios) and the anomaly scanner. |
| **Learn** | Options in 10 minutes, a 5-step learning path, a rule set, mistakes to avoid and a glossary. |

## Data sources

- **CBOE delayed quotes** (free, 15-minute delay): full chains, Greeks, IV, open interest, volume, IV30 and the VIX family.
  The limit is roughly ~100 requests per 5 minutes; the app spaces requests out automatically.
- **Yahoo** (free): 3 years of daily prices → HV, RSI, 52-week range.
- **Nasdaq** (free): 60-day earnings calendar.
- **FRED** (free): 3-month T-Bill → risk-free rate.

## Known limitations

- **IV Pos** is an estimate (≈) for the first 20 trading days: where IV30 sits within the past year's
  HV30 distribution. It switches to the true IV percentile as snapshots accumulate. Days when the
  server is off are skipped.
- Arbitrage checks that involve the stock leg (conversion/reversal, intrinsic value) only run during market hours.
- Dividends aren't modeled; early exercise of American options is only approximated.
- Scores are a ranking tool, not investment advice.

## Project structure

```
backend/app/
  main.py            API endpoints + serves the UI
  jobs.py            daily snapshot and scheduler
  data/              CBOE, Yahoo, Nasdaq and FRED clients + cache
  analytics/         chain analysis, metrics, scoring, contracts, anomalies, smile, market, Black-Scholes,
                     stance (strategy compass rules)
  journal.py plan.py db.py
frontend/src/
  pages/             one page per tab
  components/        tables, charts, UI pieces
data/options.db      snapshot history, journal, holdings, settings (SQLite, created at runtime)
Dockerfile, docker-compose.yml, .github/workflows/docker.yml   Docker image and automated publishing
```

## License

[MIT](LICENSE). Scores and suggestions are for educational purposes only and are not investment advice.
You are responsible for complying with the terms of use of the data sources.
