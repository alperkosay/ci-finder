# `@ci-finder/next`

Next.js App Router entegrasyonu. `output: "standalone"` dahil her modda çalışır. Kurulum adımları için kök [README › Next.js](../../README.md#nextjs) bölümüne bakın.

## Yeniden dışa aktarımlar

Tek import yeterli olsun diye şunlar `@ci-finder/core`'dan aynen gelir: `createCiFinder`, `CiFinderError`, `localDriver`, `s3Driver` ve core'daki tüm tipler.

```ts
import { createCiFinder, localDriver, s3Driver, uploadsDir, CiFinderError } from "@ci-finder/next";
```

## `createNextRoutes(finder)`

`app/api/<ad>/route.ts` için route handler'ları üretir.

```ts
// app/api/files/route.ts
import { createNextRoutes } from "@ci-finder/next";
import { finder } from "@/lib/finder";

export const runtime = "nodejs";
export const { GET, POST } = createNextRoutes(finder);
```

| Parametre | Açıklama |
|---|---|
| `finder` | Bir `CiFinder` örneği ya da `CiFinderOptions`. Seçenek nesnesi verilirse örnek içeride oluşturulur. |

Döner: `{ GET, POST, HEAD }`. `HEAD`'i de dışa aktarırsanız Range destekli dosya yanıtlarında `HEAD` istekleri de karşılanır.

`runtime = "nodejs"` yerel disk için gereklidir. Yalnızca S3 volume'leri kullanıyorsanız Edge runtime'da da çalışır.

## `createUploadsRoute(options?)`

`app/uploads/[...path]/route.ts` için dosya sunucusu. Dosyaları her istekte diskten okur, bu yüzden build'den sonra yüklenen dosyalar da hemen sunulur (`public/` klasöründe böyle olmaz).

```ts
// app/uploads/[...path]/route.ts
import { createUploadsRoute } from "@ci-finder/next";

export const runtime = "nodejs";
export const { GET, HEAD } = createUploadsRoute();
```

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `dir` | `string` | `uploadsDir()` | Sunulacak klasör. `driver` verilirse yok sayılır. |
| `driver` | `StorageDriver` | — | Başka bir sürücüden sun (örneğin özel bir S3 bucket'ını uygulama üzerinden) |
| `param` | `string` | `"path"` | Catch-all segmentin adı (`[...path]`) |
| `authorize` | `(request, path) => boolean \| Promise<boolean>` | — | `false` → `404`. Özel dosyalar için oturum kontrolü. |
| `cacheControl` | `string` | `"public, max-age=0, must-revalidate"` | ETag ile her istekte yeniden doğrulanır |
| `showHidden` | `boolean` | `false` | Nokta dosyalarını sunar. `.cf-*` iç klasörleri asla sunulmaz. |

Range (video ileri sarma), ETag/`304`, doğru `Content-Type` ve `?download` desteklenir. HTML ve SVG `Content-Security-Policy: sandbox` ile sunulur. Next.js 14 (senkron `params`) ve 15+ (`Promise` `params`) ile çalışır.

## Proje kökü ve yükleme klasörü

| Fonksiyon | Döner |
|---|---|
| `projectRoot()` | Uygulamanın proje kökü |
| `projectPath(...segments)` | Proje kökü altında bir yol |
| `uploadsDir(name = "uploads")` | `<proje kökü>/uploads` |

`projectRoot()` şöyle çalışır:

| Ortam | Sonuç |
|---|---|
| `next dev`, `next start` | Çalışma dizini |
| `output: "standalone"` | `server.js` kendini `.next/standalone[/<uygulama>]` içine taşır; `.next` öncesindeki yol kullanılır. Yani dosyalar build çıktısına değil, yine proje köküne yazılır. |
| `CI_FINDER_ROOT` tanımlı | Bu değer (mutlak yola çevrilir) |

`uploadsDir()` ayrıca `CI_FINDER_UPLOADS_DIR` ortam değişkenine bakar: mutlak yol olduğu gibi, göreli yol proje köküne göre kullanılır. Docker'da kalıcı bir diske yazmak için kullanışlıdır.

> Ortam değişkenleri ve `process.cwd()` bilerek `globalThis` üzerinden okunur. Böylece Next'in dosya izleyicisi tüm projeyi (ve yüklenen dosyaları) standalone paketine kopyalamaz.

## Standalone kontrol listesi

- `next.config` içinde `output: "standalone"`. Monorepo'daysanız `outputFileTracingRoot` da ekleyin.
- `.next/static` ve `public` klasörlerini standalone çıktısına kopyalayın. Örnek: [examples/next/scripts/copy-standalone-assets.mjs](../../examples/next/scripts/copy-standalone-assets.mjs).
- Küçük resimler için sharp'ın yerel kütüphanelerini pakete ekleyin: `outputFileTracingIncludes: { "/api/files": ["./node_modules/@img/**/*"] }`.
