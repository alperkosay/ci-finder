# `@thefinder/react`

🌐 [English](../react.md) · **Türkçe**

Dosya yöneticisi arayüzü. Tek bağımlılığı `react` ve `react-dom`'dur (≥ 18, peer); stiller saf CSS'tir.

```tsx
"use client";
import { TheFinder } from "@thefinder/react";
import "@thefinder/react/styles.css";

<div style={{ height: "100vh" }}>
  <TheFinder endpoint="/api/files" locale="tr" />
</div>
```

`styles.css` bir kez, uygulamanın herhangi bir yerinde içe aktarılmalıdır. Bileşen ebeveyninin yüksekliğini doldurur (`height` prop'u ile değiştirilebilir).

## `<TheFinder />`

### Bağlantı

| Prop | Tip | Açıklama |
|---|---|---|
| `endpoint` | `string` | Zorunlu. API adresi, örn. `"/api/files"` |
| `headers` | `Record<string, string> \| () => Record<string, string>` | Her isteğe eklenecek başlıklar (örn. `Authorization`) |
| `credentials` | `RequestCredentials` | Cross-origin API'de çerez için `"include"` |
| `client` | `TheFinderClient` | Kendi yapılandırdığınız istemci. Verilirse `endpoint`/`headers`/`credentials` yerine kullanılır. |
| `onUnauthorized` | `() => void` | API `401` döndüğünde çağrılır, örn. giriş sayfasına yönlendirmek için |

### Görünüm

| Prop | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `locale` | `string` | tarayıcı dili (`tr` ya da `en`) | Hazır diller: `"tr"`, `"en"`. Başka bir dil için `messages` ile birlikte verin. |
| `messages` | `Partial<Messages>` | — | Çevirileri ezer ya da ekler. Eksik anahtarlar İngilizceden gelir. |
| `theme` | `"light" \| "dark" \| "auto"` | `"auto"` | `auto` işletim sistemini izler |
| `skin` | `"classic" \| "macos"` | `"classic"` | `macos`: Finder benzeri görünüm (mavi klasörler, trafik ışıkları, zebra satırlar, buzlu menüler). Açık ve koyu modda çalışır. |
| `density` | `"comfortable" \| "compact"` | `"comfortable"` | |
| `settings` | `boolean` | `true` | Başlıkta tema, görünüm ve yoğunluk seçilen ayarlar menüsü. Kullanıcının seçimi `persistKey` altında saklanır ve prop'ları ezer; prop sonradan değişirse prop geçerli olur. |
| `height` | `number \| string` | `"100%"` | |
| `className`, `style` | | — | Kök öğeye (`.tf-root`) eklenir |
| `thumbnails` | `boolean` | `true` | Görsellerde küçük resim gösterir |

### Başlangıç durumu

| Prop | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `initialFolder` | `string` | ilk volume'ün kökü | İlk açılacak klasörün kimliği |
| `defaultView` | `Partial<Prefs>` | — | Başlangıç tercihleri. Kullanıcının değiştirdikleri `persistKey` altında saklanır ve bunlardan önceliklidir. |
| `persistKey` | `string \| false` | `"thefinder"` | Tercihlerin saklanacağı localStorage anahtarı. `false` saklamaz. |

`Prefs`:

| Alan | Tip | Varsayılan |
|---|---|---|
| `view` | `"grid" \| "list"` | `"grid"` |
| `sortKey` | `"name" \| "size" \| "mtime" \| "kind"` | `"name"` |
| `sortDir` | `1 \| -1` | `1` |
| `foldersFirst` | `boolean` | `true` |
| `detailsOpen` | `boolean` | `false` |
| `sidebarWidth` | `number` | `232` |

### Olaylar

| Prop | Tip | Açıklama |
|---|---|---|
| `onOpen` | `(entry) => boolean \| void` | Bir dosya açılırken çağrılır (çift tık, Enter). `true` döndürürseniz varsayılan davranış (önizleme, editör, indirme) çalışmaz. |
| `onChange` | `(event) => void` | Her değişiklikten sonra çağrılır |
| `editors` | `CustomEditor[]` | "Birlikte aç" menüsüne editör ekler. Bkz. [Özel editörler](#özel-editörler). |

`onChange` olayı: `{ type, entries?, ids? }`. `entries` yeni ya da güncellenen öğeler, `ids` kaldırılan öğelerin kimlikleridir.

| `type` | Ne zaman |
|---|---|
| `upload` | Bir dosya yüklendi |
| `mkdir`, `mkfile` | Klasör / dosya oluşturuldu |
| `rename` | Yeniden adlandırıldı |
| `rm` | Silindi ya da çöpe taşındı |
| `restore` | Çöpten ya da sürüm geçmişinden geri getirildi (dosya yeniden oluştu) |
| `revert` | Dosya eski bir sürüme döndürüldü |
| `duplicate` | Çoğaltıldı |
| `copy`, `move` | Yapıştırıldı ya da sürükle-bırakla taşındı |
| `archive`, `extract` | Zip oluşturuldu / açıldı |
| `optimize` | Toplu görsel işleminde dosyalar yazıldı |

### Seçici modu

Bu prop'lardan `onSelect` verildiğinde bileşen seçici gibi davranır: alt çubukta "Seç" düğmesi çıkar, dosyaya çift tıklamak onu seçer. Modal bir seçici için [`useFilePicker`](#usefilepickeroptions) daha pratiktir.

| Prop | Tip | Açıklama |
|---|---|---|
| `onSelect` | `(entries: Entry[]) => void` | Seçilen dosyalarla çağrılır |
| `selectLabel` | `string` | Düğme metni |
| `onCancel` | `() => void` | Verilirse "Vazgeç" düğmesi görünür |
| `multiple` | `boolean` | Birden çok dosya seçilebilir (varsayılan `false`) |
| `accept` | `Accept` | Seçilebilecek dosyalar. Diğerleri görünür ama seçilemez. |

```ts
type Accept = string | string[] | ((entry: Entry) => boolean);
// "image/*"            MIME grubu
// ".pdf,.docx"         uzantılar
// ["image/png", ".svg"]
// (e) => e.size < 2_000_000
```

`matchesAccept(entry, accept)` aynı kuralı kendi kodunuzda uygulamak için dışa aktarılır. Klasörler hiçbir zaman eşleşmez.

---

## Dosya seçici

### `useFilePicker(options)`

```tsx
const picker = useFilePicker({ endpoint: "/api/files", accept: "image/*" });

<button disabled={picker.isOpen} onClick={async () => {
  const files = await picker.open();
  if (files) setCover(files[0].url);
}}>Görsel seç</button>
```

Döner: `{ open(overrides?), isOpen }`.

- `open` bir `Promise<PickedFile[] | null>` döner; kullanıcı vazgeçerse `null` gelir. `overrides` o açılış için seçenekleri değiştirir: `picker.open({ multiple: true })`.
- `isOpen` seçici açıkken `true` olur.
- Hook her render'da en son seçenekleri kullanır; seçenek nesnesini `useMemo` ile sarmanız gerekmez.

### `openFilePicker(options)`

React dışında (vanilla JS, Vue, zengin metin editörleri) aynı seçici. `<body>` sonuna bir `<dialog>` ekler, kapanınca kaldırır. React ve React DOM sayfada paketlenmiş olmalıdır.

```ts
import { openFilePicker } from "@thefinder/react";
import "@thefinder/react/styles.css";

const files = await openFilePicker({ endpoint: "/api/files", accept: ".pdf" });
if (files) input.value = files[0].url;
```

Sunucu tarafında (`document` yokken) hemen `null` döner.

### `FilePickerOptions`

`<TheFinder />` prop'larının hepsi (`onSelect`, `onCancel`, `height`, `style` hariç) ve şunlar:

| Seçenek | Varsayılan | Açıklama |
|---|---|---|
| `absoluteUrls` | `false` | `url` alanında tam adres (`https://site/uploads/a.png`) döner |
| `persistKey` | `"thefinder-picker"` | Seçicinin görünüm tercihleri ana dosya yöneticisinden ayrı saklanır |

Seçici `Escape` ile, arka plana tıklayarak ya da "Vazgeç" düğmesiyle kapanır. `Escape` önce açık menü ya da pencereleri kapatır.

### `PickedFile`

`Entry` ve ek olarak `url: string`. Volume'de `url` tanımlıysa bu adres (`"/uploads/a.png"`), değilse API'nin dosya adresi kullanılır. `pickedUrl(entry, client, absolute?)` aynı adresi kendi kodunuzda üretmek için dışa aktarılır.

---

## Özel editörler

`editors` prop'u, eşleşen dosyalar için "Birlikte aç" menüsüne bir öğe ekler. Editör, dosya yöneticisinin içinde tam ekran açılır.

```tsx
import type { CustomEditor } from "@thefinder/react";

const csvViewer: CustomEditor = {
  id: "csv",
  label: "Tablo olarak aç",
  match: (entry) => entry.name.toLowerCase().endsWith(".csv"),
  render: ({ entry, store, onClose }) => <CsvTable url={store.fileUrl(entry)} title={entry.name} onClose={onClose} />,
};

<TheFinder endpoint="/api/files" editors={[csvViewer]} />
```

| Alan | Açıklama |
|---|---|
| `id` | Benzersiz kimlik |
| `label` | Menüde görünen ad |
| `match(entry)` | Editörün bu dosya için sunulup sunulmayacağı |
| `render({ entry, store, onClose })` | Editör içeriği. `onClose` editörü kapatır. |

Editör içinden kullanışlı store üyeleri:

| Üye | Açıklama |
|---|---|
| `store.client` | Bağlı [`TheFinderClient`](client.md): `getContent`, `putContent`, `putBlob`… |
| `store.fileUrl(entry)` | Dosyanın adresi (volume `url`'i ya da API adresi) |
| `store.updateEntry(entry)` | Kaydettikten sonra listedeki boyut ve tarihi günceller |
| `store.toast(message, kind?)` | Bildirim; `kind`: `"info" \| "success" \| "error"` |
| `store.fail(error)` | Hatayı kullanıcıya uygun dilde bildirir |
| `store.refresh()` | Geçerli klasörü yeniden yükler |

Kaydetme örneği:

```tsx
const { entry: saved } = await store.client.putContent(entry.id, text);
store.updateEntry(saved);
store.toast("Kaydedildi", "success");
```

---

## Store ve hook'lar

Bileşen, `useSyncExternalStore` üzerine kurulu küçük bir store (`FinderStore`) kullanır. Store'a yalnızca `<TheFinder />` içinde render edilen bileşenlerden (örneğin özel editörler) erişilebilir.

| Dışa aktarım | Açıklama |
|---|---|
| `useFinder()` | Bağlam: `{ store, t, locale, editors, pickMode, multiple, … }`. `<TheFinder>` dışında çağrılırsa hata fırlatır. |
| `useStore(selector)` | Store'un bir dilimine abone olur: `const cwd = useStore((s) => s.cwd)`. Seçici, değişmeyen durum için aynı değeri dönmelidir. |
| `FinderStore` | Store sınıfı. Durumu `store.getState()`, değişiklikleri `store.subscribe(fn)` ile izlenir. |
| `FinderState` | Durum tipi: `cwd`, `selection`, `entries`, `volumes`, `uploads`, `clipboard`, `searchQuery`… |
| `FinderPrefs` | `Prefs` tipi |

Store metotları (`open`, `select`, `upload`, `paste`, `remove`…) arayüzün kendisi için yazılmıştır. Kullanılabilirler ama `0.x` boyunca imzaları değişebilir.

## i18n

| Dışa aktarım | Açıklama |
|---|---|
| `locales` | `{ en, tr }`: hazır mesaj paketleri |
| `Messages`, `MessageKey` | Mesaj tipi ve anahtarları |
| `createTranslator(locale, overrides?)` | `(key, vars?) => string`. `{name}` gibi yer tutucuları `vars` ile doldurur. |

Yeni bir dil eklemek için tüm anahtarları çevirip verin; eksik kalanlar İngilizce görünür:

```tsx
import { locales, type Messages } from "@thefinder/react";

const de: Partial<Messages> = { upload: "Hochladen", newFolder: "Neuer Ordner" /* ... */ };
<TheFinder endpoint="/api/files" locale="de" messages={de} />
```

Anahtarların tam listesi için `locales.en` nesnesine bakın.

## İkonlar

Arayüzün elle çizilmiş SVG ikonları kendi bileşenlerinizde de kullanılabilir:

| Bileşen | Prop'lar |
|---|---|
| `<FileIcon entry={…} size={48} />` | Dosya türüne göre renkli ikon (`entry`: `kind`, `name`, `mime` yeterli) |
| `<FolderIcon size={48} open={false} />` | Klasör |
| `<Icon name="upload" size={16} />` | Arayüz ikonları; diğer SVG prop'larını da alır |

## Tema

Tüm stiller `@layer thefinder` içindedir. Katman dışında yazdığınız her kural onları ezer, `!important` gerekmez. Kök öğe `.tf-root`'tur. `data-theme` (`light`, `dark`, `auto`), `data-skin` (`classic`, `macos`) ve `data-density` öznitelikleri taşır.

```css
.tf-root {
  --tf-accent: #0f766e;
  --tf-radius: 4px;
  --tf-font: "Inter", system-ui, sans-serif;
}
.tf-root[data-theme="dark"] {
  --tf-bg: #101418;
}
```

| Değişken | Açıklama |
|---|---|
| `--tf-font`, `--tf-mono` | Yazı tipleri |
| `--tf-accent` | Vurgu rengi (seçim, birincil düğme, odak) |
| `--tf-accent-text` | Vurgu dolgusu üzerindeki metin |
| `--tf-accent-ink` | Nötr zemin üzerindeki vurgu metni (bağlantılar); kontrast için ayrı tutulur |
| `--tf-accent-soft`, `--tf-accent-line` | Vurgunun açık dolgu ve çizgi tonları (varsayılan olarak `--tf-accent`'ten türetilir) |
| `--tf-bg`, `--tf-surface`, `--tf-chrome`, `--tf-field` | Arka plan, paneller, üst/alt çubuklar, giriş alanları |
| `--tf-line`, `--tf-line-strong` | Çizgiler |
| `--tf-text`, `--tf-text-2`, `--tf-text-3` | Metin, ikincil metin, soluk metin |
| `--tf-hover`, `--tf-press`, `--tf-sel`, `--tf-sel-muted` | Üzerine gelme, basma, seçim, odak dışı seçim |
| `--tf-danger`, `--tf-success`, `--tf-warn` | Durum renkleri |
| `--tf-folder-back`, `--tf-folder-front`, `--tf-page`, `--tf-page-line` | Klasör ve dosya ikonları |
| `--tf-code-bg`, `--tf-code-active` | Kod editörü zemini ve aktif satır |
| `--tf-toast-bg`, `--tf-toast-text` | Bildirimler |
| `--tf-backdrop`, `--tf-shadow-pop`, `--tf-shadow-dialog` | Modal arka planı ve gölgeler |
| `--tf-radius`, `--tf-radius-lg` | Köşe yuvarlaklığı |
| `--tf-header-h`, `--tf-toolbar-h`, `--tf-status-h`, `--tf-details-w` | Çubuk yükseklikleri ve ayrıntılar paneli genişliği |
| `--tk-*` | Kod editörü sözdizimi renkleri (`--tk-kw`, `--tk-str`, `--tk-com`, `--tk-num`, `--tk-fn`, `--tk-type`, `--tk-prop`…) |

Sınıfların hepsi `tf-` öneklidir. Değişken dışındaki sınıflar iç yapıdır ve küçük sürümlerde değişebilir.

## Yeniden dışa aktarımlar

`createClient`, `TheFinderClient`, `ApiError`, `encodeId` ve `Entry`, `VolumeInfo` tipleri `@thefinder/core/client`'tan aynen gelir.
