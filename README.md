# Opsiyon Masası

ABD opsiyonları için kişisel analiz sitesi: piyasa notu, strateji bazlı hisse ve kontrat tarayıcıları,
portföy planı, anomali/arbitraj taraması, strateji laboratuvarı ve işlem defteri. Aylık maliyeti **$0**
(tamamen ücretsiz veri kaynakları).

> **English:** A self-hosted options analytics desk for US equities: market overview, strategy-based
> stock and contract screeners, a weekly portfolio plan (cash-secured puts, covered calls, LEAPS),
> anomaly/arbitrage scanner, strategy lab and trade journal. The UI is available in **Turkish and English**
> (TR / EN toggle, top right). Uses only free data sources (CBOE delayed quotes, Yahoo, Nasdaq, FRED).
> Quick start: `docker compose up -d` → http://localhost:8000 (see [Docker](#docker) below).

## Çalıştırma

### Docker (önerilen, homelab / sunucu)

Bkz. [Docker](#docker). Sunucu sürekli açık kaldığı için IV geçmişi hiç gün atlamadan birikir.

### macOS

En kolayı: klasördeki **Opsiyon Masası** uygulamasına çift tıkla. Sunucu çalışmıyorsa arka planda başlatır ve siteyi açar.

Terminal'den:

```bash
./run.sh
```

İlk seferde Python ortamını ve arayüzü kurar, sonra `http://localhost:8000` adresini açar.
Arayüz kodunu değiştirdiysen `REBUILD=1 ./run.sh`.

İlk açılışta ~200 hisselik evrenin snapshot'ı otomatik başlar (~6–10 dk). Sunucu açık kaldığı sürece
hafta içi her gün **16:30 ET**'den sonra yeni snapshot alınır; IV geçmişi böyle birikir.

## Docker

Hazır imaj her `main` güncellemesinde GitHub Container Registry'ye yayınlanır
(`ghcr.io/benginn/optionsdesk`, amd64 + arm64 — Raspberry Pi dahil).

```bash
mkdir opsiyon-masasi && cd opsiyon-masasi
curl -O https://raw.githubusercontent.com/benginN/optionsdesk/main/docker-compose.yml
docker compose up -d
```

Site `http://<sunucu-ip>:8000` adresinde açılır. Tek satırla da çalıştırılabilir:

```bash
docker run -d --name opsiyon-masasi --restart unless-stopped \
  -p 8000:8000 -v "$PWD/data:/app/data" ghcr.io/benginn/optionsdesk:latest
```

Kaynaktan derlemek için repoyu klonla, `docker-compose.yml` içinde `image:` satırını yoruma alıp
`build: .` satırını aç, sonra `docker compose up -d --build`.

| Ayar | Varsayılan | Açıklama |
|---|---|---|
| `-v ./data:/app/data` | — | SQLite veritabanı (snapshot geçmişi, işlem defteri, ayarlar) ve önbellek. **Yedeklenecek tek klasör budur.** |
| `PORT` | `8000` | Container içindeki port |
| `PUID` / `PGID` | `1000` | Sunucunun çalıştığı ve `data/` klasörünün sahibi olan kullanıcı |

Güncelleme: `docker compose pull && docker compose up -d`. Veriler `data/` klasöründe kalır.

> ⚠️ Uygulamada kullanıcı girişi yok. Yerel ağda kullan; internete açacaksan önüne kimlik doğrulamalı
> bir reverse proxy (Authelia, Authentik, Cloudflare Access, Tailscale vb.) koy.

### Glance

[Glance](https://github.com/glanceapp/glance) panonda iki şekilde gösterebilirsin:

- **Yer imi:** `bookmarks` ya da `monitor` widget'ına `http://<sunucu-ip>:8000` ekle
  (monitor için sağlık adresi: `/api/health`).
- **Docker container listesi:** `docker-compose.yml` içindeki `glance.*` etiketleri hazır;
  Glance'in `docker-containers` widget'ı container'ı adı, ikonu ve linkiyle otomatik gösterir
  (`glance.url` etiketini kendi sunucu adresinle değiştir).

```yaml
- type: monitor
  title: Homelab
  sites:
    - title: Opsiyon Masası
      url: http://192.168.1.10:8000
      check-url: http://192.168.1.10:8000/api/health
      icon: mdi:chart-bell-curve
```

## Bölümler

Site Türkçe ve İngilizce (sağ üstte TR / EN) ve iki modda çalışır: **Basit** (sade dil, öneriler, açıklamalar) ve **Uzman** (tüm tablolar ve metrikler).

| Bölüm | Ne yapar |
|---|---|
| **Bugün** | Piyasanın ruh hali ve prim satıcısı için ortam (göstergeler), sade dilde özet, "Bugün ne yapabilirsin?" (strateji başına en iyi fikirler), endekslerin haftalık beklenen aralığı, yaklaşan bilançolar ve büyük işlemler. Uzman modda günlük değişim tablosu, VIX, liderler. |
| **Fikirler** | 3 adım: ne yapmak istiyorsun (nakitle put sat / hissene call yaz / uzun vadeli call al) → bütçe, risk, süre → hisse kartları. "Kontratları gör" her kontratı tek cümleyle anlatır, Simüle et / Kaydet. Uzman modda tablo görünümü ve gelişmiş çoklu tarayıcı (kredi spread'leri dahil). |
| **Hisse sayfası** | "Opsiyonlar bu hisse hakkında ne söylüyor?", 30 günlük beklenen aralık, "opsiyonlar ne kadar pahalı?" göstergesi, strateji kartları; detaylı analizde vade yapısı, gülümseme, açık pozisyon, gamma, olağandışı işlemler. |
| **Portföyüm** | Planım: hisselerin + nakdin için numaralı adımlarla haftalık plan (put'lar, covered call'lar, primle LEAPS). İşlemlerim: defter, canlı pozisyon kartları, %50 kuralı / ITM uyarıları, atanma ve değersiz bitme oranları. |
| **Araçlar** | Strateji laboratuvarı (sade dilde özet, kâr/zarar eğrisi, olasılık, senaryolar) ve anomali tarayıcı. |
| **Öğren** | Opsiyonları 10 dakikada anla, 5 adımlı öğrenme yolu, kural seti, kaçınılacaklar, sözlük. |

## Veri kaynakları

- **CBOE gecikmeli kotasyon** (ücretsiz, 15 dk gecikmeli): tüm zincir, Greeks, IV, OI, hacim, IV30, VIX ailesi.
  Limit yaklaşık 5 dakikada ~100 istek; uygulama istekleri otomatik aralıklandırır.
- **Yahoo** (ücretsiz): 3 yıllık günlük fiyat → HV, RSI, 52 haftalık aralık.
- **Nasdaq** (ücretsiz): 60 günlük bilanço takvimi.
- **FRED** (ücretsiz): 3 aylık T-Bill → risksiz faiz.

## Bilinen sınırlar

- **IV Pos** ilk 20 işlem günü boyunca tahminidir (≈): IV30'un son 1 yıllık HV30 dağılımındaki yeri.
  Snapshot'lar biriktikçe gerçek IV yüzdeliğine geçer. Sunucu kapalı olduğu günler atlanır (Docker ile sürekli açık tutmak bu yüzden idealdir).
- Hisse bacaklı arbitraj kontrolleri (conversion/reversal, içsel değer) sadece seans içinde çalışır.
- Temettüler modele dahil değildir; Amerikan tipi erken kullanım yaklaşık olarak dikkate alınır.
- Skorlar sıralama aracıdır, yatırım tavsiyesi değildir.

## Yapı

```
backend/app/
  main.py            API uçları + arayüz servisi
  jobs.py            günlük snapshot ve zamanlayıcı
  data/              CBOE, Yahoo, Nasdaq, FRED istemcileri + önbellek
  analytics/         chain (zincir analizi), metrics, scoring, contracts, anomalies, smile, market, bs
  journal.py plan.py db.py
frontend/src/
  pages/             her sekme bir sayfa
  components/        tablo, grafikler, UI parçaları
data/options.db      snapshot geçmişi, defter, hisseler, ayarlar (SQLite)
Dockerfile, docker-compose.yml, .github/workflows/docker.yml   Docker imajı ve otomatik yayın
```

## Lisans

[MIT](LICENSE). Skorlar ve öneriler eğitim amaçlıdır, yatırım tavsiyesi değildir. Veri kaynaklarının
kullanım koşullarına uymak kullanıcının sorumluluğundadır.
