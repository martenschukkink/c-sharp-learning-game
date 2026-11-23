"""Speelt alle voorbeelden en testlevels uit en vergelijkt de uitkomst met wat er verwacht wordt.

    python tests/run_alles.py           # snel, met nep-three.js
    python tests/run_alles.py --echt    # met echte three.js + WebGL (trager)

Voeg je een voorbeeld of testlevel toe, zet dan hieronder de verwachte console-uitvoer
(of het begin van de verwachte foutmelding) erbij.
"""
import asyncio, os, sys
from pathlib import Path
from speel_level import speel, ROOT

VERWACHT = {
    'voorbeelden/1-variabelen.js': ['Sam is 17', '5'],
    'voorbeelden/2-if-else.js': ['5'],
    'voorbeelden/3-en-of.js': ['Poort dicht'],
    'voorbeelden/4-for.js': ['30'],
    'voorbeelden/5-while.js': ['Stappen: 2'],
    'voorbeelden/6-alles.js': ['Poort dicht', '30'],
    'app/level.js': ['=== Kassabon ===', 'Product: Chips', 'Aantal: 3', 'Prijs per stuk: 1.5', 'Op voorraad: True',
                     '5x Cola', 'Op voorraad: False', 'Bedankt!'],
    'tests/testlevels/genest.js': ['vier', 'agroot', '2', '2.5', 'x=5!', 'False'],
    'tests/testlevels/loop-na-loop.js': ['0', '3'],
    'tests/testlevels/interpolatie.js': ['x=2 {x} a False 2.5', 'ronde 0', 'ronde 1', 'geen gaten'],
}
FOUTEN = {
    'tests/testlevels/fout-onbekende-variabele.js': "Regel 2: De variabele 'b' bestaat (hier) niet",
    'tests/testlevels/fout-puntkomma.js': "Regel 1: Verwacht ';'",
    'tests/testlevels/fout-type.js': 'Regel 2: Een int past niet in een variabele van type string',
    'tests/testlevels/fout-dubbel.js': "Regel 3: De variabele 'a' bestaat al",
    'tests/testlevels/fout-conditie.js': 'Regel 2: Een conditie moet true of false opleveren',
    'tests/testlevels/fout-interpolatie-variabele.js': "Regel 2: De variabele 'b' bestaat (hier) niet",
    'tests/testlevels/fout-interpolatie-expressie.js': 'Regel 2: Tussen { } in een $-tekst mag alleen de naam van een variabele staan',
    'tests/testlevels/fout-interpolatie-buiten-console.js': 'Regel 2: Een $-tekst werkt (nog) alleen als hele invoer',
}


async def main(echt):
    chrome = os.environ.get('CHROME')
    mislukt = 0
    for rel, console in VERWACHT.items():
        for fout in (False, True):
            r = await speel(ROOT / rel, fout=fout, echt=echt, chrome=chrome)
            ok = r['finished'] and r['console'] == console and not r['leaks'] and not r['errors']
            mislukt += not ok
            print(('OK  ' if ok else 'FOUT'), rel, '(eerst foute deuren)' if fout else '',
                  '' if ok else f"→ finished={r['finished']} console={r['console']} leaks={r['leaks']} stuck={r['stuck']} errors={r['errors']}")
    for rel, begin in FOUTEN.items():
        r = await speel(ROOT / rel, echt=echt, chrome=chrome)
        ok = (r['loaderr'] or '').startswith(begin)
        mislukt += not ok
        print(('OK  ' if ok else 'FOUT'), rel, '' if ok else f"→ {r['loaderr']}")
    print(f"\n{mislukt} mislukt" if mislukt else '\nAlles geslaagd')
    return mislukt


if __name__ == '__main__':
    sys.exit(1 if asyncio.run(main('--echt' in sys.argv)) else 0)
