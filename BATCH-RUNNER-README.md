# Batch Runner - Birden Fazla Demo'yu Arka Arkaya Çalıştırma

Bu araç, birden fazla demo account'u arka arkaya otomatik olarak oluşturmanıza olanak tanır.

## Kullanım

### 1. Batch Konfigürasyon Dosyasını Düzenleyin

`batch-config.json` dosyasını düzenleyerek oluşturmak istediğiniz tüm demo'ları tanımlayın:

```json
[
  {
    "name": "Demo 1",
    "email": "demo1@example.com",
    "password": "demo1pass",
    "organizationName": "Demo Organization 1",
    "language": "en",
    "csvPath": "./data/sff-data-en"
  },
  {
    "name": "Demo 2",
    "email": "demo2@example.com",
    "password": "demo2pass",
    "organizationName": "Demo Organization 2",
    "language": "de",
    "csvPath": "./data/sff-data-de"
  }
]
```

### 2. Batch Runner'ı Çalıştırın

```bash
npm run batch
```

## Konfigürasyon Alanları

Her demo objesi şu alanları içermelidir:

| Alan | Tip | Açıklama | Zorunlu |
|------|-----|----------|---------|
| `name` | string | Demo'nun adı (loglarda görünür) | Evet |
| `email` | string | Kayıt için email adresi | Evet |
| `password` | string | Hesap şifresi | Evet |
| `organizationName` | string | Organizasyon adı | Evet |
| `language` | `"en"` \| `"de"` | Dil seçimi | Evet |
| `csvPath` | string | CSV data dosyalarının yolu | Hayır |
| `selectedSteps` | string[] | Çalıştırılacak belirli adımlar | Hayır |

## Özellikler

- ✅ **Sıralı Çalıştırma**: Demo'lar arka arkaya çalıştırılır
- ✅ **Hata Yönetimi**: Bir demo başarısız olsa bile diğerleri çalışmaya devam eder
- ✅ **İlerleme Takibi**: Her demo'nun ilerlemesi console'a yazdırılır
- ✅ **Detaylı Rapor**: Tüm sonuçlar `batch-results.json` dosyasına kaydedilir
- ✅ **Süre Takibi**: Her demo'nun ne kadar sürdüğü gösterilir
- ✅ **Stabilizasyon Bekleme**: Demo'lar arası 5 saniye bekleme süresi

## Örnek Çıktı

```
==========================================================
           BATCH DEMO CREATOR
==========================================================

Loaded 3 demo configurations from batch-config.json

----------------------------------------------------------
[1/3] Starting: Demo 1
----------------------------------------------------------
Email: demo1@example.com
Organization: Demo Organization 1
Language: en
CSV Path: ./data/sff-data-en
----------------------------------------------------------

[Demo 1] Account Registration: Creating account...
[Demo 1] Email Activation: Activating email...
...
----------------------------------------------------------
[1/3] ✓ SUCCESS: Demo 1
Duration: 5m 30s
----------------------------------------------------------

Waiting 5 seconds before starting next demo...

----------------------------------------------------------
[2/3] Starting: Demo 2
----------------------------------------------------------
...

==========================================================
           BATCH EXECUTION SUMMARY
==========================================================

Total demos: 3
✓ Successful: 2
✗ Failed: 1

Detailed Results:

  1. ✓ Demo 1 (5m 30s)
  2. ✓ Demo 2 (6m 15s)
  3. ✗ Demo 3 (2m 45s)
     Error: Email already exists

==========================================================

Results saved to: /path/to/batch-results.json
```

## Sonuçlar Dosyası

Tüm sonuçlar `batch-results.json` dosyasına JSON formatında kaydedilir:

```json
[
  {
    "name": "Demo 1",
    "status": "success",
    "duration": 330000
  },
  {
    "name": "Demo 2",
    "status": "success",
    "duration": 375000
  },
  {
    "name": "Demo 3",
    "status": "failed",
    "error": "Email already exists",
    "duration": 165000
  }
]
```

## İpuçları

### Çok Sayıda Demo İçin

10'dan fazla demo çalıştıracaksanız:

1. Daha uzun bekleme süreleri ekleyin (batch-runner.ts'de `5000`'i `10000` yapın)
2. Redis ve diğer servislerin kaynak limitlerini kontrol edin
3. Her demo'yu farklı email ve organization name ile oluşturun

### Sadece Belirli Adımları Çalıştırmak

```json
{
  "name": "Test Demo",
  "email": "test@example.com",
  "password": "testpass",
  "organizationName": "Test Org",
  "language": "en",
  "selectedSteps": ["account-registration", "email-activation"]
}
```

### Parallel Çalıştırma (Gelişmiş)

Eğer sistemleriniz yeterliyse, birden fazla batch-runner'ı farklı config dosyalarıyla parallel çalıştırabilirsiniz:

```bash
# Terminal 1
npm run batch

# Terminal 2
BATCH_CONFIG=batch-config-2.json npm run batch
```

## Sorun Giderme

### "batch-config.json not found" Hatası

Projenin root dizininde `batch-config.json` dosyasının olduğundan emin olun.

### Tüm Demo'lar Başarısız Oluyor

1. İnternet bağlantınızı kontrol edin
2. Redis'in çalıştığından emin olun
3. API endpoint'lerinin erişilebilir olduğunu kontrol edin

### Bir Demo Çok Uzun Sürüyor

- Task management setup sırasında 30 saniye bekleme süresi var
- Board'ların oluşması için 10 saniye ek bekleme var
- Normal süre: Her demo için ~5-10 dakika

## Lisans

Bu araç UNLICENSED'dır ve sadece internal kullanım içindir.
