"""Speelt een Code Gangen-level automatisch uit in een headless browser.

Gebruik:
    python tests/speel_level.py voorbeelden/4-for.js            # snel, met nep-three.js
    python tests/speel_level.py voorbeelden/4-for.js --fout     # kies bij elke conditie eerst de verkeerde deur
    python tests/speel_level.py voorbeelden/4-for.js --echt     # echte three.js (app/three.min.js of het CDN) + WebGL

Nodig: pip install playwright && playwright install chromium

De speler loopt vak voor vak (via __game.tp) naar de volgende regel, en houdt zich daarbij aan de
regels van het gebouw: schuifdeuren alleen in de looprichting en als ze open zijn, conditiedeuren
alleen als ze open zijn, en op een lopende band rijdt hij mee. Daarnaast controleert hij of er
'lekken' zijn: kamers die zonder deur met elkaar verbonden zijn.
"""
import asyncio, argparse, collections, json, math, os, sys
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / 'app'
STUB = (ROOT / 'tests' / 'three-stub.js').read_text()
DIRS = {(0, 1): 0, (0, -1): math.pi, (1, 0): -math.pi / 2, (-1, 0): math.pi / 2}   # richting → kijkhoek (yaw)


async def speel(level, fout=False, echt=False, chrome=None, screenshot=None):
    level_src = Path(level).read_text()
    res = {'level': str(level), 'loaderr': None, 'finished': False, 'console': [], 'vars': {}, 'leaks': [], 'stuck': None, 'errors': []}
    args = ['--no-sandbox']
    if echt:
        args += ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=chrome, args=args)
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: res['errors'].append(str(e)))

        async def route(r):
            u = r.request.url
            if 'cdnjs' in u and not echt:
                await r.fulfill(body=STUB, content_type='application/javascript')
            elif u.endswith('/level.js'):
                await r.fulfill(body=level_src, content_type='application/javascript')
            elif u.startswith('file:') or echt:
                await r.continue_()
            else:
                await r.abort()
        await pg.route('**/*', route)
        await pg.goto((APP / 'index.html').as_uri())
        await pg.wait_for_timeout(2500 if echt else 1500)
        if await pg.is_visible('#loaderr'):
            res['loaderr'] = await pg.inner_text('#loaderrMsg')
            await b.close()
            return res
        await pg.evaluate("document.getElementById('btnStart').click()")

        D = await pg.evaluate("__game.dump()")
        floor = {(x, y) for x, y in D['floor']}
        gate = {(g['x'], g['y']): g for g in D['gates']}
        door = {(d['x'], d['y']): d for d in D['doors']}
        belt = {tuple(c): i for i, bl in enumerate(D['belts']) for c in bl['cells']}
        trig = {}
        for k, rid in D['triggers']:
            trig.setdefault(rid, set()).add(tuple(map(int, k.split(','))))

        # --- lekcontrole: met alle deuren dicht mag geen afgesloten gebied twee kamers bevatten
        closed = set(gate) | set(door)
        roomcells = {c: rid for rid, cells in trig.items() for c in cells}
        for r in D['rooms']:
            roomcells.setdefault((r['x'], r['y']), r['id'])
        seen = set()
        for c in floor:
            if c in closed or c in seen:
                continue
            q, ids = [c], set()
            seen.add(c)
            while q:
                x, y = q.pop()
                if (x, y) in roomcells:
                    ids.add(roomcells[(x, y)])
                for dx, dy in DIRS:
                    n = (x + dx, y + dy)
                    if n in floor and n not in closed and n not in seen:
                        seen.add(n); q.append(n)
            if len(ids) > 1:
                res['leaks'].append(sorted(ids))

        async def pos():
            p_ = await pg.evaluate("__game.pos")
            return (round(p_['px'] / 2), round(-p_['pz'] / 2))

        async def tp(c, yaw=None):
            await pg.evaluate(f"__game.tp({c[0]},{c[1]}{'' if yaw is None else ',' + str(yaw)})")
            await pg.wait_for_timeout(35)

        def passable(a, n, locked, ds):
            if n not in floor:
                return False
            d = (n[0] - a[0], n[1] - a[1])
            if n in door and (ds[n] != 'open' or tuple(door[n]['dir']) != d):
                return False
            if n in gate and (n in locked or tuple(gate[n]['dir']) != d):
                return False
            if a in gate and d == tuple(-v for v in gate[a]['dir']):
                return False
            if a in door and d == tuple(-v for v in door[a]['dir']):
                return False
            return True

        async def walk_to(targets):
            dump = await pg.evaluate("__game.dump()")
            locked = {tuple(map(int, k.split(','))) for k in dump['locked']}
            ds = {(d['x'], d['y']): d['state'] for d in dump['doors']}
            start = await pos()
            prev, q, end = {start: None}, collections.deque([start]), None
            while q:
                c = q.popleft()
                if c in targets:
                    end = c; break
                if c in belt and c != start:          # op een band kom je aan het eind van de band uit
                    e = tuple(round(v) for v in D['belts'][belt[c]]['path'][-1])
                    if e not in prev:
                        prev[e] = c; q.append(e)
                    continue
                for d in DIRS:
                    n = (c[0] + d[0], c[1] + d[1])
                    if n not in prev and passable(c, n, locked, ds):
                        prev[n] = c; q.append(n)
            if end is None:
                return False
            path, c = [], end
            while c:
                path.append(c); c = prev[c]
            for c in reversed(path[:-1]):
                await tp(c)
                if c in belt:                           # meerijden, daarna opnieuw plannen
                    for _ in range(200):
                        await pg.wait_for_timeout(100)
                        if not await pg.evaluate("__game.riding"):
                            break
                    return True
            return True

        for _ in range(600):
            if await pg.evaluate("__game.finished"):
                break
            ch = await pg.evaluate("__game.choose")
            if ch:
                ds = await pg.evaluate(f"__game.doors({json.dumps(ch['id'])})")
                order = sorted(ds, key=lambda d: d['truth'] == ch['value']) if fout else [d for d in ds if d['truth'] == ch['value']]
                for d in order:
                    dd = tuple(d['dir'])
                    front = (d['x'] - dd[0], d['y'] - dd[1])
                    if not await walk_to({front}):
                        res['stuck'] = f"kan niet bij deur {d}"; break
                    await tp(front, DIRS[dd])
                    await pg.keyboard.down('KeyW'); await pg.wait_for_timeout(450); await pg.keyboard.up('KeyW')
                    await pg.wait_for_timeout(60)
                if res['stuck']:
                    break
                continue
            w = await pg.evaluate("__game.waiting")
            if not w:
                await pg.wait_for_timeout(300); continue
            if not await walk_to(trig.get(w, set())):
                res['stuck'] = f"geen pad naar {w} vanaf {await pos()}"; break
            await pg.wait_for_timeout(60)

        res['finished'] = await pg.evaluate("__game.finished")
        res['console'] = await pg.evaluate("__game.console()")
        res['vars'] = await pg.evaluate("__game.vars()")
        if screenshot:
            await pg.wait_for_timeout(2200)
            await pg.screenshot(path=screenshot)
        await b.close()
    return res


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('level')
    ap.add_argument('--fout', action='store_true', help='kies eerst de verkeerde deur')
    ap.add_argument('--echt', action='store_true', help='echte three.js en WebGL gebruiken')
    ap.add_argument('--chrome', default=os.environ.get('CHROME'), help='pad naar Chrome (anders de Chromium van Playwright)')
    ap.add_argument('--screenshot', help='bewaar aan het eind een screenshot')
    a = ap.parse_args()
    r = asyncio.run(speel(a.level, a.fout, a.echt, a.chrome, a.screenshot))
    print(json.dumps(r, indent=2, ensure_ascii=False))
    sys.exit(0 if (r['finished'] or r['loaderr']) and not r['leaks'] and not r['errors'] else 1)
