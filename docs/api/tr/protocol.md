# HTTP protokolü

🌐 [English](../protocol.md) · **Türkçe**

theFinder tek bir endpoint üzerinden RPC tarzında çalışır (örneğin `/api/files`). Arayüz bu protokolü [`TheFinderClient`](client.md) ile kullanır. Kendi istemcinizi yazacaksanız ya da API'yi başka bir dilden çağıracaksanız bu belge yeterlidir.

## İstek biçimi

| Kural | Ayrıntı |
|---|---|
| Komut | `cmd` parametresiyle seçilir: `GET /api/files?cmd=ls&id=...` ya da `POST` gövdesinde `{ "cmd": "mkdir", ... }`. |
| Yöntemler | `GET`, `HEAD`, `POST`. Diğerleri `405` döner. |
| Yalnızca okuyan komutlar | `init`, `ls`, `tree`, `parents`, `info`, `size`, `search`, `file`, `thumb`, `download`, `get`, `trash`, `versions`, `version`, `stats`. Bunlar `GET` ve `POST` ile çağrılabilir. |
| Değişiklik yapan komutlar | Geri kalan her şey yalnızca `POST` ile çalışır; `GET` ile çağrılırsa `BAD_REQUEST` döner. |
| CSRF başlığı | Her `POST` isteğinde `x-thefinder` başlığı bulunmalıdır (değeri önemsizdir, istemci `1` gönderir). Yoksa `403 FORBIDDEN`. `csrfProtection: false` ile kapatılabilir. |
| Gövde | `application/json`, `multipart/form-data` ya da `application/x-www-form-urlencoded`. Sorgu dizesindeki parametreler de okunur; aynı ad gövdede de varsa gövdedeki kullanılır. |
| Listeler (`ids`, `vids`) | JSON dizisi, virgülle ayrılmış metin (`ids=a,b`) ya da tekrarlanan sorgu parametresi (`ids=a&ids=b`). En fazla 10.000 öğe. |
| Mantıksal değerler | `true`, `"true"`, `"1"` ve `1` doğru sayılır. |

## Yanıt biçimi

JSON dönen komutlar her zaman aynı zarfı kullanır:

```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "File not found" } }
```

Yanıtlar `Cache-Control: no-store` ile gelir. `file`, `thumb`, `download` ve `version` komutları JSON yerine dosyanın kendisini döner (hata durumunda yine JSON zarfı gelir).

## Komutlar

Tablolarda `Entry`, `VolumeInfo` gibi tipler [core.md › Tipler](core.md#tipler) bölümünde tanımlıdır.

### Gezinme

| Komut | Parametreler | `data` |
|---|---|---|
| `init` | — | `InitResult`: `{ volumes, chunkSize, version, thumbnails, images }` |
| `ls` | `id` (klasör) | `{ cwd: Entry, entries: Entry[] }` |
| `tree` | `id` (klasör) | `{ entries: Entry[] }`: yalnızca alt klasörler; sürücü destekliyorsa her birinde `hasDirs` |
| `parents` | `id` | `{ entries: Entry[] }`: volume kökünden öğenin kendisine kadar zincir |
| `info` | `ids` | `{ entries: Entry[] }` |
| `size` | `ids` | `{ size, files, dirs }`: klasörler özyinelemeli toplanır |
| `search` | `id` (aranacak klasör), `q` | `{ entries: Entry[], truncated: boolean }`: alt klasörlerde de arar; büyük/küçük harf, aksan ve Türkçe ı/İ duyarsız. En fazla `searchLimit` sonuç. |

### Oluşturma ve değiştirme

| Komut | Parametreler | `data` |
|---|---|---|
| `mkdir` | `id` (üst klasör), `name` | `{ entry }` |
| `mkfile` | `id` (üst klasör), `name`, `content?` | `{ entry }` |
| `rename` | `id`, `name` | `{ entry, removed: [eskiId] }`: ad değişmediyse `removed` boş. Yalnızca büyük/küçük harfi değişen adlar (`foto.JPG` → `foto.jpg`) büyük/küçük harf duyarsız disklerde de çalışır. |
| `duplicate` | `ids` | `{ added: Entry[] }`: kopyalar aynı klasörde "ad (2)" biçiminde oluşur |
| `paste` | `ids`, `dst` (hedef klasör), `cut?`, `conflict?` | `{ added: Entry[], removed: string[], skipped: string[] }` |

`paste` ayrıntıları:

- `cut: true` taşır, aksi halde kopyalar. Volume'ler arasında (yerel disk ↔ S3) da çalışır.
- `conflict`: `"rename"` (varsayılan, "ad (2)"), `"overwrite"` (var olan öğe silinir; dosyaysa eski hali sürüm geçmişine girer) ya da `"skip"`.
- Bir klasör kendi içine taşınamaz: `MOVE_INTO_ITSELF`.

### Silme ve çöp kutusu

| Komut | Parametreler | `data` |
|---|---|---|
| `rm` | `ids`, `permanent?` | `{ removed: string[], trashed: Entry[] }`: çöp kutusu açıksa öğeler çöpe taşınır, `permanent: true` ya da `trash: false` ise kalıcı silinir |
| `trash` | `volume?` | `{ entries: Entry[] }`: tüm volume'lerin (ya da birinin) çöpü, en yeni önce. Her öğede `trash: { id, originalPath, deletedAt }` vardır; `path` asıl konumdur. |
| `restore` | `ids` (çöp öğesi kimlikleri) | `{ restored: Entry[], removed: string[] }`: eski yerine döner; klasör yoksa oluşturulur, ad doluysa "ad (2)" olur |
| `purge` | `ids` ya da `all: true` (+ `volume?`) | `{ removed: string[], all: boolean }`: kalıcı siler |

Çöp öğesi kimlikleri de `<volume>_<base64url>` biçimindedir ama `.tf-trash` içini gösterir. Bu kimlikler yalnızca `restore` ve `purge` ile kullanılabilir.

### Yükleme

Dosyalar parça parça (`multipart/form-data`) gönderilir. Parça boyutu `init` yanıtındaki `chunkSize`'dır.

| Alan | Açıklama |
|---|---|
| `cmd` | `upload` |
| `dst` | Hedef klasörün kimliği |
| `name` | Dosya adı |
| `size` | Dosyanın toplam boyutu (bayt) |
| `index`, `total` | Parça sırası (0'dan başlar) ve toplam parça sayısı |
| `offset` | Parçanın dosyadaki bayt konumu |
| `chunk` | Parçanın kendisi (dosya alanı), en fazla `chunkSize` bayt |
| `session` | İlk parçada boş; sonrakilerde bir önceki yanıttaki `session` |
| `relativePath?` | Klasör yüklemede dosyanın göreli klasörü (`"fotoğraflar/2024"`); `dst` altında oluşturulur |
| `conflict?` | `"overwrite"`: aynı adlı dosyanın üzerine yazar, eski hali sürüm geçmişine girer. Verilmezse yeni dosya "ad (2)" olur. |

Yanıt: `{ done: false, session }` ya da son parçada `{ done: true, session, entry }`.

- `session`, istemcide tutulan bir jetondur; sunucu yüklemeler arasında durum tutmaz, bu yüzden serverless ortamlarda da çalışır. Her parçada hedef yol, izinler ve uzantı yeniden doğrulanır.
- İptal: `POST { cmd: "abort", dst, session }` → `{ aborted: true }`. S3'te yarım kalan multipart yüklemeyi siler. Hata vermez, her zaman başarılı döner.

### İçerik

| Komut | Parametreler | Yanıt |
|---|---|---|
| `file` | `id`, `download?`, `v?` | Dosyanın kendisi (inline ya da ek olarak). Range, ETag/304 ve `HEAD` desteklenir. S3'te presigned URL'e `302` yönlendirme yapılabilir. `v` yalnızca önbellek kırmak içindir. |
| `thumb` | `id`, `size?` (varsayılan 256), `v?` | WebP küçük resim. Boyut izin verilen en yakın değere yuvarlanır. Küçük resim yoksa ya da üretilemiyorsa orijinal dosya gönderilir. |
| `download` | `ids` | Tek dosya doğrudan iner. Birden çok öğe ya da klasör anında oluşturulan zip olarak iner (`download.zip` ya da `<ad>.zip`). |
| `get` | `id` | `{ content, bom, entry }`: UTF-8 metin. En fazla `maxEditSize`; metin olmayan dosyada `UNSUPPORTED`. |
| `put` | aşağıya bakın | `{ entry, created }` |

`put` üç biçimde çağrılır:

| Biçim | Alanlar | Sonuç |
|---|---|---|
| JSON | `id`, `content` | Metin dosyasının üzerine yazar |
| multipart | `id`, `file`, `reason?` | İkili içerikle üzerine yazar (örneğin görsel editörü) |
| multipart | `dst`, `name`, `file` | Yeni dosya olarak kaydeder; ad doluysa boş bir ad seçilir (`created: true`) |

Üzerine yazmadan önce dosyanın eski hali sürüm geçmişine alınır. `reason` sürümde saklanan kısa kelimedir (yalnızca `a-z`, en fazla 16 karakter, varsayılan `edit`).

### Arşiv

| Komut | Parametreler | `data` |
|---|---|---|
| `archive` | `ids` (aynı klasörde olmalı), `name?` | `{ entry }`: zip dosyası; ad verilmezse `<ad>.zip` ya da `Archive.zip` |
| `extract` | `id` (`.zip`) | `{ entry, skipped }`: arşivle aynı adlı yeni bir klasöre açar. Geçersiz ya da izin verilmeyen uzantılı girdiler atlanır ve sayılır. |

Zip-slip koruması vardır; açılan toplam boyut `maxExtractSize`'ı aşarsa işlem `TOO_LARGE` ile durur.

### Sürüm geçmişi

| Komut | Parametreler | Yanıt |
|---|---|---|
| `versions` | `id` | `{ versions: FileVersion[], entry: Entry \| null }`: en yeni önce. Dosya silinmişse `entry` `null` olur ama geçmiş yine listelenir. |
| `version` | `id`, `vid`, `download?` | Sürümün içeriği (dosya yanıtı, değişmez olduğu için 1 yıl önbelleklenir) |
| `revert` | `id`, `vid` | `{ entry, created }`: dosyayı o sürümle değiştirir; mevcut hali de sürüm olur. Dosya silinmişse yeniden oluşturur (`created: true`). |
| `rmVersions` | `id`, `vids?` | `{ removed, freed }`: verilen sürümleri, `vids` yoksa tüm geçmişi siler |

### Depolama paneli

| Komut | Parametreler | `data` |
|---|---|---|
| `stats` | `volume` | `StorageStats`: volume'ün tamamını tarar |
| `cleanup` | `volume`, `target`, … | `{ removed, freed }` |

`cleanup` seçenekleri:

| `target` | Ek parametreler | Etki |
|---|---|---|
| `"cache"` | — | Küçük resim önbelleğini siler (gerektiğinde yeniden üretilir) |
| `"versions"` | `mode: "all"` | Tüm sürümler |
| `"versions"` | `mode: "orphaned"` | Dosyası artık olmayan sürümler |
| `"versions"` | `mode: "older"`, `days` | `days` günden eski sürümler |
| `"versions"` | `mode: "keep"`, `keep` | Her dosyanın yalnızca son `keep` sürümü kalır |

### Toplu görsel işleme

`transform` yalnızca sunucuda `images` ayarlıysa çalışır; aksi halde `UNSUPPORTED` döner.

| Parametre | Açıklama |
|---|---|
| `ids` | Görseller |
| `format?` | `"keep"` (varsayılan), `"jpeg"`, `"png"`, `"webp"`, `"avif"`, `"gif"` |
| `width?`, `height?` | Bu kutuya sığdırılır; oran korunur, asla büyütülmez. En fazla 20.000. |
| `quality?` | 1–100, varsayılan 80 |
| `output?` | Biçim aynıysa: `"overwrite"` (varsayılan) ya da `"copy"` (`ad-<suffix>.uzantı`) |
| `skipLarger?` | Varsayılan `true`: sonuç orijinalden küçük değilse dosyaya dokunulmaz |
| `conflict?` | Çıktı adı doluysa: `"rename"` (varsayılan) ya da `"overwrite"` |
| `suffix?` | Kopya ad eki, varsayılan `optimized` |
| `dryRun?` | `true`: sadece kodlar ve hiçbir şey yazmadan `after`, `width`, `height` (ve `skipped`) bildirir. Gerçek çalıştırmayla aynı yetkileri ister. |

Yanıt: `{ results: TransformResult[] }`. Her dosya kendi sonucunu bildirir; bir dosyadaki hata diğerlerini durdurmaz. Biçim değiştiğinde orijinal korunur ve yanına yeni dosya yazılır. Üzerine yazılan dosyaların eski hali sürüm geçmişine girer.

## Hata kodları

| Kod | HTTP | Ne zaman |
|---|---|---|
| `BAD_REQUEST` | 400 | Eksik ya da geçersiz parametre, geçersiz kimlik/yol, GET ile değişiklik komutu |
| `UNAUTHORIZED` | 401 | `authorize` hook'u `TheFinderError("UNAUTHORIZED")` fırlattı |
| `UNKNOWN_COMMAND` | 400 | Bilinmeyen `cmd` |
| `NOT_FOUND` | 404 | Öğe, volume ya da çöp öğesi yok |
| `EXISTS` | 409 | Aynı adla öğe var |
| `INVALID_NAME` | 400 | Geçersiz ad (`\ / : * ? " < > \|`, sondaki nokta, Windows'a ayrılmış adlar, 255 karakterden uzun, ayrılmış iç klasör adları) |
| `NOT_A_DIRECTORY` | 400 | Klasör beklenen yerde dosya |
| `NOT_A_FILE` | 400 | Dosya beklenen yerde klasör |
| `FORBIDDEN` | 403 | `authorize` `false` döndü, `permission` reddetti, CSRF başlığı yok, dosya sistemi izni yok |
| `READ_ONLY` | 403 | Volume ya da istek salt okunur |
| `LOCKED` | 403 | Volume kökü yeniden adlandırılamaz, taşınamaz, silinemez |
| `EXTENSION_DENIED` | 403 | Uzantı izin listesinde değil ya da yasak listesinde |
| `TOO_LARGE` | 413 | Yükleme, parça, düzenleme, görsel ya da arşiv sınırı aşıldı |
| `MOVE_INTO_ITSELF` | 400 | Klasör kendi içine taşınmak istendi |
| `UNSUPPORTED` | 400 | Metin olmayan dosya `get` ile istendi, `.zip` olmayan dosya açılmak istendi, sunucuda görsel işleme kapalı |
| `INVALID_ARCHIVE` | 400 | Bozuk zip |
| `INVALID_IMAGE` | 400 | Görsel çözülemedi |
| `STORAGE` | 502 | Depolama hatası (S3 yanıtı, disk dolu) |
| `INTERNAL` | 500 | Beklenmeyen hata; ayrıntı sunucu günlüğüne `[thefinder]` önekiyle yazılır |

Dosya sistemi hataları da bu kodlara çevrilir: `ENOENT` → `NOT_FOUND`, `EEXIST`/`ENOTEMPTY` → `EXISTS`, `EACCES`/`EPERM` → `FORBIDDEN`, `ENOSPC` → `STORAGE`, `ENAMETOOLONG` → `INVALID_NAME`.

İstemci ([`ApiError`](client.md#apierror)) bunlara ek olarak sunucudan gelmeyen şu kodları üretebilir: `NETWORK` (bağlantı yok ya da yanıt JSON değil), `ABORTED` (yükleme iptal edildi), `UPLOAD` (yükleme tamamlanmadı), `UNKNOWN`.
