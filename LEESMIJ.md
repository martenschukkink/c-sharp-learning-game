# Code Gangen – handleiding voor docenten

Code Gangen is een 3D-game in de browser. De student loopt door een gebouw dat een C#-programma is: elke regel code is een kamer. Je maakt per exercise een eigen level door alleen `level.js` aan te passen. De game bouwt de kamers zelf op uit de code.

## Wat zit er in deze map

```
app/                  ← dit is de NexEd-app (deze map upload je)
  index.html          scherm en opmaak
  engine.js           de game zelf (niet aanpassen)
  level.js            JOUW level: de code die de student doorloopt
voorbeelden/          kant-en-klare levels om te kopiëren naar app/level.js
tests/                automatische tests (zie CLAUDE.md)
tools/                maak_nexed_zip.py: maakt een uploadklare zip
CLAUDE.md             technische notities, voor jezelf of voor Claude Code
LEESMIJ.md            deze handleiding
```

## Een level maken

Open `app/level.js` en zet je eigen C#-code tussen de backticks:

```js
window.LEVEL = {
  titel: 'Variabelen declareren en wijzigen',
  code: `
int leeftijd = 16;
leeftijd = leeftijd + 1;
Console.WriteLine(leeftijd);
`,
  uitleg: {
    2: 'Sam is jarig! Kijk hoe de oude waarde verdwijnt.',
  },
};
```

- **titel**: verschijnt op het startscherm.
- **code**: de C#-code. Inspringen mag; witregels en commentaar (`//`) ook.
- **uitleg** (optioneel): extra tekst per regelnummer. Die verschijnt onder de uitleg die de game zelf geeft.
- **intro** (optioneel): vervangt de introtekst op het startscherm.

Of kopieer een bestand uit `voorbeelden/` over `app/level.js` heen.

Testen: open `app/index.html` in je browser (dubbelklikken werkt). Zit er een fout in je code, dan zie je meteen welke regel en waarom.

## Welke C# werkt

| Onderdeel | Voorbeeld |
|---|---|
| Declaraties (`int`, `double`, `bool`, `string`) | `int x = 5;` `string naam = "Sam";` |
| Toekenningen | `x = x + 1;` `x += 3;` `x++;` `x--;` |
| Rekenen | `+ - * / %` (int / int geeft een geheel getal, de rest valt weg, net als in C#) |
| Vergelijken | `< > <= >= == !=` |
| Logisch | `&&` `\|\|` `!` |
| Keuzes | `if`, `if … else`, `else if` (genest mag) |
| Herhalen | `for`, `while` (genest mag) |
| Uitvoer | `Console.WriteLine(…)` en `Console.Write(…)` |

De game controleert de code vooraf zoals de C#-compiler dat grofweg doet: een variabele die niet bestaat, een dubbele declaratie, een verkeerd type of een conditie die geen bool is, geven een foutmelding met het regelnummer.

**Nog niet ondersteund**: methodes, arrays, `Console.ReadLine`, `switch`, `do … while`, `char`, `var`, string-interpolatie (`$"…"`). Zet in de code ook geen backtick (`` ` ``).

## Hoe de code een gebouw wordt

- Elke regel is een kamer van 10 × 10 meter met een gloeiend vlak. Loopt de student eroverheen, dan wordt de regel uitgevoerd. Pas daarna gaat de glazen schuifdeur naar de volgende kamer open. Terug kan niet.
- **if zonder else**: true = bovendeur naar het blok, false = rechterdeur, met een lopende band om het blok heen.
- **if-else**: true = deur linksboven (if-tak), false = deur rechtsboven (else-tak). De takken komen samen in de kamer erboven.
- **for**: init-kamer, dan de conditie. true = bovendeur naar de body; daarna een lopende band naar `i++` (links van de conditie) en terug de conditie in. false = rechterdeur, met een lopende band naar de regel na de loop.
- **while**: net als for, zonder init- en update-kamer.
- Bij elke conditie kiest de student zelf de deur. Een foute keuze kleurt rood en blokkeert; het eindscherm toont per conditie hoe vaak er fout gekozen is.

Tip: houd een level kort (5 tot 15 regels). Elke regel is een kamer, en een loop met 10 rondes is veel lopen.

## In NexEd zetten

1. **three.js zit erbij.** `app/three.min.js` (three.js r128) hoort bij de app en moet altijd mee in de zip. De game laadt three.js nooit van internet.
2. **Zippen.** Maak een zip van de map `app` (of van de bestanden erin). NexEd pakt één map in de zip vanzelf uit. Of gebruik `python tools/maak_nexed_zip.py voorbeelden/4-for.js`: die maakt in `dist/` een zip met precies de bestanden die nodig zijn, met het gekozen level.
3. **Uploaden** als app in NexEd. Elke upload is een nieuwe versie die alle bestanden vervangt; maak dus per level een eigen app.
4. **In een exercise zetten** via `/` in de Exercise Editor, of in Markdown:

   ```
   {app id="…" height="720" allowFullscreen="true"}{.endapp}
   ```

   Een hoogte van 700 pixels of meer werkt het best; met `allowFullscreen` kan de student de game schermvullend spelen.

## Goed om te weten

- **Rondkijken met de muis**: in een ingebedde pagina werkt het vastzetten van de muis misschien niet. Slepen met de muis en de pijltjestoetsen werken altijd.
- **Inleveren**: als NexEd aangeeft dat er ingeleverd mag worden, verschijnt op het eindscherm een knop *Inleveren*. Bij tekst-inleveren stuurt de game een korte samenvatting mee (foute keuzes per conditie en de console-uitvoer); anders meldt hij alleen dat de opdracht af is. Krijgt de game geen antwoord van NexEd, dan blijft de knop verborgen.
- De game slaat niets op in de browser; elke keer begint de student opnieuw.
- **Geluid**: bij elke uitgevoerde regel, bij uitvoer naar de console en bij goede of foute keuzes klinkt een kort geluid. De geluiden worden in de browser gemaakt (geen audiobestanden). Uitzetten kan met de knop *Geluid aan/uit* of de toets **M**.
