# Kurulum ve Hybrid Çalıştırma (BTP trial)

Hedef: uygulama **lokalde** çalışır, kimlik doğrulama **gerçek XSUAA** üzerinden yapılır, AI çağrısı **BTP Destination** üzerinden gider.

## 0. Ön koşullar (bir kez)

1. `node -v` → **22 veya üstü** olmalı (approuter 23.x bunu istiyor). Değilse nodejs.org'dan LTS kur.
2. `npm i -g @sap/cds-dk` (zaten kurulu)
3. Cloud Foundry CLI v8: https://github.com/cloudfoundry/cli/releases → Windows installer. Kontrol: `cf --version`
4. Proje kökünde:
   ```
   npm install
   npm install --prefix approuter
   ```

## 1. BTP trial hesabı

1. https://account.hanatrial.ondemand.com → **Go To Your Trial Account**
2. Subaccount **trial** → *Overview* sayfasında **Cloud Foundry Environment** etkin olmalı (org + `dev` space). Değilse *Enable Cloud Foundry* → *Create Space* (`dev`).
3. Aynı sayfadaki **API Endpoint** adresini kopyala (örn. `https://api.cf.us10-001.hana.ondemand.com`).

## 2. CF'e giriş

```
cf login -a <API Endpoint>
```
E-posta + parola sorar; org ve space'i seç. (Şirket/SSO hesabıysa: `cf login -a <API Endpoint> --sso`)

## 3. XSUAA servisi

Proje kökünde (`xs-security.json` burada):
```
cf create-service xsuaa application supplier-xsuaa -c xs-security.json
cf create-service-key supplier-xsuaa supplier-xsuaa-key
cds bind -2 supplier-xsuaa
```
- `xs-security.json`: tek scope `Approval`, role template `Approval`, role collection `SupplierApprover`, ve `http://localhost:5000/**` redirect izni (lokal login dönüşü için şart).
- `cds bind` bağlantı bilgisini `.cdsrc-private.json`'a yazar (gizli değil ama gitignore'da, commit edilmez).
- `xs-security.json`'ı sonradan değiştirirsen: `cf update-service supplier-xsuaa -c xs-security.json`

## 4. Destination servisi + OpenRouter destination'ı

```
cf create-service destination lite supplier-destination
cf create-service-key supplier-destination supplier-destination-key
cds bind -2 supplier-destination
```

Cockpit → Subaccount **trial** → **Connectivity → Destinations → Create Destination**:

| Alan | Değer |
|---|---|
| Name | `openrouter-api` |
| Type | HTTP |
| URL | `https://openrouter.ai/api/v1` |
| Proxy Type | Internet |
| Authentication | NoAuthentication |
| Additional Properties → New Property | `URL.headers.Authorization` = `Bearer sk-or-v1-...` (OpenRouter key'in) |

Kaydet. (*Check Connection* 404/401 gösterebilir, normal: kök adreste bir sayfa yok.)

Uygulama yalnızca `openrouter-api` adını bilir (`package.json → cds.requires.openrouter.credentials.destination`). Adres ve anahtar sadece BTP'de durur.

**Model:** `package.json → cds.requires.openrouter.llmModel` (varsayılan `openai/gpt-4o-mini`, çağrı başı kuruşun altında; OpenRouter hesabına birkaç dolar kredi gerekir). Ücretsiz istersen https://openrouter.ai/models?max_price=0 sayfasından `:free` ile biten bir model seç ve buraya yaz (günlük limitleri var).

## 5. Çalıştır

İki terminal, proje kökünde:
```
npm run watch:hybrid      # CAP :4004  (cds watch --profile hybrid)
npm run router:hybrid     # approuter :5000  (cds bind --exec ... npm start --prefix approuter)
```
Tarayıcı: **http://localhost:5000** → BTP login → launchpad.

Demo verisi istersen (üçüncü terminal): `npm run seed` → 4 başvuru, hepsinin parolası `Demo!2026`.

> Veritabanı bellekte (SQLite in-memory). CAP her yeniden başladığında (bir `srv/` veya `db/` dosyasını kaydettiğinde) veriler sıfırlanır → `npm run seed` tekrar.

## 6. Rol atama (videoda "önce yetkisiz, sonra yetkili" göstermek için)

1. **Önce rol atamadan** http://localhost:5000 → *Tedarikçi Onayları* tile'ı → **403 / uygulama açılamıyor**. (Videodaki senaryo bu.)
2. Cockpit → Subaccount → **Security → Role Collections → SupplierApprover → Edit → Users**: kendi e-postanı ekle (Identity Provider: Default identity provider) → Save.
3. **http://localhost:5000/do/logout** → tekrar giriş. (Yeni rol ancak yeni token ile gelir; çıkış yapmadan değişmez.)
4. Tile artık açılır.

## 7. Dil testi

Chrome → Ayarlar → Diller → *Türkçe*'yi veya *English*'i en üste taşı → sayfayı yenile. Arayüz ve backend hata mesajları birlikte değişir.

## Sorun giderme

| Belirti | Sebep / çözüm |
|---|---|
| Login sonrası `redirect_uri` hatası | `xs-security.json`'daki `redirect-uris` → `cf update-service ...` |
| `npm run router:hybrid` "No XSUAA" | `cds bind -2 supplier-xsuaa` yapılmamış / yanlış klasördesin |
| AI: "AI analizi şu anda yapılamıyor" | Destination adı/URL/`URL.headers.Authorization` yanlış, kredi yok veya model adı geçersiz. Terminal 1'deki `[ai]` log satırına bak |
| Onaylar 403 rol atadıktan sonra da | `/do/logout` ile çık, tekrar gir |
| Yükleme sırasında 403 `SESSION_*` | Tedarikçi oturumu düştü (CAP yeniden başladı) → tekrar giriş |
