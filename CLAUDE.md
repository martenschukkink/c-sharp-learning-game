# Code Gangen – notities voor Claude Code

Een 3D-browsergame (three.js r128) die C# uitlegt: het gebouw ís het programma, elke regel code is een kamer. Gemaakt voor MBO Software Developer-studenten en bedoeld om als app in een NexEd-exercise te draaien. Eigenaar: Marten (docent softwareontwikkeling). Communiceer in het Nederlands; teksten in de game en commentaar in de code ook in het Nederlands.

## Structuur
- `app/index.html` – opmaak (CSS) en schermen. Laadt `./three.min.js` (three.js r128, onderdeel van de app; nooit van een CDN laden). Daarna `level.js` en `engine.js`.
- `app/engine.js` – de hele game in één IIFE, zonder build-stap. Secties:
  1. lexer + parser (C#-subset → AST) en `check()` (scopes en types, foutmeldingen met regelnummer)
  2. `ev()` waarden met C#-semantiek (int-deling, string-concat, `True`/`False` bij printen) en `trace()` voor de tussenstappen in de uitleg
  3. `Builder` + `place*()` – zet de AST om in een raster met kamers, deuren, schuifdeuren, lopende banden
  4. level laden en foutscherm
  5. code-paneel (syntax highlighting, actieve regel, tellers, doorgestreepte overgeslagen regels)
  6. inventory, console (HUD), berichten; 6b. geluid (Web Audio, gesynthetiseerd)
  7. uitvoering als generator: `yield {wait: kamerId}` wacht tot de speler op het vlak komt, `yield {choose, value}` wacht op de goede deur
  8. three.js-scène; 9. speler, botsingen, lopende banden; 10. plattegrond; 11. NexEd-inleveren; 12. schermen en animatielus
- `app/level.js` – `window.LEVEL = { titel, code, uitleg?, intro? }`.
- `voorbeelden/` – kant-en-klare levels. `LEESMIJ.md` – handleiding voor docenten.
- `tests/` – `speel_level.py` (automatische speler), `run_alles.py` (alle levels + verwachte uitkomst), `three-stub.js` (nep-three.js), `testlevels/`.
- `tools/maak_nexed_zip.py` – zip voor NexEd met een gekozen level.

## Testen
```
pip install playwright && playwright install chromium
python tests/run_alles.py            # snel, met nep-three.js (logica, paden, lekken)
python tests/run_alles.py --echt     # echte three.js + WebGL via SwiftShaderpython tests/speel_level.py voorbeelden/4-for.js --fout --echt --screenshot shot.png
```
- De speler loopt via `__game.tp` vak voor vak, respecteert schuifdeuren (richting, op slot) en conditiedeuren, en rijdt mee op banden.
- Lekcontrole: met alle deuren dicht mag geen gebied twee kamers bevatten.
- `window.__game` is een testhaak (posities, wachtende kamer, dump van de indeling). Laat die staan; de tests hebben hem nodig.
- Na wijzigingen in de indeling of uitvoering: altijd `run_alles.py` draaien. Na visuele wijzigingen ook `--echt` met een screenshot bekijken.

## Indeling (vaste afspraken, met Marten besproken)
- Raster van 2 m. Kamers 5 vakken hoog; gewone regels 5 breed met een regel-vlak van 3×3 in de looplijn. Een conditiekamer is in z'n geheel de regel (binnenkomen = vraag stellen).
- Het programma loopt naar het noorden (+y in het raster, −z in de wereld).
- Schuifdeur (`gate`) tussen kamers: `req` = id van de kamer ervoor; op slot tot die regel is uitgevoerd (in een loop: elke ronde opnieuw). Wie er voorbij is, kan niet terug.
- if zonder else: true = bovendeur, false = rechterdeur + lopende band om het blok heen naar de rechterkant van de volgende kamer.
- if-else: true linksboven, false rechtsboven; takken komen samen in de volgende kamer.
- for: init-kamer → conditie; true = boven (body) → band links omlaag → update-kamer links van de conditie → schuifdeur terug de conditie in; false = rechts + band. while: idem zonder init/update.
- Geen portalen/teleports (bewust afgeschaft); overslaan gaat via lopende banden.
- Een genest blok dat met losse uitgangen of banden eindigt, krijgt een lege `}`-kamer (junction). Het programma eindigt in "einde programma".
- `place*()` werkt met `pend = {entries: [x…], belts: [...]}`: de eerstvolgende kamer moet die ingangen omvatten en de banden aan de rechterkant ontvangen. Geneste blokken worden in een eigen `Builder` gebouwd en daarna verschoven (`merge`).
- Scherm: plattegrond, inventory en HUD-console links; code rechts; uitleg midden onder.

## NexEd (docs.nexed.com/ontwikkelen/apps)
Volledige beschrijving van de hand-in-API (protocol, `uploadType`s, `nexed:handin-ack`, voorbeeldcode) staat in `NEXED.md`. Lees die eerst bij werk aan het inleveren (sectie 11 van engine.js) of de sandbox.
- Zip met `index.html` in de root, relatieve paden, max. 5 MB / 1000 bestanden; elke upload is een nieuwe versie (dus één app per level).
- Sandbox: geen localStorage/cookies/IndexedDB, geen `alert()`, pop-ups of downloads. Pointer lock is onzeker → slepen en pijltjestoetsen moeten blijven werken.
- Inleveren via `postMessage`: `nexed:handin-init` → `nexed:handin-config` (`canHandIn`, `uploadType`) → `nexed:handin` (`null` of `{text}`). Controleer `event.origin` tegen `(*.)app.nexed.com` en stuur daarna naar dat adres, niet naar `'*'`.
- three.js wordt altijd meegeleverd als `three.min.js`; nooit van een CDN laden (ook niet als fallback).

## Een nieuw soort statement toevoegen
parser (`simple()`/`statement()`) → `check()` → `exec()` of `runStmt()` (met `hit()` en een `message()`) → `placeStmt()` (kamer + schuifdeur) → highlighting in `highlightCode()` → voorbeeld in `voorbeelden/` + verwachting in `tests/run_alles.py` → LEESMIJ bijwerken.

## Wensen / volgende stappen
- `Console.ReadLine` via het consolevenster (invoer op de plek van de cursor).
- Willekeurige startwaarden per run; methodes; arrays; `switch`, `do…while`.
- engine.js opsplitsen in modules zodra het groeit (zonder build-stap voor NexEd, of met een simpele bundel naar één bestand).
- Touchbediening.
