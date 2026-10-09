# ciFinder API referansı

Bu klasör her paketin dışa açtığı API'yi tek tek anlatır. Kurulum ve genel kullanım için kök [README](../../README.md)'ye bakın.

| Belge | İçerik |
|---|---|
| [protocol.md](protocol.md) | HTTP protokolü: istek biçimi, tüm komutlar, parametreler, yanıtlar, hata kodları |
| [core.md](core.md) | `@ci-finder/core`: motor, seçenekler, sürücüler, adaptörler, dosya sunucusu, sharp, yardımcılar, tipler |
| [client.md](client.md) | `@ci-finder/core/client`: tarayıcı ve sunucu için API istemcisi |
| [next.md](next.md) | `@ci-finder/next`: route'lar ve proje kökü tespiti |
| [react.md](react.md) | `@ci-finder/react`: `<CiFinder />`, dosya seçici, özel editörler, store, i18n, tema değişkenleri |
| [ckeditor.md](ckeditor.md) | `@ci-finder/ckeditor`: CKEditor 5 eklentisi ve CKEditor 4 connector'ı |

## Temel kavramlar

- **Volume:** Bir depolama kökü. Her volume bir sürücüye (`localDriver`, `s3Driver` ya da kendi sürücünüz) bağlıdır. Birden çok volume aynı anda kullanılabilir.
- **Volume yolu:** Volume içinde `/` ile başlayan, normalize edilmiş POSIX yolu: `/`, `/belgeler/rapor.pdf`. `..` içeren yollar çözülmeye çalışılmaz, reddedilir.
- **Kimlik (id):** `<volume>_<base64url(yol)>`, örneğin `files_L2RvY3MvYS50eHQ` (`files` volume'ünde `/docs/a.txt`). Kimlikler kalıcıdır, URL'de güvenle kullanılır ve geri çözülebilir: `encodeId` / `decodeId`.
- **Entry:** Bir dosya ya da klasörün API'deki temsili. Alanları için [core.md › Entry](core.md#entry) bölümüne bakın.
- **Gizli iç klasörler:** `.cf-trash` (çöp kutusu), `.cf-versions` (sürüm geçmişi) ve `.cf-thumbs` (küçük resim önbelleği). Hiçbir komutla, aramayla ya da dosya sunucusuyla erişilemezler; bu adlarla öğe de oluşturulamaz.

## Sürümler

Dört paket her zaman aynı sürüm numarasıyla yayımlanır. `0.x` boyunca küçük sürümler (`0.1` → `0.2`) kırıcı değişiklik içerebilir; değişiklikler her paketin `CHANGELOG.md` dosyasında listelenir.
