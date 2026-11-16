/* =============================================================================
   ANTECKNINGAR.JS — flik "Anteckningar". ÄGS AV FLIK-CHATTEN för Anteckningar.
   Rör inga andra filer. Behöver du något ändrat i core.js/index.html/styles.css:
   skriv en överlämning till huvud-chatten.

   Drive: mappen "Anteckningar" under appens rotmapp. Egna filer: anteckningar.json
   Mönster: flik-mönstret (se FLIK_KONTRAKT.md). Läs och spara med driveReadJson /
   driveUpdateJson / driveSave. Testa alltid med omladdning mot riktig inloggning.
   ============================================================================= */

// Egna globaler för den här filen, prefixade så de aldrig krockar med andra filer.
var anteckningarItems = [];
var anteckningarReadFailed = false; // sant efter läsfel: då får inget sparas

// Körs en gång per inloggning innan första ritning. Kastar den, ritas fliken inte.
async function anteckningarLoad() {
  var d = await driveReadJson(["Anteckningar"], "anteckningar.json");
  anteckningarItems = (d && Array.isArray(d.items)) ? d.items : [];
}

function anteckningarRender(body) {
  body.innerHTML = "<div class='empty'><div class='eico'>🚧</div>Anteckningar: sparade texter och anteckningar<br>Under uppbyggnad.</div>";
}

registerTab({ id: "anteckningar", label: "Anteckningar", order: 30, load: anteckningarLoad, render: anteckningarRender });
onSignOut(function () { anteckningarItems = []; anteckningarReadFailed = false; });
