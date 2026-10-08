# ciFinder

React için dosya yöneticisi. Arayüz saf CSS ile yazıldı, hiçbir UI kütüphanesine bağlı değil. Backend Web standardı `Request → Response` üzerine kurulu; Next.js (standalone dahil), Node.js, Bun, Express, Fastify, Koa ve Hono ile çalışır. Dosyalar yerel diskte, S3'te ya da ikisinde birden tutulabilir.

| Paket | İçerik |
|---|---|
| `@ci-finder/core` | Sunucu motoru, yerel ve S3 sürücüleri, Node adaptörleri, tarayıcı istemcisi. Çalışma zamanı bağımlılığı yok. |
| `@ci-finder/next` | Next.js route'ları ve standalone uyumlu proje kökü tespiti. |
| `@ci-finder/react` | `<CiFinder />` bileşeni ve `styles.css`. Tek bağımlılığı `react` (peer). |

## Özellikler

- **Gezinme:** Simge ve liste görünümü, sanal liste (10.000+ dosya akıcı), klasör ağacı, düzenlenebilir yol çubuğu, geçmiş (geri/ileri).
- **Seçim:** Ctrl/Shift ile çoklu seçim, sürükleyerek alan (lasso) seçimi, yazarak dosyaya atlama.
- **Dosya işlemleri:** Kes, kopyala, yapıştır, çoğalt, yerinde yeniden adlandır, sil. Ad çakışmasında "değiştir / ikisini de tut / atla" sorulur.
- **Sürükle-bırak:** İçeride klasörlere ve kenar çubuğuna taşıma; Ctrl veya Alt ile kopyalama. Masaüstünden dosya ve klasör bırakılabilir.
- **Yükleme:** Parça parça (chunk'lı) gönderilir, böylece büyük dosyalar sunucu gövde limitlerine takılmaz. İlerleme, iptal ve tekrar deneme var; klasör yapısı korunur.
- **İndirme:** Tek dosya doğrudan iner. Birden çok dosya ya da klasör, sunucuda anında oluşturulan zip olarak iner (zip64 destekli).
- **Arşiv:** Zip oluşturma ve çıkarma; zip-slip ve zip bombası koruması dahil.
- **Çöp kutusu:** Veritabanı gerektirmez. `Delete` öğeyi onay sormadan çöpe taşır ve bildirimde "Geri al" düğmesi çıkar. `Shift+Delete` kalıcı olarak siler. Geri yükleme, kalıcı silme, boşaltma ve 30 gün sonra otomatik temizlik var.
- **Arama:** Alt klasörlerde de arar. Büyük/küçük harf ve aksan duyarsızdır; Türkçe ı/İ doğru eşleşir.
- **Hızlı bakış (Space):** Resim, video, ses, PDF, kod ve Markdown önizlemesi.
- **Dahili editörler:**
  - Kod editörü: 13 dil ailesi için renklendirme, bul/değiştir, satıra git, akıllı girinti, Ctrl+S ile kaydetme.
  - Önizlemeli Markdown editörü.
  - Görsel editörü: kırp, döndür, çevir, boyutlandır, biçim ve kalite seçimi.
- **Klavye ve erişilebilirlik:** Tüm işlemler klavyeyle yapılabilir; ARIA rolleri tanımlı.
- **Görünüm:** Açık/koyu/otomatik tema, iki yoğunluk seçeneği, dar ekranlara uyum (container query).
- **Dil:** Türkçe ve İngilizce hazır; `messages` prop'u ile başka diller eklenebilir.

## Kurulum

```bash
npm i @ci-finder/core @ci-finder/react @ci-finder/next
```

## Next.js

**1. Sunucu ayarı (`lib/finder.ts`)**

```ts
import { createCiFinder, localDriver, uploadsDir } from "@ci-finder/next";

export const finder = createCiFinder({
  volumes: [
    {
      id: "uploads",
      name: "Uploads",
      driver: localDriver({ root: uploadsDir() }), // <proje kökü>/uploads
      url: "/uploads",
      denyExtensions: ["php", "exe"],
    },
  ],
  authorize: async ({ request }) => Boolean(await getSession(request)), // isteğe bağlı
});
```

**2. API route'u (`app/api/files/route.ts`)**

```ts
import { createNextRoutes } from "@ci-finder/next";
import { finder } from "@/lib/finder";

export const runtime = "nodejs";
export const { GET, POST } = createNextRoutes(finder);
```

**3. Dosya sunumu (`app/uploads/[...path]/route.ts`)**

```ts
import { createUploadsRoute } from "@ci-finder/next";

export const runtime = "nodejs";
export const { GET, HEAD } = createUploadsRoute();
```

**4. Sayfa**

```tsx
"use client";
import { CiFinder } from "@ci-finder/react";
import "@ci-finder/react/styles.css";

export default function Files() {
  return (
    <div style={{ height: "100vh" }}>
      <CiFinder endpoint="/api/files" locale="tr" />
    </div>
  );
}
```

### Standalone ve `uploads` klasörü

- `uploadsDir()` her modda proje kökündeki `uploads/` klasörünü verir:
  - `next dev` ve `next start`: çalışma dizini.
  - `output: "standalone"`: `server.js` kendini `.next/standalone/...` içine taşıdığı için `.next` öncesindeki yol kullanılır. Yani dosyalar build çıktısına değil, yine proje köküne yazılır.
- Docker veya kalıcı disk kullanıyorsanız klasörü ortam değişkenleriyle değiştirebilirsiniz:
  - `CI_FINDER_UPLOADS_DIR=/data/uploads` sadece yükleme klasörünü değiştirir.
  - `CI_FINDER_ROOT=/app` proje kökünü değiştirir.
- Dosyalar neden `public/` altında değil? Next.js production'da, build sonrası `public/` klasörüne eklenen dosyaları sunmaz. `createUploadsRoute` ise dosyaları her istekte diskten okur. Range (video ileri sarma), ETag ve 304 destekler; HTML ve SVG dosyalarını `CSP: sandbox` ile sunar.
- Standalone build `.next/static` klasörünü kendiliğinden kopyalamaz. [examples/next/scripts/copy-standalone-assets.mjs](examples/next/scripts/copy-standalone-assets.mjs) bu işi `postbuild` adımında yapar.
- Monorepo'da `next.config` içine `outputFileTracingRoot` ekleyin; örnek: [examples/next/next.config.mjs](examples/next/next.config.mjs).

## Bun

```ts
import { createCiFinder, createFileServer } from "@ci-finder/core";
import { localDriver } from "@ci-finder/core/local";
import index from "./index.html";

const driver = localDriver({ root: "./uploads" });
const finder = createCiFinder({ volumes: [{ id: "files", driver, url: "/uploads" }] });

Bun.serve({
  routes: {
    "/": index, // React arayüzünü Bun kendisi paketler
    "/api/files": finder.handler,
    "/uploads/*": createFileServer({ driver, prefix: "/uploads" }),
  },
});
```

## Node.js, Express, Fastify, Koa

```ts
import { toExpress, toNodeHandler, toFastify, toKoa } from "@ci-finder/core/node";

app.all("/api/files", toExpress(finder.handler));                       // Express / Connect
http.createServer(toNodeHandler(finder.handler));                       // düz node:http
fastify.register(toFastify(finder.handler), { prefix: "/api/files" });  // Fastify
router.all("/api/files", toKoa(finder.handler));                        // Koa
```

`express.json()` gibi gövde ayrıştırıcılar sorun çıkarmaz; gövde önceden okunmuşsa adaptör onu yeniden oluşturur. Hono, Deno ve Cloudflare gibi Web standardı ortamlarda `finder.handler` doğrudan kullanılır.

## S3, R2, MinIO

```ts
import { s3Driver } from "@ci-finder/core/s3";

volumes: [
  { id: "local", driver: localDriver({ root: uploadsDir() }), url: "/uploads" },
  {
    id: "s3",
    name: "Bulut",
    driver: s3Driver({
      bucket: "my-bucket",
      region: "auto",                                   // R2 için "auto"
      endpoint: "https://<id>.r2.cloudflarestorage.com", // AWS için boş bırakın
      accessKeyId: process.env.S3_KEY!,
      secretAccessKey: process.env.S3_SECRET!,
      prefix: "uploads/",
    }),
    url: "https://cdn.example.com/uploads", // public bucket/CDN varsa; yoksa presigned URL kullanılır
  },
];
```

- AWS SDK kullanılmaz; imzalama (SigV4) Web Crypto ile yapılır ve Edge runtime'da da çalışır.
- Yerel disk ile S3 arasında kopyalama ve taşıma desteklenir.
- Yüklemeler S3 multipart olarak yapılır ve sunucu istekler arasında durum tutmaz, bu yüzden serverless ortamda da çalışır. S3 kullanılıyorsa `chunkSize` en az 5 MiB olmalı (varsayılan 5 MiB).
- Görsel editörü S3'teki görselleri düzenleyebilsin diye bucket'ta CORS ayarı gerekir (`GET`, uygulamanızın origin'i).

## Çöp kutusu

Veritabanı kullanılmaz. Her volume'ün çöpü kendi içinde, gizli `.cf-trash/` klasöründe tutulur:

```
uploads/.cf-trash/
  mgh2k1-a8f3c2d1/          ← silinen öğe (asıl adıyla)
    Faturalar/...
  mgh2k1-a8f3c2d1.json      ← { name, originalPath, deletedAt, kind, size }
```

- Yerel diskte de S3'te de aynı şekilde çalışır ve sunucu yeniden başlasa da korunur.
- Geri yüklenen öğe eski yerine döner. Eski klasör silinmişse yeniden oluşturulur; aynı adla başka bir öğe varsa adı "dosya (2)" olur.
- Süresi dolan öğeler çöp kutusu her listelendiğinde temizlenir, bunun için cron gerekmez.
- `.cf-trash` normal listede, aramada, zip indirmede ve `/uploads` route'unda hiç görünmez; `showHidden: true` olsa bile.

```ts
{ id: "uploads", driver, trash: { retentionDays: 14 } } // varsayılan: 30 gün
{ id: "tmp", driver, trash: false }                      // çöp kutusu yok, doğrudan silinir
```

API komutları: `rm` (varsayılan olarak çöpe taşır, `permanent: true` ile kalıcı siler), `trash`, `restore`, `purge` (`{ ids }` ya da `{ all: true }`).

## `<CiFinder />` prop'ları

| Prop | Açıklama |
|---|---|
| `endpoint` | API adresi, örn. `/api/files` |
| `headers`, `credentials` | Ek istek başlıkları (örn. `Authorization`), cross-origin için cookie ayarı |
| `locale`, `messages` | `"tr"` / `"en"`, çeviri ekleme veya ezme |
| `theme` | `"auto"` (varsayılan), `"light"`, `"dark"` |
| `density` | `"comfortable"` (varsayılan), `"compact"` |
| `height`, `className`, `style` | Boyut ve stil. Varsayılan yükseklik ebeveynin %100'ü |
| `initialFolder`, `defaultView`, `persistKey` | Başlangıç klasörü, varsayılan görünüm ve sıralama, tercihlerin saklanacağı localStorage anahtarı |
| `onSelect`, `selectLabel`, `multiple` | Seçici modu (örn. CMS'te "görsel seç" alanı) |
| `onOpen` | Dosya açılışını yakalar; `true` döndürürseniz varsayılan davranış çalışmaz |
| `onChange` | Her değişiklikten sonra çağrılır (yükleme, silme, taşıma…) |
| `editors` | "Birlikte aç" menüsüne kendi editörünüzü ekler |

## Tema

Tüm stiller `@layer ci-finder` içindedir, yani katman dışında yazdığınız her kural onları ezer. Renkler CSS değişkenleriyle tanımlı:

```css
.cf-root {
  --cf-accent: #0f766e;
  --cf-radius: 4px;
  --cf-font: "Inter", system-ui, sans-serif;
}
.cf-root[data-theme="dark"] {
  --cf-bg: #101418;
}
```

## Güvenlik

- **Path traversal:** `..` içeren yollar çözülmeye çalışılmaz, doğrudan reddedilir. Kök dışına işaret eden symlink'ler gizlenir.
- **CSRF:** Tüm değişiklik isteklerinde `x-ci-finder` başlığı zorunludur; değişiklik yapan komutlar GET ile çalışmaz.
- **Yetkilendirme:** Volume bazında `readOnly`, `permission(action, path)`, uzantı izin ve yasak listeleri, `maxUploadSize`; komut bazında `authorize` hook'u.
- **Arşivler:** Zip-slip ve zip bombası koruması (`maxExtractSize`).
- **Aktif içerik:** Yüklenen HTML ve SVG dosyaları sandbox CSP ile sunulur, uygulamanızın origin'inde script çalıştıramaz.
- **Kimlik doğrulama:** `authorize` hook'unda kendiniz yapmalısınız. Varsayılan ayarlarla API'ye herkes erişebilir.

## Geliştirme

```bash
npm install
npm run build      # core → next → react
npm test           # core testleri (Node)
npm run test:bun   # aynı testler Bun ile
npm run dev        # paketleri derler ve Next örneğini başlatır (http://localhost:3000)
```

Örnekler: [examples/next](examples/next), [examples/bun](examples/bun), [examples/express](examples/express).
