# Standalone Scripts

Bu klasördeki scriptler, mevcut bir hesapta belirli veri türlerini oluşturmanıza olanak tanır. Her script bağımsız çalışır ve sadece email/password ile login yaparak CSV dosyalarından veri oluşturur.

## Genel Kullanım

Tüm scriptler aynı komut satırı formatını kullanır:

```bash
npm run script:<script-name> -- --email <email> --password <password> --csv <csv-dosya-yolu> [options]
```

### Gerekli Parametreler

- `--email` veya `-e`: Hesap email adresi
- `--password` veya `-p`: Hesap şifresi
- `--csv` veya `-c`: CSV dosyasının yolu

### Opsiyonel Parametreler

- `--env <environment>`: Ortam seçimi (`testing` veya `production`, varsayılan: `testing`)
- `--language` veya `-l`: Dil (`en` veya `de`, varsayılan: `en`)
- `--help` veya `-h`: Yardım mesajını göster

## Mevcut Scriptler

### 1. User/Employee Oluşturma

**Script:** `create-users.ts`
**Komut:** `npm run script:users`

Employees (çalışanlar) ve kullanıcı hesaplarını CSV dosyalarından oluşturur.

**Gerekli CSV Dosyaları:**
- `employees.csv` (zorunlu)
- `offices.csv` (zorunlu - ofis lokasyonları için)
- `employee-details.csv` (opsiyonel)
- `employee-contracts.csv` (opsiyonel)
- `employee-salaries.csv` (opsiyonel)

**Örnek:**
```bash
npm run script:users -- \
  --email admin@example.com \
  --password mypassword \
  --csv ./data/manufacturing-en/employees.csv

# Production ortamında
npm run script:users -- \
  -e admin@example.com \
  -p mypassword \
  -c ./data/manufacturing-en/employees.csv \
  --env production
```

**Not:** Tüm CSV dosyaları aynı klasörde olmalıdır. Script otomatik olarak `employee-details.csv`, `employee-contracts.csv`, vb. dosyalarını aynı klasörde arayacaktır.

---

### 2. Proje Oluşturma

**Script:** `create-projects.ts`
**Komut:** `npm run script:projects`

Projeleri, milestone'ları ve work package'ları CSV dosyalarından oluşturur.

**Gerekli CSV Dosyaları:**
- `projects.csv` (zorunlu)
- `milestones.csv` (opsiyonel)
- `work-packages.csv` (opsiyonel)

**Örnek:**
```bash
npm run script:projects -- \
  --email admin@example.com \
  --password mypassword \
  --csv ./data/manufacturing-en/projects.csv
```

**Not:** Eğer projelere employee atamak istiyorsanız, önce `create-users` scriptini çalıştırmalısınız.

---

### 3. Departman ve Team Oluşturma

**Script:** `create-departments-teams.ts`
**Komut:** `npm run script:departments`

Organizasyon yapısını (departmanlar ve teamler) oluşturur.

**Gerekli CSV Dosyaları:**
- `departments.csv` (zorunlu)
- `teams.csv` (opsiyonel)
- `c-level.csv` (opsiyonel - C-level yönetici atamaları için)

**Örnek:**
```bash
npm run script:departments -- \
  --email admin@example.com \
  --password mypassword \
  --csv ./data/manufacturing-en/departments.csv
```

**Önkoşul:** Bu script çalıştırılmadan önce `create-users` scriptinin çalıştırılması gerekir, çünkü departman liderleri employee verilerinden alınır.

---

### 4. Task Oluşturma

**Script:** `create-tasks.ts`
**Komut:** `npm run script:tasks`

Task management sistemini kurar ve taskleri oluşturur.

**Gerekli CSV Dosyaları:**
- `tasks.csv` (zorunlu)

**Örnek:**
```bash
npm run script:tasks -- \
  --email admin@example.com \
  --password mypassword \
  --csv ./data/manufacturing-en/tasks.csv \
  --language en
```

**Önkoşullar:**
1. Önce `create-projects` scriptini çalıştırın (projeler olmalı)
2. Eğer tasklara employee atamak istiyorsanız, `create-users` scriptini de çalıştırın

---

### 5. Contractor Oluşturma

**Script:** `create-contractors.ts`
**Komut:** `npm run script:contractors`

External contractor'ları (dış yükleniciler) oluşturur ve projelere atar.

**Gerekli CSV Dosyaları:**
- `contractors.csv` (zorunlu)

**Örnek:**
```bash
npm run script:contractors -- \
  --email admin@example.com \
  --password mypassword \
  --csv ./data/contractors.csv
```

**Not:** Eğer contractor'ları projelere atamak istiyorsanız, önce `create-projects` scriptini çalıştırmalısınız. Aksi takdirde sadece contractor'lar oluşturulur, ataması yapılmaz.

---

### 6. Office/Location Oluşturma

**Script:** `create-offices.ts`
**Komut:** `npm run script:offices`

Ofis lokasyonlarını oluşturur.

**Gerekli CSV Dosyaları:**
- `offices.csv` (zorunlu)

**Örnek:**
```bash
npm run script:offices -- \
  --email admin@example.com \
  --password mypassword \
  --csv ./data/manufacturing-en/offices.csv
```

**Not:** Bu scripti `create-users` scriptinden önce çalıştırmanız önerilir, çünkü employeeler ofislere atanır.

---

## Önerilen Çalıştırma Sırası

Sıfırdan bir hesap kuruyorsanız, scriptleri şu sırada çalıştırmanız önerilir:

1. **Office'leri oluştur** (employeeler ofislere atanacak)
   ```bash
   npm run script:offices -- -e admin@example.com -p pass -c ./data/manufacturing-en/offices.csv
   ```

2. **User/Employee'leri oluştur**
   ```bash
   npm run script:users -- -e admin@example.com -p pass -c ./data/manufacturing-en/employees.csv
   ```

3. **Departman ve Team'leri oluştur**
   ```bash
   npm run script:departments -- -e admin@example.com -p pass -c ./data/manufacturing-en/departments.csv
   ```

4. **Contractor'ları oluştur** (opsiyonel)
   ```bash
   npm run script:contractors -- -e admin@example.com -p pass -c ./data/contractors.csv
   ```

5. **Projeleri oluştur**
   ```bash
   npm run script:projects -- -e admin@example.com -p pass -c ./data/manufacturing-en/projects.csv
   ```

6. **Task'ları oluştur**
   ```bash
   npm run script:tasks -- -e admin@example.com -p pass -c ./data/manufacturing-en/tasks.csv
   ```

---

## Hata Ayıklama

### Cache Sorunları

Scriptler `data/cache/` klasörünü kullanır. Eğer problemlerle karşılaşırsanız, cache'i temizleyebilirsiniz:

```bash
rm -rf data/cache/*.json
```

### Log'ları İnceleme

Tüm scriptler detaylı log çıktısı verir. Hataları görmek için çıktıyı dikkatlice inceleyin.

### Environment Sorunları

`.env` dosyanızın doğru yapılandırıldığından emin olun:

```env
# Testing Environment
TESTING_EMAIL=your-testing-email@example.com
TESTING_PASSWORD=your-testing-password

# Production Environment (opsiyonel)
PROD_EMAIL=your-prod-email@example.com
PROD_PASSWORD=your-prod-password

# Company Creation Token
COMPANY_CREATION_TOKEN=your-jwt-token
```

---

## CSV Dosya Formatları

Her script, demo creator'ın ana workflow'unda kullanılan aynı CSV formatlarını kullanır. CSV örnekleri için `data/` klasörüne bakabilirsiniz:

- `data/manufacturing-en/` - Manufacturing industry (İngilizce)
- `data/manufacturing-de/` - Manufacturing industry (Almanca)
- `data/healthcare-en/` - Healthcare industry (İngilizce)
- Ve diğer industry klasörleri...

---

## Teknik Detaylar

### Base Script Utilities

Tüm scriptler `base-script.ts` modülünü kullanır. Bu modül şunları sağlar:

- **Argument Parsing:** Komut satırı argümanlarını parse eder
- **Authentication:** Email/password ile login yapar
- **API Client Creation:** Tüm gerekli API client'ları oluşturur
- **Organization ID Fetching:** Organizasyon ID'sini otomatik olarak alır
- **Error Handling:** Hataları yakalar ve kullanıcı dostu mesajlar gösterir

### ScriptContext

Her script çalıştığında bir `ScriptContext` nesnesi oluşturulur:

```typescript
interface ScriptContext {
  email: string;
  password: string;
  environment: Environment;
  envConfig: EnvironmentConfig;
  bearerToken: string;
  organizationId: string;
  partnerId: string;
  language: string;
  csvPath: string;
  authService: AuthService;
  apiClient: ApiClient;
  hrApiClient: ApiClient;
  taskManagementApiClient: ApiClient;
  imsCustomersApiClient: ApiClient;
}
```

Bu context, scriptlerin mevcut operation'ları kullanmasını sağlar.

---

## Katkıda Bulunma

Yeni scriptler eklemek için:

1. `scripts/standalone/` klasöründe yeni bir TypeScript dosyası oluşturun
2. `base-script.ts` modülünü kullanın
3. İlgili operation'ları import edin ve kullanın
4. `package.json`'a yeni bir npm script ekleyin
5. Bu README'ye dokümantasyon ekleyin

---

## Lisans

Bu scriptler Demo Creator projesinin bir parçasıdır ve aynı lisans altındadır.
