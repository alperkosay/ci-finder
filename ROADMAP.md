# ciFinder — Yol Haritası

React tabanlı, backend'i Next.js / Node.js / Bun ve yaygın tüm framework'lerle çalışabilen, hiçbir UI kütüphanesine bağımlı olmayan, native CSS ile yazılmış bir dosya yöneticisi.

---

## Hedefler

- **Her yerde çalışan backend:** Çekirdek, Web Standard `Request → Response` imzasıyla yazılır. Bun, Next.js App Router, Hono ve Deno bu imzayı doğrudan kullanır; Node `http`, Express, Fastify ve Koa için ince adaptörler sağlanır.
- **Sıfır runtime bağımlılığı:** Core paketinde dış bağımlılık yok (zip yazıcı, MIME tablosu dahili). React paketinin tek bağımlılığı peer olarak `react` / `react-dom` (≥18).
- **Native CSS:** Tailwind, CSS-in-JS ya da bileşen kütüphanesi yok. Custom properties, `@layer`, nesting, `:has()` ve container queries kullanılır.
- **Gerçek bir araç gibi hissettiren UI:** Yoğun, hızlı, klavyeyle tamamen kullanılabilir; "AI şablonu" görünümünden uzak.
- **İki depolama seçeneği:** Yerel disk ve S3 (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces gibi uyumlu servisler). İkisi aynı anda farklı volume'ler olarak kullanılabilir.
- **Birinci sınıf Next.js desteği:** `output: "standalone"` dahil. Dosyalar her zaman proje kökündeki `uploads/` klasörüne yazılır ve hazır bir route ile sunulur.
- **Dahili düzenleyiciler:** Kod/metin, görsel ve Markdown dosyaları uygulama içinden düzenlenip kaydedilir.

---

## Mimari

```
elfinder-clone/
├─ packages/
│  ├─ core/          # backend motoru (framework bağımsız)
│  │  ├─ commands/   # open, ls, tree, mkdir, rename, rm, paste, upload...
│  │  ├─ drivers/    # StorageDriver arayüzü + LocalDriver + S3Driver
│  │  ├─ security/   # path traversal koruması, izinler, limitler
│  │  ├─ serve/      # Range/ETag destekli dosya sunucu
│  │  └─ zip/        # bağımlılıksız zip stream
│  ├─ next/          # Next.js'e özel: API route, uploads serve route, kök tespiti
│  ├─ adapters/      # node, express, fastify, koa
│  ├─ client/        # framework bağımsız API istemcisi (fetch + chunk upload)
│  └─ react/         # <CiFinder /> bileşeni + styles.css
└─ examples/
   ├─ nextjs/        # app/api/files/route.ts → export { GET, POST }
   ├─ express/
   ├─ bun/           # Bun.serve({ fetch: handler })
   └─ vite-react/
```

### Kullanım örnekleri (hedeflenen API)

```ts
// Bun
const fm = createCiFinder({ volumes: [{ id: "files", root: "./storage" }] });
Bun.serve({ fetch: fm.handler });

// Next.js — app/api/files/route.ts
export const { GET, POST } = createNextRoutes(fm);

// Next.js — app/uploads/[...path]/route.ts
export const { GET, HEAD } = createUploadsRoute({ dir: "uploads" });

// S3 volume (yerel disk ile birlikte)
createCiFinder({
  volumes: [
    { id: "local", driver: localDriver({ root: projectPath("uploads") }), url: "/uploads" },
    { id: "s3", driver: s3Driver({ bucket, region, endpoint, accessKeyId, secretAccessKey }) },
  ],
});

// Express
app.use("/api/files", toExpress(fm.handler));
```

```tsx
// React
import { CiFinder } from "@ci-finder/react";
import "@ci-finder/react/styles.css";

<CiFinder endpoint="/api/files" locale="tr" theme="auto" />
```

### Protokol

- Tek endpoint üzerinden RPC: `POST /api/files` → `{ cmd, ...params }`. İndirme ve önizleme için `GET ?cmd=file&id=...`.
- Dosya kimlikleri: volume önekli base64url path hash'i (`files_L2RvY3MvYS50eHQ`).
- Tüm yanıtlar tutarlı yapıda: `{ ok: true, data }` ya da `{ ok: false, error: { code, message } }`.

---

## Backend kapsamı

### Komutlar

| Grup | Komutlar |
|---|---|
| Gezinme | `open`, `ls`, `tree`, `parents`, `info`, `search` |
| Oluşturma / değiştirme | `mkdir`, `mkfile`, `rename`, `duplicate`, `rm` |
| Taşıma | `paste` (kopyala/taşı, çakışmada otomatik yeniden adlandırma) |
| Aktarım | `upload` (chunk'lı, klasör yapısını korur), `download` (stream, çoklu seçimde anında zip), `file` (önizleme için inline) |
| İçerik | `get` / `put` (metin düzenleme) |
| Arşiv | `archive` / `extract` (zip) |

### Güvenlik ve yapılandırma

- Root sandbox: hiçbir istek volume kökünün dışına çıkamaz.
- Symlink'lerin kök dışına işaret etmesi engellenir.
- Uzantı ve MIME için izin/yasak listeleri.
- Maksimum yükleme ve chunk boyutu.
- Volume bazında `readOnly`, gizli dosya kuralları, dosya bazında izin callback'i.
- Hook'lar: `authorize`, `onBeforeCommand`, `onAfterCommand`.
- Çoklu volume desteği.

### Depolama sürücüleri

Tüm komutlar ortak bir `StorageDriver` arayüzü üzerinden çalışır; yeni sürücü yazmak için bu arayüzü uygulamak yeterlidir.

- **LocalDriver:** `node:fs` üzerinde. Node ve Bun'da aynı kodla çalışır.
- **S3Driver:** Dış bağımlılık yok (AWS SDK kullanılmaz). İmzalama (SigV4) Web Crypto ile yapılır.
  - Desteklenen işlemler: ListObjectsV2, Get/Put/Head/Copy/DeleteObject(s), büyük dosyalar için multipart upload.
  - Klasörler S3'te prefix olarak modellenir; boş klasörler için `dizin/` işaret nesnesi kullanılır.
  - Taşıma ve yeniden adlandırma işlemleri kopyala + sil şeklinde yapılır; klasörlerde prefix altındaki tüm nesneler işlenir.
  - Dosya sunumu için seçenekler: presigned URL'e yönlendirme (varsayılan), public bucket/CDN URL'i ya da proxy üzerinden stream.
  - Uyumlu servisler: AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, Backblaze B2 (`endpoint` + `forcePathStyle` ile).

### Next.js entegrasyonu

- `output: "standalone"` tam destek; monorepo için `outputFileTracingRoot` örneği.
- **Proje kökü tespiti:** `projectPath("uploads")` her ortamda proje kökünü verir.
  - `next dev` ve `next start`: `process.cwd()`.
  - Standalone (`.next/standalone/.../server.js`): yol `.next` öncesine kırpılır, yani yine proje kökü.
  - Docker/sunucu: `CI_FINDER_UPLOADS_DIR` (veya kök için `CI_FINDER_ROOT`) ortam değişkeni ile ezilebilir.
- **Neden `public/` değil:** Next.js production'da `public/` klasörüne çalışma zamanında eklenen dosyaları sunmaz; standalone'da `public/` ayrıca kopyalanmalıdır. Bu yüzden dosyalar `uploads/` altında tutulur ve route ile sunulur.
- **`app/uploads/[...path]/route.ts`:** Hazır serve handler.
  - `Range` (video ileri sarma), `ETag`, `Last-Modified`, `304 Not Modified`
  - Doğru `Content-Type`; `?download=1` ile indirme
  - Path traversal ve gizli dosya koruması
  - HTML/SVG gibi aktif içerikler `CSP: sandbox` ile sunulur (XSS koruması)
  - İsteğe bağlı `authorize(request)` hook'u ve `Cache-Control` ayarı
- `runtime = "nodejs"` otomatik; Edge runtime'da yalnızca S3 volume'leri kullanılabilir.
- Chunk'lı yükleme sayesinde Next.js gövde boyutu limitlerine takılmaz.

---

## Frontend kapsamı

### Yerleşim

- Araç çubuğu
- Düzenlenebilir breadcrumb (tıklanınca yol girişine dönüşür)
- Sol panel: lazy yüklenen klasör ağacı
- Ana alan: grid ve liste görünümü, sıralanabilir kolonlar, sanal liste
- Sağ panel: açılır kapanır önizleme/detay
- Durum çubuğu: seçim sayısı, toplam boyut, volume bilgisi

### Etkileşim

- **Seçim:** tıklama, Ctrl/Shift ile çoklu seçim, sürükleyerek alan (lasso) seçimi
- **Klavye:** oklar, Enter, Backspace (üst klasör), Delete, F2, Ctrl+C/X/V/A, yazarak dosyaya atlama, Space ile hızlı önizleme
- **Sağ tık menüsü:** alt menüler, klavyeyle gezinme, bağlama göre öğeler
- **Sürükle-bırak:** içeride taşıma (Ctrl ile kopyalama), dışarıdan dosya ve klasör bırakarak yükleme
- **Yükleme kuyruğu:** ilerleme, iptal, tekrar deneme
- **Önizleme:** resim, video, ses, PDF, metin/kod
- **Diğer:** özellikler penceresi, onay diyalogları, toast bildirimleri

### Dahili düzenleyiciler

Hepsi kendi kodumuz; Monaco, CodeMirror ya da benzeri bir bağımlılık yok.

- **Kod / metin editörü**
  - Sözdizimi renklendirme: JS/TS, JSON, HTML, CSS, Markdown, Python, PHP, SQL, YAML, shell
  - Satır numaraları, aktif satır vurgusu
  - Tab ile girinti, otomatik girinti, parantez kapatma
  - Bul / değiştir (Ctrl+F, Ctrl+H), satıra git (Ctrl+G)
  - Ctrl+S ile kaydet; kaydedilmemiş değişiklik uyarısı
  - Satır kaydırma ve yazı boyutu seçenekleri, kodlama (UTF-8) ve satır sonu (LF/CRLF) gösterimi
- **Markdown:** Yan yana önizleme ile düzenleme.
- **Görsel editörü** (canvas tabanlı)
  - Kırpma (serbest ve oran kilitli: 1:1, 4:3, 16:9)
  - Döndürme (90°) ve yatay/dikey çevirme
  - Yeniden boyutlandırma (oran kilitli)
  - Format ve kalite seçimi (JPEG/WebP)
  - Üzerine kaydet ya da kopya olarak kaydet
- **Genişletilebilirlik:** `editors` prop'u ile özel editör eklenebilir (örneğin isteyen Monaco bağlayabilir).

### Tasarım ilkeleri

| Yapılmayacak | Yapılacak |
|---|---|
| Mor-mavi gradyanlar, glassmorphism | Nötr, hafif sıcak gri palet ve tek, ölçülü vurgu rengi |
| Her yerde büyük `border-radius` | 1px ince çizgiler, 4–6px radius |
| Emoji ya da hazır ikon paketi | Elle çizilmiş tutarlı SVG ikon seti (20px grid, türe göre renk kodu) |
| Abartılı gölgeler, boş kart yığınları | Yoğun, işlevsel, masaüstü dosya yöneticisi hissi |
| Dekoratif animasyonlar | Kısa, amaçlı geçişler; `prefers-reduced-motion` desteği |

- Sistem font yığını; boyut ve tarih kolonlarında `tabular-nums`.
- Gerçekçi boş, yükleniyor ve hata durumları.
- Açık/koyu tema ve kompakt/rahat yoğunluk seçeneği.
- Tüm sınıflar `cf-` önekli; stiller `@layer` içinde, tüketici CSS'i kolayca ezebilir.
- Tema değiştirmek yalnızca CSS değişkenlerini ezmekle mümkün.

### Teknik

- State: `useSyncExternalStore` üzerine kurulu küçük, dahili store.
- Erişilebilirlik: `tree` / `grid` ARIA rolleri, odak yönetimi, ekran okuyucu duyuruları.
- i18n: TR ve EN hazır; dil paketi dışarıdan verilebilir.
- Mobil: dokunmatik seçim, uzun basma ile menü, dar ekranda tek panel.

---

## Araçlar

- TypeScript
- `tsup`: ESM + CJS çıktı (yalnızca geliştirme bağımlılığı)
- Vitest: core testleri hem Node hem Bun üzerinde koşturulur
- Vite: örnek React uygulaması

---

## Aşamalar

Durum: 8 Ekim 2026. `[x]` biten, `[ ]` bekleyen maddeler.

### Aşama 0 — İskelet
- [x] Monorepo ve npm workspaces kurulumu
- [x] Ortak `tsconfig`, tsup build, Vitest altyapısı
- [ ] Lint/format ayarları (ESLint/Prettier henüz eklenmedi)

### Aşama 1 — Core + LocalDriver
- [x] `StorageDriver` arayüzü ve `LocalDriver`
- [x] Kimlik (hash) üretimi ve çözümleme
- [x] Güvenlik katmanı (sandbox, symlink, izinler, limitler, CSRF başlığı)
- [x] Gezinme komutları: `init`, `ls`, `tree`, `parents`, `info`, `size`, `search`
- [x] Değiştirme komutları: `mkdir`, `mkfile`, `rename`, `duplicate`, `rm`, `paste`
- [x] Aktarım: chunk'lı `upload`, stream `download` (zip), Range destekli `file`
- [x] `get` / `put` (metin ve binary)
- [x] Bağımlılıksız zip (zip64 dahil); `archive` / `extract`
- [x] Hook sistemi
- [x] Testler: 51 test, Node (Vitest) ve Bun'da geçiyor

### Aşama 1b — S3 sürücüsü
- [x] Bağımlılıksız SigV4 imzalama (AWS'nin resmî test vektörleriyle doğrulandı)
- [x] Listeleme, okuma, yazma, kopyalama, silme
- [x] Prefix tabanlı klasör modeli
- [x] Multipart upload (sunucu durum tutmaz)
- [x] Presigned URL ile dosya sunumu
- [x] Bellek içi sahte S3 ile entegrasyon testleri
- [ ] Gerçek MinIO / R2 / AWS üzerinde test

### Aşama 2 — Next.js paketi, adaptörler ve örnekler
- [x] `projectRoot()` / `uploadsDir()`: dev, start ve standalone'da proje kökü tespiti
- [x] `createNextRoutes()`: API route
- [x] `createUploadsRoute()`: `app/uploads/[...path]/route.ts` serve handler
- [x] Standalone build ile uçtan uca test (dosyalar proje köküne yazılıyor)
- [x] Node `http`, Express, Fastify, Koa adaptörleri
- [x] Genel `createFileServer()` (Bun, Express, Node)
- [x] Next.js, Bun ve Express örnekleri
- [ ] Fastify ve Koa adaptörleri için canlı test

### Aşama 3 — UI temeli
- [x] Tasarım tokenları, açık/koyu/otomatik tema
- [x] SVG ikon seti (UI + dosya türleri)
- [x] Tarayıcı istemcisi (`@ci-finder/core/client`)
- [x] Store ve veri akışı (`useSyncExternalStore`)
- [x] Yerleşim: araç çubuğu, breadcrumb, ağaç, durum çubuğu, ayrıntılar paneli
- [x] Grid ve liste görünümleri, sıralama

### Aşama 4 — Etkileşim
- [x] Seçim modeli (tekli, çoklu, aralık, lasso)
- [x] Klavye kısayolları ve odak yönetimi
- [x] Sağ tık menüsü (alt menüler dahil)
- [x] Pano (kes/kopyala/yapıştır) ve çakışma diyaloğu
- [x] İçeride sürükle-bırak (görünüm, ağaç, yol çubuğu)

### Aşama 5 — Dosya işlemleri UI
- [x] Dışarıdan sürükle-bırak ile yükleme (klasör dahil)
- [x] Yükleme kuyruğu paneli
- [x] İndirme (tekli ve zip)
- [x] Hızlı bakış
- [x] Yeniden adlandırma, yeni klasör/dosya, silme onayı
- [x] Ayrıntılar paneli, toast bildirimleri

### Aşama 5b — Dahili düzenleyiciler
- [x] Editör altyapısı (açma, kaydetme, kirli durum, `editors` prop'u)
- [x] Kod editörü: renklendirme, satır numaraları, girinti, parantez tamamlama, yorum satırı
- [x] Kod editörü: bul/değiştir, satıra git
- [x] Markdown önizlemeli düzenleme
- [x] Görsel editörü: kırp, döndür, çevir, boyutlandır, kaydet

### Aşama 5c — Çöp kutusu (veritabanısız)
- [x] `.cf-trash` klasörü ve JSON yan dosyaları (yerel + S3)
- [x] `rm` çöpe taşır, `permanent` ile kalıcı siler; `trash`, `restore`, `purge` komutları
- [x] Saklama süresi ve tembel temizlik; `.cf-trash` her yoldan erişime kapalı
- [x] Arayüz: kenar çubuğunda sayaçlı "Çöp Kutusu", "Geri al" bildirimi, Shift+Delete
- [x] Testler: 10 birim testi + 10 e2e senaryosu

### Aşama 6 — Cila
- [x] Büyük klasörler için sanal liste (10.000 dosyada DOM'da ~100 öğe)
- [ ] Erişilebilirlik denetimi (ekran okuyucu ile manuel test)
- [x] i18n (TR, EN)
- [x] Yoğunluk seçenekleri ve tema özelleştirme
- [x] Dar ekran uyumu (container query, açılır kenar çubuğu)
- [ ] Dokunmatik: uzun basma ile menü, dokunarak lasso
- [x] Performans ölçümü (10.000 dosya)

### Aşama 7 — Paketleme ve dokümantasyon
- [x] README (kurulum, Next/Bun/Express, S3, prop'lar, tema, güvenlik)
- [ ] Paket başına README ve API referansı
- [x] Yayına hazır `package.json` (exports, types, sideEffects)
- [ ] npm'e yayın ve sürüm yönetimi (changesets)

## Sonraya bırakılanlar

- Sunucu taraflı küçük resim (thumbnail) üretimi (opsiyonel eklenti)
- Orijinal elFinder protokolü için uyumluluk katmanı
- Vue / Svelte / vanilla JS bileşenleri (`client` paketi zaten hazır olacağı için)

---

## Açık kararlar

| Karar | Öneri | Durum |
|---|---|---|
| Protokol | Kendi API'miz (tek endpoint, RPC) | Karar verildi |
| Depolama | Yerel disk + S3 | Karar verildi |
| Next.js | Standalone dahil; `uploads/` proje kökünde, route ile sunulur | Karar verildi |
| Dahili düzenleyiciler | Kod, Markdown, görsel | Karar verildi |
| Paket yöneticisi | npm workspaces (Bun ile uyumlu) | Karar verildi |
| Proje / paket adı | ciFinder — `@ci-finder/core`, `@ci-finder/react`, `@ci-finder/next` | Karar verildi |
