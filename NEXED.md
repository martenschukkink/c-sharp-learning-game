# NexEd-app: afronden en inleveren met de NexEd hand-in-API

Dit document is bedoeld voor een AI-assistent (LLM) die een NexEd-app bouwt of aanpast. Geef het in zijn geheel mee
als context. Het beschrijft hoe een app een exercise afrondt of werk inlevert namens de student.

## Context

- Een NexEd-app is een statische webapp (HTML, CSS, JavaScript) met een `index.html` in de hoofdmap.
- NexEd laat de app draaien in een iframe met `sandbox="allow-scripts allow-forms"`, zonder `allow-same-origin`.
  Gevolgen: geen `localStorage`/cookies, geen `alert()`/`confirm()`, geen pop-ups, downloads of navigatie. Toon
  meldingen in de app zelf.
- De app praat met NexEd via `window.parent.postMessage`. De app vraagt alleen óf er iets ingeleverd mag worden en
  stuurt het werk op. NexEd bepaalt bij welke exercise dat hoort en voert het inleveren uit. De app geeft dus nooit een
  exercise-id of cursus mee.

Een app wordt op twee manieren gebruikt. De hand-in-API werkt in beide, maar wat er mag verschilt:

| Waar draait de app?                                   | `uploadType` dat de app krijgt                        |
|-------------------------------------------------------|-------------------------------------------------------|
| Als eigen exercise (app exercise)                     | `EVENT` (afronden) of `FILE_UPLOAD` (bestanden), afhankelijk van de instelling `Afronden` van de app; `null` als de app niets inlevert. |
| In de omschrijving van een theorie-exercise           | `EVENT`                                               |
| In de omschrijving van een praktijk-exercise          | Het inlevertype van de exercise: `TEXT`, `FILE_UPLOAD` of `GIT`. |

Bouw de app daarom zo dat hij leest wat NexEd toestaat en zich daaraan aanpast, in plaats van één type aan te nemen.

## Protocol

| Bericht               | Richting     | Inhoud                                                                                   |
|-----------------------|--------------|------------------------------------------------------------------------------------------|
| `nexed:handin-init`   | App → NexEd  | `{ type: 'nexed:handin-init' }`. Vraag wat er ingeleverd mag worden.                      |
| `nexed:handin-config` | NexEd → App  | `{ type, canHandIn, uploadType, requiredFiles }`                                         |
| `nexed:handin`        | App → NexEd  | `{ type: 'nexed:handin', payload }`, zie hieronder.                                      |
| `nexed:handin-ack`    | NexEd → App  | `{ type, accepted }`, met `accepted` `true` of `false`.                                  |

`nexed:handin-config`:

- `canHandIn` (boolean): mag er nu ingeleverd worden? `false` als een docent of beheerder de exercise bekijkt, als de
  exercise al is afgerond of in review is, of als de app niets inlevert.
- `uploadType`: `'EVENT'`, `'FILE_UPLOAD'`, `'TEXT'`, `'GIT'` of `null`.
- `requiredFiles` (array van strings): bestandsnamen die de exercise verplicht stelt. Vaak leeg.

`payload` van `nexed:handin`, per `uploadType`:

| `uploadType`  | `payload`                                         | Regels                                                      |
|---------------|---------------------------------------------------|-------------------------------------------------------------|
| `EVENT`       | `null`                                            | Rondt de exercise af. Niets anders meesturen.                |
| `FILE_UPLOAD` | `{ files: [{ name, content }, …] }`               | Minstens één bestand. `name` is een niet-lege string. `content` is een string, `Blob`, `ArrayBuffer` of typed array. |
| `TEXT`        | `{ text }`                                        | `text` is een string van 1 t/m 20.000 tekens.                |
| `GIT`         | —                                                 | Niet inleveren. De student levert in via Git. Verberg de inleverknop. |
| `null`        | —                                                 | Niet inleveren.                                              |

Een ongeldig verzoek, of een verzoek terwijl `canHandIn` `false` is, krijgt `accepted: false`.

## Belangrijke regels

- **Stuur `nexed:handin-init` zodra de app geladen is** en wacht op `nexed:handin-config`. Toon de inleverknop alleen
  als `canHandIn` `true` is en het `uploadType` iets is wat de app ondersteunt.
- **Gebruik een time-out** (bijvoorbeeld 3 seconden) op `nexed:handin-init`. Komt er geen antwoord, dan kan er op deze
  pagina niet worden ingeleverd: verberg de knop. Dat gebeurt bijvoorbeeld als de app los geopend is.
- **Controleer afzender en adres.** Accepteer alleen berichten waarvoor `event.source === window.parent`. Onthoud
  `event.origin` van `nexed:handin-config` en stuur `nexed:handin` naar dat exacte adres, niet naar `'*'`. NexEd draait
  op meerdere adressen (`app.nexed.com`, `<school>.app.nexed.com`); hardcode er geen.
- **Gebruik precies de namen uit `requiredFiles`** als de exercise die verplicht stelt. Ontbreekt er een, dan toont
  NexEd de student een melding en wordt er niet ingeleverd.
- **`accepted: true` betekent alleen dat NexEd het verzoek heeft aangenomen**, niet dat het inleveren gelukt is. NexEd
  toont het resultaat zelf aan de student (een afrond-dialoog of een foutmelding, zoals te veel pogingen, een te groot
  bestand of ontbrekende bestanden). De app krijgt daar geen bericht over. Toon na `accepted: true` dus iets als
  "Verstuurd naar NexEd", niet "Ingeleverd!".
- **De config wordt niet vanzelf bijgewerkt.** Na het inleveren verandert `canHandIn` meestal naar `false`, maar NexEd
  stuurt geen nieuwe config. Stuur opnieuw `nexed:handin-init` als je de actuele stand nodig hebt, en voorkom dubbel
  inleveren door de knop na het versturen uit te schakelen.
- NexEd sluit het volledige scherm als de app vanuit een exercise inlevert.

## Kant-en-klare helper

```js
const nexedHandIn = (() => {
    const TIMEOUT_MS = 3000;
    let nexedOrigin = null;
    let configWaiter = null;
    let ackWaiter = null;

    window.addEventListener('message', (event) => {
        if (event.source !== window.parent) return;
        const data = event.data;
        if (data?.type === 'nexed:handin-config' && configWaiter) {
            nexedOrigin = event.origin;
            configWaiter({
                canHandIn: data.canHandIn === true,
                uploadType: data.uploadType ?? null,
                requiredFiles: Array.isArray(data.requiredFiles) ? data.requiredFiles : [],
            });
            configWaiter = null;
        } else if (data?.type === 'nexed:handin-ack' && ackWaiter) {
            ackWaiter(data.accepted === true);
            ackWaiter = null;
        }
    });

    function wait(setWaiter, fallback) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => { setWaiter(null); resolve(fallback); }, TIMEOUT_MS);
            setWaiter((value) => { clearTimeout(timer); resolve(value); });
        });
    }

    /** Vraagt NexEd wat er mag. Geeft { canHandIn, uploadType, requiredFiles } terug. */
    function getConfig() {
        const none = { canHandIn: false, uploadType: null, requiredFiles: [] };
        if (window.parent === window) return Promise.resolve(none);
        const result = wait((w) => { configWaiter = w; }, none);
        window.parent.postMessage({ type: 'nexed:handin-init' }, '*');
        return result;
    }

    /** Stuurt een inlevering. Geeft true terug als NexEd het verzoek heeft aangenomen. */
    function send(payload) {
        if (!nexedOrigin) return Promise.resolve(false);
        const result = wait((w) => { ackWaiter = w; }, false);
        window.parent.postMessage({ type: 'nexed:handin', payload }, nexedOrigin);
        return result;
    }

    return {
        getConfig,
        complete: () => send(null),
        handInText: (text) => send({ text: String(text) }),
        handInFiles: (files) => send({ files }),
    };
})();
```

## Voorbeeld

```js
const button = document.querySelector('#inleveren');
const status = document.querySelector('#status');
button.hidden = true;

let config = await nexedHandIn.getConfig(); // in een <script type="module">
const supported = ['EVENT', 'FILE_UPLOAD', 'TEXT'];
button.hidden = !(config.canHandIn && supported.includes(config.uploadType));

button.addEventListener('click', async () => {
    button.disabled = true;
    let accepted = false;
    if (config.uploadType === 'EVENT') {
        accepted = await nexedHandIn.complete();
    } else if (config.uploadType === 'TEXT') {
        accepted = await nexedHandIn.handInText(maakVerslag());
    } else if (config.uploadType === 'FILE_UPLOAD') {
        const name = config.requiredFiles[0] ?? 'resultaat.json';
        accepted = await nexedHandIn.handInFiles([{ name, content: JSON.stringify(resultaat()) }]);
    }
    status.textContent = accepted ? 'Verstuurd naar NexEd.' : 'Inleveren kan nu niet.';
    if (!accepted) button.disabled = false;
});
```

## Checklist voor de app

- Stuur `nexed:handin-init` bij het laden, met time-out; toon de knop alleen als `canHandIn` `true` is.
- Ondersteun de `uploadType`s die passen bij de app; doe niets bij `GIT` en `null`.
- Controleer `event.source === window.parent`; stuur `nexed:handin` naar de onthouden `event.origin`.
- Gebruik bij bestanden precies de namen uit `requiredFiles`.
- Schakel de knop uit na versturen; zie `accepted: true` als "verstuurd", niet als "gelukt".
- Toon meldingen in de app, niet met `alert()`.
- Test in NexEd op de probeerpagina (`Probeer de app` in de app-instellingen). Daar laat NexEd zien wat er is
  ingeleverd. Los geopend kan de app niet inleveren.
