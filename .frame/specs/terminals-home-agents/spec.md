---
keywords: home, terminals, overview, tabs, agents rail, navigation, view modes, lane board, top bar, cross-project attention, presence
related: lane-orchestrator, decisions-view, agent-dispatch, agent-orchestration, sidebar-project-section
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

- Sabit ve tek durumlu: **yalnızca `Home` ve `Terminals`** + sağdaki action
  cluster (kullanım barları, ayarlar, "…" menüsü, güncelleme bildirimi).
- Hangi bölümdeysen o vurgulanır.
- Bugünkü **terminal başına tab'lar top bar'dan kalkar** — onlar Terminals
  bölümünün kendi tab şeridine iner.
- Bugünkü **grid layout select** (1x1…3x3) kalkar.
- Bugünkü **presence chip'leri (◆) kalkar** — `presenceBar.js` silinir.
- Açık section chip'leri (spec / task / diff / orchestrator) bugünkü gibi top
  bar'da kalmaya devam eder. Kural: **dıştaki şerit "hangi bölümdeyim",
  içteki şerit "bölüm içinde ne açık"** demektir.

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

### 5. Agents rail

- Sağdaki panel terminal listesi olmaktan çıkar, **yalnızca agent'ları**
  listeler. Agent olmayan terminaller rail'de görünmez (onlara erişim tab
  şeridi ve Overview üzerindendir).
- **Hem Overview'da hem terminal tab'larında** görünür.
- Sıralama bugünkü aciliyet önceliğini korur:
  `agent-approval → agent-input → agent-working`.
- Bir satıra tıklamak o agent'ın terminaline gider (`enterLane`).
- **Daraltılmış hâlde** statü renklerine göre küçük ikonlardan oluşan bir
  şerit olarak kalır — kullanıcı paneli küçültse bile approval bekleyen
  agent'ı görebilir. Collapse mekaniği `sectionRail`/`laneRail`'in mevcut
  `.lane-rail` idiomundan devralınır, yeni bir rail implementasyonu yazılmaz.
- **Cross-project:** rail'in kendisi mevcut projeye aittir. En altta tek bir
  satır bulunur — *"Diğer projelerde N agent · M approval bekliyor"* — ve
  tıklandığında o projeye geçirir. Bu satırın verisi `projectStatusBadges`'in
  zaten hesapladığı proje başına approval/input sayımından gelir; **yeni IPC
  kanalı veya yeni hesaplama eklenmez.**

### 6. Sidebar

- **Terminals satırı sidebar'dan kalkar.** Kalanlar: Specs, Tasks, Decisions,
  Structure, GitHub, Claude, Prompts, History, Activity.
- Bölünme kuralı: **top bar = canlı iş (Home, Terminals); sidebar = proje
  artefaktları.** Bu kural korunmalıdır — Specs/Tasks top bar'a taşınmaz,
  terminal sidebar'a dönmez.

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

- [ ] Top bar'da yalnızca `Home` ve `Terminals` var; terminal tab'ları, grid
      layout select ve presence chip'leri orada değil.
- [ ] Terminals bölümü bir tab şeridi gösteriyor; `Overview` en solda ve
      kapatılamaz durumda.
- [ ] Overview bugünkü çoklu görünümün davranışını (kolon 1/2/3, sürükle-sırala,
      boyutlandırma, `+ New terminal`) aynen koruyor.
- [ ] Pane başlığındaki büyüteç o terminali kendi tab'ında açıyor; ikinci kez
      basınca yeni tab açmayıp var olana geçiyor.
- [ ] Yukarıdaki tab yaşam döngüsü tablosundaki yedi satırın her biri
      tanımlandığı gibi çalışıyor — özellikle: tab'ı kapatmak terminali
      öldürmüyor, ve proje değişimi tab'ları kaybettirmiyor.
- [ ] `detail` viewMode, `terminalGrid.js`, hücre atama mantığı ve `gridLayout`
      kodda yok.
- [ ] `enterLane` "o terminalin tab'ını aç/öne getir" anlamında tek giriş
      noktası; Home kartı, Agents rail ve `agentDispatch` oradan geçiyor.
- [ ] `isViewingFrame()` Overview'da ve terminal tab'ında doğru cevap veriyor;
      odaklı terminal boştayken Start onu kullanıyor, yeni terminal açmıyor.
- [ ] Home dört karttan oluşuyor (Terminals, Orchestration, Specs, Tasks);
      Specs/Tasks yan paneli (`laneRail.js`) yok.
- [ ] Home'un Terminals kartı hem boşken hem doluyken doğrudan yeni terminal
      yaratabiliyor; yarattığında Terminals'a geçip o terminalin tab'ını açıyor.
- [ ] Proje seçili değilken Home değil, proje seçimi gösteriliyor.
- [ ] Agents rail yalnızca agent'ları listeliyor, aciliyet sırasında, hem
      Overview'da hem tab'larda; daraltılmış hâlde statü ikonu şeridi kalıyor.
- [ ] Agents rail'in altında "diğer projelerde N agent" satırı var ve o projeye
      geçiriyor; bu satır yeni IPC kanalı kullanmıyor.
- [ ] `presenceBar.js` silinmiş ve top bar'daki chip alanı kaldırılmış.
- [ ] Sidebar'da Terminals satırı yok; kalan satırların aktif vurgusu doğru
      çalışıyor (Home ve Terminals sidebar'da yer almadığı için sidebar'ın
      "hiçbiri aktif değil" durumu artık tutarlı).
- [ ] Kullanıcıya görünen hiçbir metinde "Frame/Frames/Mainframe/Lane" geçmiyor.
- [ ] Statü etiketleri tek kaynaktan geliyor; Home kartı, Agents rail ve
      Overview pane'i aynı sözcükleri kullanıyor.
- [ ] Ölü kod temizlendi: `enterFrames()`/`onEnterFrames`, `.btn-lane-frames`
      CSS'i, `restoreProjectSession`'ın ezilen viewMode restore'u.
- [ ] Boş durum tek yerde tanımlı (Home kartı ve Overview aynı metni tekrar
      etmiyor).
- [ ] Testler geçiyor.

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

## Kapsam dışı

- **Cross-project mimarisi.** Bu spec yalnızca yukarıdaki tek satırlık dikkat
  göstergesini ekler. Ambient bir cross-project yüzeyi, başka projeye gitmeden
  müdahale, ve OS bildirim katmanı ayrı bir spec'e (`cross-project-attention`)
  bırakılır. Not: veri katmanı zaten hazır — `laneStatus` bütün projelerin
  terminallerini izliyor ve `projectStatusBadges` proje başına dikkat sayımını
  hesaplıyor; eksik olan yalnızca görünür bir ev.
- **Section chip'lerinin (spec/task/diff) kendi bölümlerine indirilmesi.**
  Terminals kendi tab şeridini kazandıktan sonra "spec tab'ları neden hâlâ top
  bar'da?" sorusu meşrudur, ama bu spec'in kapsamını büyütür — ayrı ele alınır.
- **Overview'da pane gizleme / seçici çoklu görünüm.** Detail'in hücre atama
  yeteneği (belirli terminalleri seçip izleme) bilinçli olarak kaybediliyor;
  karşılığında sürükle-sırala ve tab'lar var. İhtiyaç doğarsa ayrı iş.
- Memory / Team / prototipin diğer adımları.

## Açıkça geri çevrilen kararlar

- **`retire-rail-and-panels` (2026-08-20)** — *"One navigation system remains:
  sidebar workspace nav (nine entries) → center views."* Artık prensipli bir
  ikili bölünme var: top bar = canlı iş, sidebar = proje artefaktları.
  Terminals sidebar'dan çıkıyor.
- **`topbar-presence` (2026-08-20)** — presence chip'leri Agents rail'e
  birleşiyor; `presenceBar.js` siliniyor. Chip'lerin taşıdığı proje-üstü
  dikkat değeri, rail'in alt satırıyla korunuyor.
- **`lane-orchestrator` (2026-06)** — board'un landing view olması zaten
  `terminals-view` (2026-08-20) tarafından çevrilmişti; burada Home'un rolü
  tamamen yeniden tanımlanıyor (terminal panosu → proje panosu). Ayrıca
  lane-orchestrator'ın detail/grid yüzeyi tamamen emekli oluyor.
- **`terminals-view` (2026-08-20)** — Terminals'ın varsayılan landing view
  olması korunuyor; ancak "Terminals sidebar workspace nav girişidir" kısmı
  çevriliyor.

## Değerlendirilip elenen alternatifler

- **"Multi mod / single mod" ikilisi.** Terminals'ın iki modu olması ve
  moda göre farklı davranması önerildi; tab şeridi lehine elendi. Sebep: tab
  modeli "var olan terminaller" ile "üzerinde çalıştıklarım" ayrımını doğal
  olarak kuruyor, birden fazla terminali aynı anda açık tutmayı sağlıyor ve
  mod hafızası gibi gizli bir durum gerektirmiyor.
- **Büyütecin tamamen kaldırılması** (her terminal otomatik ve kalıcı bir tab
  alsın). Elendi: tab kapatmayı ya yıkıcı (terminali öldürür) ya da
  geri alınamaz (kapatılan tab bir daha açılamaz) hâle getiriyordu. Mevcut
  karar ikisini de çözüyor: otomatik açılır, istenirse kapatılır, büyüteçle
  geri açılır.
- **Overview'da pane tıklamasının tab açması.** Elendi: Overview'ın var oluş
  sebebi birden fazla terminali yan yana izleyip birine yazabilmek; tıklama
  seni oradan çıkarsaydı bu amaç ortadan kalkardı.
- **Presence chip'lerinin korunması.** Elendi: Agents rail ile birebir aynı
  işi yapıyor; ikisi de kalsaydı bu spec'in çözdüğü "aynı liste iki yerde"
  problemi agent katmanında yeniden kurulmuş olurdu.
