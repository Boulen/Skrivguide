/* =============================================================================
   SKRIV.JS — flik "Skriv". ÄGS AV FLIK-CHATTEN för Skriv.
   Rör inga andra filer. Behöver du något ändrat i core.js/index.html/styles.css:
   skriv en överlämning till huvud-chatten.

   Drive: mappen "Skriv" under appens rotmapp. Egna filer: skriv.json
   Mönster: flik-mönstret (se FLIK_KONTRAKT.md). Läs och spara med driveReadJson /
   driveUpdateJson / driveSave. Testa alltid med omladdning mot riktig inloggning.
   ============================================================================= */

// Egna globaler för den här filen, prefixade så de aldrig krockar med andra filer.
var skrivItems = [];
var skrivReadFailed = false; // sant efter läsfel: då får inget sparas

// Körs en gång per inloggning innan första ritning. Kastar den, ritas fliken inte.
async function skrivLoad() {
  var d = await driveReadJson(["Skriv"], "skriv.json");
  skrivItems = (d && Array.isArray(d.items)) ? d.items : [];
}

function skrivRender(body) {
  body.innerHTML = "<div class='empty'><div class='eico'>🚧</div>Skriv: textredigerare med AI-hjälp<br>Under uppbyggnad.</div>";
}

registerTab({ id: "skriv", label: "Skriv", order: 10, load: skrivLoad, render: skrivRender });
onSignOut(function () { skrivItems = []; skrivReadFailed = false; });
