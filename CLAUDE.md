# ClaudeCodeIDE - Frame Project

Bu proje **Frame** ile yönetilmektedir. Aşağıdaki kurallara uyarak dökümanları güncel tut.

---

## ⚡ IMPORTANT: Token Efficiency Protocol

**Before scanning any code, ALWAYS read these files first:**

1. **STRUCTURE.json** - Contains the complete codebase map with modules, files, functions, and their relationships
2. **tasks.json** - Current tasks and their status

**Workflow:**
1. Read STRUCTURE.json to understand where relevant code is located
2. Based on the task, identify which specific files you need to read
3. Read ONLY those files - do NOT scan the entire codebase
4. After making changes, update STRUCTURE.json if you added/removed/modified functions or files

**Example:** If task is "fix bug in task panel", look at STRUCTURE.json → find `renderer/tasksPanel` module → read only that file.

---

## Task Yönetimi (tasks.json)

### Task Tanıma Kuralları

**Bunlar TASK'tır - tasks.json'a ekle:**
- Kullanıcı bir özellik veya değişiklik istediğinde
- "Şunu yapalım", "Şunu ekleyelim", "Bunu geliştir" gibi kararlar
- "Bunu sonra yaparız", "Şimdilik bırakalım" dediğimiz ertelenmiş işler
- Kod yazarken keşfedilen eksiklikler veya iyileştirme fırsatları
- Bug fix gerektiren durumlar

**Bunlar TASK DEĞİLDİR:**
- Hata mesajları ve debugging oturumları
- Sorular, açıklamalar, bilgi alışverişi
- Geçici denemeler ve testler
- Zaten tamamlanmış ve kapatılmış işler
- Anlık düzeltmeler (typo fix gibi)

### Task Oluşturma Akışı

1. Konuşma sırasında task pattern'i algıla
2. Uygun bir anda kullanıcıya sor: "Bu konuşmadan şu taskları çıkardım, tasks.json'a ekleyeyim mi?"
3. Kullanıcı onaylarsa tasks.json'a ekle

### Task Yapısı

```json
{
  "id": "unique-id",
  "title": "Kısa ve net başlık (max 60 karakter)",
  "description": "Claude'un detaylı açıklaması - ne yapılacak, nasıl yapılacak, hangi dosyalar etkilenecek",
  "userRequest": "Kullanıcının orijinal isteği/promptu - aynen kopyala",
  "acceptanceCriteria": "Bu task ne zaman tamamlanmış sayılır? Somut kriterler listesi",
  "notes": "Tartışma sırasında çıkan önemli notlar, kararlar, alternatifler",
  "status": "pending | in_progress | completed",
  "priority": "high | medium | low",
  "category": "feature | fix | refactor | docs | test",
  "context": "Session tarihi ve bağlam",
  "createdAt": "ISO date",
  "updatedAt": "ISO date",
  "completedAt": "ISO date | null"
}
```

### Task İçerik Kuralları

**title:** Kısa, aksiyona yönelik başlık
- ✅ "Add tasks button to terminal toolbar"
- ❌ "Tasks"

**description:** Claude'un detaylı teknik açıklaması
- Ne yapılacak (what)
- Nasıl yapılacak (how) - kısa teknik yaklaşım
- Hangi dosyalar etkilenecek
- Minimum 2-3 cümle

**userRequest:** Kullanıcının orijinal sözleri
- Kullanıcının promptunu/isteğini aynen kopyala
- Bağlamı korumak için önemli
- "Kullanıcı dedi ki: ..." formatında

**acceptanceCriteria:** Bitiş kriterleri
- Somut, test edilebilir maddeler
- "Bu olduğunda task tamamdır" listesi

**notes:** Tartışma notları (opsiyonel)
- Değerlendirilen alternatifler
- Önemli kararlar ve nedenleri
- "Sonra yaparız" denen bağımlılıklar

### Task Durum Güncellemeleri

- Bir task üzerinde çalışmaya başladığında: `status: "in_progress"`
- Task tamamlandığında: `status: "completed"`, `completedAt` güncelle
- Commit sonrası: İlgili taskların durumunu kontrol et ve güncelle

---

## PROJECT_NOTES.md Kuralları

### Ne Zaman Güncelle?
- Önemli bir mimari karar alındığında
- Teknoloji seçimi yapıldığında
- Önemli bir problem çözüldüğünde ve çözüm yöntemi kayda değer olduğunda
- Kullanıcıyla birlikte bir yaklaşım belirlendiğinde

### Format
```markdown
## [Tarih] Karar/Not Başlığı

**Bağlam:** Neden bu karara ihtiyaç duyuldu?
**Karar:** Ne karar verildi?
**Alternatifler:** Değerlendirilen diğer seçenekler (varsa)
**Sonuç:** Bu kararın etkileri
```

### Güncelleme Akışı
- Karar alındıktan hemen sonra güncelle
- Kullanıcıya sormadan ekleyebilirsin (önemli kararlar için)
- Küçük kararları biriktirip toplu ekleyebilirsin

---

## 📝 Context Preservation (Otomatik Not Alma)

Frame'in temel amacı context kaybını önlemek. Bu yüzden önemli anları yakala ve kullanıcıya sor.

### Ne Zaman Sorulmalı?

Aşağıdaki durumlardan biri gerçekleştiğinde kullanıcıya sor: **"Bu konuşmayı PROJECT_NOTES.md'ye ekleyeyim mi?"**

- Bir task başarıyla tamamlandığında
- Önemli bir mimari/teknik karar alındığında
- Bir bug çözüldüğünde ve çözüm yöntemi kayda değer olduğunda
- "Bunu sonra yapalım" denildiğinde (bu durumda tasks.json'a da ekle)
- Yeni bir pattern veya best practice keşfedildiğinde

### Tamamlanma Algılama

Şu sinyallere dikkat et:
- Kullanıcı onayı: "tamam", "oldu", "çalıştı", "güzel", "düzeldi", "evet"
- Bir konuyu bitirip başka konuya geçilmesi
- Build/run başarılı olduktan sonra kullanıcının devam etmesi

### Nasıl Eklenmeli?

1. **Özet YAZMA** - Konuşmayı olduğu gibi, context'iyle birlikte ekle
2. **Tarih ekle** - `### [YYYY-MM-DD] Başlık` formatında
3. **Session Notes bölümüne ekle** - PROJECT_NOTES.md'nin sonunda

### Ne Zaman SORMA

- Her küçük değişiklikte (spam olur)
- Typo fix, basit düzeltmeler
- Kullanıcı zaten "hayır" veya "gerek yok" demişse o session'da aynı konu için tekrar sorma

### Kullanıcı "Hayır" Derse

Sorun yok, devam et. Kullanıcı önemli gördüğü şeyleri kendisi de söyleyebilir: "bunu notlara ekle"

---

## STRUCTURE.json Kuralları

**Bu dosya codebase'in haritasıdır. Token tasarrufu için kritik öneme sahiptir.**

### Ne Zaman Güncelle?
- Yeni dosya/klasör oluşturulduğunda
- Dosya/klasör silindiğinde veya taşındığında
- Yeni fonksiyon/method eklendiğinde veya silindiğinde
- Fonksiyon imzası (parametreler, return type) değiştiğinde
- Modül bağımlılıkları değiştiğinde
- IPC channel eklendiğinde veya değiştiğinde

### Format (Detaylı)
```json
{
  "lastUpdated": "ISO date",
  "overview": "Proje açıklaması",
  "architecture": {
    "pattern": "Electron (main + renderer)",
    "entryPoints": {
      "main": "src/main/index.js",
      "renderer": "src/renderer/index.js"
    }
  },
  "modules": {
    "main/tasksManager": {
      "path": "src/main/tasksManager.js",
      "purpose": "Task CRUD operations",
      "exports": ["init", "loadTasks", "addTask"],
      "functions": {
        "loadTasks": {
          "line": 20,
          "purpose": "Load tasks from tasks.json",
          "params": ["projectPath"],
          "returns": "object"
        },
        "addTask": {
          "line": 45,
          "purpose": "Add new task to project",
          "params": ["projectPath", "taskData"],
          "emits": "IPC.TASK_UPDATED"
        }
      },
      "ipcHandles": ["LOAD_TASKS", "ADD_TASK", "UPDATE_TASK"],
      "dependencies": ["fs", "path", "../shared/ipcChannels"]
    }
  },
  "ipcChannels": {
    "LOAD_TASKS": {
      "direction": "renderer → main",
      "sender": "renderer/tasksPanel.js",
      "handler": "main/tasksManager.js",
      "payload": "projectPath",
      "response": "TASKS_DATA"
    }
  },
  "dataFlow": {
    "taskCreation": "UI → tasksPanel.handleTaskFormSubmit → IPC.ADD_TASK → tasksManager.addTask → tasks.json → IPC.TASK_UPDATED → UI refresh"
  }
}
```

### Güncelleme Kuralları
- Kod değişikliği yaptıktan sonra: `npm run structure:changed`
- Veya tüm projeyi yeniden tara: `npm run structure`
- Pre-commit hook otomatik olarak günceller (commit öncesi)
- Manuel güncelleme gerekirse fonksiyon satır numaralarını (line) güncel tut
- Yeni IPC channel eklediysen ipcChannels bölümünü kontrol et

---

## QUICKSTART.md Kuralları

### Ne Zaman Güncelle?
- Kurulum adımları değiştiğinde
- Yeni gereksinimler eklendiğinde
- Önemli komutlar değiştiğinde

---

## Genel Kurallar

1. **Dil:** Dökümanları Türkçe yaz (kod örnekleri hariç)
2. **Tarih Formatı:** ISO 8601 (YYYY-MM-DDTHH:mm:ssZ)
3. **Commit Sonrası:** tasks.json ve STRUCTURE.json'ı kontrol et
4. **Session Başlangıcı:** tasks.json'daki pending taskları gözden geçir

---

*Bu dosya Frame tarafından otomatik oluşturulmuştur.*
*Oluşturulma tarihi: 2026-01-24*
