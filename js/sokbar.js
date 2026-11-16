/* =============================================================================
   SOKBAR.JS — fast rad längst ned på alla vyer. ÄGS AV SÖKBAR-CHATTEN.
   Mönster: fast inslag. Injicerar egen markup i document.body och registrerar
   en init med registerInit() (core.js anropar den i showApp()).

   Vad den gör: man skriver ett ord eller en fråga, AI svarar i en ruta ovanför
   raden. Sökningar sparas i historiken och enskilda svar kan sparas (📌).
   Läser aldrig någon annan flikes data.

   Drive: Sokbar/sokbar.json  =  { history:[entry], saved:[entry] }
   entry = { id, q, typ:"ord"|"svar", rubrik, svar, synonymer:[], anmarkning, ts, savedAt? }
   Alla skrivningar går via driveUpdateJson (strikt läsning först), så ett läsfel
   kan aldrig skriva över sparad data.
   ============================================================================= */
(function sokbarModule() {
  if (window.__sokbarLoaded) return; // dubblettskydd
  window.__sokbarLoaded = true;

  var SOKBAR_FOLDER = ["Sokbar"], SOKBAR_FILE = "sokbar.json";
  var SOKBAR_HISTORY_MAX = 100, SOKBAR_SAVED_MAX = 300;
  var SOKBAR_SYSTEM =
    "Du är Sökbar, ett snabbt uppslagsverk i ett svenskt skrivprogram. Svara alltid på svenska, kort, korrekt och utan onödig inledning.\n"
    + "Är frågan ett enskilt ord eller en mycket kort fras: sätt typ till \"ord\", ge betydelsen i svar (en eller två meningar), "
    + "4 till 8 synonymer i synonymer, och vid behov en kort notering om stavning, böjning eller vanliga fel i anmarkning.\n"
    + "Är det en fråga (språk, grammatik, skrivande, fakta): sätt typ till \"svar\" och svara direkt i svar. Lämna synonymer som [] och anmarkning som \"\".\n"
    + "Svara ENDAST med ett JSON-objekt, utan markdown:\n"
    + "{\"typ\":\"ord\"|\"svar\",\"rubrik\":\"kort rubrik\",\"svar\":\"text\",\"synonymer\":[\"...\"],\"anmarkning\":\"...\"}";

  // ---- Filens tillstånd (nollställs i onSignOut) ----
  var sokbarHistory = [], sokbarSaved = [];
  var sokbarReadFailed = false, sokbarLoaded = false;
  var sokbarCurrent = null;       // entry som visas i rutan just nu
  var sokbarSeq = 0;              // ökar vid varje ny sökning / utloggning
  var sokbarAbort = null;         // AbortController för pågående sökning
  var sokbarObserver = null, sokbarDocHandler = null, sokbarResizeHandler = null;

  function sokbarEl(id) { return document.getElementById(id); }
  function sokbarNewId() { return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---------------------------------------------------------------------------
  // Drive
  // ---------------------------------------------------------------------------
  async function sokbarLoad() {
    var gen = sokbarSeq;
    try {
      var d = await driveReadJson(SOKBAR_FOLDER, SOKBAR_FILE);
      if (gen !== sokbarSeq && !sokbarEl("sokbar-root")) return; // utloggad under tiden
      sokbarHistory = (d && Array.isArray(d.history)) ? d.history : [];
      sokbarSaved = (d && Array.isArray(d.saved)) ? d.saved : [];
      sokbarReadFailed = false; sokbarLoaded = true;
    } catch (e) {
      sokbarReadFailed = true;
      showDriveError("Ladda Sökbar", e, function () { sokbarLoad(); });
    }
  }
  // Strikt läs-ändra-skriv. Kastar vid läsfel (inget skrivs). Uppdaterar lokal kopia.
  async function sokbarMutate(fn) {
    var next = await driveUpdateJson(SOKBAR_FOLDER, SOKBAR_FILE, function (d) {
      if (!Array.isArray(d.history)) d.history = [];
      if (!Array.isArray(d.saved)) d.saved = [];
      fn(d);
      d.history = d.history.slice(0, SOKBAR_HISTORY_MAX);
      d.saved = d.saved.slice(0, SOKBAR_SAVED_MAX);
      return d;
    }, { defaultValue: { history: [], saved: [] } });
    if (!sokbarEl("sokbar-root")) return next; // utloggad under tiden
    sokbarHistory = next.history || []; sokbarSaved = next.saved || [];
    sokbarReadFailed = false; sokbarLoaded = true;
    return next;
  }

  // ---------------------------------------------------------------------------
  // Rad och padding
  // ---------------------------------------------------------------------------
  function sokbarApplyPadding() {
    var bar = sokbarEl("sokbar-root");
    if (!bar) return;
    var pad = (Math.ceil(bar.getBoundingClientRect().height) + 20) + "px";
    document.body.style.paddingBottom = pad;
    var wrap = document.querySelector(".wrap");
    if (wrap) wrap.style.paddingBottom = pad;
  }
  function sokbarInject() {
    if (sokbarEl("sokbar-root")) return;
    document.body.insertAdjacentHTML("beforeend",
      "<div class='dict-bar' id='sokbar-root'>"
      + "<div class='dict-result' id='sokbar-result' role='region' aria-live='polite' aria-label='Sökresultat'></div>"
      + "<div class='dict-combined-row'>"
      + "<div class='dict-input-row' style='flex:1'>"
      + "<input type='text' id='dictInput' placeholder='Slå upp ett ord eller ställ en fråga' autocomplete='off' autocapitalize='off' enterkeyhint='search' aria-label='Sök'>"
      + "<button type='button' class='abtn' id='sokbar-go' style='padding:7px 14px;font-size:14px' aria-label='Sök'>&#8594;</button>"
      + "<div class='dropup' id='sokbar-dropup'>"
      + "<button type='button' class='gear-btn' id='sokbar-menu-btn' title='Historik och sparade svar' aria-label='Historik och sparade svar'>&#9776;</button>"
      + "<div class='dropup-menu' id='sokbar-menu'>"
      + "<button type='button' id='sokbar-open-history'>🕘 Historik</button>"
      + "<button type='button' id='sokbar-open-saved'>📌 Sparade svar</button>"
      + "</div></div>"
      + "</div></div></div>");

    var input = sokbarEl("dictInput");
    input.onkeydown = function (e) {
      if (e.key === "Enter") { e.preventDefault(); sokbarSearch(input.value); }
      else if (e.key === "Escape") { sokbarCloseResult(); }
    };
    sokbarEl("sokbar-go").onclick = function () { sokbarSearch(input.value); };
    sokbarEl("sokbar-open-history").onclick = function () { sokbarOpenList("history"); };
    sokbarEl("sokbar-open-saved").onclick = function () { sokbarOpenList("saved"); };

    // Dropup: egen liten bindning så att dokumentlyssnaren kan tas bort vid utloggning.
    var wrapEl = sokbarEl("sokbar-dropup"), btn = sokbarEl("sokbar-menu-btn"), menu = sokbarEl("sokbar-menu");
    function setOpen(o) { menu.classList.toggle("open", o); btn.setAttribute("aria-expanded", o ? "true" : "false"); }
    btn.setAttribute("aria-haspopup", "true"); btn.setAttribute("aria-expanded", "false");
    btn.onclick = function () {
      var o = !menu.classList.contains("open");
      setOpen(o);
      if (o) { var first = menu.querySelector("button"); if (first) first.focus(); }
    };
    menu.addEventListener("click", function () { setOpen(false); });
    menu.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.focus(); } });
    sokbarDocHandler = function (e) { if (menu.classList.contains("open") && !wrapEl.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", sokbarDocHandler);

    // Bottenutrymme i synk med radens höjd (den växer när resultat visas).
    var bar = sokbarEl("sokbar-root");
    if (window.ResizeObserver) { sokbarObserver = new ResizeObserver(sokbarApplyPadding); sokbarObserver.observe(bar); }
    else { sokbarResizeHandler = sokbarApplyPadding; window.addEventListener("resize", sokbarResizeHandler); }
    sokbarApplyPadding();
  }

  // ---------------------------------------------------------------------------
  // Resultatrutan
  // ---------------------------------------------------------------------------
  function sokbarCloseResult() {
    sokbarSeq++; // gör att ett pågående svar inte ritas
    if (sokbarAbort) { try { sokbarAbort.abort(); } catch (e) {} sokbarAbort = null; }
    sokbarCurrent = null;
    var r = sokbarEl("sokbar-result");
    if (r) { r.classList.remove("visible"); r.innerHTML = ""; }
  }
  function sokbarResultBox() {
    var r = sokbarEl("sokbar-result");
    if (r) r.classList.add("visible");
    return r;
  }
  function sokbarIsSaved(entry) {
    return sokbarSaved.some(function (s) { return s.id === entry.id; });
  }
  function sokbarShow(entry) {
    var r = sokbarResultBox();
    if (!r) return;
    sokbarCurrent = entry;
    var syn = (entry.synonymer || []).map(function (s) { return "<span class='synonym-chip'>" + esc(s) + "</span>"; }).join("");
    r.innerHTML =
      "<button type='button' class='dict-close' id='sokbar-close' aria-label='Stäng'>&times;</button>"
      + "<span class='note-label'>" + (entry.typ === "ord" ? "Ord" : "Svar") + " · " + esc(entry.q) + "</span>"
      + (entry.rubrik ? "<div style='font-weight:600;color:var(--text-bright);margin-bottom:6px;padding-right:30px'>" + esc(entry.rubrik) + "</div>" : "")
      + "<div style='font-size:14px;line-height:1.6;color:var(--text-bright);white-space:pre-wrap;max-height:40vh;overflow-y:auto'>" + esc(entry.svar) + "</div>"
      + (syn ? "<div style='margin-top:8px'>" + syn + "</div>" : "")
      + (entry.anmarkning ? "<div class='swhy' style='margin-top:8px'>" + esc(entry.anmarkning) + "</div>" : "")
      + "<div class='row mt8' style='margin-bottom:0;flex-wrap:wrap'>"
      + "<button type='button' class='action-btn' id='sokbar-copy'>Kopiera</button>"
      + "<button type='button' class='action-btn' id='sokbar-save'" + (sokbarIsSaved(entry) ? " disabled" : "") + ">"
      + (sokbarIsSaved(entry) ? "📌 Sparat" : "📌 Spara svar") + "</button>"
      + "<span class='copy-ok' id='sokbar-note' style='margin:0;align-self:center'></span></div>";
    sokbarEl("sokbar-close").onclick = sokbarCloseResult;
    sokbarEl("sokbar-copy").onclick = function () {
      var txt = (entry.rubrik ? entry.rubrik + "\n" : "") + entry.svar
        + (entry.synonymer && entry.synonymer.length ? "\nSynonymer: " + entry.synonymer.join(", ") : "");
      copyText(txt);
      sokbarNote("Kopierat");
    };
    sokbarEl("sokbar-save").onclick = function () { sokbarSaveCurrent(entry); };
    sokbarApplyPadding();
  }
  function sokbarNote(msg, isErr) {
    var n = sokbarEl("sokbar-note");
    if (!n) return;
    n.textContent = msg; n.style.color = isErr ? "var(--error)" : "var(--main)"; n.style.display = "inline";
    var gen = sokbarSeq;
    setTimeout(function () { var m = sokbarEl("sokbar-note"); if (m && gen === sokbarSeq) m.style.display = "none"; }, 2500);
  }
  async function sokbarSaveCurrent(entry) {
    var btn = sokbarEl("sokbar-save");
    if (btn) { btn.disabled = true; btn.textContent = "Sparar..."; }
    try {
      await sokbarMutate(function (d) {
        if (d.saved.some(function (s) { return s.id === entry.id; })) return;
        var copy = JSON.parse(JSON.stringify(entry)); copy.savedAt = new Date().toISOString();
        d.saved.unshift(copy);
      });
      if (sokbarCurrent && sokbarCurrent.id === entry.id) sokbarShow(entry);
    } catch (e) {
      showDriveError("Spara svar", e, function () { sokbarSaveCurrent(entry); });
      if (btn) { btn.disabled = false; btn.textContent = "📌 Spara svar"; }
      sokbarNote("Kunde inte spara", true);
    }
  }

  // ---------------------------------------------------------------------------
  // Sökning
  // ---------------------------------------------------------------------------
  async function sokbarSearch(raw) {
    var q = String(raw || "").trim().slice(0, 500);
    if (!q) return;
    if (sokbarAbort) { try { sokbarAbort.abort(); } catch (e) {} }
    var my = ++sokbarSeq;
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    sokbarAbort = ctrl;
    var r = sokbarResultBox();
    if (!r) return;
    sokbarCurrent = null;
    r.innerHTML = "<button type='button' class='dict-close' id='sokbar-close' aria-label='Stäng'>&times;</button>"
      + "<div style='color:var(--sub);font-size:13px'>Söker efter &quot;" + esc(q) + "&quot;...</div>";
    sokbarEl("sokbar-close").onclick = sokbarCloseResult;
    sokbarApplyPadding();

    var res;
    try {
      res = await aiJson(SOKBAR_SYSTEM, q, 900, {
        signal: ctrl ? ctrl.signal : undefined,
        validate: function (p) { return p && typeof p.svar === "string" && p.svar.trim(); }
      });
    } catch (e) { res = { parsed: null, raw: "", error: e }; }
    if (my !== sokbarSeq || !sokbarEl("sokbar-root")) return; // ny sökning, stängd eller utloggad
    sokbarAbort = null;

    var p = res.parsed, entry;
    if (p) {
      entry = { id: sokbarNewId(), q: q, typ: p.typ === "ord" ? "ord" : "svar", rubrik: String(p.rubrik || ""),
        svar: String(p.svar), synonymer: Array.isArray(p.synonymer) ? p.synonymer.map(String).slice(0, 12) : [],
        anmarkning: String(p.anmarkning || ""), ts: new Date().toISOString() };
    } else if (res.raw && res.raw.trim()) {
      // Svaret gick inte att tolka som JSON men har text: visa texten, inget fel.
      entry = { id: sokbarNewId(), q: q, typ: "svar", rubrik: "", svar: res.raw.trim(), synonymer: [], anmarkning: "", ts: new Date().toISOString() };
    } else {
      r.innerHTML = "<button type='button' class='dict-close' id='sokbar-close' aria-label='Stäng'>&times;</button>"
        + "<div style='color:var(--error);font-size:13px'>Kunde inte hämta något svar"
        + (res.error && res.error.message ? " (" + esc(res.error.message) + ")" : "") + ". Försök igen.</div>"
        + "<div class='row mt8' style='margin-bottom:0'><button type='button' class='action-btn' id='sokbar-retry'>Försök igen</button></div>";
      sokbarEl("sokbar-close").onclick = sokbarCloseResult;
      sokbarEl("sokbar-retry").onclick = function () { sokbarSearch(q); };
      sokbarApplyPadding();
      return;
    }
    sokbarShow(entry);
    // Historik sparas i bakgrunden. Misslyckas det visas felbannern, svaret ligger kvar.
    sokbarMutate(function (d) { d.history.unshift(entry); }).catch(function (e) {
      showDriveError("Spara sökhistorik", e);
    });
  }

  // ---------------------------------------------------------------------------
  // Listor (Historik / Sparade svar) i överlägg
  // ---------------------------------------------------------------------------
  function sokbarOpenList(kind) {
    var isHist = kind === "history";
    var ov = openOverlay({ title: isHist ? "🕘 Historik" : "📌 Sparade svar", width: 560,
      footHtml: isHist ? "<button type='button' class='sec ghost' id='sokbar-clear'>Rensa historik</button>" : "",
      render: function (body) { draw(body); } });
    function list() { return isHist ? sokbarHistory : sokbarSaved; }
    function draw(body) {
      if (sokbarReadFailed) {
        body.innerHTML = "<div class='empty'>Kunde inte läsa filen från Drive.<br><br>"
          + "<button type='button' class='sec ghost' id='sokbar-reload' style='max-width:220px'>Försök igen</button></div>";
        body.querySelector("#sokbar-reload").onclick = async function () { await sokbarLoad(); draw(body); };
        return;
      }
      var items = list();
      if (!items.length) { body.innerHTML = "<div class='empty'>" + (isHist ? "Ingen historik än." : "Inga sparade svar än.") + "</div>"; return; }
      body.innerHTML = items.map(function (it, i) {
        return "<div class='khist' data-i='" + i + "' tabindex='0' style='display:flex;gap:10px;align-items:flex-start'>"
          + "<div style='flex:1;min-width:0'><div class='kmsg'>" + esc(it.q) + "</div>"
          + "<div class='kmeta'><span class='kbadge'>" + (it.typ === "ord" ? "ord" : "svar") + "</span><span>" + esc(fd(it.savedAt || it.ts)) + "</span></div></div>"
          + "<button type='button' class='action-btn' data-del='" + i + "' title='Ta bort'>🗑</button></div>";
      }).join("");
      body.querySelectorAll(".khist").forEach(function (card) {
        var open = function () { var it = list()[Number(card.dataset.i)]; if (it) { ov.close(); sokbarShow(it); } };
        card.onclick = open;
        card.onkeydown = function (e) { if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } };
      });
      body.querySelectorAll("[data-del]").forEach(function (b) {
        var it = list()[Number(b.dataset.del)];
        twoClickDelete(b, function () { remove(it, body); });
      });
    }
    async function remove(it, body) {
      if (!it) return;
      try {
        await sokbarMutate(function (d) { var arr = isHist ? d.history : d.saved; var k = arr.findIndex(function (x) { return x.id === it.id; }); if (k >= 0) arr.splice(k, 1); });
        draw(body);
        if (sokbarCurrent && sokbarCurrent.id === it.id) sokbarShow(sokbarCurrent); // uppdatera 📌-knappen
      } catch (e) { showDriveError("Ta bort", e); }
    }
    var clr = ov.el.querySelector("#sokbar-clear");
    if (clr) clr.onclick = function () {
      confirmDelete("Rensa hela sökhistoriken? Sparade svar påverkas inte.", async function () {
        try { await sokbarMutate(function (d) { d.history = []; }); draw(ov.body); }
        catch (e) { showDriveError("Rensa historik", e); }
      });
    };
    // Läsfel vid start eller filen aldrig läst: försök en gång till innan listan ritas.
    if (!sokbarLoaded && !sokbarReadFailed) sokbarLoad().then(function () { draw(ov.body); });
  }

  // ---------------------------------------------------------------------------
  // Livscykel
  // ---------------------------------------------------------------------------
  registerInit(function sokbarInit() {
    if (sokbarEl("sokbar-root")) return;
    sokbarInject();
    sokbarLoad();
  });

  onSignOut(function sokbarSignOut() {
    sokbarSeq++;
    if (sokbarAbort) { try { sokbarAbort.abort(); } catch (e) {} sokbarAbort = null; }
    if (sokbarObserver) { sokbarObserver.disconnect(); sokbarObserver = null; }
    if (sokbarResizeHandler) { window.removeEventListener("resize", sokbarResizeHandler); sokbarResizeHandler = null; }
    if (sokbarDocHandler) { document.removeEventListener("mousedown", sokbarDocHandler); sokbarDocHandler = null; }
    var bar = sokbarEl("sokbar-root");
    if (bar) bar.remove();
    document.body.style.paddingBottom = "";
    var wrap = document.querySelector(".wrap");
    if (wrap) wrap.style.paddingBottom = "";
    sokbarHistory = []; sokbarSaved = [];
    sokbarReadFailed = false; sokbarLoaded = false; sokbarCurrent = null;
  });
})();
