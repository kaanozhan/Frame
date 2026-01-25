/**
 * Frame Templates
 * Templates for auto-generated Frame project files
 * Each template includes instructions header for Claude Code
 */

/**
 * Get current date in YYYY-MM-DD format
 */
function getDateString() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get current ISO timestamp
 */
function getISOTimestamp() {
  return new Date().toISOString();
}

/**
 * CLAUDE.md template - Main instructions file for Claude Code
 */
function getClaudeTemplate(projectName) {
  const date = getDateString();
  return `# ${projectName} - Frame Project

Bu proje **Frame** ile yönetilmektedir. Aşağıdaki kurallara uyarak dökümanları güncel tut.

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

\`\`\`json
{
  "id": "unique-id",
  "title": "Kısa ve net başlık",
  "description": "Detaylı açıklama",
  "status": "pending | in_progress | completed",
  "priority": "high | medium | low",
  "context": "Bu task nereden/nasıl çıktı",
  "createdAt": "ISO date",
  "updatedAt": "ISO date",
  "completedAt": "ISO date | null"
}
\`\`\`

### Task Durum Güncellemeleri

- Bir task üzerinde çalışmaya başladığında: \`status: "in_progress"\`
- Task tamamlandığında: \`status: "completed"\`, \`completedAt\` güncelle
- Commit sonrası: İlgili taskların durumunu kontrol et ve güncelle

---

## PROJECT_NOTES.md Kuralları

### Ne Zaman Güncelle?
- Önemli bir mimari karar alındığında
- Teknoloji seçimi yapıldığında
- Önemli bir problem çözüldüğünde ve çözüm yöntemi kayda değer olduğunda
- Kullanıcıyla birlikte bir yaklaşım belirlendiğinde

### Format
\`\`\`markdown
## [Tarih] Karar/Not Başlığı

**Bağlam:** Neden bu karara ihtiyaç duyuldu?
**Karar:** Ne karar verildi?
**Alternatifler:** Değerlendirilen diğer seçenekler (varsa)
**Sonuç:** Bu kararın etkileri
\`\`\`

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
2. **Tarih ekle** - \`### [YYYY-MM-DD] Başlık\` formatında
3. **Session Notes bölümüne ekle** - PROJECT_NOTES.md'nin sonunda

### Ne Zaman SORMA

- Her küçük değişiklikte (spam olur)
- Typo fix, basit düzeltmeler
- Kullanıcı zaten "hayır" veya "gerek yok" demişse o session'da aynı konu için tekrar sorma

### Kullanıcı "Hayır" Derse

Sorun yok, devam et. Kullanıcı önemli gördüğü şeyleri kendisi de söyleyebilir: "bunu notlara ekle"

---

## STRUCTURE.json Kuralları

### Ne Zaman Güncelle?
- Yeni dosya/klasör oluşturulduğunda
- Dosya/klasör silindiğinde veya taşındığında
- Modül yapısı değiştiğinde
- Commit sonrası (yapısal değişiklik varsa)

### Format
\`\`\`json
{
  "lastUpdated": "ISO date",
  "overview": "Proje yapısının kısa açıklaması",
  "modules": {
    "moduleName": {
      "path": "src/module",
      "purpose": "Bu modül ne yapar",
      "files": ["file1.js", "file2.js"],
      "dependencies": ["otherModule"]
    }
  }
}
\`\`\`

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
*Oluşturulma tarihi: ${date}*
`;
}

/**
 * STRUCTURE.json template
 */
function getStructureTemplate(projectName) {
  return {
    _frame_metadata: {
      purpose: "Project structure and module map for AI assistants",
      forClaude: "Read this file FIRST when starting work on this project. It contains the module structure, data flow, and conventions. Update this file when you add new modules or change the architecture.",
      lastUpdated: getDateString(),
      generatedBy: "Frame"
    },
    version: "1.0",
    description: `${projectName} - update this description`,
    architecture: {
      type: "",
      entryPoint: "",
      notes: ""
    },
    modules: {},
    dataFlow: [],
    conventions: {}
  };
}

/**
 * PROJECT_NOTES.md template
 */
function getNotesTemplate(projectName) {
  const date = getDateString();
  return `<!-- FRAME AUTO-GENERATED FILE -->
<!-- Purpose: Project notes, decisions, and context for AI assistants -->
<!-- For Claude: Read this to understand project history, decisions made, and current context. Update this file with important decisions, context, and notes during development sessions. -->
<!-- Last Updated: ${date} -->

# ${projectName} - Project Notes

## Overview
*Brief description of what this project does*

## Current Status
*What state is the project in? What's the current focus?*

## Key Decisions
*Important architectural or design decisions and their rationale*

| Decision | Rationale | Date |
|----------|-----------|------|
| | | |

## Session Log
*Brief notes from development sessions*

### ${date}
- Initial Frame project setup

## Known Issues
*Current bugs or limitations*

- None yet

## Next Steps
*What should be worked on next*

1.

## Context for Claude
*Special instructions or context for AI assistants*

- Read STRUCTURE.json for module architecture
- Check todos.json for pending tasks
- Follow existing code patterns and conventions
`;
}

/**
 * tasks.json template
 */
function getTasksTemplate(projectName) {
  return {
    _frame_metadata: {
      purpose: "Task tracking for the project",
      forClaude: "Check this file to understand what tasks are pending, in progress, or completed. Update task status as you work. Add new tasks when discovered during development. Follow the task recognition rules in CLAUDE.md. IMPORTANT: Include userRequest (original user prompt), detailed description, and acceptanceCriteria for each task.",
      lastUpdated: getDateString(),
      generatedBy: "Frame"
    },
    project: projectName,
    version: "1.1",
    lastUpdated: getISOTimestamp(),
    tasks: {
      pending: [],
      inProgress: [],
      completed: []
    },
    taskSchema: {
      _comment: "This schema shows the expected structure for each task",
      id: "unique-id (task-xxx format)",
      title: "Short actionable title (max 60 chars)",
      description: "Claude's detailed explanation - what, how, which files affected",
      userRequest: "Original user prompt/request - copy verbatim",
      acceptanceCriteria: "When is this task done? Concrete testable criteria",
      notes: "Discussion notes, alternatives considered, dependencies (optional)",
      status: "pending | in_progress | completed",
      priority: "high | medium | low",
      category: "feature | fix | refactor | docs | test",
      context: "Session date and context",
      createdAt: "ISO timestamp",
      updatedAt: "ISO timestamp",
      completedAt: "ISO timestamp | null"
    },
    metadata: {
      totalCreated: 0,
      totalCompleted: 0
    },
    categories: {
      feature: "New features",
      fix: "Bug fixes",
      refactor: "Code improvements",
      docs: "Documentation",
      test: "Testing",
      research: "Research and exploration"
    }
  };
}

/**
 * QUICKSTART.md template
 */
function getQuickstartTemplate(projectName) {
  const date = getDateString();
  return `<!-- FRAME AUTO-GENERATED FILE -->
<!-- Purpose: Quick onboarding guide for developers and AI assistants -->
<!-- For Claude: Read this FIRST to quickly understand how to work with this project. Contains setup instructions, common commands, and key files to know. -->
<!-- Last Updated: ${date} -->

# ${projectName} - Quick Start Guide

## Setup

\`\`\`bash
# Clone and install
git clone <repo-url>
cd ${projectName}
npm install  # or appropriate package manager
\`\`\`

## Common Commands

\`\`\`bash
# Development
npm run dev

# Build
npm run build

# Test
npm test
\`\`\`

## Key Files

| File | Purpose |
|------|---------|
| \`STRUCTURE.json\` | Module map and architecture |
| \`PROJECT_NOTES.md\` | Decisions and context |
| \`todos.json\` | Task tracking |
| \`QUICKSTART.md\` | This file |

## Project Structure

\`\`\`
${projectName}/
├── .frame/           # Frame configuration
├── src/              # Source code
└── ...
\`\`\`

## For AI Assistants (Claude)

1. **First**: Read \`STRUCTURE.json\` for architecture overview
2. **Then**: Check \`PROJECT_NOTES.md\` for current context and decisions
3. **Check**: \`todos.json\` for pending tasks
4. **Follow**: Existing code patterns and conventions
5. **Update**: These files as you make changes

## Quick Context

*Add a brief summary of what this project does and its current state here*
`;
}

/**
 * .frame/config.json template
 */
function getFrameConfigTemplate(projectName) {
  return {
    version: "1.0",
    name: projectName,
    description: "",
    createdAt: getISOTimestamp(),
    initializedBy: "Frame",
    settings: {
      autoUpdateStructure: true,
      autoUpdateNotes: false,
      taskRecognition: true
    },
    files: {
      claude: "CLAUDE.md",
      structure: "STRUCTURE.json",
      notes: "PROJECT_NOTES.md",
      tasks: "tasks.json",
      quickstart: "QUICKSTART.md"
    }
  };
}

module.exports = {
  getClaudeTemplate,
  getStructureTemplate,
  getNotesTemplate,
  getTasksTemplate,
  getQuickstartTemplate,
  getFrameConfigTemplate
};
