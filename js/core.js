/* =============================================================================
   CORE.JS — Skrivguide. Delad infrastruktur. ÄGS AV HUVUD-CHATTEN.
   Rör aldrig den här filen från en flik-chatt: skriv en överlämning istället.

   -----------------------------------------------------------------------------
   FLIK-KONTRAKT (kort version, full version i FLIK_KONTRAKT.md)
   -----------------------------------------------------------------------------
   Scriptordning i index.html:  core.js  ->  (sokbar.js)  ->  flikfilerna  ->  init();

   FLIK (egen nav-knapp, ritar i #body)
     registerTab({
       id:"skriv",              // unikt, a-z0-9
       label:"Skriv",           // text i nav-knappen
       order:10,                // valfri, lägre = längre till vänster
       load:async function(){}, // valfri. Körs EN gång per inloggning innan första ritning.
                                // Kasta vid läsfel -> fliken ritas inte (inget kan skrivas över).
       render:function(body){}  // ritar i body (= #body). Anropas varje gång fliken visas.
     });

   FAST INSLAG (injicerar egen markup i document.body, som Sökbar)
     registerInit(function(){ ... });   // körs i showApp() efter inloggning, i registreringsordning

   INSTÄLLNINGSSEKTION (visas i ⚙-overlayen)
     registerSettings({id:"skriv", title:"Skriv", render:function(container){}});

   RENSA VID UTLOGGNING
     onSignOut(function(){ ...nollställ filens globaler... });

   Alla delade globaler deklareras HÄR (var). En flikfil deklarerar bara sina egna.
   Flikar delar inga variabler med varandra.

   -----------------------------------------------------------------------------
   DRIVE (alla anrop går genom driveFetch: token läggs på, 401 -> en förnyelse)
   -----------------------------------------------------------------------------
   driveReadJson(folderNames, fileName, rootId?)
       -> objekt, eller null om filen SAKNAS/är tom.
       -> KASTAR DriveError vid läsfel (nät, 403, 5xx, ogiltig JSON).
       Tolka aldrig ett fångat fel som "tom lista". Sätt en flagga och vägra spara.
   driveWriteJson(folderNames, fileName, data, rootId?)
       -> true. KASTAR DriveError vid fel. Skrivningar per fil köas i ordning.
   driveSave(context, folderNames, fileName, data, rootId?)
       -> true/false. Fångar felet och visar showDriveError. Använd när du inte vill await:a.
   driveUpdateJson(folderNames, fileName, mutatorFn, {defaultValue?, rootId?}?)
       -> läser strikt (avbryter vid läsfel), kör mutatorFn(aktuellt) och skriver sedan.
          mutatorFn muterar objektet på plats eller returnerar ett nytt. Läs-ändra-skriv
          är atomiskt på den här enheten. Använd för 📌-sparningar och cachar.
   showDriveError(context, e, retryFn?)   gemensam felvisning (banner överst).
   mergeListsById(local, remote)          slår ihop listor på id (nyast updatedAt/timestamp vinner).
   Övrigt: driveFindFolder, driveRenameFolder, driveDeleteFile, driveOpenInDrive.

   Behörighet: drive.file. Appen ser bara mappar/filer den själv skapat. Appen skapar och
   äger rotmappen "Skrivguide" i användarens Drive. Skapa aldrig mappar för hand.

   -----------------------------------------------------------------------------
   AI (OpenAI-likt format via PROXY)
   -----------------------------------------------------------------------------
   aiCall(system, userMsg, maxTokens, opts?)  -> fetch-Response
   aiChat(system, messages, maxTokens, opts?) -> fetch-Response
       opts: {model, signal, context}  context = extra text som läggs efter systemprompten.
       Ingen automatisk appdata läggs in. Bygg kontexten själv och skicka den.
   aiText(data)    -> svarstexten ("" om saknas).   aiError(data) -> felmeddelande eller "".
   aiCallRetry(system, userMsg, maxTokens, opts) / aiChatRetry(system, messages, maxTokens, opts)
       -> Promise<string|any>. Auto-omförsök: 30 s timeout/försök, väntan 1,2,3..5 s, nytt
          försök vid nätverksfel, timeout, 5xx, 429, tomt eller oläsligt svar. Fatalt direkt
          (kastar) vid 400/401/403/404. Returnerar null om anropet avbröts.
       opts: {isActive():bool  (false = avbryt, returnerar null),
              parse(text) (valfri, kastar vid oläsligt svar),
              fallback(text) (används efter 3 oläsliga men icke-tomma svar),
              onAttempt(n), maxAttempts (0 = obegränsat), timeoutMs, context, model}
   aiJson(system, userMsg, maxTokens, opts?)  -> {parsed, raw, error}
       Två försök, klammerräknande JSON-tolkning. parsed = objekt eller null.
       Om parsed är null men raw har text: visa raw istället för ett fel.
       opts: {attempts, validate(parsed)->bool, messages (för chatt), context, model}
   parseJsonReply(text) -> objekt eller null.   extractBalancedJson(text) -> sträng eller null.
   selectedModel, MODELS

   -----------------------------------------------------------------------------
   UI-HJÄLPARE
   -----------------------------------------------------------------------------
   esc, fd, spin, copyText, autoGrowTextarea, chatContentToText, trackLoad,
   chatContinuationHtml / bindChatContinuation   ("Fortsätt konversationen")
   confirmDelete(message, onYes)      message är ren text (escapas här).
   twoClickDelete(btn, onYes, {ms})   första klicket "Ta bort?" i 3 s, andra bekräftar.
   openOverlay({title, bodyHtml, render(body), footHtml, width, onClose, focus})
       -> {el, body, foot, close}. Ram, ✕, Esc, klick utanför, fokusfälla, fokus tillbaka.
   openJsonEditor({title, files:[{key,label,folder,file,fallback,validate,onSaved}], rootId})
       Rå JSON-redigering. Vägrar spara efter läsfel.
   chipsHtml(items, {selectAttr, removeAttr, selected(item,i)}) + bindChips(container, opts)
   bindDropup(wrapEl, toggleBtn, menuEl)   meny som öppnas uppåt.
   ============================================================================= */

// ---- Konstanter (BYT PLATSHÅLLARE INNAN FÖRSTA INLOGGNING, se CHECKLISTA_uppstart.md) ----
var APP_ID = "skrivguide";                 // skickas som app:"…" till proxyns oauth/token
var APP_NAME = "Skrivguide";
var PROXY = "https://ai-proxy.jenseskilsson95.workers.dev/";
var CLIENT_ID = "BYT_MOT_NYTT_KLIENT_ID.apps.googleusercontent.com";
var SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile";
var APP_ROOT_FOLDER_NAME = "Skrivguide";   // skapas av appen i användarens Drive
var REDIRECT_URI = location.origin + location.pathname.replace(/\/+$/, "/");
var LS_PREFIX = "sg_";
var DRIVE_API = "https://www.googleapis.com/drive/v3/files";
var DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
var FOLDER_MIME = "application/vnd.google-apps.folder";

// ---- Delat tillstånd ----
var accessToken = null, userInfo = null;
var view = "";
var lastAuthError = "";

var selectedModel = "anthropic/claude-sonnet-5.5";
try { var _sm = sessionStorage.getItem(LS_PREFIX + "selected_model"); if (_sm) selectedModel = _sm; } catch (e) {}
var MODELS = [
  {id:"anthropic/claude-sonnet-5.5",name:"Claude Sonnet 5.5",desc:"Balanserad och kraftfull — bra för det mesta"},
  {id:"anthropic/claude-opus-5.5",name:"Claude Opus 5.5",desc:"Anthropics kraftfulla modell — komplex analys"},
  {id:"anthropic/claude-fable-5.1",name:"Claude Fable 5.1",desc:"Mythos-klass — toppresultat på avancerat kunskapsarbete"},
  {id:"anthropic/claude-haiku-5.5",name:"Claude Haiku 5.5",desc:"Snabbast och billigast — enkla frågor och snabba svar"},
  {id:"google/gemini-4-argon",name:"Gemini 4 Argon",desc:"Googles flaggskepp — komplext resonemang"},
  {id:"google/gemini-3.5-flash",name:"Gemini 3.5 Flash",desc:"Googles snabba modell — research och långa texter"},
  {id:"openai/gpt-6.1-sol",name:"GPT-6.1 Sol",desc:"OpenAIs starka modell — instruktioner och struktur"},
  {id:"openai/gpt-6-luna",name:"GPT-6 Luna",desc:"OpenAIs snabba modell — kostnadseffektiv"},
  {id:"deepseek/deepseek-v4.1-flash-1017",name:"DeepSeek V4.1 Flash",desc:"Snabb open source-modell"},
  {id:"x-ai/grok-4.7",name:"Grok 4.7",desc:"xAIs flaggskepp — aktuell info och kreativt skrivande"}
];

// =============================================================================
// REGISTER: flikar, init-funktioner, inställningssektioner, utloggningskrokar
// =============================================================================
var TABS = [], INITS = [], SETTINGS_SECTIONS = [], SIGNOUT_HOOKS = [];
var viewSeq = 0;

function registerTab(def) {
  if (!def || !def.id || !def.label || typeof def.render !== "function") {
    console.error("registerTab: id, label och render krävs", def);
    return;
  }
  var existing = TABS.findIndex(function (t) { return t.id === def.id; });
  var tab = { id: def.id, label: def.label, order: def.order == null ? 100 : def.order,
              load: def.load || null, render: def.render, _loaded: false, _seq: TABS.length };
  if (existing >= 0) TABS[existing] = tab; else TABS.push(tab);
  TABS.sort(function (a, b) { return a.order - b.order || a._seq - b._seq; });
  if (accessToken && document.getElementById("tabs")) buildTabs();
}
function registerInit(fn) { if (typeof fn === "function") INITS.push(fn); }
function registerSettings(def) {
  if (!def || !def.id || typeof def.render !== "function") return;
  SETTINGS_SECTIONS = SETTINGS_SECTIONS.filter(function (s) { return s.id !== def.id; });
  SETTINGS_SECTIONS.push(def);
}
function onSignOut(fn) { if (typeof fn === "function") SIGNOUT_HOOKS.push(fn); }
function getTab(id) { return TABS.find(function (t) { return t.id === id; }) || null; }

function buildTabs() {
  var box = document.getElementById("tabs");
  if (!box) return;
  box.innerHTML = TABS.map(function (t) {
    return "<button type='button' class='tab" + (t.id === view ? " on" : "") + "' data-v='" + esc(t.id) + "'>" + esc(t.label) + "</button>";
  }).join("");
  box.querySelectorAll(".tab").forEach(function (btn) {
    btn.onclick = function () { setView(btn.dataset.v); };
  });
}
function setView(id) {
  view = id;
  try { sessionStorage.setItem(LS_PREFIX + "view", id); } catch (e) {}
  document.querySelectorAll("#tabs .tab").forEach(function (t) { t.classList.toggle("on", t.dataset.v === id); });
  render();
}
// Laddar fliken vid behov (en gång per inloggning) och ritar sedan. Ett läsfel i load()
// ger en felruta med "Försök igen" och fliken ritas INTE, så inget kan skrivas över.
function render() {
  var body = document.getElementById("body");
  if (!body) return;
  var tab = getTab(view);
  var my = ++viewSeq;
  if (!tab) {
    body.innerHTML = "<div class='empty'><div class='eico'>🧩</div>Inga flikar är registrerade än.</div>";
    return;
  }
  function draw() {
    if (my !== viewSeq) return;
    try { tab.render(body); }
    catch (e) {
      console.error("Fel när fliken '" + tab.id + "' ritades:", e);
      body.innerHTML = "<div class='empty' style='color:var(--error)'>Fliken kunde inte ritas: " + esc(e && e.message) + "</div>";
    }
  }
  if (tab.load && !tab._loaded) {
    body.innerHTML = "<div class='empty'>⏳ Laddar...</div>";
    bumpLoadIndicator(1);
    Promise.resolve().then(function () { return tab.load(); }).then(function () {
      tab._loaded = true;
      bumpLoadIndicator(-1);
      draw();
    }, function (e) {
      bumpLoadIndicator(-1);
      showDriveError("Ladda " + tab.label, e);
      if (my !== viewSeq) return;
      body.innerHTML = "<div class='empty'><div class='eico'>⚠️</div>Kunde inte läsa " + esc(tab.label) + ".<br><br>"
        + "<button type='button' class='sec ghost' id='tab-retry' style='max-width:220px'>Försök igen</button></div>";
      var rb = body.querySelector("#tab-retry");
      if (rb) rb.onclick = function () { render(); };
    });
  } else draw();
}
function reloadTab(id) { var t = getTab(id || view); if (t) t._loaded = false; }

var activeLoads = 0;
function bumpLoadIndicator(delta) {
  activeLoads = Math.max(0, activeLoads + delta);
  var el = document.getElementById("global-load-spinner");
  if (el) el.style.display = activeLoads > 0 ? "inline-block" : "none";
}
// Visar den globala spinnern medan ett löfte pågår.
function trackLoad(promise) {
  bumpLoadIndicator(1);
  var done = function () { bumpLoadIndicator(-1); };
  Promise.resolve(promise).then(done, done);
  return promise;
}

// =============================================================================
// AUTH (code flow via Cloudflare Worker, refresh-token, ingen klienthemlighet här)
// =============================================================================
function startLogin() {
  if (/^BYT_MOT/.test(CLIENT_ID)) {
    var dbg = document.getElementById("debug-msg");
    if (dbg) dbg.textContent = "CLIENT_ID är inte ifyllt i core.js än (se CHECKLISTA_uppstart.md).";
    return;
  }
  var p = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true" });
  location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}
async function fetchUserInfo() {
  try {
    var r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + accessToken } });
    userInfo = await r.json();
  } catch (e) {}
}
function showLogin() {
  document.getElementById("login-screen").style.display = "block";
  document.getElementById("main-app").style.display = "none";
}
function persistTokens(d) {
  accessToken = d.access_token;
  localStorage.setItem(LS_PREFIX + "access_token", d.access_token);
  localStorage.setItem(LS_PREFIX + "token_expiry", String(Date.now() + ((d.expires_in || 3600) * 1000)));
  if (d.refresh_token) localStorage.setItem(LS_PREFIX + "refresh_token", d.refresh_token);
}
function clearStoredAuth() {
  ["access_token", "token_expiry", "refresh_token"].forEach(function (k) { localStorage.removeItem(LS_PREFIX + k); });
}
async function exchangeCodeForTokens(code) {
  try {
    var r = await fetch(PROXY + "oauth/token", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app: APP_ID, grant_type: "authorization_code", code: code, redirect_uri: REDIRECT_URI }) });
    var d = await r.json();
    if (!d.access_token) { lastAuthError = d.error_description || d.error || ("HTTP " + r.status); return false; }
    persistTokens(d);
    return true;
  } catch (e) { lastAuthError = (e && e.message) || "nätverksfel"; return false; }
}
var refreshPromise = null;
function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async function () {
    var refreshToken = localStorage.getItem(LS_PREFIX + "refresh_token");
    if (!refreshToken) return false;
    try {
      var r = await fetch(PROXY + "oauth/token", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: APP_ID, grant_type: "refresh_token", refresh_token: refreshToken }) });
      var d = await r.json();
      if (!d.access_token) return false;
      persistTokens(d);
      return true;
    } catch (e) { return false; }
  })();
  var clear = function () { refreshPromise = null; };
  refreshPromise.then(clear, clear);
  return refreshPromise;
}
var tokenWatchInterval = null, tokenWatchBound = false;
function startTokenWatch() {
  if (tokenWatchInterval) clearInterval(tokenWatchInterval);
  tokenWatchInterval = setInterval(checkAndRenewToken, 5 * 60 * 1000);
  if (!tokenWatchBound) {
    tokenWatchBound = true;
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") checkAndRenewToken();
    });
  }
}
async function checkAndRenewToken() {
  if (!accessToken) return;
  var expiry = parseInt(localStorage.getItem(LS_PREFIX + "token_expiry") || "0");
  if (Date.now() < expiry - 10 * 60 * 1000) return;
  var renewed = await refreshAccessToken();
  if (!renewed) signOut();
}

// =============================================================================
// DRIVE
// =============================================================================
var driveDirCache = {}, driveDirCachePromise = {}, driveFileCreatePromise = {}, driveLocks = {};

function makeDriveError(message, status, detail) {
  var e = new Error(message);
  e.name = "DriveError"; e.status = status || 0; e.detail = detail || "";
  return e;
}
function escQ(s) { return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

async function driveFetch(url, opts) {
  if (!accessToken) throw makeDriveError("Inte inloggad", 401);
  opts = opts || {};
  var r;
  for (var attempt = 0; attempt < 2; attempt++) {
    var headers = Object.assign({}, opts.headers || {}, { Authorization: "Bearer " + accessToken });
    try { r = await fetch(url, Object.assign({}, opts, { headers: headers })); }
    catch (e) { throw makeDriveError("Nätverksfel: " + ((e && e.message) || e), 0); }
    if (r.status === 401 && attempt === 0 && await refreshAccessToken()) continue;
    return r;
  }
  return r;
}
async function driveCheck(r, what) {
  if (r.ok) return r;
  var t = "";
  try { t = await r.text(); } catch (e) {}
  throw makeDriveError(what + " misslyckades (HTTP " + r.status + ")", r.status, t.slice(0, 300));
}

async function driveMkdir(name, parentId) {
  var ckey = parentId + "/" + name;
  if (driveDirCache[ckey]) return driveDirCache[ckey];
  if (driveDirCachePromise[ckey]) return driveDirCachePromise[ckey];
  driveDirCachePromise[ckey] = (async function () {
    try {
      var q = "name='" + escQ(name) + "' and '" + parentId + "' in parents and mimeType='" + FOLDER_MIME + "' and trashed=false";
      var r = await driveCheck(await driveFetch(DRIVE_API + "?q=" + encodeURIComponent(q) + "&fields=files(id)&orderBy=createdTime"), "Sök mappen '" + name + "'");
      var d = await r.json();
      if (d.files && d.files.length) { driveDirCache[ckey] = d.files[0].id; return driveDirCache[ckey]; }
      var r2 = await driveCheck(await driveFetch(DRIVE_API, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, parents: [parentId], mimeType: FOLDER_MIME }) }), "Skapa mappen '" + name + "'");
      var d2 = await r2.json();
      if (!d2.id) throw makeDriveError("Mappen '" + name + "' kunde inte skapas", 200);
      driveDirCache[ckey] = d2.id;
      return d2.id;
    } finally { delete driveDirCachePromise[ckey]; }
  })();
  return driveDirCachePromise[ckey];
}
// Appen skapar och äger sin rotmapp själv (drive.file ser inga manuellt skapade mappar).
function getAppRootFolderId() { return driveMkdir(APP_ROOT_FOLDER_NAME, "root"); }
async function driveResolveFolderPath(folderNames, rootId) {
  var parentId = rootId || await getAppRootFolderId();
  for (var i = 0; i < folderNames.length; i++) parentId = await driveMkdir(folderNames[i], parentId);
  return parentId;
}
async function driveFindFolder(name, parentId) {
  var q = "name='" + escQ(name) + "' and mimeType='" + FOLDER_MIME + "' and '" + parentId + "' in parents and trashed=false";
  var r = await driveCheck(await driveFetch(DRIVE_API + "?q=" + encodeURIComponent(q) + "&fields=files(id,name)"), "Sök mappen '" + name + "'");
  var d = await r.json();
  return (d.files && d.files.length) ? d.files[0].id : null;
}
async function driveRenameFolder(id, newName) {
  await driveCheck(await driveFetch(DRIVE_API + "/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) }), "Byt mappnamn");
}
async function driveDeleteFile(fileId) {
  await driveCheck(await driveFetch(DRIVE_API + "/" + fileId, { method: "DELETE" }), "Ta bort fil");
}

// Hittar (eller skapar, om skapaOmSaknas) en fil i mappen. Samtidiga anrop delar en
// pågående förfrågan så att inga dubbletter skapas.
async function driveGetOrCreateFileId(folderNames, fileName, skapaOmSaknas, rootId) {
  var parentId = await driveResolveFolderPath(folderNames, rootId);
  var fkey = parentId + "/" + fileName;
  if (driveFileCreatePromise[fkey]) {
    var existingId = await driveFileCreatePromise[fkey];
    if (existingId || !skapaOmSaknas) return existingId;
  }
  driveFileCreatePromise[fkey] = (async function () {
    try {
      var q = "name='" + escQ(fileName) + "' and '" + parentId + "' in parents and trashed=false";
      var r = await driveCheck(await driveFetch(DRIVE_API + "?q=" + encodeURIComponent(q) + "&fields=files(id,name,createdTime)&orderBy=createdTime"), "Sök filen '" + fileName + "'");
      var d = await r.json();
      if (d.files && d.files.length) {
        if (d.files.length > 1) console.warn("Flera filer med namnet " + fileName + " i samma mapp. Använder den äldsta.");
        return d.files[0].id;
      }
      if (!skapaOmSaknas) return null;
      var form = new FormData();
      form.append("metadata", new Blob([JSON.stringify({ name: fileName, parents: [parentId], mimeType: "application/json" })], { type: "application/json" }));
      form.append("file", new Blob(["{}"], { type: "application/json" }));
      var r2 = await driveCheck(await driveFetch(DRIVE_UPLOAD + "?uploadType=multipart&fields=id", { method: "POST", body: form }), "Skapa filen '" + fileName + "'");
      var d2 = await r2.json();
      if (!d2.id) throw makeDriveError("Filen '" + fileName + "' kunde inte skapas", 200);
      return d2.id;
    } finally { delete driveFileCreatePromise[fkey]; }
  })();
  return driveFileCreatePromise[fkey];
}

// Köar åtgärder per fil så att skrivningar och läs-ändra-skriv sker i ordning.
function driveLock(key, fn) {
  var prev = driveLocks[key] || Promise.resolve();
  var run = prev.then(fn);
  driveLocks[key] = run.catch(function () {});
  return run;
}
function driveLockKey(folderNames, fileName, rootId) { return (rootId || "") + "|" + folderNames.join("/") + "/" + fileName; }

async function _driveReadStrict(folderNames, fileName, rootId) {
  var id = await driveGetOrCreateFileId(folderNames, fileName, false, rootId);
  if (!id) return null;
  var r = await driveFetch(DRIVE_API + "/" + id + "?alt=media");
  if (r.status === 404) return null;
  await driveCheck(r, "Läs " + folderNames.join("/") + "/" + fileName);
  var text = await r.text();
  if (!text || !text.trim() || text.trim() === "{}") return null;
  try { return JSON.parse(text); }
  catch (pe) { throw makeDriveError("Ogiltig JSON i " + folderNames.join("/") + "/" + fileName + ": " + pe.message, 200); }
}
async function _driveWriteRaw(folderNames, fileName, data, rootId) {
  var id = await driveGetOrCreateFileId(folderNames, fileName, true, rootId);
  var r = await driveFetch(DRIVE_UPLOAD + "/" + id + "?uploadType=media", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data, null, 2) });
  await driveCheck(r, "Spara " + folderNames.join("/") + "/" + fileName);
  return true;
}
function driveReadJson(folderNames, fileName, rootId) {
  return driveLock(driveLockKey(folderNames, fileName, rootId), function () { return _driveReadStrict(folderNames, fileName, rootId); });
}
function driveWriteJson(folderNames, fileName, data, rootId) {
  return driveLock(driveLockKey(folderNames, fileName, rootId), function () { return _driveWriteRaw(folderNames, fileName, data, rootId); });
}
async function driveSave(context, folderNames, fileName, data, rootId) {
  try { return await driveWriteJson(folderNames, fileName, data, rootId); }
  catch (e) { showDriveError(context, e, function () { driveSave(context, folderNames, fileName, data, rootId); }); return false; }
}
function driveUpdateJson(folderNames, fileName, mutatorFn, opts) {
  opts = opts || {};
  return driveLock(driveLockKey(folderNames, fileName, opts.rootId), async function () {
    var cur = await _driveReadStrict(folderNames, fileName, opts.rootId); // kastar vid läsfel = ingen skrivning
    var base = cur === null ? (opts.defaultValue !== undefined ? JSON.parse(JSON.stringify(opts.defaultValue)) : {}) : cur;
    var res = await mutatorFn(base);
    var next = res === undefined ? base : res;
    await _driveWriteRaw(folderNames, fileName, next, opts.rootId);
    return next;
  });
}
async function driveOpenInDrive(folderNames, fileName, rootId) {
  var id = await driveGetOrCreateFileId(folderNames, fileName, false, rootId);
  if (!id) throw makeDriveError("Filen finns inte i Drive ännu", 404);
  window.open("https://drive.google.com/file/d/" + id + "/view", "_blank");
}
// Slår ihop två listor på id. Vid samma id vinner den med nyast updatedAt/timestamp.
function mergeListsById(local, remote) {
  var map = new Map();
  function stamp(x) { return new Date(x.updatedAt || x.timestamp || 0).getTime() || 0; }
  (local || []).concat(remote || []).forEach(function (x) {
    var k = String(x.id != null ? x.id : x.timestamp);
    var cur = map.get(k);
    if (!cur || stamp(x) > stamp(cur)) map.set(k, x);
  });
  return Array.from(map.values()).sort(function (a, b) { return stamp(b) - stamp(a); });
}

// ---- Gemensam felvisning ----
var driveErrorItems = [], driveErrorSeq = 0;
function showDriveError(context, e, retryFn) {
  var msg = (e && e.message) || String(e || "Okänt fel");
  var hint = "";
  if (e && e.status === 403) hint = "Behörighet saknas. Appen ser bara mappar den själv skapat (drive.file).";
  else if (e && e.status === 401) hint = "Sessionen har gått ut. Ladda om sidan eller logga in igen.";
  console.error("Drive-fel [" + context + "]", e);
  var dup = driveErrorItems.find(function (x) { return x.context === context && x.msg === msg; });
  if (dup) { dup.count++; dup.retryFn = retryFn || dup.retryFn; }
  else driveErrorItems.push({ id: ++driveErrorSeq, context: context, msg: msg, hint: hint, detail: (e && e.detail) || "", retryFn: retryFn || null, count: 1 });
  renderDriveErrors();
}
function renderDriveErrors() {
  var banner = document.getElementById("drive-error-banner");
  if (!driveErrorItems.length) { if (banner) banner.remove(); return; }
  if (!banner) { banner = document.createElement("div"); banner.id = "drive-error-banner"; banner.setAttribute("role", "alert"); document.body.appendChild(banner); }
  banner.innerHTML = driveErrorItems.map(function (x) {
    return "<div class='derr-row'><div class='derr-text'><b>" + esc(x.context) + "</b>" + (x.count > 1 ? " (" + x.count + " ggr)" : "") + ": " + esc(x.msg)
      + (x.hint ? "<div class='derr-hint'>" + esc(x.hint) + "</div>" : "") + "</div>"
      + (x.retryFn ? "<button type='button' class='action-btn' data-derr-retry='" + x.id + "'>Försök igen</button>" : "")
      + "<button type='button' class='action-btn' data-derr-close='" + x.id + "' title='Stäng'>✕</button></div>";
  }).join("");
  banner.querySelectorAll("[data-derr-close]").forEach(function (b) {
    b.onclick = function () { driveErrorItems = driveErrorItems.filter(function (x) { return String(x.id) !== b.dataset.derrClose; }); renderDriveErrors(); };
  });
  banner.querySelectorAll("[data-derr-retry]").forEach(function (b) {
    b.onclick = function () {
      var item = driveErrorItems.find(function (x) { return String(x.id) === b.dataset.derrRetry; });
      driveErrorItems = driveErrorItems.filter(function (x) { return x !== item; });
      renderDriveErrors();
      if (item && item.retryFn) item.retryFn();
    };
  });
}
window.addEventListener("unhandledrejection", function (ev) {
  var r = ev && ev.reason;
  if (r && r.name === "DriveError") { showDriveError("Oväntat Drive-fel", r); ev.preventDefault(); }
});

// =============================================================================
// AI
// =============================================================================
async function aiChat(system, messages, maxTokens, opts) {
  opts = opts || {};
  var sys = system + (opts.context ? "\n\n" + opts.context : "");
  return fetch(PROXY, { method: "POST", headers: { "Content-Type": "application/json" }, signal: opts.signal,
    body: JSON.stringify({ model: opts.model || selectedModel, max_tokens: maxTokens,
      messages: [{ role: "system", content: sys }].concat(messages) }) });
}
function aiCall(system, userMsg, maxTokens, opts) {
  return aiChat(system, [{ role: "user", content: userMsg }], maxTokens, opts);
}
function aiText(data) {
  if (!data) return "";
  if (data.choices && data.choices[0]) {
    var msg = data.choices[0].message;
    if (msg) {
      if (typeof msg.content === "string" && msg.content) return msg.content;
      if (Array.isArray(msg.content)) return msg.content.map(function (p) { return p.text || p.content || ""; }).join("");
    }
    if (data.choices[0].text) return data.choices[0].text;
  }
  if (data.candidates && data.candidates[0]) {
    var c = data.candidates[0];
    if (c.content && c.content.parts) return c.content.parts.map(function (p) { return p.text || ""; }).join("");
  }
  return "";
}
function aiError(data) {
  if (!data || !data.error) return "";
  return typeof data.error === "string" ? data.error : (data.error.message || JSON.stringify(data.error));
}

// Räknar matchande klamrar och hoppar över klamrar i strängar. Null om objektet aldrig
// stängs (typiskt ett svar som klippts av max_tokens).
function extractBalancedJson(text) {
  text = String(text || "").replace(/```json|```/gi, "").trim();
  var start = text.indexOf("{");
  if (start === -1) return null;
  var depth = 0, inStr = false, esc_ = false;
  for (var i = start; i < text.length; i++) {
    var ch = text[i];
    if (inStr) {
      if (esc_) { esc_ = false; continue; }
      if (ch === "\\") { esc_ = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}
function extractJsonObject(text) { return extractBalancedJson(text) || String(text || ""); }
function parseJsonReply(text) {
  var block = extractBalancedJson(text);
  if (!block) return null;
  try { return JSON.parse(block); } catch (e1) {}
  try { return JSON.parse(block.replace(/\r?\n/g, " ")); } catch (e2) {}
  return null;
}

var AI_TIMEOUT_MS = 30000, AI_RETRY_BASE_MS = 1000, AI_PARSE_FAIL_FALLBACK = 3;
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function withTimeout(promise, ms) {
  var t;
  var timeout = new Promise(function (_, rej) { t = setTimeout(function () { rej(new Error("Timeout")); }, ms); });
  return Promise.race([promise, timeout]).then(function (v) { clearTimeout(t); return v; }, function (e) { clearTimeout(t); throw e; });
}
async function aiRetry(makeCall, opts) {
  opts = opts || {};
  var isActive = opts.isActive || function () { return true; };
  var attempt = 0, parseFails = 0, lastErr = null;
  while (isActive()) {
    attempt++;
    if (opts.maxAttempts && attempt > opts.maxAttempts) break;
    if (opts.onAttempt) opts.onAttempt(attempt);
    try {
      var res = await withTimeout(makeCall(), opts.timeoutMs || AI_TIMEOUT_MS);
      if (!isActive()) return null;
      if (!res.ok) {
        var he = new Error("HTTP " + res.status);
        he.fatal = [400, 401, 403, 404].indexOf(res.status) !== -1;
        throw he;
      }
      var data = await res.json();
      var em = aiError(data);
      if (em) throw new Error(em);
      var text = String(aiText(data) || "").trim();
      if (!text) throw new Error("Tomt svar");
      if (!opts.parse) return text;
      try { return opts.parse(text); }
      catch (pe) {
        parseFails++;
        if (parseFails >= AI_PARSE_FAIL_FALLBACK && opts.fallback) return opts.fallback(text);
        throw pe;
      }
    } catch (e) {
      if (e && e.fatal) throw e;
      lastErr = e;
      if (!isActive()) return null;
      await sleep(Math.min(AI_RETRY_BASE_MS * attempt, 5000));
    }
  }
  if (!isActive()) return null;
  if (lastErr) throw lastErr;
  return null;
}
function aiChatRetry(system, messages, maxTokens, opts) {
  return aiRetry(function () { return aiChat(system, messages, maxTokens, opts); }, opts);
}
function aiCallRetry(system, userMsg, maxTokens, opts) {
  return aiChatRetry(system, [{ role: "user", content: userMsg }], maxTokens, opts);
}
// Två försök. Returnerar {parsed, raw, error}. Är parsed null men raw har text: visa raw.
async function aiJson(system, userMsg, maxTokens, opts) {
  opts = opts || {};
  var attempts = opts.attempts || 2;
  var messages = opts.messages || [{ role: "user", content: userMsg }];
  var parsed = null, raw = "", error = null;
  for (var i = 0; i < attempts && !parsed; i++) {
    try {
      var res = await aiChat(system, messages, maxTokens, opts);
      var data = await res.json();
      raw = aiText(data) || raw;
      var em = aiError(data);
      if (em) throw new Error(em);
      var p = parseJsonReply(aiText(data));
      if (p && (!opts.validate || opts.validate(p))) { parsed = p; error = null; }
    } catch (e) { error = e; }
  }
  return { parsed: parsed, raw: raw, error: error };
}

// =============================================================================
// UI-HJÄLPARE
// =============================================================================
function fd(iso) { return new Date(iso).toLocaleDateString("sv-SE", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function spin() { return "<div style='text-align:center;padding:60px 0'><div class='spnr'></div><div style='color:var(--sub);font-size:13px;margin-top:14px'>Arbetar...</div></div>"; }
function copyText(txt) {
  if (navigator.clipboard) { navigator.clipboard.writeText(txt).catch(function () {}); }
  else { var t = document.createElement("textarea"); t.value = txt; document.body.appendChild(t); t.select(); document.execCommand("copy"); document.body.removeChild(t); }
}
function autoGrowTextarea(ta) {
  if (!ta) return;
  function resize() { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
  ta.addEventListener("input", resize);
  resize();
}
function chatContentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter(function (p) { return p.type === "text"; }).map(function (p) { return p.text; }).join(" ");
  return "";
}
function chatContinuationHtml(chat, idPrefix) {
  var thread = (chat || []).slice(2).map(function (m) {
    var txt = chatContentToText(m.content);
    return m.role === "user"
      ? "<div style='display:flex;justify-content:flex-end;margin-bottom:8px'><div class='bubble-me'>" + esc(txt) + "</div></div>"
      : "<div style='display:flex;justify-content:flex-start;margin-bottom:8px'><div class='bubble-them'>" + esc(txt) + "</div></div>";
  }).join("");
  return (thread ? "<div class='mt12' style='margin-bottom:8px'>" + thread + "</div>" : "")
    + "<div class='lbl' style='margin-top:12px'>Fortsätt konversationen</div>"
    + "<div class='row'><input class='inp' id='" + idPrefix + "-followup-inp' placeholder='Ställ en följdfråga...'/><button type='button' class='abtn' id='" + idPrefix + "-followup-btn'>&#8594;</button></div>"
    + "<div id='" + idPrefix + "-followup-loading' style='display:none;text-align:center;color:var(--sub);font-size:12px;margin-top:6px'>Skriver...</div>";
}
function bindChatContinuation(b, idPrefix, systemPrompt, getChat, onDone) {
  var inp = b.querySelector("#" + idPrefix + "-followup-inp");
  var btn = b.querySelector("#" + idPrefix + "-followup-btn");
  var loadingEl = b.querySelector("#" + idPrefix + "-followup-loading");
  if (!btn || !inp) return;
  var busy = false;
  var send = async function () {
    var txt = inp.value.trim();
    if (!txt || busy) return;
    busy = true; inp.value = "";
    var chat = getChat();
    chat.push({ role: "user", content: txt });
    btn.disabled = true; if (loadingEl) loadingEl.style.display = "block";
    try {
      var text = await aiChatRetry(systemPrompt, chat, 900, { maxAttempts: 3 });
      chat.push({ role: "assistant", content: text || "Kunde inte svara." });
    } catch (e) { chat.push({ role: "assistant", content: "Kunde inte svara. Försök igen." }); }
    busy = false; btn.disabled = false; if (loadingEl) loadingEl.style.display = "none";
    onDone();
  };
  btn.onclick = send;
  inp.onkeydown = function (e) { if (e.key === "Enter") send(); };
}

// ---- Overlay med ram, ✕, Esc, klick utanför, fokusfälla och fokus tillbaka ----
var overlaySeq = 0, overlayOpenCount = 0;
function openOverlay(opts) {
  opts = opts || {};
  var lastFocus = document.activeElement;
  var el = document.createElement("div");
  el.className = "overlay";
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
  var titleId = "ov-title-" + (++overlaySeq);
  el.setAttribute("aria-labelledby", titleId);
  el.innerHTML = "<div class='overlay-card' style='width:100%;max-width:" + (opts.width || 520) + "px'>"
    + "<div class='overlay-head'><div class='overlay-title' id='" + titleId + "'>" + esc(opts.title || "") + "</div>"
    + "<button type='button' class='action-btn' data-ov-close title='Stäng (Esc)'>✕</button></div>"
    + "<div class='overlay-body'>" + (opts.bodyHtml || "") + "</div>"
    + (opts.footHtml ? "<div class='overlay-foot'>" + opts.footHtml + "</div>" : "") + "</div>";
  document.body.appendChild(el);
  overlayOpenCount++; document.body.style.overflow = "hidden";
  var closed = false;
  var api = { el: el, body: el.querySelector(".overlay-body"), foot: el.querySelector(".overlay-foot"), close: close };
  function close() {
    if (closed) return;
    closed = true;
    el.remove();
    overlayOpenCount = Math.max(0, overlayOpenCount - 1);
    if (!overlayOpenCount) document.body.style.overflow = "";
    if (lastFocus && typeof lastFocus.focus === "function" && document.contains(lastFocus)) lastFocus.focus();
    if (opts.onClose) opts.onClose();
  }
  el.querySelector("[data-ov-close]").onclick = close;
  el.addEventListener("mousedown", function (e) { if (e.target === el) close(); });
  el.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== "Tab") return;
    var f = Array.prototype.slice.call(el.querySelectorAll("button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])"))
      .filter(function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  if (opts.render) opts.render(api.body, api);
  var target = opts.focus ? el.querySelector(opts.focus) : el.querySelector("input, select, textarea, .overlay-body button");
  (target || el.querySelector("[data-ov-close]")).focus();
  return api;
}

function confirmDelete(message, onConfirm) {
  var ov = openOverlay({ title: "Ta bort?", width: 360,
    bodyHtml: "<div class='confirm-msg'>" + esc(message) + "</div>",
    footHtml: "<button type='button' class='sec ghost' id='cd-cancel'>Avbryt</button><button type='button' class='sec danger' id='cd-confirm'>Ta bort</button>",
    focus: "#cd-cancel" });
  ov.el.querySelector("#cd-cancel").onclick = ov.close;
  ov.el.querySelector("#cd-confirm").onclick = function () { ov.close(); onConfirm(); };
}
function twoClickDelete(btn, onConfirm, opts) {
  opts = opts || {};
  var ms = opts.ms || 3000, orig = btn.textContent, origTitle = btn.title, armed = false, timer = null;
  function reset() { armed = false; btn.classList.remove("armed"); btn.textContent = orig; btn.title = origTitle; }
  btn.onclick = function (e) {
    if (e) e.stopPropagation();
    if (armed) { clearTimeout(timer); reset(); onConfirm(); return; }
    armed = true; btn.classList.add("armed"); btn.textContent = "Ta bort?"; btn.title = "Klicka igen för att bekräfta";
    timer = setTimeout(reset, ms);
  };
}
function showInfoPopup(title, message) {
  var ov = openOverlay({ title: title, width: 360, bodyHtml: "<div class='confirm-msg'>" + esc(message) + "</div>",
    footHtml: "<button type='button' class='sec ghost' id='ip-ok'>OK</button>", focus: "#ip-ok" });
  ov.el.querySelector("#ip-ok").onclick = ov.close;
}

// ---- Chips med valfritt × ----
function chipsHtml(items, opts) {
  opts = opts || {};
  if (!items || !items.length) return "";
  return "<div class='chips'>" + items.map(function (it, i) {
    var label = typeof it === "string" ? it : (it.label || it.name || "");
    var on = opts.selected && opts.selected(it, i);
    return "<span class='chip" + (on ? " on" : "") + "'" + (opts.selectAttr ? " data-" + opts.selectAttr + "='" + i + "' tabindex='0'" : "") + " title='" + esc(label) + "'>"
      + esc(label.length > 28 ? label.slice(0, 28) + "…" : label)
      + (opts.removeAttr ? "<button type='button' class='chip-x' data-" + opts.removeAttr + "='" + i + "' title='Ta bort'>×</button>" : "")
      + "</span>";
  }).join("") + "</div>";
}
// onSelect(i) / onRemove(i) anropas med index. Klick på × aktiverar inte chipet.
function bindChips(container, opts) {
  if (opts.selectAttr && opts.onSelect) container.querySelectorAll("[data-" + opts.selectAttr + "]").forEach(function (el) {
    el.onclick = function (e) { if (e.target.classList.contains("chip-x")) return; opts.onSelect(Number(el.dataset[camel(opts.selectAttr)])); };
  });
  if (opts.removeAttr && opts.onRemove) container.querySelectorAll("[data-" + opts.removeAttr + "]").forEach(function (el) {
    el.onclick = function (e) { e.stopPropagation(); opts.onRemove(Number(el.dataset[camel(opts.removeAttr)])); };
  });
}
function camel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

// ---- Dropup (meny som öppnas uppåt från en knapp längst ned) ----
function bindDropup(wrapEl, toggleBtn, menuEl) {
  if (!wrapEl || !toggleBtn || !menuEl) return;
  function setOpen(o) { menuEl.classList.toggle("open", o); toggleBtn.setAttribute("aria-expanded", o ? "true" : "false"); }
  toggleBtn.setAttribute("aria-haspopup", "true"); toggleBtn.setAttribute("aria-expanded", "false");
  toggleBtn.onclick = function () {
    var o = !menuEl.classList.contains("open");
    setOpen(o);
    if (o) { var first = menuEl.querySelector("button"); if (first) first.focus(); }
  };
  document.addEventListener("mousedown", function (e) { if (menuEl.classList.contains("open") && !wrapEl.contains(e.target)) setOpen(false); });
  menuEl.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); setOpen(false); toggleBtn.focus(); } });
  menuEl.addEventListener("click", function () { setOpen(false); });
}

// ---- Generisk JSON-redigerare ----
function openJsonEditor(cfg) {
  var files = cfg.files || [];
  var current = files[0];
  var loaded = false; // sant bara när filen lästs utan fel
  var ov = openOverlay({ title: cfg.title || "Redigera JSON", width: 640,
    bodyHtml: "<div class='row'><select class='field' id='je-select'>" + files.map(function (f) { return "<option value='" + esc(f.key) + "'>" + esc(f.label) + "</option>"; }).join("") + "</select>"
      + "<button type='button' class='action-btn' id='je-drive'>🔗 Öppna i Drive</button></div>"
      + "<div class='overlay-status' id='je-status'></div>"
      + "<textarea class='field json-area' id='je-text' spellcheck='false' disabled></textarea>"
      + "<div class='overlay-status err' id='je-warn'></div>",
    footHtml: "<button type='button' class='sec ghost' id='je-cancel'>Avbryt</button><button type='button' class='sec' id='je-save' disabled>Spara</button>" });
  var sel = ov.el.querySelector("#je-select"), ta = ov.el.querySelector("#je-text"), st = ov.el.querySelector("#je-status"),
      warn = ov.el.querySelector("#je-warn"), save = ov.el.querySelector("#je-save");
  async function load() {
    loaded = false; save.disabled = true; ta.disabled = true; warn.textContent = ""; st.textContent = "Hämtar från Drive...";
    try {
      var data = await driveReadJson(current.folder, current.file, cfg.rootId);
      ta.value = JSON.stringify(data === null ? (current.fallback !== undefined ? current.fallback : {}) : data, null, 2);
      ta.disabled = false; save.disabled = false; loaded = true;
      st.textContent = data === null ? "Filen finns inte i Drive ännu. Den skapas första gången du sparar." : "";
    } catch (e) {
      ta.value = ""; st.textContent = "Kunde inte läsa filen: " + e.message + " Det går inte att spara förrän den kan läsas.";
      var retry = document.createElement("button"); retry.type = "button"; retry.className = "action-btn"; retry.textContent = "Försök igen"; retry.onclick = load;
      st.appendChild(document.createElement("br")); st.appendChild(retry);
    }
  }
  sel.onchange = function () { current = files.find(function (f) { return f.key === sel.value; }); load(); };
  ov.el.querySelector("#je-cancel").onclick = ov.close;
  ov.el.querySelector("#je-drive").onclick = function () {
    driveOpenInDrive(current.folder, current.file, cfg.rootId).catch(function (e) { warn.textContent = e.message; });
  };
  save.onclick = async function () {
    if (!loaded) return;
    var parsed;
    try { parsed = JSON.parse(ta.value); } catch (e) { warn.textContent = "Ogiltig JSON: " + e.message; return; }
    if (current.validate) { var why = current.validate(parsed); if (why) { warn.textContent = why; return; } }
    save.disabled = true; save.textContent = "Sparar...";
    try {
      await driveWriteJson(current.folder, current.file, parsed, cfg.rootId);
      if (current.onSaved) current.onSaved(parsed);
      ov.close();
    } catch (e) { warn.textContent = "Kunde inte spara: " + e.message; save.disabled = false; save.textContent = "Spara"; }
  };
  load();
  return ov;
}

// =============================================================================
// INSTÄLLNINGAR (⚙ i headern): modell, registrerade sektioner, konto
// =============================================================================
// ---- Installera som app (PWA) ----
// Webbläsaren skickar beforeinstallprompt (Chrome/Edge/Android). iOS Safari saknar den:
// där visas en instruktion (Dela -> Lägg till på hemskärmen).
var installPrompt = null;
window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); installPrompt = e; refreshInstallButtons(); });
window.addEventListener("appinstalled", function () { installPrompt = null; refreshInstallButtons(); });
function isStandalone() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
}
function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
function doInstall() {
  var p = installPrompt;
  if (!p) return Promise.resolve(false);
  installPrompt = null;
  p.prompt();
  return Promise.resolve(p.userChoice).then(function (c) { refreshInstallButtons(); return !!c && c.outcome === "accepted"; }, function () { refreshInstallButtons(); return false; });
}
function refreshInstallButtons() {
  var b = document.getElementById("install-login");
  if (b) { b.style.display = (installPrompt && !isStandalone()) ? "" : "none"; b.onclick = function () { doInstall(); }; }
  var box = document.getElementById("set-install");
  if (box) { box.innerHTML = installBoxHtml(); bindInstallBox(box); }
}
function installBoxHtml() {
  if (isStandalone()) return "<div class='settings-row-sub'>Appen är installerad på den här enheten.</div>";
  if (installPrompt) return "<button type='button' class='sec' id='set-install-btn'>📲 Installera som app</button>";
  if (isIos()) return "<div class='settings-row-sub'>iPhone/iPad: öppna sidan i Safari, tryck på Dela-ikonen och välj Lägg till på hemskärmen.</div>";
  return "<div class='settings-row-sub'>Öppna webbläsarens meny och välj Installera app (Chrome/Edge) eller Lägg till på startskärmen (Android). Alternativet visas när sidan har laddats färdigt.</div>";
}
function bindInstallBox(box) {
  var b = box.querySelector("#set-install-btn");
  if (b) b.onclick = function () { doInstall(); };
}

function openSettings() {
  openOverlay({ title: "⚙ Inställningar", width: 480, render: function (body) {
    var modelOpts = MODELS.map(function (m) { return "<option value='" + esc(m.id) + "'" + (m.id === selectedModel ? " selected" : "") + ">" + esc(m.name) + "</option>"; }).join("");
    body.innerHTML = "<div class='settings-row'><div class='lbl'>AI-modell</div><select class='field' id='set-model'>" + modelOpts + "</select>"
      + "<div class='settings-row-sub' id='set-model-desc'></div></div>"
      + SETTINGS_SECTIONS.map(function (s) { return "<div class='settings-row' data-sec='" + esc(s.id) + "'><div class='lbl'>" + esc(s.title || s.id) + "</div><div class='sec-body'></div></div>"; }).join("")
      + "<div class='settings-row'><div class='lbl'>Installera</div><div id='set-install'></div></div>"
      + "<div class='settings-row'><div class='lbl'>Konto</div><div class='settings-row-sub'>" + esc((userInfo && (userInfo.name || userInfo.email)) || "Inloggad") + "</div>"
      + "<button type='button' class='sec ghost' id='set-signout' style='margin-top:10px'>Logga ut</button></div>";
    var sel = body.querySelector("#set-model"), desc = body.querySelector("#set-model-desc");
    function showDesc() { var m = MODELS.find(function (x) { return x.id === sel.value; }); desc.textContent = m ? m.desc : ""; }
    showDesc();
    sel.onchange = function () { selectedModel = sel.value; try { sessionStorage.setItem(LS_PREFIX + "selected_model", selectedModel); } catch (e) {} showDesc(); };
    SETTINGS_SECTIONS.forEach(function (s) {
      var c = body.querySelector("[data-sec='" + s.id + "'] .sec-body");
      try { s.render(c); } catch (e) { c.textContent = "Kunde inte visa: " + e.message; }
    });
    refreshInstallButtons();
    body.querySelector("#set-signout").onclick = function () { signOut(); };
  } });
}

// =============================================================================
// APP-LIVSCYKEL
// =============================================================================
function hdr() {
  var el = document.getElementById("htitle");
  if (!el) return;
  el.innerHTML = "<span class='brain-ico'><svg width='22' height='22' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg' aria-hidden='true'><g fill='#4fa8ff'>"
    + "<path d='M62 6l32 32-8 8-32-32z'/><path d='M50 22l32 32L40 86 8 92l6-32z'/></g></svg></span>" + esc(APP_NAME) + "<span class='caret'>_</span>";
  el.style.cursor = "pointer"; el.title = "Ladda om appen";
  el.onclick = function () { location.reload(); };
}
function clearDriveCaches() { driveDirCache = {}; driveDirCachePromise = {}; driveFileCreatePromise = {}; driveLocks = {}; }

function showApp() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("main-app").style.display = "block";
  clearDriveCaches();
  TABS.forEach(function (t) { t._loaded = false; });
  hdr();
  var saved = ""; try { saved = sessionStorage.getItem(LS_PREFIX + "view") || ""; } catch (e) {}
  view = getTab(saved) ? saved : (TABS[0] ? TABS[0].id : "");
  buildTabs();
  INITS.forEach(function (fn) { try { fn(); } catch (e) { console.error("Init-fel:", e); } });
  render();
}
function signOut() {
  if (tokenWatchInterval) { clearInterval(tokenWatchInterval); tokenWatchInterval = null; }
  clearStoredAuth(); accessToken = null; userInfo = null; clearDriveCaches();
  driveErrorItems = []; renderDriveErrors();
  document.querySelectorAll(".overlay").forEach(function (o) { o.remove(); });
  overlayOpenCount = 0; document.body.style.overflow = "";
  SIGNOUT_HOOKS.forEach(function (fn) { try { fn(); } catch (e) { console.error("Utloggningskrok:", e); } });
  showLogin();
}
async function init() {
  refreshInstallButtons();
  var dbg = document.getElementById("debug-msg");
  if (window.__pendingAuthError && dbg) dbg.textContent = "Inloggningen avbröts: " + window.__pendingAuthError;
  if (window.__pendingAuthCode) {
    var code = window.__pendingAuthCode;
    window.__pendingAuthCode = null;
    if (await exchangeCodeForTokens(code)) { await fetchUserInfo(); showApp(); startTokenWatch(); return; }
    if (dbg) dbg.textContent = "Inloggningen misslyckades: " + lastAuthError;
  }
  var savedToken = localStorage.getItem(LS_PREFIX + "access_token");
  var expiry = parseInt(localStorage.getItem(LS_PREFIX + "token_expiry") || "0");
  if (savedToken && Date.now() < expiry - 2 * 60 * 1000) {
    accessToken = savedToken;
    if (!userInfo) await fetchUserInfo();
    showApp(); startTokenWatch(); return;
  }
  if (await refreshAccessToken()) {
    if (!userInfo) await fetchUserInfo();
    showApp(); startTokenWatch(); return;
  }
  clearStoredAuth();
  if (dbg && !dbg.textContent) dbg.textContent = "Redirect URI: " + REDIRECT_URI;
  showLogin();
}
