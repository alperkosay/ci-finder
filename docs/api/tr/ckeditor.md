# `@thefinder/ckeditor`

🌐 [English](../ckeditor.md) · **Türkçe**

CKEditor 5 ve CKEditor 4 için connector; CKFinder'ın yaptığı işi yapar:

- araç çubuğuna dosya yöneticisi düğmesi ekler. Seçilen görseller görsel olarak, diğer dosyalar bağlantı olarak eklenir;
- yapıştırılan ve sürüklenen görselleri theFinder'ın parçalı yüklemesiyle sunucuya kaydeder.

Seçici [`openFilePicker`](react.md#openfilepickeroptions) ile açıldığı için sayfada `@thefinder/react/styles.css` yüklü olmalıdır.

## CKEditor 5

```ts
import { ClassicEditor, Essentials, Paragraph, Image, ImageUpload, Link } from "ckeditor5";
import { TheFinder } from "@thefinder/ckeditor";
import "@thefinder/react/styles.css";

ClassicEditor.create(el, {
  licenseKey: "GPL",
  plugins: [Essentials, Paragraph, Image, ImageUpload, Link, TheFinder],
  toolbar: ["bold", "link", "|", "theFinder"],
  theFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
});
```

`ckeditor5` ≥ 42 gerekir (birleşik `ckeditor5` paketi). Eklenti `FileRepository`'yi kendisi yükler.

### `theFinder` ayarları (`TheFinderEditorConfig`)

| Seçenek | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `endpoint` | `string` | `"/api/files"` | API adresi |
| `headers` | `Record<string, string> \| () => Record<string, string>` | — | Ek istek başlıkları |
| `credentials` | `RequestCredentials` | — | Cross-origin çerez ayarı |
| `client` | `TheFinderClient` | — | Hazır istemci; verilirse yukarıdaki üçü yerine kullanılır |
| `uploadFolder` | `string \| { volume, path } \| false` | `"/editor"` | Yapıştırılan görsellerin klasörü. Metin verilirse ilk volume'de bir yol olarak kullanılır. Klasör yoksa oluşturulur. `false` verilirse CKEditor'ün kendi yükleme ayarı kullanılır. |
| `absoluteUrls` | `boolean` | `false` | İçeriğe tam adres (`https://site/uploads/a.png`) yazılır |
| `picker` | `Partial<FilePickerOptions>` | — | Seçici ayarları: `accept`, `theme`, `locale`, `multiple`… |
| `openPicker` | `() => Promise<PickedFile[] \| null>` | — | Yerleşik seçici yerine kendi seçicinizi açar |

### Bileşenler

| Ad | Açıklama |
|---|---|
| `theFinder` (araç çubuğu öğesi) | Dosya yöneticisini açar. Editör salt okunurken devre dışıdır. Düğme etiketi editörün arayüz diline göre Türkçe ya da İngilizcedir. |
| `editor.plugins.get("TheFinder").browse()` | Seçiciyi kendi düğmenizden açar |
| `editor.plugins.get("TheFinder").insert(files)` | `PickedFile[]` ekler. `Image` eklentisi yüklüyse görseller görsel, diğerleri bağlantı olur. Tek dosya seçildiğinde ve metin seçiliyse bağlantı seçili metne verilir. |
| `TheFinderUploadAdapter` | Upload adapter sınıfı; kendi `FileRepository` kurulumunuzda kullanmak için dışa aktarılır |

## CKEditor 4

CKEditor 4 global bir `CKEDITOR` nesnesiyle çalışır. Bu yüzden modül, ona bir `thefinder` eklentisi kaydeder:

```ts
import { registerTheFinder } from "@thefinder/ckeditor/v4";
import "@thefinder/react/styles.css";

registerTheFinder(window.CKEDITOR);
CKEDITOR.replace("body", {
  extraPlugins: "thefinder,uploadimage",
  theFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
});
```

`registerTheFinder(CKEDITOR)` birden fazla çağrılabilir; eklenti yalnızca bir kez kaydedilir. Eklenti `filebrowser` eklentisine ihtiyaç duyar (standart paketlerde vardır).

Eklentinin yaptıkları:

- `TheFinder` araç çubuğu düğmesini (`insert` grubu) ve `thefinder` komutunu ekler.
- Resim ve Bağlantı pencerelerindeki "Sunucuyu Gözat" düğmelerini theFinder seçicisine bağlar. Resim penceresinde yalnızca görseller seçilebilir. `filebrowserBrowseUrl` ya da `filebrowserImageBrowseUrl` zaten tanımlıysa onlara dokunulmaz.
- `uploadimage` eklentisi yüklüyse yapıştırılan ve sürüklenen görselleri theFinder üzerinden yükler. `uploadUrl` ya da `imageUploadUrl` zaten tanımlıysa onlar korunur.

### `theFinder` ayarları (`TheFinderEditor4Config`)

CKEditor 5 ile aynıdır; tek fark `openPicker` imzasıdır:

```ts
openPicker?: (options: { images: boolean; multiple: boolean }) => Promise<PickedFile[] | null>;
// images: görsel bekleniyor (Resim penceresi), multiple: araç çubuğu düğmesinde true
```

CKEditor 4'ün açık kaynak son sürümü 4.22.1'dir; 4.23 ve sonrası ticari lisans anahtarı ister. Connector iki sürümle de çalışır.

## Tipler

`TheFinderEditorConfig`, `TheFinderEditor4Config`, `CKEditorStatic` (CKEditor 4 global'inin kullanılan kısmı) ve `PickedFile`.
