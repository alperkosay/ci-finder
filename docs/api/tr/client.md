# `@ci-finder/core/client`

🌐 [English](../client.md) · **Türkçe**

[HTTP protokolünü](protocol.md) saran, bağımlılıksız API istemcisi. Arayüz bunu kullanır; tarayıcıda, Node.js'te, Bun'da ya da başka bir framework'te (Vue, Svelte, vanilla JS) kendi arayüzünüzü yazmak için de kullanılabilir. `createClient`, `CiFinderClient`, `ApiError` ve `encodeId` `@ci-finder/react`'tan da alınabilir.

```ts
import { createClient, ApiError } from "@ci-finder/core/client";

const client = createClient({ endpoint: "/api/files" });
const { volumes } = await client.init();
const { entries } = await client.ls(volumes[0].root.id);
```

## `createClient(options)` / `new CiFinderClient(options)`

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `endpoint` | `string` | — | Zorunlu. Göreli (`"/api/files"`) ya da mutlak adres |
| `headers` | `Record<string, string> \| () => Record<string, string>` | — | Her isteğe eklenecek başlıklar. Fonksiyon verilirse her istekte yeniden çağrılır (yenilenen token için). |
| `credentials` | `RequestCredentials` | `"same-origin"` | Cross-origin API'de çerez göndermek için `"include"` |
| `fetch` | `typeof fetch` | global `fetch` | Özel `fetch`. Verilirse yüklemeler de XHR yerine bu `fetch` ile yapılır (bayt düzeyinde ilerleme olmaz). |

Değişiklik yapan istekler `POST` ile ve `x-ci-finder` başlığıyla gönderilir.

## Metotlar

Her metot `Promise` döner ve hata durumunda [`ApiError`](#apierror) fırlatır. Dönüş tipleri sunucudaki `data` alanıdır.

### Gezinme

| Metot | Döner |
|---|---|
| `init()` | `InitResult`. Ayrıca sunucunun `chunkSize` değerini istemciye kaydeder; yüklemeden önce bir kez çağrılmalıdır. |
| `ls(id, signal?)` | `{ cwd, entries }` |
| `tree(id)` | `{ entries }` |
| `parents(id)` | `{ entries }` |
| `info(ids)` | `{ entries }` |
| `size(ids)` | `{ size, files, dirs }` |
| `search(id, q, signal?)` | `{ entries, truncated }` |

### Değiştirme

| Metot | Döner |
|---|---|
| `mkdir(id, name)` | `{ entry }` |
| `mkfile(id, name, content = "")` | `{ entry }` |
| `rename(id, name)` | `{ entry, removed }` |
| `duplicate(ids)` | `{ added }` |
| `paste(ids, dst, cut, conflict = "rename")` | `{ added, removed, skipped }`. `conflict`: `"rename" \| "overwrite" \| "skip"` |
| `rm(ids, permanent = false)` | `{ removed, trashed }` |
| `archive(ids, name?)` | `{ entry }` |
| `extract(id)` | `{ entry, skipped }` |

### Çöp kutusu

| Metot | Döner |
|---|---|
| `trash(volume?)` | `{ entries }` |
| `restore(ids)` | `{ restored, removed }` |
| `purge(ids)` | `{ removed }` |
| `emptyTrash(volume?)` | `{ all: true }` |

### İçerik

| Metot | Döner |
|---|---|
| `getContent(id)` | `{ content, bom, entry }` |
| `putContent(id, content)` | `{ entry }`. Metnin üzerine yazar. |
| `putBlob(id, blob, reason?)` | `{ entry }`. İkili içerikle üzerine yazar; eski hali sürüm geçmişine girer. |
| `saveBlobAs(dst, name, blob)` | `{ entry }`. Yeni dosya olarak kaydeder; ad doluysa boş bir ad seçilir. |

### Sürüm geçmişi ve depolama

| Metot | Döner |
|---|---|
| `versions(id)` | `{ versions, entry }` (`entry` dosya silinmişse `null`) |
| `revert(id, vid)` | `{ entry, created }` |
| `rmVersions(id, vids?)` | `{ removed, freed }` |
| `stats(volume, signal?)` | `StorageStats` |
| `cleanup(volume, request)` | `{ removed, freed }` |
| `transform(ids, options?, signal?)` | `{ results: TransformResult[] }` |

```ts
type CleanupRequest =
  | { target: "cache" }
  | { target: "versions"; mode: "all" | "orphaned" }
  | { target: "versions"; mode: "older"; days: number }
  | { target: "versions"; mode: "keep"; keep: number };

interface TransformOptions {
  format?: ImageFormat | "keep";  // varsayılan "keep"
  width?: number; height?: number;
  quality?: number;               // 1–100, varsayılan 80
  output?: "overwrite" | "copy";  // varsayılan "overwrite"
  skipLarger?: boolean;           // varsayılan true
  conflict?: "rename" | "overwrite";
  suffix?: string;                // varsayılan "optimized"
}
```

### Yükleme

```ts
const entry = await client.upload(file, folderId, {
  relativePath: "fotoğraflar/2024", // klasör yüklemede
  conflict: "overwrite",             // varsayılan: yeni ad ("ad (2)")
  onProgress: ({ loaded, total }) => bar.value = loaded / total,
  signal: controller.signal,
});
```

| Seçenek | Açıklama |
|---|---|
| `relativePath` | Hedef altında oluşturulacak göreli klasör |
| `conflict` | `"rename"` ya da `"overwrite"` |
| `onProgress` | `{ loaded, total }`. Tarayıcıda XHR sayesinde parça içinde de güncellenir. |
| `signal` | İptal edilince sunucudaki yarım yükleme de silinir ve `ApiError("ABORTED")` fırlatılır |

Dosya `chunkSize` boyutunda parçalara bölünür; parçalar sırayla gönderilir. Yüklemeden önce `init()` çağrılmamışsa varsayılan 5 MiB kullanılır.

### Adres üreticiler

Bu metotlar istek atmaz, yalnızca adres üretir. `<img src>`, `<a href>` ya da `<video src>` içinde kullanılır.

| Metot | Açıklama |
|---|---|
| `fileUrl(entry, download = false)` | Dosyanın kendisi. Adreste `v=<mtime>` bulunduğu için dosya değişince adres de değişir. |
| `thumbUrl(entry, size)` | Küçük resim (sunucuda kapalıysa orijinal) |
| `versionUrl(id, vid, download = false)` | Bir sürümün içeriği |
| `downloadUrl(ids)` | Tek dosya ya da zip |

### Alt düzey

| Metot | Açıklama |
|---|---|
| `get<T>(cmd, params?, signal?)` | Herhangi bir komutu `GET` ile çağırır |
| `post<T>(cmd, body, signal?)` | JSON nesnesi ya da `FormData` ile `POST` |
| `endpoint` | Yapılandırılmış adres |

## `ApiError`

```ts
try {
  await client.mkdir(id, "Raporlar");
} catch (e) {
  if (e instanceof ApiError && e.code === "EXISTS") { /* ... */ }
}
```

| Alan | Açıklama |
|---|---|
| `code` | Sunucu hata kodu ([liste](protocol.md#hata-kodları)) ya da istemci kodu: `NETWORK`, `ABORTED`, `UPLOAD`, `UNKNOWN` |
| `message` | Sunucunun mesajı |
| `status` | HTTP durumu; ağ hatası ve iptalde `0` |

## Diğer dışa aktarımlar

- `encodeId(volume, path)`: Kimlik üretir, örneğin bilinen bir klasörü açmak için: `client.ls(encodeId("files", "/raporlar"))`.
- Tipler: `Entry`, `VolumeInfo`, `InitResult`, `EntryKind`, `FileVersion`, `ImageFormat`, `StorageStats`, `TransformResult`, `UsageCategory`, `VersionedFile`, `ConflictMode`, `ClientOptions`, `UploadOptions`, `UploadProgress`, `TransformOptions`, `CleanupRequest`, `SizeResult`.
