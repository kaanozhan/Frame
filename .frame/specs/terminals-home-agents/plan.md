# Plan — Home, Terminals ve Agents — üç yüzeyin tek modele oturtulması

## Architecture

### Resolved plan-time decisions

**İş kararları (kullanıcıya soruldu)**

- **D1 · Perf spec'ine göre sıralama** — `audit-q3-performance-resources` T10
  (ölçüm turu) açıkken başlanır. *Gerekçe:* T01–T09 kod işi bitmiş, T10 kod
  değiştirmiyor; ölçümün nihai tasarımı görmesi tercih edildi. *Not:* T10
  37 gündür `in_progress` — "yakında kapanır" varsayımına yaslanılmamalı.
- **D2 · Agent görünürlüğü tek panelde toplanmaz** — dört yüzeye dağıtılır
  (Overview pane başlıkları · Other Terminals rail'i · sidebar chip'i · status
  bar slotu). *Gerekçe:* her yüzey kendi bağlamının gösteremediğini gösterir.
  Tek "Agents" rail'i Overview'la çakışıyordu ve Terminals şeritten
  kaldırılınca hiç görünmüyordu.
- **D10 · Terminals sidebar'da kalır** — `sidebar-nav-groups`'un Work grubundaki
  yeri korunur. *Gerekçe:* o spec sidebar'a "eylemde bulunduğun yer" anlamını
  verdi; sidebar = açma noktası, top bar = açık olan. Tekrar değil, iki iş.
- **D11 · Top bar'daki Terminals şeritten kaldırılabilir** — `×` yalnızca top
  bar'dan düşürür; bölüm, sekmeler, düzen ve agent'lar yaşar. *Gerekçe:* tek
  kural kurar — Home kalıcı, gerisi açık ve kaldırılabilir; ve `×` her iki
  seviyede de "şeritten kaldır" demek olur, asla "yok et".
- **D13 · Other Terminals varsayılan kapalı** — kenardaki hover düğmesiyle
  açılır, durumu hatırlanır; kapalı şeritte yalnızca approval/input bekleyenler
  belirir. *Gerekçe:* tekli görünümde ekran terminalin; panel istendiğinde
  gelir, ama kör bırakmaz.
- **D14 · Status bar slotu yalnızca diğer projeleri kapsar** — bu projenin
  dikkati sidebar chip'inde. *Gerekçe:* aksi halde Overview'da ekranda olanı
  tekrar ederdi. Etiket kapsamı açıkça söyler.
- **D15 · Status bar: hover menüyü açar, tık iş yapar** — *Gerekçe:* bar'ın
  kendi idiomu (`status-bar.css:38-39`, kullanım ölçerleri detayı hover'da
  açıyor, tık refresh). Bar-içi tutarlılık.

**Teknik kararlar (kullanıcıya soruldu)**

- **D3 · Sekme durumu `terminalsView` prefs'inde** — `openTabs`/`activeTab`,
  `localStorage['frame-terminals-view']`, `cols`/`order` ile aynı proje-başına
  kayıtta. *Gerekçe:* ölü id budaması orada zaten var; `saveProjectSession`'ın
  erken dönen dalına (C4) ve perf spec'inin MRU pruning'ine dokunulmaz.
- **D4 · Tab şeridi `terminalsView` içinde** — ayrı modüle çıkarılmaz.
  *Gerekçe:* mount taşıma mantığının bölünmesi C1'in tek ihlal yolu.
- **D5 (revize) · `laneDetailRail.js` → `otherTerminalsRail.js`** —
  *silinmez.* Bir ara "status bar rail'i gereksiz kılıyor" diye silinmesi
  kararlaştırılmıştı; çerçeve değişince (agent paneli değil, "göremediğim
  terminaller") geri alındı. Ad içeriğe uyar; `detail` emekli oluyor.

**Sessiz kararlar (tek savunulabilir cevap)**

- **Test duruşu: none this time.** PROJECT_NOTES §Testing `src/renderer/` için
  "no DOM/UI harness present" diyor; bugün doğrulandı (`jsdom`, `playwright`,
  `@testing-library`, `puppeteer` yok). Bu spec %100 renderer. Beş bölüm test
  işinden arınıktır.
- **Statü sözlüğü tek kaynağı `laneStatus.js`** — taksonominin sahibi o modül.
  Dört yüzey (Overview başlığı, rail, sidebar chip'i, status bar slotu) aynı
  sözcükleri ve aynı dikkat sembollerini kullanır.
- **D8 (genişletildi) · `projectStatusBadges.computeCounts()`** — yuvarlama saf
  bir fonksiyona çıkarılıp export edilir ve **iki tüketiciyi** besler: sidebar
  chip'inin dikkat durumu ve status bar slotu. Tek implementasyon, yeni IPC yok.
- **Rail agent-only değil** — baktığın terminal hariç projenin tüm terminalleri,
  agent'lar işaretli. Agent-only olsaydı tekli görünümde düz shell'lere geçiş
  yolu kalmazdı.
- **Kapalı şeritte yalnızca dikkat gerektirenler.** `projectStatusBadges.js`
  başlığındaki kayıtlı ilkenin bir seviye aşağıda tekrarı: *"the list only flags
  projects that need the user's attention."*
- **D9 · Orchestrator ile dağıtılmaz.** Footprint `audit-q3-performance-resources`
  ile dört dosyada kesişiyor ve o spec `implementing` — conflict guard dispatch'i
  reddeder. T10 kapanana kadar doğrudan yürütülür.

### Kısıtlar (C-ID'ler)

- **C1 — Mount tekilliği.** `mountTerminal` DOM elementini kopyalamaz,
  `container.appendChild(instance.element)` ile **taşır**
  (`terminalManager.js:547`). Sekme ↔ Overview geçişinde hedef gövde her zaman
  yeniden mount eder; "zaten mount'luydu" varsayımı yasaktır. İhlali sessiz bir
  boş-pane hatasıdır.
- **C2 — Inline yüzeyler mount-idempotent.** `laneBoard.render()` bugün her
  state değişiminde container'ı siliyor (`laneBoard.js:135`). Dört canlı veri
  kartıyla bu, 2026-08-20'de ölçülen IPC fırtınasının (saniyede ~100 round-trip,
  %163 CPU) birebir şekli. Home `mount()`/`update()` ikilisine ayrılır.
- **C3 — Proje değişimi terminalleri öldürmez** (`terminalManager.js:666-672`).
  Sekmeler de bu yüzden atılmaz.
- **C4 — `saveProjectSession` erken dönüşü** (`terminalManager.js:163-165`)
  sekme durumu oraya yazılmayarak dolanılır; o dal değiştirilmez.
- **C5 — `audit-q3-performance-resources`'ın kayıtlı kararları korunur:**
  `laneStatus`'ta `_armQuietTimer`, `terminalManager`'da 20'lik MRU session
  pruning + `clearProjectSession` wiring, ve `laneRail`/`laneBoard`/`laneStatus`/
  `terminalManager`'daki **init-once listener guard'ları**. Yeniden yazılan
  `laneBoard` ve yeni rail bu idiomu sürdürür.
- **C6 — 2026-08-25 merge'ünün kararları korunur.** Work/Context/Frame grupları,
  katlanma durumu ve Terminals satırının sayacı; `historyPanel`'in emekliliği;
  kullanım ölçerlerinin status bar'da, tema toggle'ının top bar'da olması. Ve
  spec listelerindeki `!malformed` filtresi (`laneRail.js:204`,
  `multiTerminalUI.js:520`) — **Home'un Specs kartı `laneRail`'in aboneliklerini
  devralırken bu filtreyi taşımak zorundadır.**

### Bileşenler

**Statü sözlüğü.** `laneStatus.js` sunum yardımcılarının tek evi olur:
`statusLabel(status, { agentName, foreground, commandLine, short })`,
`attentionMark(status)` (Overview başlığındaki ve kapalı şeritteki dikkat
sembolü), `cleanCommand`, `formatRelativeTime`, `assignmentIcon`,
`assignmentText`. `laneBoard`'un helper export'ları kalkar — bu, rail'in
bugün `laneBoard`'a olan import bağımlılığını (`laneDetailRail.js:15`) de koparır.

**Terminals bölümü.** `terminalsView` iki katmana ayrılır: `_buildTabStrip()` ve
aktif sekmenin gövdesi. `activeTab === null` → Overview gövdesi (bugünkü
`tv-grid` + layout bar; pane başlığı okunur statü + dikkat işareti kazanır,
rail **yok**); `activeTab === id` → tek terminal gövdesi + Other Terminals
rail'i. Şerit `overflow-x: auto`. Pane'deki `data-maximize` → `data-open`,
ikon `Maximize2` → `Search`, `openTab(id)` çağırır; `maximizedId` prefs'i ve
onu okuyan dallar silinir.

Sekme yaşam döngüsü: `openTab` zaten açıksa yalnızca `activeTab`'ı değiştirir;
`closeTab` sekmeyi düşürür, terminale dokunmaz; terminal ölünce normalizasyon
sekmeyi düşürür; Overview'da pane tıklaması yerinde odaklanma davranışında
kalır (`terminalsView.js:243-252`).

**Top bar.** `_renderLeftSection` `Home` (kalıcı) + `Terminals` (kaldırılabilir,
`×`'li) + section chip'lerine iner. Terminals'ın chip mekaniği section
chip'lerinden devralınır; kaldırılmışsa Home'a düşülür ve **Work → Terminals**
onu geri koyar. Terminal başına tab'lar, `grid-layout-select` ve presence kabı
kaldırılır; tema toggle'ı ve güncelleme bildirimi yerinde kalır (C6).

**`detail`'in emekliliği.** `viewMode` = `board | terminals | specs | tasks |
panel`. `_renderDetailView`, `_ensureAssignments`, `_assignCell`,
`_newLaneInCell`, `_cellAssignments`, `_detailRailCallbacks` ve `TerminalGrid`
import'u kaldırılır. `enterLane(id)` tek çoke point kalır, yeni anlamı
"Terminals'a geç (gerekirse şeride geri koy) + o terminalin sekmesini aç/öne
getir". `isViewingFrame()` → `viewMode === 'terminals' && !isSectionVisible &&
!isDecisionsVisible && !!activeTerminalId`; bu `agentDispatch.js:251`'deki
hatayı düzeltir.

**Home.** `laneBoard` dört karta yeniden yazılır (Terminals, Orchestration,
Specs, Tasks), `mount()`/`update()` ikilisiyle. `laneRail.js` silinir;
Specs/Tasks abonelikleri (`SPEC_DATA`/`TASKS_DATA`, `!malformed` filtresiyle)
kartlara geçer. Proje yokken Home render edilmez.

**Other Terminals rail.** `otherTerminalsRail` yalnızca tekli terminal
gövdesinde render edilir. Kaynak: bu projenin terminalleri eksi baktığın.
Varsayılan kapalı (`isHidden` varsayılanı ters çevrilir); kapalı şeritte
yalnızca approval/input bekleyenler kırmızı ünlem + agent göstergesiyle
görünür — bugünkü jenerik iki ikon (`laneDetailRail.js:103-106`) yerine.
Collapse mekaniği ve `.lane-rail` CSS'i korunur.

**Sidebar chip'i.** `projectListUI`'daki `workspace-nav-agents` (`:392-395`)
sayıya ek olarak dikkat durumu kazanır: `computeCounts()`'tan gelen
approval/input varsa renk ve sembol değişir. Terminals satırı ve sayacı
korunur (C6).

**Status bar slotu.** `statusBar.js`'in ilan edilmiş boş sol slotu (`:10`)
doldurulur: kapsam **yalnızca diğer projeler**, üç durum (yok → sönük ipucu ·
var → sakin sayı · bekleyen var → öne çıkan). Hover projeye göre gruplu menüyü
**yukarı** açar; satır tıklaması gerekirse `state.setProjectPath` + `enterLane`
— bu mantık `presenceBar._focus`'tan (`presenceBar.js:105-113`) devralınır ve
`presenceBar.js` silinir. Hover menüsü açılma gecikmesi + bağışlayıcı kapanma
alanı ister.

## Files

**Modified**

- `src/renderer/laneStatus.js` — statü sözcükleri, dikkat sembolleri ve sunum yardımcılarının tek evi; `_armQuietTimer` ve init-once guard korunur (C5).
- `src/renderer/terminalsView.js` — tab şeridi, `openTab`/`closeTab`, büyüteç, `maximizedId`'nin kaldırılması, prefs'e `openTabs`/`activeTab`, Overview pane başlığının okunur statüsü, tekli gövdede rail hosting.
- `src/renderer/multiTerminalUI.js` — `detail` render yolunun ve hücre mantığının kaldırılması, `enterLane`/`isViewingFrame` yeniden tanımı, Terminals'ın şeritten kaldırılabilirliği, Home için idempotent board render.
- `src/renderer/terminalManager.js` — `gridLayout`/`setGridLayout` ve legacy eşlemenin kaldırılması, ölü viewMode restore temizliği; MRU pruning korunur (C5).
- `src/renderer/terminalTabBar.js` — sol bölüm `Home` + kaldırılabilir `Terminals` + section chip'leri; terminal tab'ları, layout select, presence kabı ve ölü `onEnterFrames` kalkar; tema toggle'ı korunur (C6).
- `src/renderer/laneBoard.js` — dört kartlık Home panosuna yeniden yazım, `mount()`/`update()` ayrımıyla (C2); Specs kartı `!malformed` filtresini taşır (C6); init-once guard sürdürülür (C5).
- `src/renderer/agentDispatch.js` — `isViewingFrame`'in yeni anlamına uyum; `_startAgentIn` kullanıcıyı Overview'dan koparmaz.
- `src/renderer/projectStatusBadges.js` — proje başına yuvarlama saf `computeCounts()` olarak dışa açılır; iki tüketici.
- `src/renderer/projectListUI.js` — Work→Terminals satırı ve sayacı korunur; `◆` göstergesi dikkat durumu kazanır (C6).
- `src/renderer/statusBar.js` — boş sol slot doldurulur: diğer-projeler göstergesi + hover menüsü + navigasyon.
- `src/renderer/paletteSources.js` — `Go to Home` eklenir.
- `src/renderer/index.js` — komut sözlüğü "Frame/Mainframe" → "Terminal/Home", kategori `Frames` → `Terminals`; `presenceBar` init'i kaldırılır.
- `src/renderer/styles/components/lane-board.css` — top bar'ın yeni hali, Home kartları, öksüz `.btn-lane-frames*` temizliği.
- `src/renderer/styles/components/terminals-view.css` — tab şeridi, tekli gövde, okunur pane başlığı, `maximized` kurallarının kaldırılması.
- `src/renderer/styles/components/status-bar.css` — sol slot ve yukarı açılan hover menüsü.
- `src/renderer/styles/components/terminal.css` — presence chip kurallarının kaldırılması.
- `src/renderer/styles/components/orchestrator.css` — Home kartına taşınan orchestrator rozet kuralları.
- `src/renderer/styles/components/project-section.css` — sidebar chip'inin dikkat durumu.

**New**

- `src/renderer/otherTerminalsRail.js` — `laneDetailRail.js`'ten `git mv`; tekli gövdede "diğer terminaller", varsayılan kapalı, kapalı şeritte dikkat işareti.

**Deleted**

- `src/renderer/laneDetailRail.js` — `otherTerminalsRail.js` olarak taşındı.
- `src/renderer/laneRail.js` — Home'un Specs/Tasks yan paneli; içeriği kartlara geçti.
- `src/renderer/terminalGrid.js` — `detail` görünümünün hücre grid'i.
- `src/renderer/presenceBar.js` — top bar agent chip'leri; status bar slotuna birleşti.

## Footprint

- src/renderer/laneStatus.js
- src/renderer/terminalsView.js
- src/renderer/multiTerminalUI.js
- src/renderer/terminalManager.js
- src/renderer/terminalTabBar.js
- src/renderer/laneBoard.js
- src/renderer/otherTerminalsRail.js
- src/renderer/laneDetailRail.js
- src/renderer/laneRail.js
- src/renderer/terminalGrid.js
- src/renderer/presenceBar.js
- src/renderer/agentDispatch.js
- src/renderer/projectStatusBadges.js
- src/renderer/projectListUI.js
- src/renderer/statusBar.js
- src/renderer/paletteSources.js
- src/renderer/index.js
- src/renderer/styles/components/lane-board.css
- src/renderer/styles/components/terminals-view.css
- src/renderer/styles/components/status-bar.css
- src/renderer/styles/components/terminal.css
- src/renderer/styles/components/orchestrator.css
- src/renderer/styles/components/project-section.css

## Dependencies

None. Yeni paket yok, yeni IPC kanalı yok — `src/main/` ve
`src/shared/ipcChannels.js` bu spec'in dışında kalır.

## Sequencing

1. **Statü sözlüğünü `laneStatus`'a taşı.** `statusLabel` (`short` bayraklı),
   `attentionMark`, `cleanCommand`, `formatRelativeTime`, `assignmentIcon`,
   `assignmentText`. Davranış değişmez, iki etiket sözlüğü teke iner.
   `_armQuietTimer` ve init-once guard'a dokunulmaz. — G7, C5, S17
2. **Tab şeridini kur.** `openTabs`/`activeTab` prefs'i, `_buildTabStrip()`,
   `openTab`/`closeTab`, tekli gövde, şeridin `overflow-x` davranışı; mount
   sekme ↔ Overview geçişinde her zaman yeniden yapılır. — G2, C1, C3, S2, S5
3. **Büyüteci bağla, `maximizedId`'yi kaldır.** — G2, S4
4. **`detail`'i emekli et.** Hücre mantığı ve `terminalGrid.js` silinir;
   `gridLayout`, legacy eşleme ve ölü viewMode restore temizlenir; `enterLane`
   ve `isViewingFrame` yeniden tanımlanır, `agentDispatch` uyumlanır. — G3, C5,
   S6, S7, S8
5. **Top bar'ı yeniden kur.** `Home` + kaldırılabilir `Terminals` + section
   chip'leri; `×` şeritten kaldırır, bölüm yaşar; Work → Terminals geri koyar.
   Terminal tab'ları, layout select, presence kabı ve ölü `enterFrames`
   kaldırılır; `presenceBar.js` silinir; öksüz CSS temizlenir; tema toggle'ı
   korunur. — G1, C6, S1, S14, S18, S21
6. **Overview'ın pane başlığını okunur yap.** Statü metni + dikkat işareti,
   `laneStatus` sözlüğünden. Overview'a rail eklenmez. — G5, S22
7. **Other Terminals rail'ini kur.** `git mv laneDetailRail.js
   otherTerminalsRail.js`; yalnızca tekli gövdede render; varsayılan kapalı +
   hover açma düğmesi; kapalı şeritte yalnızca approval/input bekleyenler;
   satır tıklaması `enterLane`. Init-once guard sürdürülür. — G5, C5, S12, S23,
   S24
8. **Sidebar chip'i + status bar slotu.** `projectStatusBadges`'e
   `computeCounts()` export'u; sidebar `◆` chip'i dikkat durumu kazanır; status
   bar'ın sol slotu üç durumla doldurulur, hover menüsü yukarı açılır, satır
   tıklaması gerekirse projeyi değiştirip sekmeyi açar. — G5, C6, S13, S25, S26
9. **Home'u kart panosuna çevir.** Dört kart, `mount()`/`update()` ayrımı,
   `_renderBoardView` idempotence guard'ı, `laneRail.js` silinir, Specs kartı
   `!malformed` filtresini taşır, proje yokken proje seçimi. — G4, C2, C6, S9,
   S10, S11, S19, S27
10. **Palette, sözlük ve kalan temizlik.** `Go to Home`; komut sözlüğünde
    "Frame/Mainframe" → "Terminal/Home"; kısayollar `enterLane`'in yeni
    anlamıyla; kalan "New Frame" metinleri; boş durumun tek yerde toplanması.
    — G6, G7, S16, S19
