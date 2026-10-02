# Video Akışı (~10-12 dk)

Hazırlık: iki terminal açık (`watch:hybrid`, `router:hybrid`), `npm run seed` çalıştırılmış, **rol henüz atanmamış**, tarayıcı dili Türkçe. Gerekli dosyalar `test/files/` içinde.

## 1. Mimari (1,5 dk) — VS Code'da `readme.md` diyagramı açık

- Tek CAP backend, tek OData V4 servisi (`SupplierService`), iki UI5 freestyle uygulama, lokal Fiori launchpad.
- Kullanıcı her zaman approuter'a (:5000) girer. `xs-app.json`'da rota **sırası**: önce dar public tedarikçi uçları (`none`), sonra her şeyi yakalayan `xsuaa + Approval` rotası. Listede olmayan her şey otomatik korumalı.
- Aynı kural CAP'te ikinci kez: `@requires: 'any'` / `@restrict ... to: 'Approval'` (`srv/supplier-service.cds`).
- Tedarikçi BTP kullanıcısı değil: bcrypt hash + oturum token'ı (DB'de sadece SHA-256 hash'i).
- AI: uygulama sadece destination adını bilir (`openrouter-api`); timeout, retry, JSON çıktı doğrulama.

## 2. Tedarikçi tarafı (4 dk) — launchpad → *Tedarikçi Portalı*

1. Header'da BTP kullanıcısı (sağ üst avatar) → XSUAA kullanıcısı launchpad'de görünüyor.
2. **Yanlış giriş**: `yok@test.com` / `Yanlis!123` → "E-posta veya parola hatalı." (bilinmeyen e-posta ile yanlış parola aynı mesaj — hesap tahmin edilemez).
3. Kayıt ol → parolayı yavaş yaz: kurallar tek tek **yeşile** döner; göz simgesiyle göster/gizle.
4. **Aynı e-posta ile ikinci kayıt**: seed e-postası `info@anadolu-elektronik.example` → "Bu e-posta adresiyle kayıtlı bir hesap zaten var."
5. Yeni e-postayla kayıt → otomatik giriş, form açılır.
6. **Boş form gönder** → zorunlu alanlar (`*`) kırmızı + mesaj.
7. **PDF olmayan dosya**: `test/files/image.png` veya `not-a-pdf.txt` → hata. (Windows dosya penceresi sadece PDF gösterir; sağ alttan *Tüm dosyalar* seç.)
8. **10 MB üstü**: `too-large-11mb.pdf` → hata. (Kurallar dosya seçilmeden önce bilgi kutusunda yazıyor.)
9. Formu doldur, `valid-certificate.pdf` → Gönder → form kaybolur, **process flow** görünür (Gönderildi).
10. Çıkış yap → tekrar giriş → yine yalnızca akış görünür, form yok.
11. *(Ekstra, 30 sn)* `test/requests.http`: UI'ı atlayıp doğrudan API'ye boş form / `.txt` / yeniden adlandırılmış PNG / 11 MB gönder → backend hepsini reddediyor. "Kontroller sadece arayüzde değil."

## 3. Onaycı tarafı (4 dk)

1. Launchpad → *Tedarikçi Onayları* → **rol yok → 403**. (Senaryo: rol atanmadan önce giriş denemesi.)
2. Cockpit → Role Collection `SupplierApprover` → kullanıcıyı ekle → `localhost:5000/do/logout` → tekrar giriş → uygulama açılır.
3. Tablo: 5 sütun, sekmeler (Tüm / Bekleyen / Onaylanan / Reddedilen) ve sayıları, arama (`kuzey`), "Filtreyi temizle" butonunun sadece filtre varken görünmesi.
4. Ayarlar: kategori filtresi, sıralama, sütunlar sekmesinden Telefon/Ülke/Kategori aç.
5. Bir satıra tıkla → detay; durum otomatik **İncelemede**. Sertifika linki PDF'i açar.
6. **Yorumsuz Reddet** → TextArea kırmızı, ret engellenir. Yorum + revize alanı seç (Sertifika) → Reddet → akış güncellenir.
7. Başka başvuru → **AI ile Analiz Et**:
   - `Anadolu Elektronik` (geçerli ISO sertifikası) → büyük ihtimalle onay
   - `Kuzey Yazılım` (2019'da süresi dolmuş) veya `Bremen Consulting` (yemek menüsü) → ret + gerekçe otomatik ret yorumu olur
8. Portal'a dön (reddedilen tedarikçi): gerekçe görünür → **Tekrar Başvur** → eski veriler dolu ve salt okunur, sadece sertifika aktif → yeni PDF → gönder → akış yine "Gönderildi".

## 4. Dil (30 sn)

Chrome dilini English yap → yenile → launchpad, iki uygulama ve backend hata mesajları İngilizce. Geri Türkçe.

## Kapanış (15 sn)

"Validasyonlar hem frontend hem backend'de; yetki hem approuter hem CAP seviyesinde; AI çağrısı timeout, retry ve çıktı doğrulamasıyla. Teşekkürler."
