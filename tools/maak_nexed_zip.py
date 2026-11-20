"""Maakt een zip die je als app in NexEd kunt uploaden.

    python tools/maak_nexed_zip.py                              # met app/level.js
    python tools/maak_nexed_zip.py voorbeelden/4-for.js         # met dit level als level.js
    python tools/maak_nexed_zip.py voorbeelden/4-for.js -o dist/for-loop.zip

In de zip komen alleen de bestanden die de app nodig heeft (NexEd: index.html in de root,
maximaal 5 MB, alleen toegestane bestandstypen).
"""
import argparse, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / 'app'

ap = argparse.ArgumentParser()
ap.add_argument('level', nargs='?', default=str(APP / 'level.js'))
ap.add_argument('-o', '--out')
a = ap.parse_args()

level = Path(a.level)
out = Path(a.out) if a.out else ROOT / 'dist' / f"code-gangen-{level.stem if level.name != 'level.js' else 'level'}.zip"
out.parent.mkdir(parents=True, exist_ok=True)

three = APP / 'three.min.js'
if not three.exists():
    print('Fout: app/three.min.js ontbreekt. De app laadt three.js nooit van een CDN.'); sys.exit(1)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(APP / 'index.html', 'index.html')
    z.write(APP / 'engine.js', 'engine.js')
    z.write(level, 'level.js')
    z.write(three, 'three.min.js')
    for f in sorted((APP / 'fonts').iterdir()):  # lettertypen + licenties, nooit extern laden
        if f.suffix in ('.woff2', '.txt'):
            z.write(f, f'fonts/{f.name}')

size = out.stat().st_size
print(f'{out}  ({size / 1024:.0f} kB)')
if size > 5 * 1024 * 1024:
    print('Let op: groter dan 5 MB, NexEd accepteert dit niet.'); sys.exit(1)
