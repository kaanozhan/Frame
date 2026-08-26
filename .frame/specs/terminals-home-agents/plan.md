# Plan — Home, Terminals ve Agents — üç yüzeyin tek modele oturtulması

## Architecture

### Resolved plan-time decisions

**İş kararları (kullanıcıya soruldu)**

- **Perf spec'ine göre sıralama** — `audit-q3-performance-resources` T10 (ölçüm
  turu) açıkken başlanır; T10 sonrasında ölçer. *Gerekçe:* T01–T09 kod işi
  bitmiş, T10 kod değiştirmiyor. Kullanıcı, ölçümün gerçek son hali görmesini
  tercih etti; bedeli T10'un bütçelerinin yeni tasarıma göre yeniden
  yorumlanması.
- **Agents rail Home'da yok** — yalnızca Terminals bölümünde (Overview ve
  terminal sekmeleri). *Gerekçe:* Home'un Terminals kartı zaten terminal
  özetini ve agent durumunu taşıyor; rail'i oraya da koymak aynı bilgiyi iki
  yerde gösterir ve "Home'dan yan paneli kaldır" kararıyla çelişir.

**Teknik kararlar (kullanıcıya soruldu)**

- **Sekme durumu `terminalsView` prefs'inde** — `openTabs: string[]` +
  `activeTab: string|null`, `localStorage['frame-terminals-view']` içinde,
  `cols`/`order` ile aynı proje-başına kayıtta. *Gerekçe:* ölü id budaması
  orada zaten var (`_orderedTerminals`), restart sonrası şerit kendiliğinden
  Overview'a düşer, ve `terminalManager.saveProjectSession`'a hiç dokunulmaz —
  onun sıfır-terminalli projede erken dönen dalı (`terminalManager.js:163-165`)
  ile perf spec'inin oraya yeni koyduğu MRU pruning'i riske atmayız.
- **Tab şeridi `terminalsView` içinde** — ayrı modüle çıkarılmaz. *Gerekçe:*
  durum (openTabs/activeTab/prefs) ve mount taşıma mantığı tek sahipte kalır;
  o mantığın bölünmesi C1'in ihlal edilme riskini artırır.
- **`laneDetailRail.js` → `agentsRail.js`** (git mv). *Gerekçe:* modül artık
  lane değil agent listeliyor ve "detail" emekli olan bir yüzeyin adı.
  Kod-"lane"/arayüz-"terminal" kuralı terminal sözlüğüyle ilgilidir, ihlal yok.

**Sessiz kararlar (tek savunulabilir cevap)**

- **Test duruşu: none this time.** `.frame/PROJECT_NOTES.md` §Testing kaydı
  `src/renderer/` için "no DOM/UI harness present" diyor; bugün doğruladım —
  `jsdom`, `playwright`, `@testing-library`, `puppeteer` hiçbiri
  `package.json`'da yok. Bu spec'in işi %100 renderer. Çalıştırılamayacak test
  planlamak planı daha titiz gösterip daha az doğru yapardı. Beş bölüm test
  işinden arınmıştır.
- **Statü etiketi tek kaynağı `laneStatus.js`** — taksonominin sahibi zaten o
  modül; ayrı bir modül açmak üçüncü bir ev yaratırdı.
- **Cross-project satırı `projectStatusBadges`'ten** — oradaki yuvarlama saf
  bir fonksiyona (`computeCounts`) çıkarılıp export edilir; rail onu çağırır.
  Mantığı rail'de yeniden yazmak iki implementasyon demek olurdu.
- **Orchestrator ile dağıtılmaz.** Footprint `audit-q3-performance-resources`
  ile dört dosyada kesiştiği ve o spec `implementing` olduğu için Frame'in
  conflict guard'ı bu spec'i reddeder. T10 kapanana kadar iş doğrudan
  yürütülür; sonrasında dağıtım serbest.

### Kısıtlar (C-ID'ler)

- **C1 — Mount tekilliği.** Bir terminalin DOM elementi tektir;
  `mountTerminal` onu kopyalamaz, `container.appendChild(instance.element)` ile
  **taşır** (`terminalManager.js:547`). Sekme ↔ Overview geçişinde hedef gövde
  her zaman yeniden mount eder; `terminalsView` "zaten mount edilmişti"
  varsayımıyla mount'u asla atlamaz. Atlanırsa geri dönüşte pane boş kalır.
- **C2 — Inline yüzeyler mount-idempotent.** `laneBoard.render()` bugün her
  state değişiminde `container.innerHTML = ''` yapıp her şeyi yeniden kuruyor
  (`laneBoard.js:133-169`). Dört canlı veri kartıyla bu, 2026-08-20'de
  ölçülmüş IPC fırtınasının (saniyede ~100 round-trip, %163 CPU) birebir
  şeklidir. Home `mount()` + `update()` ikilisine ayrılır; `_renderBoardView`
  `_renderDashView`'in idempotence guard'ını taklit eder.
- **C3 — Proje değişimi terminalleri öldürmez.** `terminals` tek bir Map'tir
  ve geçişte budanmaz; `getTerminalStates()` yalnızca görünümü filtreler
  (`terminalManager.js:666-672`). Sekmeler de bu yüzden atılmaz.
- **C4 — `saveProjectSession` erken dönüşü** (`terminalManager.js:163-165`)
  sekme durumunun oraya yazılmamasıyla dolanılır; o dal değiştirilmez.
- **C5 — `audit-q3-performance-resources`'ın kayıtlı kararları korunur.**
  Footprint dört dosyada kesişiyor. Korunacaklar: `laneStatus`'ta
  `_armQuietTimer` (per-chunk timer yerine burst başına tek timer),
  `terminalManager`'da 20'lik MRU session pruning + `clearProjectSession`
  wiring, ve `laneRail`/`laneBoard`/`laneStatus`/`terminalManager`'daki
  **init-once listener guard'ları**. Yeniden yazılan `laneBoard` ve yeni
  `agentsRail` init-once guard idiomunu sürdürür; `laneRail`'in silinmesi o
  spec'in amacıyla (daha az dinleyici) çelişmez.

### Bileşenler

**Statü sözlüğü.** `laneStatus.js` sunum yardımcılarının tek evi olur:
`statusLabel(status, { agentName, foreground, commandLine, short })`,
`cleanCommand`, `formatRelativeTime`, `assignmentIcon`, `assignmentText`.
`short` bayrağı bugünkü iki tonu ("Agent working" / "Working") tek tablodan
üretir. `laneBoard`'un helper export'ları kalkar; bu, `laneDetailRail`'in
bugün `laneBoard`'a olan import bağımlılığını (`laneDetailRail.js:15`) de
koparır.

**Terminals bölümü.** `terminalsView` iki katmana ayrılır: `_buildTabStrip()`
ve aktif sekmenin gövdesi. `activeTab === null` → Overview gövdesi (bugünkü
`tv-grid` + layout bar, davranışı korunur); `activeTab === id` → tek terminal
gövdesi (layout bar yok, hayalet pane yok). Şerit `overflow-x: auto`.
Pane başlığındaki `data-maximize` düğmesi `data-open`'a, ikonu `Maximize2` →
`Search` olur ve `openTab(id)` çağırır; `maximizedId` prefs'i ve onu okuyan
tüm dallar silinir. Agents rail her iki gövde tipinde de tek yerden render
edilir.

Sekme yaşam döngüsü: `openTab(id)` zaten açıksa yalnızca `activeTab`'ı
değiştirir (ikinci sekme yok); `closeTab(id)` sekmeyi düşürür, terminale
dokunmaz; terminal kapanınca (`TERMINAL_DESTROYED`) normalizasyon sekmeyi
düşürür; Overview'da pane tıklaması bugünkü yerinde-odaklanma davranışında
kalır (`terminalsView.js:243-252`).

**`detail`'in emekliliği.** `viewMode` seti `board | terminals | specs | tasks
| panel`. `enterLane(id)` tek çoke point olarak kalır, yeni anlamı
"Terminals'a geç + o terminalin sekmesini aç/öne getir"; Home kartı, Agents
rail ve `agentDispatch` buradan geçer. `isViewingFrame()` →
`viewMode === 'terminals' && !isSectionVisible && !isDecisionsVisible &&
!!activeTerminalId`; bu, `agentDispatch.js:251`'in bugün varsayılan görünümde
her zaman `false` dönüp Start'ı odaklı terminal yerine hep yeni terminale
göndermesini düzeltir.

**Home.** `laneBoard` dört karta yeniden yazılır: Terminals (sayı + agent
durumu + her durumda "yeni terminal"), Orchestration (bugünkü kartın
davranışı), Specs, Tasks. Specs/Tasks kartları `laneRail`'in `SPEC_DATA` /
`TASKS_DATA` aboneliklerini devralır — yeni IPC yok. Proje yokken Home
render edilmez; proje seçimi gösterilir.

**Agents rail.** `agentsRail` kaynağı `getTerminalStates(true)` + `laneStatus`;
`agentName` taşımayanlar filtrelenir. Sıra `agent-approval → agent-input →
agent-working`. Satır tıklaması `enterLane`; başka projedeyse önce
`state.setProjectPath(...)` — bu mantık bugün `presenceBar._focus`'ta
(`presenceBar.js:105-113`) yazılı, oradan devralınır. Daraltılmış hâlde statü
renkli ikon şeridi. En altta "Diğer projelerde N agent · M approval bekliyor"
satırı, `projectStatusBadges.computeCounts()` ile beslenir.

## Files

**Modified**

- `src/renderer/laneStatus.js` — statü etiketi + sunum yardımcılarının tek evi; `_armQuietTimer` ve init-once guard korunur (C5).
- `src/renderer/terminalsView.js` — tab şeridi, `openTab`/`closeTab`, büyüteç, `maximizedId`'nin kaldırılması, prefs'e `openTabs`/`activeTab`, rail hosting.
- `src/renderer/multiTerminalUI.js` — `detail` render yolunun ve hücre mantığının kaldırılması, `enterLane`/`isViewingFrame` yeniden tanımı, Home için idempotent board render.
- `src/renderer/terminalManager.js` — `gridLayout`/`setGridLayout` ve legacy `tabs|grid → detail` eşlemesinin kaldırılması, ölü viewMode restore temizliği; MRU pruning ve `clearProjectSession` wiring korunur (C5).
- `src/renderer/terminalTabBar.js` — sol bölüm `Home` + `Terminals`'a iner; terminal tab'ları, layout select, presence kabı ve ölü `onEnterFrames` kalkar.
- `src/renderer/laneBoard.js` — dört kartlık Home panosuna yeniden yazım, `mount()`/`update()` ayrımıyla (C2); init-once guard idiomu sürdürülür (C5).
- `src/renderer/agentDispatch.js` — `isViewingFrame`'in yeni anlamına uyum; `_startAgentIn` kullanıcıyı Overview'dan koparmaz.
- `src/renderer/projectStatusBadges.js` — proje başına yuvarlama saf `computeCounts()` olarak dışa açılır.
- `src/renderer/projectListUI.js` — workspace nav'dan `terminals` satırı ve ona bağlı sayaç/`◆ N` göstergesi kalkar; `clearProjectSession` wiring korunur (C5).
- `src/renderer/paletteSources.js` — `Go to Home` eklenir, `Go to Terminals` kalır.
- `src/renderer/index.js` — komut sözlüğü "Frame/Mainframe" → "Terminal/Home", kategori `Frames` → `Terminals`; `presenceBar` init'inin kaldırılması.
- `src/renderer/styles/components/lane-board.css` — top bar iki düğmeye iner, Home kartları, öksüz `.btn-lane-frames*` temizliği.
- `src/renderer/styles/components/terminals-view.css` — tab şeridi, tek-terminal gövdesi, `maximized` kurallarının kaldırılması.
- `src/renderer/styles/components/terminal.css` — presence chip kurallarının kaldırılması.
- `src/renderer/styles/components/orchestrator.css` — Home kartına taşınan orchestrator rozet kuralları.
- `src/renderer/styles/components/project-section.css` — workspace nav'dan kalkan Terminals satırının kuralları.

**New**

- `src/renderer/agentsRail.js` — `laneDetailRail.js`'ten `git mv`; agent-only liste, aciliyet sırası, daraltılmış ikon şeridi, cross-project satırı.

**Deleted**

- `src/renderer/laneDetailRail.js` — `agentsRail.js` olarak taşındı.
- `src/renderer/laneRail.js` — Home'un Specs/Tasks yan paneli; içeriği Home kartlarına geçti.
- `src/renderer/terminalGrid.js` — `detail` görünümünün hücre grid'i; yüzey emekli oldu.
- `src/renderer/presenceBar.js` — top bar agent chip'leri; Agents rail'e birleşti.

## Footprint

- src/renderer/laneStatus.js
- src/renderer/terminalsView.js
- src/renderer/multiTerminalUI.js
- src/renderer/terminalManager.js
- src/renderer/terminalTabBar.js
- src/renderer/laneBoard.js
- src/renderer/agentsRail.js
- src/renderer/laneDetailRail.js
- src/renderer/laneRail.js
- src/renderer/terminalGrid.js
- src/renderer/presenceBar.js
- src/renderer/agentDispatch.js
- src/renderer/projectStatusBadges.js
- src/renderer/projectListUI.js
- src/renderer/paletteSources.js
- src/renderer/index.js
- src/renderer/styles/components/lane-board.css
- src/renderer/styles/components/terminals-view.css
- src/renderer/styles/components/terminal.css
- src/renderer/styles/components/orchestrator.css
- src/renderer/styles/components/project-section.css

## Dependencies

None. Yeni paket yok, yeni IPC kanalı yok — `src/main/` ve
`src/shared/ipcChannels.js` bu spec'in dışında kalır. (CI `npm ci`
çalıştırmıyor; repo-yerel modüllerle çalışma kuralı zaten korunuyor.)

## Sequencing

1. **Statü sözlüğünü `laneStatus`'a taşı.** `statusLabel` (`short` bayraklı),
   `cleanCommand`, `formatRelativeTime`, `assignmentIcon`, `assignmentText`
   oraya taşınır; `laneBoard` ve `laneDetailRail` tüketiciye döner. Davranış
   değişmez, iki etiket sözlüğü teke iner. `_armQuietTimer` ve init-once
   guard'a dokunulmaz. — G7, C5
2. **Tab şeridini kur.** `terminalsView`'a `openTabs`/`activeTab` prefs'i,
   `_buildTabStrip()`, `openTab`/`closeTab`, tek-terminal gövdesi ve şeridin
   `overflow-x` davranışı. Overview gövdesi aynen korunur. Sekme ↔ Overview
   geçişinde mount her zaman yeniden yapılır. — G2, C1, C3
3. **Büyüteci bağla, `maximizedId`'yi kaldır.** `data-maximize` → `data-open`,
   `Maximize2` → `Search`, `openTab` çağrısı; `maximizedId` prefs'i ve onu
   okuyan `_buildLayoutBar`/`render`/`_buildPane` dalları silinir. — G2
4. **`detail`'i emekli et.** `_renderDetailView`, `_ensureAssignments`,
   `_assignCell`, `_newLaneInCell`, `_cellAssignments`, `_detailRailCallbacks`
   ve `TerminalGrid` import'u kaldırılır; `terminalGrid.js` silinir;
   `terminalManager`'dan `gridLayout`/`setGridLayout`, legacy eşleme ve ölü
   viewMode restore temizlenir. `enterLane` ve `isViewingFrame` yeniden
   tanımlanır, `agentDispatch` uyumlanır. MRU pruning korunur. — G3, C5
5. **Top bar'ı ikiye indir.** `_renderLeftSection` `Home` + `Terminals`;
   terminal tab'ları, layout select, presence kabı ve ölü
   `onEnterFrames`/`enterFrames` kaldırılır; `presenceBar.js` silinir ve
   `index.js`'teki init'i çıkarılır; öksüz `.btn-lane-frames*` CSS'i temizlenir.
   — G1
6. **Agents rail'i kur.** `git mv laneDetailRail.js agentsRail.js`; agent
   filtresi, aciliyet sırası, daraltılmış ikon şeridi, `enterLane` ile
   satır tıklaması ve `presenceBar._focus`'tan devralınan proje değiştirme.
   `projectStatusBadges`'e `computeCounts()` export'u eklenir ve rail'in alt
   satırı ondan beslenir. Rail her iki gövde tipinde render edilir. Init-once
   guard idiomu sürdürülür. — G5, C5
7. **Home'u kart panosuna çevir.** `laneBoard` dört karta yeniden yazılır,
   `mount()`/`update()` ayrımıyla; `_renderBoardView` idempotence guard'ı
   kazanır; `laneRail.js` silinir ve Specs/Tasks abonelikleri kartlara geçer;
   proje yokken proje seçimi gösterilir; Terminals kartı her durumda yeni
   terminal yaratır ve sekmesini açar. — G4, C2, C5
8. **Sidebar, palette, sözlük ve ölü kod süpürmesi.** `projectListUI`'dan
   `terminals` nav satırı ve göstergeleri; `paletteSources`'a `Go to Home`;
   `index.js` komut sözlüğü "Frame/Mainframe" → "Terminal/Home" ve kategori
   `Frames` → `Terminals`; kısayollar `enterLane`'in yeni anlamıyla; kalan
   "New Frame" metinleri; boş durumun tek yerde toplanması. — G6, G7
