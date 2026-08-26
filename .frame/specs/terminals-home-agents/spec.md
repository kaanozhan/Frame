---
keywords: home, terminals, overview, tabs, other terminals rail, status bar, navigation, view modes, lane board, top bar, cross-project attention, presence, sidebar nav groups
related: lane-orchestrator, decisions-view, agent-dispatch, agent-orchestration, sidebar-project-section, status-bar, sidebar-nav-groups
---

# Home, Terminals ve Agents — üç yüzeyin tek modele oturtulması

> **What we're building:** Frame'in merkez alanı bugün aynı nesnenin (terminal)
> üç ayrı yüzeyine bölünmüş durumda — Home (kart panosu), Terminals (canlı pane
> grid) ve isimsiz bir üçüncü `detail` görünümü. Bu spec üçünü tek bir modele
> indiriyor: **Home** bir proje panosuna dönüşüyor, **Terminals** kendi tab
> şeridine sahip tek bir bölüm oluyor (Overview + açılan terminaller),
> `detail` viewMode'u tamamen emekli oluyor ve sağdaki panel terminal listesi
> olmaktan çıkıp **Agents** takip paneline dönüşüyor.

## User's request (original, Turkish)

Başlangıç gözlemi:

> "Terminals ve Home görünümü ayrı viewlar olması güzel olmuş ama bence bir
> inconsistency yaratıyor. Kim nasıl kullanmak istiyorsa öyle kullanabilir ama
> sanki bir inconsistency var bir bakmanı istiyorum."

Konuşma boyunca kullanıcının verdiği kararlar (hepsi bu spec'e girdi):

> "Toolbar'a Home yanına Terminals gelsin ve sol menu'den terminals kalksın."

> "İlk satırda layoutlar vs cartlar curtlar var ya onlar olmayacak, orada
> Overview tab'ı açık olacak. Overview altında bu layout seçimleri drag drop vs
> şu an mevcut olan olacak. Şu anki expand iconu da büyüteç'e dönüşebilir,
> kullanıcı tıkladığında ona Overview yanında yeni bir tab açılarak o Terminal
> gelecek."

> "Sağdaki Terminals alanı … belki agents alanına dönüşebilir. Maksat çalışan
> agent'ların status'unu buradan görmek ve o ajana direkt ulaşabilmek. Kapalı
> halinde de küçük ikonlarla statuslarına göre ayrılabilir."

> "Home'u gerçekten bir takip layout'una dönüştürebiliriz. Bir card gibi çalışan
> … Orchestration ayrı bir kart, terminals ayrı bir kart, specs ve tasks ayrı
> kartlar olabilir. Hiçbir proje seçili değilse yine proje seçme
> önceliklendirilir, bu view değil."

> "Topbar chipleri kalkabilir. Agents rail sadece agent'ları listeleyecek."

> "Büyüteç'in kalması iyi olur gibi — otomatik açabilir yine terminal'i ama
> kullanıcı isterse kapar, kaparsa açar, açmaz ise overview'da kalır."


> "Terminals Work altına gelmiş ve orada yaşayan bir şey haline gelmiş. Şöyle
> bir şey yapılabilir: terminals de kapanabilir bir şey olur, böylelikle
> kapalıyken Work kısmından erişilebilir; onun dışında 2 yerden de erişilebilir
> olur." … "Amaç tam olarak kapatmak olmuyor zaten, sadece yukarıdaki
> toolbar'dan kaldırılıyor; Terminals içinde yaşamaya devam ediyor."

> "Overview'da zaten her terminal'in yanında ismi vs'si gözüküyor, bunu hiç
> dahil etmeyelim; statuları daha okunur şekilde terminal'in tepesine yazalım,
> görülür olsun ünlem işaretleriyle vs. Tekli terminal görünümünde ise Other
> Terminals gibi bir sağda section olsa."

> "Other Terminals sadece tekli görünümde olsun ve default kapalı olsun. Orada
> bir hover buton olsun, kullanıcı isterse açabilsin… Kapalı halindeyken de
> eğer bir agent approval bekliyorsa, kapalı halinde de tık diye o listede
> kırmızı ünlem agent'lı vs bir görünümle o da gözüksün."

> "Status bar => burada other agents ile ilgili bir alan… yoksa orada bir
> bilgilendirme olabilir: seçili proje dışındaki agentların takibi vs şeklinde.
> Olduğunda da agent sayısı ve durumları, approval vs bekleyen varsa o da daha
> kapsamlı gösterilebilir. Tıklandığında menu açılıp hızlı geçiş olur."

> "Ya da hover olsun, session kısmıyla tutarlı olsun."


## Problem

Bugün aynı terminal listesi **dört** yerde, dört farklı sözlükle render ediliyor:
top bar tab'ları, Home kartları, Terminals pane'leri, detail rail'i. Somut
kırıklar:

1. **Home kartına tıklamak varsayılan görünümü atlıyor.** `enterLane()` →
   `setViewMode('detail')` (`multiTerminalUI.js:241`), yani kullanıcı hiçbir
   menüden seçemeyeceği isimsiz bir yüzeye düşüyor.
2. **İki ayrı grid sistemi aynı işi yapıyor.** Terminals'ın 1/2/3 kolonu
   (`terminalsView.js`, kendi localStorage'ı) ve detail'in 1x1…3x3 hücre atama
   sistemi (`multiTerminalUI._ensureAssignments`, terminalManager session).
   Detail boş hücreleri açık terminallerle otomatik dolduruyor — yani 2x2
   detail ≈ 2 kolonlu Terminals.
3. **İki navigasyon sistemi birbirini bilmiyor.** Home yalnızca top bar'da,
   Terminals yalnızca sidebar'da (`projectListUI.js:238`).
4. **Sidebar'ın aktif göstergesi yalan söylüyor.** `surfaces` listelerinde
   `board` ve `detail` yok → Home'dayken veya bir terminaldeyken hiçbir satır
   yanmıyor, ama Specs/Tasks'ta yanıyor.
5. **Home tek yönlü ada.** Specs/Tasks/panel kapanışı ve son terminalin
   kapanışı hep `showTerminals()`'a dönüyor; Home'a dönüş yolu yok.
6. **Klavyenin tamamı `detail`'e bağlı.** `Ctrl+Tab`, `Cmd+1-9`,
   `Cmd+Shift+T` hepsi `enterLane` → detail. Varsayılan görünümün kısayolu yok.
7. **Sözlük üç parçalı.** Palette hâlâ "New Frame / Close Frame / Switch to
   Frame N / Back to Mainframe" diyor (`index.js:672-739`), Home kartı "New
   Frame" (`laneBoard.js:234`), aynı kartın tooltip'i "New Terminal"
   (`:229`), Terminals ise "New terminal".
8. **Aynı statü için iki etiket sözlüğü.** `laneBoard` "Agent working",
   `laneDetailRail` "Working", Terminals pane'i hiçbir şey (sadece nokta).
9. **Sağ rail her yüzeyde farklı.** Home → Specs/Tasks, detail → terminal
   listesi, Terminals → hiç.
10. **Boş durum iki kere yazılmış**, aynı metinle, farklı CTA'larla
    (`laneBoard.js:293`, `terminalsView.js:229`).
11. **Ölü kod:** `enterFrames()`/`onEnterFrames` hiçbir yerden tetiklenmiyor,
    `.btn-lane-frames` CSS'i öksüz, `restoreProjectSession`'ın viewMode
    restore'u iki satır sonra eziliyor (`terminalManager.js:132` vs `:227`).

## Karara bağlanmış UI modeli

Bu bölüm normatiftir. Uygulama buradan sapmamalıdır.

```
┌─ TOP BAR ──────────────────────────────────────────────────┐
│ Home   [Terminals]                        ⚙ ⋯              │
├────────────────────────────────────────────────────────────┤
│ [Overview] [Terminal 1] [Terminal 3]                       │
├────────────────────────────────────────────────────────────┤
│  LAYOUT ▮1 ▮▮2 ▮▮▮3        drag header to reorder     A    │
│  ┌──────────────┐ ┌──────────────┐                    g    │
│  │ Terminal 1 🔍│ │ Terminal 3 🔍│                    e    │
│  └──────────────┘ └──────────────┘                    n    │
│  ┌ + New terminal ────────────────┐                   t    │
│                                                       s    │
└────────────────────────────────────────────────────────────┘
```

### 1. Top bar


- Sabit ve tek durumlu değil artık — **tek kural**: `Home` kalıcıdır, top
  bar'daki diğer her şey *açılmış bir yüzeydir ve şeritten kaldırılabilir*.
- Şerit: `Home` · `Terminals` · açık section chip'leri (spec / task / diff /
  orchestrator).
- **`×` her zaman "bu şeritten kaldır" demektir, asla "yok et".** Terminals'ın
  `×`'i yalnızca onu top bar'dan düşürür: bölüm, açık terminal sekmeleri,
  Overview düzeni ve çalışan agent'lar aynen yaşamaya devam eder. Sidebar'daki
  **Work → Terminals** ile bıraktığın durumla geri gelir.
- Terminals açılışta şeritte **vardır** (Terminals landing view olmaya devam
  ediyor). Kaldırılmışsa Home'a düşülür.
- **Kural — yazılmalı, yoksa aşınır:** top bar *canlı durumu olan* yüzeyleri
  taşır. Terminals'ta çalışan process'ler ve kendi sekme şeridi var; Specs
  grid'inde yok. Specs/Tasks/Decisions/panel'ler sidebar'dan açılır ve top
  bar'da görünmez — bugünkü davranışları korunur.
- **Kalkanlar:** terminal başına tab'lar, grid layout select, presence
  chip'leri (`presenceBar.js` silinir).
- **Kalanlar:** tema toggle'ı (status-bar spec'iyle top bar'a taşındı),
  "…" menüsü, güncelleme bildirimi. **Claude kullanım barları status bar'a
  taşındı ve orada kalır** — top bar'a geri getirilmez.

### 2. Terminals bölümü — tab şeridi

- Bölümün ilk satırı bir tab şeridi: `[Overview] [Terminal N] …`
- **Overview** en solda, her zaman var, kapatılamaz.
- **Overview'ın içeriği bugünkü Terminals görünümüdür**: LAYOUT 1/2/3 kolon,
  başlıktan sürükleyip sıralama, alt kenardan boyutlandırma, `+ New terminal`
  hayalet pane'i. Bunlar aynen korunur.
- Pane başlığındaki bugünkü `⤢` **büyütece (🔍) dönüşür** ve anlamı değişir:
  artık "aynı görünüm içinde büyüt" değil, **"bu terminali kendi tab'ında aç"**
  demektir. `maximizedId` tercihi tamamen kalkar.

**Tab yaşam döngüsü (normatif):**

| Aksiyon | Sonuç |
|---|---|
| Terminal yaratılır (Home kartı, Overview'daki `+`, `Cmd+Shift+T`) | tab otomatik açılır **ve o tab'a geçilir** |
| Tab'ın × 'ine basılır | **tab kapanır, terminal yaşamaya devam eder** — Overview'da durur |
| Overview'da pane'in 🔍 'ına basılır | tab'ı açar; tab zaten açıksa ona geçer (ikinci tab açılmaz) |
| Overview'da pane'e tıklanır | **yerinde odaklanır, tab'a geçilmez** (Overview'ın yan yana izleme amacı korunur) |
| Terminal kapatılır (Overview pane'inin × 'ı, `Cmd+Shift+W`, süreç ölümü) | terminal ve varsa tab'ı birlikte kapanır |
| Proje değiştirilir | **terminal tab'ları atılmaz** — proje başına saklanır ve geri dönüldüğünde aynı sekmelerle karşılanır |
| Uygulama yeniden başlar | tab'lar gitmiş olur (terminal id'leri restart'ta yaşamıyor); Overview açılır |

- Tab şeridi terminal sayısıyla büyüyebilir (proje başına en fazla 9 terminal →
  Overview + 9 tab). Şeridin **yatay taşma davranışı tanımlı olmalıdır**
  (scroll); sessiz kırpma kabul edilmez.
- Bir tab'ın içeriği tek bir terminaldir — hücre yok, layout seçimi yok.

### 3. `detail` viewMode emekli oluyor

- `viewMode` seti: `board | terminals | specs | tasks | panel`. `detail` yok.
- Hücre atama mantığı (`_ensureAssignments`, `_assignCell`, `_newLaneInCell`),
  `terminalGrid.js` ve `gridLayout` plumbing'i silinir.
- `enterLane(terminalId)` tek çoke point olarak kalır, anlamı değişir:
  **"Terminals bölümüne geç ve o terminalin tab'ını aç/öne getir."** Home
  kartı, Agents rail, `agentDispatch`, `presenceBar`'dan devralınan odaklama —
  hepsi buradan geçer.
- `isViewingFrame()` yeniden tanımlanır: *"Terminals bölümündeyim ve odaklı bir
  terminal var"*. Bugün `viewMode === 'detail'` olduğu için varsayılan
  görünümde **her zaman false** dönüyor ve `agentDispatch` odaklı terminali hiç
  kullanmıyor (`agentDispatch.js:251`) — bu bir hatadır ve bu spec'te düzelir.

### 4. Home — proje panosu

- Home artık terminal listesi değil, **kart panosu**. Sağdaki Specs/Tasks
  rail'i (`laneRail.js`) kalkar; içeriği kartlara taşınır.
- Kartlar:
  - **Terminals** — kaç terminal var, çalışan agent'ların durumu, ve **her
    durumda** (boşken de doluyken de) doğrudan "yeni terminal" aksiyonu.
    Yeni terminal yaratılınca Terminals bölümüne geçilir ve o terminalin tab'ı
    açılır.
  - **Orchestration** — bugünkü orchestrator kartının davranışı korunur
    (aktifse "reattach", değilse "start").
  - **Specs** — aktif spec'lerin özeti.
  - **Tasks** — bekleyen task'ların özeti.
- Kural: **kart = özet + giriş noktası; sidebar = tam yüzey.** Kartlar
  dashboard'un yerini almaz, oraya götürür.
- **Proje seçili değilse Home gösterilmez** — proje seçimi önceliklendirilir
  (bugünkü `_renderNoProjectState` davranışı bu role taşınır).

### 5. Agent görünürlüğü — dört yüzey


Agent görünürlüğü tek bir panele değil, **dört yüzeye** dağılır. Kural:
*her yüzey, kendi bağlamının zaten gösteremediği şeyi gösterir.* Aynı liste
iki yerde çizilmez.

**5a — Overview: pane başlıkları.** Overview zaten bu projenin agent panosu;
yanına liste koymak tekrar olurdu. Bunun yerine pane başlığındaki statü
**okunur hale gelir**: durum metni ve dikkat işareti (approval en güçlüsü)
başlıkta net görünür. Overview'da ayrı bir rail **yoktur**.

**5b — "Other Terminals" rail: yalnızca tekli terminal gövdesinde.** Tek bir
terminale bakarken diğerlerini göremezsin; bu rail o boşluğu kapatır.
- Baktığın terminal hariç **projenin tüm terminallerini** listeler — sekmesi
  olan da olmayan da. Agent'lar işaretlidir. (Yalnızca agent'ları listeleme
  fikri elendi: hızlı geçiş de bu rail'in işi.)
- **Varsayılan kapalıdır.** Kenarda hover'da beliren bir düğmeyle açılır;
  açık/kapalı durumu hatırlanır.
- **Kapalıyken sessizdir ama kör değildir:** approval veya input bekleyen bir
  agent varsa dar şeritte kırmızı ünlem + agent göstergesi belirir. Çalışan ve
  idle terminaller kapalı şeritte hiç görünmez.
- Sekme şeridiyle karışmaması için kural: **şerit = açtıklarım arasında
  gezinme; rail = göremediklerimin durumu.**

**5c — Sidebar `◆` chip'i: bu proje, her yüzeyde.** `sidebar-nav-groups` ile
gelen Work → Terminals satırındaki `◆ N` göstergesi korunur ve **dikkat
durumu kazanır**: bugün yalnızca çalışan agent sayısı, bundan sonra biri
approval/input beklerken renk değiştirir. Beslemesi `projectStatusBadges`'in
zaten hesapladığı proje-başına approval/input sayımıdır — yeni veri yok. Bu,
Specs/Tasks/Decisions/panel'lerdeyken bu projenin agent'ını kaçırma boşluğunu
kapatır.

**5d — Status bar slotu: diğer projeler, her yüzeyde.** `status-bar` spec'inin
bilinçli boş bıraktığı sol slot (`statusBar.js:10`) doldurulur. Kapsamı
**yalnızca seçili proje dışındaki** agent'lardır ve etiketi bunu açıkça söyler
— yoksa "5 agent'ım var, neden 2 yazıyor?" sorusu doğar. Üç durum:
- *Hiç yok* → sönük, kendini açıklayan bir ipucu (slot'un ne olduğunu öğretir;
  kısa tutulur, uzun açıklama tooltip'te).
- *Var, hiçbiri bloke değil* → sakin sayı.
- *Approval/input bekleyen var* → öne çıkan, renkli ve daha kapsamlı.

**Hover menüyü açar, tık en acil agent'a gider** — bu, bar'ın kendi idiomudur:
kullanım ölçerleri de detayı hover'da açıyor, tıklama ise eylem (refresh)
(`status-bar.css:38-39`). Menü projeye göre gruplanır, satır tıklaması
gerekirse projeyi değiştirip o terminalin sekmesini açar. Bar pencerenin
dibinde olduğu için menü **yukarı** açılır; hover menüsü küçük bir açılma
gecikmesi ve bağışlayıcı bir kapanma alanı ister.

**Ortak sözlük.** Dört yüzey de aynı statü sözcüklerini ve aynı sembolleri
kullanır (§7). Sidebar chip'i ile status bar slotu aynı şeyi farklı kapsamda
söyler; farklı renk veya sembol kullanmaları kuralı tesadüfe çevirir.

### 6. Sidebar


- **Terminals sidebar'da kalır.** `sidebar-nav-groups` (2026-08-25) sol menüyü
  Work / Context / Frame gruplarına ayırdı ve Terminals'ı Work'ün ilk satırı
  yaptı. Bu karar **geri çevrilmez, üstüne binilir**: sidebar Work → Terminals
  *açma noktasıdır*, top bar'daki Terminals ise *açık olandır*. Tekrar değil,
  iki farklı iş.
- Satırın terminal sayısı korunur; `◆` göstergesi §5c'deki dikkat durumunu
  kazanır.
- Gruplar ve katlanma durumu olduğu gibi korunur. `historyPanel` aynı merge'de
  emekli oldu; bu spec onu geri getirmez.

### 7. Sözlük

- Kullanıcıya görünen tek kelime **"terminal"**dir. "Frame", "Frames",
  "Mainframe", "Lane" kullanıcı arayüzünde hiçbir yerde geçmez.
  - `index.js` palette: "New Frame" → "New Terminal", "Close Frame" →
    "Close Terminal", "Next/Previous Frame", "Switch to Frame N",
    "Back to Mainframe" → "Home", kategori "Frames" → "Terminals".
  - `laneBoard.js:234` ve `terminalGrid.js:136`'daki "New Frame" metinleri.
- **Statü etiketleri tek bir kaynaktan gelir.** Bugün `laneBoard.STATUS_LABELS`
  ("Agent working") ve `laneDetailRail.STATUS_SHORT` ("Working") ayrı ayrı
  tanımlı; tek bir tabloya indirilir ve Home kartı, Agents rail ve Overview
  pane başlığı aynı sözcükleri kullanır.
- Kod içi `lane*` modül/dosya isimleri değişmez (2026-08-20 kuralı korunur):
  kod "lane" der, kullanıcı arayüzü "terminal" der.

## Goal / Acceptance

- [ ] Top bar `Home` · `Terminals` · açık section chip'lerinden oluşuyor;
      terminal başına tab'lar, grid layout select ve presence chip'leri orada
      değil. S1
- [ ] Terminals bölümü bir tab şeridi gösteriyor; `Overview` en solda ve
      kapatılamaz durumda. S2
- [ ] Overview bugünkü çoklu görünümün davranışını (kolon 1/2/3,
      sürükle-sırala, boyutlandırma) aynen koruyor. S3
- [ ] Pane başlığındaki büyüteç o terminali kendi sekmesinde açıyor; ikinci kez
      basınca yeni sekme açmayıp var olana geçiyor. S4
- [ ] Sekme yaşam döngüsü tablosundaki yedi satırın her biri tanımlandığı gibi
      çalışıyor. S5
- [ ] `detail` viewMode, `terminalGrid.js`, hücre atama mantığı ve `gridLayout`
      kodda yok. S6
- [ ] `enterLane` "o terminalin sekmesini aç/öne getir" anlamında tek giriş
      noktası. S7
- [ ] `isViewingFrame()` Overview'da ve terminal sekmesinde doğru cevap
      veriyor; odaklı boş terminal varken Start onu kullanıyor. S8
- [ ] Home dört karttan oluşuyor (Terminals, Orchestration, Specs, Tasks);
      `laneRail.js` yok. S9
- [ ] Home'un Terminals kartı hem boşken hem doluyken yeni terminal yaratıyor
      ve sekmesini açıyor. S10
- [ ] Proje seçili değilken Home değil, proje seçimi gösteriliyor. S11
- [ ] "Other Terminals" rail yalnızca tekli terminal gövdesinde var; baktığın
      terminal hariç projenin tüm terminallerini durumlarıyla listeliyor ve
      tıklama hızlı geçiş yapıyor. S12
- [ ] Status bar'ın sol slotu **yalnızca seçili proje dışındaki** agent'ları
      kapsıyor ve etiketi kapsamını açıkça söylüyor. S13
- [ ] `presenceBar.js` silinmiş ve top bar'daki chip alanı kaldırılmış. S14
- [ ] Sidebar'da Terminals, Work grubunun ilk satırı olarak duruyor; sayısı ve
      `◆` göstergesi çalışıyor. S15
- [ ] Kullanıcıya görünen hiçbir metinde "Frame/Frames/Mainframe/Lane"
      geçmiyor. S16
- [ ] Statü sözcükleri ve dikkat sembolleri tek kaynaktan geliyor; Overview
      pane başlığı, Other Terminals rail'i, sidebar chip'i ve status bar slotu
      aynı sözlüğü kullanıyor. S17
- [ ] Ölü kod temizlendi: `enterFrames()`/`onEnterFrames`, `.btn-lane-frames`
      CSS'i, ezilen viewMode restore'u. S18
- [ ] Boş durum tek yerde tanımlı. S19
- [ ] Testler geçiyor. S20
- [ ] Terminals'ın `×`'i bölümü yok etmiyor: terminaller, sekmeler ve Overview
      düzeni yaşıyor; Work → Terminals bıraktığın durumla geri getiriyor. S21
- [ ] Overview pane başlığı okunur statü metni ve dikkat işareti taşıyor;
      Overview'da ayrı bir rail yok. S22
- [ ] Other Terminals rail varsayılan kapalı; kenardaki hover düğmesiyle
      açılıyor ve açık/kapalı durumu hatırlanıyor. S23
- [ ] Rail kapalıyken dar şeritte yalnızca approval/input bekleyenler
      görünüyor; çalışan ve idle terminaller sessiz. S24
- [ ] Sidebar `◆` chip'i approval/input bekleyen varken dikkat durumuna
      geçiyor; beslemesi mevcut `projectStatusBadges` sayımı, yeni IPC yok. S25
- [ ] Status bar slotu üç durumu doğru gösteriyor (yok → ipucu · var → sakin
      sayı · bekleyen var → öne çıkan); hover menüyü açıyor, tık en acil
      agent'a götürüyor; menü yukarı açılıyor ve projeye göre gruplu. S26
- [ ] Home'un Specs kartı `!malformed` filtresini taşıyor. S27


## Uygulamada uyulması zorunlu teknik kısıtlar

Bunlar konuşma sırasında kodda doğrulandı; tasarım tercihi değil, kısıttır.

1. **Bir terminal aynı anda tek bir yerde canlı olabilir.**
   `mountTerminal` terminalin DOM elementini kopyalamaz, **taşır**
   (`terminalManager.js:547`, `container.appendChild(instance.element)`).
   Tab ile Overview aynı terminal örneğini paylaşır; geçişte mount taşınır ve
   hedefte yeniden mount edilir. Bu kural yazılmazsa "tab'a geçtim, Overview'a
   döndüm, pane boş" şeklinde sessiz bir hata çıkar. **Bu modelin en olası
   hata kaynağıdır.**

2. **Merkeze inline mount edilen ve mount'ta veri yükleyen yüzeyler
   idempotent olmak zorundadır.** 2026-08-20'de kayıtlı ders: section chip'i
   açıkken her veri push'u `_onStateChange`'e geri besleniyor ve mount'ta veri
   yükleyen yüzey saniyede ~100 IPC round-trip'e çıkıp CPU'yu %163'e taşıdı.
   Home dört canlı veri kartıyla tam olarak bu şekildedir ve bugün
   `laneBoard.render()` her state değişiminde `container.innerHTML = ''` yapıp
   her şeyi baştan kuruyor (`laneBoard.js:133-169`). **Home kartları bir kez
   mount olur, sonra yerinde güncellenir** — `laneBoard`'un mevcut
   `_updateCardStatus` / `_updateBranchChips` idiomu tüm kartlara genişletilir.
   Bu spec kabul edilmeden önce ölçülmelidir: boştaki IPC sayacı ve CPU.

3. **Proje değişimi terminalleri öldürmez.** `terminals` tek bir Map'tir ve
   geçişte budanmaz; `getTerminalStates()` yalnızca görünümü filtreler
   (`terminalManager.js:666-672`). PTY'ler, scrollback ve çalışan agent'lar
   yaşamaya devam eder. Tab'lar da bu yüzden atılmaz, proje başına saklanır.

4. **`saveProjectSession` terminali olmayan proje için erken dönüyor**
   (`terminalManager.js:163-165`). Tab durumu oraya yazılacaksa bu erken dönüş
   gözden geçirilmelidir, yoksa sıfır terminalli projenin durumu hiç kaydedilmez.


5. **Gelen merge'ün kararları korunur (`sidebar-nav-groups`, `status-bar`,
   `spec-status-repair` — 2026-08-25).**
   - Sol menünün Work / Context / Frame grupları, katlanma durumu ve Terminals
     satırının sayacı korunur; `historyPanel`'in emekliliği geri alınmaz.
   - Claude kullanım ölçerleri status bar'da kalır, top bar'a geri taşınmaz;
     tema toggle'ı top bar'da kalır.
   - Spec listelerindeki `!malformed` filtresi (`laneRail.js:204`,
     `multiTerminalUI.js:520`) korunur. **Home'un Specs kartı `laneRail`'in
     aboneliklerini devralırken bu filtreyi taşımak zorundadır**, yoksa yeni
     gelen düzeltme regresyona uğrar.
## Kapsam dışı

- **Cross-project mimarisinin geri kalanı.** Bu spec status bar slotunu ve onun
  hover menüsünü getiriyor; **projeye gitmeden müdahale** (başka projenin
  terminaline oradan yazmak) ve **OS bildirim katmanı** ayrı bir spec'e
  (`cross-project-attention`) bırakılır.
- **Section chip'lerinin kendi bölümlerine indirilmesi.** Terminals kendi sekme
  şeridini kazandıktan sonra "spec chip'leri neden hâlâ top bar'da?" sorusu
  meşrudur, ama kapsamı büyütür.
- **Overview'da seçici pane gizleme.** `detail`'in hücre atama yeteneği bilinçli
  kaybediliyor; karşılığında sürükle-sırala ve sekmeler var.
- **Status bar'ın sağ yarısı.** Kullanım ölçerleri `status-bar` spec'inin işi;
  bu spec yalnızca boş bırakılmış sol slotu doldurur.
- Memory / Team / prototipin diğer adımları.


## Açıkça geri çevrilen kararlar

- **`retire-rail-and-panels` (2026-08-20)** — *"One navigation system remains:
  sidebar workspace nav → center views."* Artık top bar da canlı yüzeyler için
  bir hızlı yol taşıyor. Yumuşak bir çevirme: sidebar **eksiksiz** navigasyon
  olmaya devam ediyor (Terminals dahil), top bar yalnızca açık olanı gösteriyor.
- **`topbar-presence` (2026-08-20)** — presence chip'leri siliniyor;
  `presenceBar.js` gidiyor. Taşıdığı proje-üstü dikkat değeri kaybolmuyor,
  status bar slotuna (§5d) ve sidebar chip'ine (§5c) dağılıyor.
- **`lane-orchestrator` (2026-06)** — board'un landing view olması zaten
  `terminals-view` tarafından çevrilmişti; burada Home'un rolü yeniden
  tanımlanıyor (terminal panosu → proje panosu) ve detail/grid yüzeyi tamamen
  emekli oluyor.

**Açıkça geri çevrilmeyenler** — üstüne binilenler:

- **`sidebar-nav-groups` (2026-08-25)** — Work/Context/Frame grupları ve
  Terminals'ın Work'teki yeri **korunur**. Bu spec'in ilk taslağı Terminals'ı
  sidebar'dan kaldırıyordu; o karar geri alındı.
- **`status-bar` (2026-08-25)** — bilinçli boş bırakılan sol slot doldurulur;
  bar'ın "hover açar, tık iş yapar" idiomu ve kullanım ölçerlerinin yeri
  korunur.
- **`terminals-view` (2026-08-20)** — Terminals'ın landing view olması ve
  sidebar workspace nav girişi olması **korunur**.


## Değerlendirilip elenen alternatifler

- **"Çoklu mod / tekli mod" ikilisi.** Sekme şeridi lehine elendi: modeli gizli
  bir mod durumu olmadan kuruyor, birden fazla terminali açık tutmaya izin
  veriyor.
- **Büyütecin tamamen kaldırılması** (her terminal kalıcı sekme alsın). Elendi:
  sekme kapatmayı ya yıkıcı ya geri alınamaz yapıyordu.
- **Overview'da pane tıklamasının sekme açması.** Elendi: Overview'ın var oluş
  sebebi birden fazla terminali izleyip birine yazabilmek.
- **Presence chip'lerinin korunması.** Elendi: status bar slotu ve sidebar
  chip'i aynı işi okunur biçimde yapıyor.
- **Terminals'ın sidebar'dan kaldırılması.** Elendi: `sidebar-nav-groups`
  Work grubuyla ona prensipli bir ev verdi ("eylemde bulunduğun yer"), ve
  sidebar = açma noktası / top bar = açık olan ayrımı tekrar değil.
- **Tek bir "Agents" rail'i.** Elendi: Overview'ın pane başlıklarıyla ve status
  bar slotuyla çakışıyordu, üstelik Terminals şeritten kaldırılınca hiç
  görünmüyordu — yani hiçbir zaman "terminal view'dan bağımsız" olamıyordu.
- **Rail'in yalnızca agent'ları listelemesi.** Elendi: tekli görünümde düz
  shell'lere geçiş yolu kalmıyordu; rail'in işi durum kadar hızlı geçiş de.
- **Status bar slotunun tüm projeleri kapsaması.** Elendi: Overview'da ekranda
  olanı tekrar ederdi ve bu projenin dikkati zaten sidebar chip'inde.
- **Status bar menüsünün tıkla açılması.** Elendi: bar'ın kendi idiomu hover
  açar / tık iş yapar (`status-bar.css:38-39`).
