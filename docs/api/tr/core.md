# `@thefinder/core`

🌐 [English](../core.md) · **Türkçe**

Sunucu motoru. Çalışma zamanı bağımlılığı yoktur; Web standardı `Request → Response` imzasıyla Node.js (≥ 18.17), Bun, Deno ve edge ortamlarında çalışır.

## Giriş noktaları

| Alt yol | İçerik | Ortam |
|---|---|---|
| `@thefinder/core` | Motor, dosya sunucusu, hatalar, yardımcılar, tipler | Her yerde |
| `@thefinder/core/local` | `localDriver`, `LocalDriver` | Node.js, Bun (`node:fs`) |
| `@thefinder/core/s3` | `s3Driver`, `S3Driver` | Her yerde (Web Crypto + `fetch`) |
| `@thefinder/core/node` | `toNodeHandler`, `toExpress`, `toFastify`, `toKoa`, `toWebRequest`, `sendWebResponse` | Node.js |
| `@thefinder/core/sharp` | `sharpThumbnailer`, `sharpImages` | Node.js, Bun; `sharp` (≥ 0.33) kurulu olmalı |
| `@thefinder/core/client` | `createClient`, `TheFinderClient`, `ApiError`. Bkz. [client.md](client.md) | Tarayıcı ve sunucu |

---

## `createTheFinder(options)`

```ts
import { createTheFinder } from "@thefinder/core";
import { localDriver } from "@thefinder/core/local";

const finder = createTheFinder({
  volumes: [{ id: "files", name: "Dosyalar", driver: localDriver({ root: "./uploads" }), url: "/uploads" }],
});
```

`new TheFinder(options)` ile aynıdır. Hatalı yapılandırmada (volume yok, aynı volume kimliği iki kez, S3 varken `chunkSize` < 5 MiB) hemen `Error` fırlatır.

### `TheFinderOptions`

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `volumes` | `VolumeOptions[]` | — | Zorunlu, en az bir volume |
| `chunkSize` | `number` | 5 MiB | Yükleme parça boyutu. S3 volume'ü varsa en az 5 MiB olmalı. |
| `authorize` | `(ctx) => AuthorizeResult \| Promise<…>` | — | Her komuttan önce çalışır. Bkz. [Yetkilendirme](#yetkilendirme). |
| `onBeforeCommand` | `(ctx) => void \| Promise<void>` | — | Yetkilendirmeden sonra, komuttan önce. Hata fırlatırsa komut çalışmaz. |
| `onAfterCommand` | `(ctx & { result }) => void \| Promise<void>` | — | Komut başarıyla bittikten sonra. Dosya yanıtlarında `result` bir `Response`'tur. |
| `maxEditSize` | `number` | 5 MiB | `get` / `put` (metin) için üst sınır |
| `searchLimit` | `number` | 500 | `search` sonuç sınırı |
| `thumbnails` | `ThumbnailOptions` | — | Sunucuda küçük resim. Bkz. [Küçük resimler](#küçük-resimler). |
| `images` | `ImageProcessor` | — | Toplu görsel işleme. Bkz. [Görsel işleme](#görsel-işleme). |
| `maxImageSize` | `number` | 60 MiB | `transform` için en büyük girdi |
| `maxExtractSize` | `number` | 4 GiB | `extract` ile açılabilecek toplam boyut (zip bombası koruması) |
| `csrfProtection` | `boolean` | `true` | `POST` isteklerinde `x-thefinder` başlığını zorunlu tutar |

### `VolumeOptions`

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `id` | `string` | — | Zorunlu. Harf, rakam ve tire, en fazla 32 karakter; kimliklerin öneki olur. |
| `name` | `string` | `id` | Kök klasörün görünen adı |
| `driver` | `StorageDriver` | — | Zorunlu |
| `url` | `string` | — | Dosyaların herkese açık temel adresi (`"/uploads"`, `"https://cdn.example.com"`). Verilirse her dosyada `url` alanı olur; arayüz önizlemede ve seçicide bunu kullanır. |
| `readOnly` | `boolean` | `false` | Tüm yazma işlemlerini `READ_ONLY` ile reddeder. Çöp kutusu ve sürüm geçmişi de kapanır. |
| `showHidden` | `boolean` | `false` | Nokta ile başlayan dosyaları gösterir. Kapalıyken nokta ile başlayan isimler (`.htaccess`, `.env`...) oluşturulamaz, yüklenemez ve zip'ten çıkarılmaz. İç klasörler (`.tf-*`) her durumda gizli kalır. |
| `allowExtensions` | `string[]` | — | Yalnızca bu uzantılar (küçük harf, noktasız). Boş ya da yoksa hepsi. |
| `denyExtensions` | `string[]` | — | Yükleme, oluşturma, yeniden adlandırma, yapıştırma ve arşiv açmada reddedilen uzantılar |
| `maxUploadSize` | `number` | — | Tek dosya için bayt sınırı (yükleme ve ikili `put`) |
| `permission` | `(action, path) => boolean` | — | `action`: `"read" \| "write" \| "delete"`. `false` döndürmek o yoldaki işlemi `FORBIDDEN` ile reddeder ve arayüzdeki `read`/`write` bayraklarını belirler. Klasör işlemleri içeriğe de uygulanır: içinde silinemeyen bir öğe olan klasör silinemez, okunamayan alt klasörler arama, boyut, zip indirme ve arşive girmez. |
| `trash` | `boolean \| { retentionDays? }` | `true`, 30 gün | `false`: silinen öğeler doğrudan silinir |
| `versions` | `boolean \| { maxPerFile?, retentionDays? }` | `true`, 20 sürüm, süresiz | `retentionDays: 0` süresiz saklar. `false`: sürüm alınmaz. |

### `TheFinder` örneği

| Üye | Açıklama |
|---|---|
| `handler(request): Promise<Response>` | Web standardı istek işleyici. Bun, Deno, Hono, Next.js route'ları ve Cloudflare Workers'ta doğrudan kullanılır; Node framework'leri için [adaptörlere](#node-adaptörleri) bakın. Bağlamı korumak için ok fonksiyonu olarak tanımlıdır: `Bun.serve({ fetch: finder.handler })` güvenlidir. |
| `execute<T>(cmd, params?, request?)` | Bir komutu HTTP olmadan çalıştırır; hook'lar ve `authorize` yine çalışır. Hata durumunda `TheFinderError` fırlatır. `request` verilmezse boş bir `Request` kullanılır. |
| `getVolume(id)` | `Volume` örneğini döner (ileri düzey kullanım) |
| `options` | Varsayılanları uygulanmış seçenekler |

```ts
// Örnek: bir cron işinde 90 günden eski sürümleri temizlemek
await finder.execute("cleanup", { volume: "files", target: "versions", mode: "older", days: 90 });
```

### Yetkilendirme

```ts
type AuthorizeResult = boolean | void | { readOnly?: boolean };

interface CommandContext {
  cmd: string;                       // "ls", "upload"...
  request: Request;                  // gelen istek (çerez, başlık okunabilir)
  params: Record<string, unknown>;   // birleştirilmiş sorgu + gövde parametreleri
}
```

| `authorize` sonucu | Etki |
|---|---|
| `true` ya da `undefined` | İstek geçer |
| `false` | `403 FORBIDDEN` |
| `{ readOnly: true }` | İstek geçer ama bu istek için tüm volume'ler salt okunur olur. `init` yanıtında `readOnly: true` geldiği için arayüz yazma eylemlerini kendiliğinden gizler. |
| `throw new TheFinderError("UNAUTHORIZED")` | `401`; arayüzde `onUnauthorized` çağrılır |

---

## Sürücüler

### `localDriver(options)`, `@thefinder/core/local`

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `root` | `string` | — | Zorunlu. Volume kökü; göreli verilirse çalışma dizinine göre çözülür. |
| `create` | `boolean` | `true` | Kök klasör yoksa oluşturur |
| `followSymlinks` | `boolean` | `true` | Symlink'leri izler. Kök dışını gösteren bağlantılar her zaman gizlenir ve erişimde `FORBIDDEN` verir. |

- Dosyaları önce geçici bir dosyaya yazar, sonra yerine taşır. Böylece yarım kalan yazma asıl dosyayı bozmaz. Windows'ta hedef dosya başka bir programda açıksa yeniden dener.
- `capacity()` disk boyutunu bildirir (depolama paneli için).
- `driver.root`: çözülmüş mutlak kök yolu. `driver.abs(path)`: volume yolunu işletim sistemi yoluna çevirir.

### `s3Driver(options)`, `@thefinder/core/s3`

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `bucket` | `string` | — | Zorunlu |
| `accessKeyId`, `secretAccessKey` | `string` | — | Zorunlu |
| `sessionToken` | `string` | — | Geçici kimlik bilgileri için |
| `region` | `string` | `"us-east-1"` | Cloudflare R2 için `"auto"` |
| `endpoint` | `string` | AWS | S3 uyumlu servisler: R2, MinIO, DigitalOcean Spaces, Backblaze B2… |
| `prefix` | `string` | bucket kökü | Volume kökü olarak kullanılacak anahtar öneki, örn. `"uploads/"` |
| `forcePathStyle` | `boolean` | özel endpoint'te `true`, AWS'de `false` | `endpoint/bucket/key` biçimli adresler |
| `delivery` | `"presigned" \| "proxy"` | `"presigned"` | Volume'de `url` yoksa dosyalar tarayıcıya nasıl ulaşır: kısa ömürlü presigned URL'e yönlendirme ya da sunucu üzerinden akış |
| `presignExpiresIn` | `number` | 3600 | Presigned URL ömrü (saniye) |
| `partSize` | `number` | 8 MiB | Akışla yazmada (arşiv, volume'ler arası kopya) multipart parça boyutu; en az 5 MiB |
| `fetch` | `typeof fetch` | global `fetch` | Özel `fetch` (test, proxy) |

- İmzalama (SigV4) Web Crypto ile yapılır; AWS SDK gerekmez.
- Klasörler prefix olarak modellenir; boş klasörler `klasör/` işaret nesnesiyle tutulur.
- Taşıma ve yeniden adlandırma kopyala + sil şeklindedir; klasörlerde prefix altındaki tüm nesneler işlenir.
- Yüklemeler multipart'tır ve sunucu durum tutmaz.
- Görsel editörünün S3'teki görselleri okuyabilmesi için bucket CORS ayarında uygulamanızın origin'ine `GET` izni verin.

### `StorageDriver` arayüzü

Yeni bir depolama (FTP, Azure Blob, Google Drive…) eklemek için bu arayüzü uygulamanız yeterlidir. Motor sürücüye her zaman normalize edilmiş yollar verir (`/`, `/a/b.txt`); sürücü `..` görmez.

| Metot | Zorunlu | Açıklama |
|---|---|---|
| `kind` | ✔ | Kısa ad (`"local"`, `"s3"`, `"ftp"`); arayüz ikon seçiminde kullanır |
| `stat(path)` | ✔ | `DriverStat` ya da yoksa `null` |
| `list(path)` | ✔ | Klasörün doğrudan çocukları |
| `mkdir(path)` | ✔ | Tek klasör oluşturur (üst klasör vardır) |
| `read(path, range?)` | ✔ | `ReadableStream<Uint8Array>`; `range` dahil-dahil bayt aralığıdır |
| `write(path, data)` | ✔ | `data`: `ReadableStream`, `Uint8Array`, `ArrayBuffer` ya da `string`. Varsa üzerine yazar. |
| `remove(path)` | ✔ | Dosyayı ya da klasörü özyinelemeli siler |
| `copy(from, to)` | ✔ | Özyinelemeli kopya; hedef yoktur |
| `move(from, to)` | ✔ | Taşıma / yeniden adlandırma; hedef yoktur (büyük/küçük harf farkı hariç) |
| `uploadChunk(chunk)` | ✔ | Bir yükleme parçasını yazar; `{ session, done }` döner. `session` sürücüye özel durumdur, istemciye gidip bir sonraki parçayla geri gelir. |
| `abortUpload(path, session)` | | Yarım yüklemeyi temizler |
| `hasSubdirs(path)` | | Ağaçta açma okunun gösterilip gösterilmeyeceği |
| `search(path, match, limit)` | | Hızlı özyinelemeli arama; yoksa motor ağacı kendisi dolaşır |
| `signedUrl(path, { download?, filename?, expiresIn? })` | | Doğrudan URL (presigned). Bir URL dönerse motor dosyayı akıtmak yerine `302` ile yönlendirir. |
| `capacity()` | | `{ total, free }` ya da `null` |

```ts
interface DriverStat { name: string; path: VolumePath; kind: "file" | "dir"; size: number; mtime: number /* ms */ }

interface UploadChunk {
  path: VolumePath;   // ilk parçada doğrulanmış ve çakışmasız hedef
  session?: string;   // önceki parçanın döndürdüğü durum; ilk parçada undefined
  index: number; total: number;
  size: number;       // dosyanın toplam boyutu
  offset: number;     // parçanın bayt konumu
  data: Uint8Array;
}
```

---

## Küçük resimler

```ts
import { sharpThumbnailer } from "@thefinder/core/sharp";

createTheFinder({ volumes, thumbnails: { generator: sharpThumbnailer(), sizes: [128, 256, 512] } });
```

### `ThumbnailOptions`

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `generator` | `Thumbnailer` | — | Zorunlu |
| `sizes` | `number[]` | `[128, 256, 512]` | İzin verilen boyutlar; istekler en yakınına yuvarlanır |
| `maxInputSize` | `number` | 40 MiB | Daha büyük dosyalar küçük resme çevrilmez, orijinal gönderilir |
| `concurrency` | `number` | 2 | Aynı anda en fazla kaç üretim yapılacağı |

Küçük resimler volume'ün `.tf-thumbs/` klasöründe tutulur. Kaynak değişince yeniden üretilir; dosya silinince, taşınınca ya da adı değişince temizlenir.

### `sharpThumbnailer(options?)`

| Seçenek | Varsayılan | Açıklama |
|---|---|---|
| `quality` | 78 | WebP kalitesi |
| `maxPixels` | 120.000.000 | Bundan büyük görseller reddedilir (çözme bombası koruması) |

Okuduğu biçimler: jpg, jpeg, jfif, png, webp, gif, avif, tif, tiff, heic, heif. EXIF yönünü uygular, oranı korur, büyütmez. `sharp` yüklenemezse API çalışmaya devam eder, günlüğe bir kez uyarı yazılır ve orijinal görseller gönderilir.

### `Thumbnailer` arayüzü

```ts
interface Thumbnailer {
  extensions: string[];      // okuyabildiği uzantılar (küçük harf)
  extension?: string;        // üretilen dosya uzantısı, varsayılan "webp"
  generate(input: Uint8Array, size: number): Promise<Uint8Array>; // size×size kutusuna sığdır
}
```

## Görsel işleme

```ts
import { sharpImages } from "@thefinder/core/sharp";

createTheFinder({ volumes, images: sharpImages() });
```

### `sharpImages(options?)`

| Seçenek | Varsayılan | Açıklama |
|---|---|---|
| `maxPixels` | 120.000.000 | Çözme bombası koruması |
| `effort` | 4 | WebP/AVIF kodlama eforu (hız ↔ boyut) |

Yazdığı biçimler: jpeg (mozjpeg), png (kalite < 100 ise paletli), webp, avif, gif. EXIF yönünü uygular, meta verileri siler, büyütmez. Kaynak ve hedef biçim destekliyorsa animasyon korunur. Bozuk girdide `INVALID_IMAGE`, piksel sınırında `TOO_LARGE` hatası verir. Aynı anda en fazla iki görsel işlenir, diğerleri sıra bekler.

### `ImageProcessor` arayüzü

```ts
interface ImageProcessor {
  extensions: string[];   // okuyabildiği uzantılar
  formats: ImageFormat[]; // yazabildiği biçimler: "jpeg" | "png" | "webp" | "avif" | "gif"
  transform(input: Uint8Array, options: ImageTransformOptions): Promise<{ data: Uint8Array; width: number; height: number }>;
}

interface ImageTransformOptions { format: ImageFormat; width?: number; height?: number; quality?: number /* 1–100, varsayılan 80 */ }
```

---

## Dosya sunumu

### `createFileServer(options)`

Bir sürücüdeki dosyaları bir URL öneki altında sunan Web standardı handler.

```ts
Bun.serve({ routes: { "/uploads/*": createFileServer({ driver, prefix: "/uploads" }) } });
```

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `driver` | `StorageDriver` | — | Zorunlu |
| `prefix` | `string` | `""` | URL öneki |
| `showHidden` | `boolean` | `false` | Nokta dosyalarını sunar (`.tf-*` asla sunulmaz) |
| `authorize` | `(request, path) => boolean \| Promise<boolean>` | — | `false` → `404` (özel dosyaların varlığı da gizlenir) |
| `cacheControl` | `string` | `"public, max-age=0, must-revalidate"` | |

Range, ETag/`304`, `HEAD`, doğru `Content-Type` ve `?download` desteklenir. HTML ve SVG gibi etkin içerikler `Content-Security-Policy: sandbox` ile sunulur. `GET`/`HEAD` dışındaki yöntemler `405` döner.

### `serveFile(options)`

Kendi route'unuzda dosya yanıtı üretmek için alt düzey yardımcı.

| Seçenek | Tip | Açıklama |
|---|---|---|
| `request` | `Request` | Range ve koşullu GET başlıkları buradan okunur |
| `stat` | `DriverStat` | Boyut, tarih ve ETag için |
| `open` | `(range?) => Promise<ReadableStream>` | İçeriği açar |
| `download` | `boolean` | `attachment` olarak gönderir |
| `filename` | `string` | `Content-Disposition` adı (varsayılan `stat.name`) |
| `cacheControl` | `string` | Varsayılan `"private, max-age=0, must-revalidate"` |
| `mime` | `string` | Varsayılan dosya adından tahmin edilir |

Diğer yardımcılar: `contentDisposition(type, filename)` (RFC 6266/5987, UTF-8 adlar), `parseRange(header, size)` (`ByteRange`, `"invalid"` ya da `null`), `etagOf(stat)`.

---

## Node adaptörleri

`@thefinder/core/node`. `express.json()` ya da `koa-bodyparser` gibi bir ayrıştırıcı gövdeyi önceden okumuşsa adaptör gövdeyi yeniden oluşturur.

| Fonksiyon | Kullanım |
|---|---|
| `toNodeHandler(handler)` | `http.createServer(toNodeHandler(finder.handler))`. Express / Connect ara katmanı olarak da çalışır; hata olursa `next(err)` çağrılır. |
| `toExpress(handler)` | `toNodeHandler` ile aynı: `app.all("/api/files", toExpress(finder.handler))` |
| `toKoa(handler)` | `router.all("/api/files", toKoa(finder.handler))` |
| `toFastify(handler, { path? })` | Fastify eklentisi: `fastify.register(toFastify(finder.handler), { prefix: "/api/files" })`. Kendi kapsamında gövde ayrıştırmayı kapatır; `path` varsayılanı `"/"`. |
| `toWebRequest(req)` | `IncomingMessage` → `Request`. `x-forwarded-proto` / `x-forwarded-host` dikkate alınır. |
| `sendWebResponse(res, response)` | `Response`'u `ServerResponse`'a akıtır |

Bir dosya sunucusunu da aynı şekilde bağlayabilirsiniz: `app.get("/uploads/*", toExpress(createFileServer({ driver, prefix: "/uploads" })))`.

---

## Hatalar

```ts
import { TheFinderError, isTheFinderError } from "@thefinder/core";

throw new TheFinderError("UNAUTHORIZED");           // mesaj varsayılanı kodun kendisi
throw new TheFinderError("FORBIDDEN", "Bu klasör size kapalı");
```

| Üye | Açıklama |
|---|---|
| `code: ErrorCode` | Kodların tam listesi ve HTTP karşılıkları: [protocol.md › Hata kodları](protocol.md#hata-kodları) |
| `status: number` | Koddan türetilen HTTP durumu |
| `isTheFinderError(e)` | Tip koruyucu |

Hook'larda ya da sürücülerde fırlatılan `TheFinderError` istemciye kendi kodu ve mesajıyla iletilir. Diğer hatalar `INTERNAL` olur ve ayrıntıları yalnızca sunucu günlüğüne yazılır.

## Yardımcılar

| Dışa aktarım | Açıklama |
|---|---|
| `encodeId(volume, path)` / `decodeId(id)` | Kimlik üretme ve çözme. `decodeId` geçersiz girdide `BAD_REQUEST` fırlatır. |
| `normalizePath(input)` | `"a//b/./c"` → `"/a/b/c"`. `..`, ters bölü ve NUL içeren yolları çözmeye çalışmaz, `BAD_REQUEST` fırlatır. |
| `joinPath(dir, name)`, `dirname(path)`, `basename(path)` | POSIX volume yolu işlemleri |
| `extname(name)` | Noktasız, küçük harf uzantı; nokta dosyalarında `""` |
| `isInside(parent, child)` | `child`, `parent`'ın kendisi ya da altında mı |
| `mimeOf(name)` | Uzantıdan MIME tipi (dahili tablo); bilinmiyorsa `application/octet-stream` |
| `isActiveContent(mime)` | Tarayıcıda script çalıştırabilecek tipler (HTML, SVG, XML, JS) |
| `createZipStream(sources)` | Bağımlılıksız, akışlı zip yazıcı (zip64 dahil). Zaten sıkıştırılmış biçimler sıkıştırılmadan eklenir. |
| `readZipEntries(read, size)` / `openZipEntry(read, entry)` | Rastgele erişimli zip okuyucu; arşiv belleğe alınmaz |
| `CSRF_HEADER` | `"x-thefinder"` |
| `VERSION` | Paket sürümü |
| `TRASH_ROOT`, `THUMBS_ROOT`, `VERSIONS_ROOT` | `"/.tf-trash"`, `"/.tf-thumbs"`, `"/.tf-versions"` |
| `isTrashPath(path)`, `isVersionsPath(path)`, `isReservedPath(path)` | Yol iç klasörlerden birinde mi |
| `Volume`, `ThumbnailService` | Motorun iç sınıfları; ileri düzey kullanım içindir, API'leri küçük sürümlerde değişebilir |

```ts
interface ZipSource {
  name: string;          // arşiv içi yol; klasörler "/" ile biter
  mtime: number;
  size?: number;         // çok büyük dosyalarda zip64 kararı için
  open?: () => Promise<ReadableStream<Uint8Array>>;
}
```

---

## Tipler

Tüm tipler `import type { … } from "@thefinder/core"` ile alınabilir. Tarayıcı kodunda aynı tipler `@thefinder/core/client` üzerinden de gelir.

### `Entry`

| Alan | Tip | Açıklama |
|---|---|---|
| `id` | `string` | Kimlik |
| `parent` | `string \| null` | Üst klasörün kimliği; volume kökünde `null` |
| `volume` | `string` | Volume kimliği |
| `name` | `string` | Ad; volume kökünde volume'ün `name`'i |
| `path` | `string` | Volume yolu |
| `kind` | `"file" \| "dir"` | |
| `size` | `number` | Bayt; klasörlerde 0 (gerçek boyut için `size` komutu) |
| `mtime` | `number` | Son değişiklik (ms) |
| `mime` | `string` | Klasörlerde `"directory"` |
| `read`, `write` | `boolean` | `readOnly` ve `permission` sonucuna göre izinler |
| `locked?` | `true` | Volume kökü |
| `hasDirs?` | `boolean` | Yalnızca `tree` yanıtında |
| `url?` | `string` | Volume'de `url` tanımlıysa dosyanın doğrudan adresi |
| `trash?` | `{ id, originalPath, deletedAt }` | Yalnızca çöp kutusu yanıtlarında; `path` asıl konumdur |

### `VolumeInfo`

`{ id, name, kind, root: Entry, readOnly, maxUploadSize: number | null, allowExtensions: string[] | null, denyExtensions: string[], trash: { retentionDays, count } | null, versions: { maxPerFile, retentionDays } | null }`

`trash` ve `versions`, o özellik kapalıysa `null` olur.

### `InitResult`

`{ volumes: VolumeInfo[], chunkSize, version, thumbnails: { sizes, extensions } | null, images: { extensions, formats } | null }`

### `FileVersion`

`{ id, size, createdAt, reason }`. `reason` sürümü neyin değiştirdiğini söyler: `edit`, `upload`, `replace`, `optimize`, `revert`…

### `StorageStats`

| Alan | Açıklama |
|---|---|
| `volume` | Volume kimliği |
| `files`, `dirs`, `size` | Yalnızca kullanıcı dosyaları (çöp, sürüm, önbellek hariç) |
| `categories` | `Record<"image" \| "video" \| "audio" \| "document" \| "archive" \| "code" \| "other", { files, size }>` |
| `largest` | En büyük dosyalar (`Entry[]`), büyükten küçüğe |
| `versions` | `{ files, count, size, orphaned, items: VersionedFile[] }` (`items` en fazla 200) |
| `trash` | `{ count, size }` |
| `cache` | `{ files, size }`: küçük resim önbelleği |
| `capacity` | `{ total, free } \| null`: sürücü bildirebiliyorsa disk |
| `truncated` | Volume tamamen taranamayacak kadar büyükse `true` |
| `scannedAt` | Tarama zamanı (ms) |

`VersionedFile`: `{ id, path, name, exists, count, size, latest }`. `exists: false` ise dosya silinmiş ya da theFinder dışında taşınmıştır, yani sürümleri sahipsizdir.

### `TransformResult`

| Alan | Açıklama |
|---|---|
| `id`, `name` | Kaynak dosya |
| `before`, `after?` | Kaynak ve sonuç boyutu (bayt) |
| `width?`, `height?` | Sonuç ölçüleri |
| `entry?` | Yazılan dosya (yerinde yazıldıysa kaynağın kendisi) |
| `created?` | Kaynağın yanına yeni dosya oluşturulduysa `true` |
| `skipped?` | `"larger"` (sonuç küçülmedi) ya da `"unsupported"` (biçim işlenemiyor) |
| `error?` | Bu dosya başarısız olduysa hata kodu |
