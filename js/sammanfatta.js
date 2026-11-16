/* =============================================================================
   SAMMANFATTA.JS — flik "Sammanfatta". ÄGS AV FLIK-CHATTEN för Sammanfatta.
   Rör inga andra filer. Behöver du något ändrat i core.js/index.html/styles.css:
   skriv en överlämning till huvud-chatten.

   Drive: mappen "Sammanfatta" under appens rotmapp. Egna filer: sammanfatta.json
   Mönster: flik-mönstret (se FLIK_KONTRAKT.md). Läs och spara med driveReadJson /
   driveUpdateJson / driveSave. Testa alltid med omladdning mot riktig inloggning.
   ============================================================================= */

// Egna globaler för den här filen, prefixade så de aldrig krockar med andra filer.
var sammanfattaItems = [];
var sammanfattaReadFailed = false; // sant efter läsfel: då får inget sparas

// Körs en gång per inloggning innan första ritning. Kastar den, ritas fliken inte.
async function sammanfattaLoad() {
  var d = await driveReadJson(["Sammanfatta"], "sammanfatta.json");
  sammanfattaItems = (d && Array.isArray(d.items)) ? d.items : [];
}

function sammanfattaRender(body) {
  body.innerHTML = "<div class='empty'><div class='eico'>🚧</div>Sammanfatta: sammanfatta text i vald längd och stil<br>Under uppbyggnad.</div>";
}

registerTab({ id: "sammanfatta", label: "Sammanfatta", order: 20, load: sammanfattaLoad, render: sammanfattaRender });
onSignOut(function () { sammanfattaItems = []; sammanfattaReadFailed = false; });
