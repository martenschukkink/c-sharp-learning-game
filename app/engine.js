/* =====================================================================
   Code Gangen – engine
   Leest window.LEVEL (uit level.js), zet de C#-code om in een gebouw
   (elke regel een kamer) en laat de speler het programma doorlopen.
   Je hoeft dit bestand niet aan te passen om een nieuw level te maken.
   ===================================================================== */
(async function () {
'use strict';

const LEVEL = window.LEVEL || {};
const CELL = 2, H = 3.4, EYE = 1.6, RAD = 0.45, SPEED = 5.5;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// =====================================================================
// 1. C#-code inlezen (een kleine subset van C#)
// =====================================================================
class CodeError extends Error { constructor(msg, line) { super(msg); this.line = line; } }
const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'true', 'false']);
const TYPES = new Set(['int', 'double', 'bool', 'string']);
const OPS = ['&&', '||', '==', '!=', '<=', '>=', '++', '--', '+=', '-=', '*=', '/=', '%=',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '(', ')', '{', '}', ';', ',', '.'];

function lex(src) {
  const toks = []; let i = 0, line = 1, lineStart = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; lineStart = i; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('/*', i)) {
      const e = src.indexOf('*/', i + 2), end = e < 0 ? src.length : e + 2;
      for (let k = i; k < end; k++) if (src[k] === '\n') { line++; lineStart = k + 1; }
      i = end; continue;
    }
    const col = i - lineStart, start = i;
    if (/[0-9]/.test(c)) {
      let j = i; while (/[0-9]/.test(src[j] || '')) j++;
      let isDouble = false;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] || '')) { isDouble = true; j++; while (/[0-9]/.test(src[j] || '')) j++; }
      toks.push({ t: 'num', v: Number(src.slice(i, j)), raw: src.slice(i, j), isDouble, line, col, start, end: j }); i = j; continue;
    }
    if (c === '$' && src[i + 1] === '"') {
      // string-interpolatie: parts is een rij van losse tekst en variabelen
      const parts = []; let j = i + 2, s = '';
      const gat = /\{[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*\}/y;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\n') throw new CodeError('Tekst zonder afsluitend aanhalingsteken (")', line);
        if (src[j] === '\\') { const n = src[j + 1]; s += n === 'n' ? '\n' : n === 't' ? '\t' : n; j += 2; }
        else if (src.startsWith('{{', j)) { s += '{'; j += 2; }
        else if (src.startsWith('}}', j)) { s += '}'; j += 2; }
        else if (src[j] === '}') throw new CodeError("Losse '}' in een $-tekst (schrijf '}}' voor een gewone accolade)", line);
        else if (src[j] === '{') {
          gat.lastIndex = j;
          const m = gat.exec(src);
          if (!m) throw new CodeError("Tussen { } in een $-tekst mag alleen de naam van een variabele staan (schrijf '{{' voor een gewone accolade)", line);
          if (s) { parts.push(s); s = ''; }
          parts.push({ k: 'var', name: m[1], line });
          j += m[0].length;
        } else s += src[j++];
      }
      if (j >= src.length) throw new CodeError('Tekst zonder afsluitend aanhalingsteken (")', line);
      if (s) parts.push(s);
      toks.push({ t: 'istr', v: src.slice(i, j + 1), parts, line, col, start, end: j + 1 }); i = j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\n') throw new CodeError('Tekst zonder afsluitend aanhalingsteken (")', line);
        if (src[j] === '\\') { const n = src[j + 1]; s += n === 'n' ? '\n' : n === 't' ? '\t' : n; j += 2; } else s += src[j++];
      }
      if (j >= src.length) throw new CodeError('Tekst zonder afsluitend aanhalingsteken (")', line);
      toks.push({ t: 'str', v: s, line, col, start, end: j + 1 }); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (/[A-Za-z0-9_]/.test(src[j] || '')) j++;
      const w = src.slice(i, j);
      toks.push({ t: KEYWORDS.has(w) ? 'kw' : TYPES.has(w) ? 'type' : 'id', v: w, line, col, start, end: j }); i = j; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw new CodeError(`Onbekend teken '${c}'`, line);
    toks.push({ t: 'op', v: op, line, col, start, end: i + op.length }); i += op.length;
  }
  toks.push({ t: 'eof', v: '', line, col: 0, start: src.length, end: src.length });
  return toks;
}

function parse(src) {
  const toks = lex(src); let p = 0, uid = 0;
  const peek = () => toks[p];
  const is = v => toks[p].v === v && toks[p].t !== 'str';
  const next = () => toks[p++];
  const want = (v, waar) => {
    // bij een ontbrekende ; of ) hoort de fout bij de regel ervoor, niet bij de volgende
    const line = (v === ';' || v === ')') && p > 0 ? toks[p - 1].line : peek().line;
    if (!is(v)) throw new CodeError(`Verwacht '${v}'${waar ? ' ' + waar : ''}, maar vond '${peek().v || 'einde van de code'}'`, line);
    return next();
  };
  const text = (a, b) => src.slice(a.start, b.end).replace(/\s+/g, ' ');
  const tag = (s, first, last) => { s.id = 'n' + (++uid); s.line = first.line; s.first = first; s.last = last; s.src = text(first, last); return s; };

  function block() {
    if (is('{')) {
      const open = next(), body = [];
      while (!is('}')) {
        if (peek().t === 'eof') throw new CodeError("Er ontbreekt een '}'", open.line);
        body.push(statement());
      }
      return { kind: 'block', body, open, close: next() };
    }
    const st = statement();
    return { kind: 'block', body: [st], open: null, close: null };
  }
  function simple() {
    const first = peek();
    if (first.t === 'type') {
      const type = next().v, nameT = next();
      if (nameT.t !== 'id') throw new CodeError(`Verwacht een naam na '${type}'`, nameT.line);
      let init = null;
      if (is('=')) { next(); init = expr(); }
      return tag({ kind: 'decl', type, name: nameT.v, init }, first, toks[p - 1]);
    }
    if (first.t === 'id' && first.v === 'Console') {
      next(); want('.', 'na Console');
      const m = next();
      if (m.v !== 'WriteLine' && m.v !== 'Write') throw new CodeError(`Console.${m.v} wordt (nog) niet ondersteund`, m.line);
      want('(', `na Console.${m.v}`);
      const e = is(')') ? null : peek().t === 'istr' ? { k: 'interp', parts: next().parts } : expr();
      want(')');
      return tag({ kind: 'write', newline: m.v === 'WriteLine', expr: e }, first, toks[p - 1]);
    }
    if (first.t === 'op' && (first.v === '++' || first.v === '--')) {
      next(); const n = next();
      if (n.t !== 'id') throw new CodeError(`Verwacht een variabele na '${first.v}'`, n.line);
      return tag({ kind: 'incdec', name: n.v, op: first.v }, first, n);
    }
    if (first.t === 'id') {
      next(); const o = peek();
      if (o.v === '++' || o.v === '--') { next(); return tag({ kind: 'incdec', name: first.v, op: o.v }, first, o); }
      if (['=', '+=', '-=', '*=', '/=', '%='].includes(o.v)) { next(); const e = expr(); return tag({ kind: 'assign', name: first.v, op: o.v, expr: e }, first, toks[p - 1]); }
      throw new CodeError(`Verwacht '=' of '++' na '${first.v}'`, o.line);
    }
    if (first.t === 'type' || first.v === 'var') throw new CodeError(`Onbekend type '${first.v}'`, first.line);
    throw new CodeError(`Onverwacht '${first.v || 'einde van de code'}'`, first.line);
  }
  function condition(waar) {
    want('(', waar);
    const cf = peek(); const cond = expr(); const cl = toks[p - 1];
    const close = want(')');
    return { cond, condSrc: text(cf, cl), cf, cl, close };
  }
  function statement() {
    const t = peek();
    if (t.t === 'kw' && t.v === 'if') {
      next(); const c = condition("na 'if'");
      const then = block(); let els = null, elseTok = null;
      if (is('else')) { elseTok = next(); els = block(); }
      return tag({ kind: 'if', cond: c.cond, condSrc: c.condSrc, then, else: els, elseTok }, t, c.close);
    }
    if (t.t === 'kw' && t.v === 'while') {
      next(); const c = condition("na 'while'");
      return tag({ kind: 'while', cond: c.cond, condSrc: c.condSrc, body: block() }, t, c.close);
    }
    if (t.t === 'kw' && t.v === 'for') {
      next(); want('(', "na 'for'");
      const init = simple();
      if (init.kind !== 'decl' && init.kind !== 'assign') throw new CodeError('Het eerste deel van een for-loop moet een declaratie of toekenning zijn', init.line);
      want(';', 'na het eerste deel van de for-loop');
      const cf = peek(); const cond = expr(); const cl = toks[p - 1];
      want(';', 'na de conditie van de for-loop');
      const update = simple();
      const close = want(')');
      const node = tag({ kind: 'for', init, cond, condSrc: text(cf, cl), update, body: block() }, t, close);
      if (init.line === t.line && cl.line === t.line && update.line === t.line) {
        node.parts = { init: [init.first.col, init.last.col + (init.last.end - init.last.start)],
          cond: [cf.col, cl.col + (cl.end - cl.start)],
          update: [update.first.col, update.last.col + (update.last.end - update.last.start)] };
      }
      return node;
    }
    if (t.t === 'kw' && t.v === 'else') throw new CodeError("'else' zonder 'if' ervoor", t.line);
    const s = simple();
    want(';', 'aan het eind van de regel');
    return s;
  }
  // expressies, van zwak naar sterk bindend
  function expr() { return orE(); }
  const binary = (sub, ops) => () => {
    let a = sub();
    while (peek().t === 'op' && ops.includes(peek().v)) { const op = next().v; a = { k: 'bin', op, a, b: sub() }; }
    return a;
  };
  function unary() {
    if (is('!') || is('-')) { const op = next().v; return { k: 'un', op, a: unary() }; }
    return primary();
  }
  function primary() {
    const t = next();
    if (t.t === 'num') return { k: 'num', v: t.v, raw: t.raw, isDouble: t.isDouble };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'istr') throw new CodeError('Een $-tekst werkt (nog) alleen als hele invoer van Console.Write of Console.WriteLine', t.line);
    if (t.t === 'kw' && (t.v === 'true' || t.v === 'false')) return { k: 'bool', v: t.v === 'true' };
    if (t.t === 'id') return { k: 'var', name: t.v, line: t.line };
    if (t.v === '(') { const e = expr(); want(')'); return { k: 'paren', e }; }
    throw new CodeError(`Verwacht een waarde, maar vond '${t.v || 'einde van de code'}'`, t.line);
  }
  const mul = binary(unary, ['*', '/', '%']), add = binary(mul, ['+', '-']);
  const rel = binary(add, ['<', '>', '<=', '>=']), eq = binary(rel, ['==', '!=']);
  const andE = binary(eq, ['&&']), orE = binary(andE, ['||']);

  const body = [];
  while (peek().t !== 'eof') body.push(statement());
  if (!body.length) throw new CodeError('Het level bevat nog geen code', 1);
  return { kind: 'block', body };
}

// Controle vooraf: bestaan de variabelen, kloppen de types?
const NUM = t => t === 'int' || t === 'double';
function check(prog) {
  const scopes = [new Map()];
  const find = n => { for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(n)) return scopes[i].get(n); return null; };
  const need = (n, line) => { const t = find(n); if (!t) throw new CodeError(`De variabele '${n}' bestaat (hier) niet`, line); return t; };
  const fits = (target, t, line) => {
    if (target === t || (target === 'double' && t === 'int')) return;
    throw new CodeError(`Een ${t} past niet in een variabele van type ${target}`, line);
  };
  function type(e, line) {
    switch (e.k) {
      case 'num': return e.isDouble ? 'double' : 'int';
      case 'str': return 'string';
      case 'interp': e.parts.forEach(p => { if (typeof p !== 'string') need(p.name, line); }); return 'string';
      case 'bool': return 'bool';
      case 'var': return need(e.name, line);
      case 'paren': return type(e.e, line);
      case 'un': {
        const a = type(e.a, line);
        if (e.op === '!') { if (a !== 'bool') throw new CodeError("'!' werkt alleen op een bool", line); return 'bool'; }
        if (!NUM(a)) throw new CodeError("'-' werkt alleen op getallen", line); return a;
      }
      case 'bin': {
        const a = type(e.a, line), b = type(e.b, line), op = e.op;
        if (op === '&&' || op === '||') { if (a !== 'bool' || b !== 'bool') throw new CodeError(`'${op}' werkt alleen tussen twee bools`, line); return 'bool'; }
        if (op === '==' || op === '!=') { if (a !== b && !(NUM(a) && NUM(b))) throw new CodeError(`Je kunt een ${a} niet vergelijken met een ${b}`, line); return 'bool'; }
        if (['<', '>', '<=', '>='].includes(op)) { if (!NUM(a) || !NUM(b)) throw new CodeError(`'${op}' werkt alleen tussen getallen`, line); return 'bool'; }
        if (op === '+' && (a === 'string' || b === 'string')) return 'string';
        if (!NUM(a) || !NUM(b)) throw new CodeError(`'${op}' werkt alleen tussen getallen`, line);
        return a === 'double' || b === 'double' ? 'double' : 'int';
      }
    }
  }
  const boolCond = (e, line) => { if (type(e, line) !== 'bool') throw new CodeError('Een conditie moet true of false opleveren', line); };
  function stmt(s) {
    switch (s.kind) {
      case 'decl':
        if (find(s.name)) throw new CodeError(`De variabele '${s.name}' bestaat al`, s.line);
        if (s.init) fits(s.type, type(s.init, s.line), s.line);
        scopes[scopes.length - 1].set(s.name, s.type); break;
      case 'assign': {
        const vt = need(s.name, s.line), t = type(s.expr, s.line);
        if (s.op === '=') fits(vt, t, s.line);
        else if (s.op === '+=' && vt === 'string') { /* tekst erachter plakken mag */ }
        else { if (!NUM(vt) || !NUM(t)) throw new CodeError(`'${s.op}' werkt alleen met getallen`, s.line); fits(vt, t, s.line); }
        break;
      }
      case 'incdec': if (!NUM(need(s.name, s.line))) throw new CodeError(`'${s.op}' werkt alleen met getallen`, s.line); break;
      case 'write': if (s.expr) type(s.expr, s.line); break;
      case 'if': boolCond(s.cond, s.line); block(s.then); if (s.else) block(s.else); break;
      case 'while': boolCond(s.cond, s.line); block(s.body); break;
      case 'for':
        scopes.push(new Map()); stmt(s.init); boolCond(s.cond, s.line); block(s.body); stmt(s.update); scopes.pop(); break;
    }
  }
  function block(b) { scopes.push(new Map()); b.body.forEach(stmt); scopes.pop(); }
  prog.body.forEach(stmt);
}

// =====================================================================
// 2. Waarden uitrekenen, met tussenstappen voor de uitleg
// =====================================================================
let scopes = [];
let curLine = 0;
const lookup = n => { for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(n)) return scopes[i].get(n); return null; };
const csStr = x => x.t === 'bool' ? (x.v ? 'True' : 'False') : String(x.v);            // zoals C# het print
const lit = x => x.t === 'string' ? `"${x.v}"` : x.t === 'bool' ? String(x.v) : String(x.v);   // zoals in code
function ev(e) {
  switch (e.k) {
    case 'num': return { t: e.isDouble ? 'double' : 'int', v: e.v };
    case 'str': return { t: 'string', v: e.v };
    case 'interp': return { t: 'string', v: e.parts.map(p => typeof p === 'string' ? p : csStr(ev(p))).join('') };
    case 'bool': return { t: 'bool', v: e.v };
    case 'paren': return ev(e.e);
    case 'var': {
      const x = lookup(e.name);
      if (!x || x.v === undefined) throw new CodeError(`'${e.name}' heeft nog geen waarde`, curLine);
      return { t: x.type, v: x.v };
    }
    case 'un': { const a = ev(e.a); return e.op === '!' ? { t: 'bool', v: !a.v } : { t: a.t, v: -a.v }; }
    case 'bin': {
      if (e.op === '&&') return ev(e.a).v ? { t: 'bool', v: ev(e.b).v } : { t: 'bool', v: false };
      if (e.op === '||') return ev(e.a).v ? { t: 'bool', v: true } : { t: 'bool', v: ev(e.b).v };
      const a = ev(e.a), b = ev(e.b), ints = a.t === 'int' && b.t === 'int';
      const n = v => ({ t: ints ? 'int' : 'double', v });
      switch (e.op) {
        case '+': return (a.t === 'string' || b.t === 'string') ? { t: 'string', v: csStr(a) + csStr(b) } : n(a.v + b.v);
        case '-': return n(a.v - b.v);
        case '*': return n(a.v * b.v);
        case '/': if (ints) { if (b.v === 0) throw new CodeError('Delen door 0 (DivideByZeroException)', curLine); return n(Math.trunc(a.v / b.v)); } return n(a.v / b.v);
        case '%': if (ints && b.v === 0) throw new CodeError('Delen door 0 (DivideByZeroException)', curLine); return n(a.v % b.v);
        case '<': return { t: 'bool', v: a.v < b.v };
        case '>': return { t: 'bool', v: a.v > b.v };
        case '<=': return { t: 'bool', v: a.v <= b.v };
        case '>=': return { t: 'bool', v: a.v >= b.v };
        case '==': return { t: 'bool', v: a.v === b.v };
        case '!=': return { t: 'bool', v: a.v !== b.v };
      }
    }
  }
}
const isLogic = e => e.k === 'bin' && (e.op === '&&' || e.op === '||') || e.k === 'un' && e.op === '!';
const hasLogic = e => isLogic(e) || (e.k === 'bin' && (hasLogic(e.a) || hasLogic(e.b))) || (e.k === 'paren' && hasLogic(e.e)) || (e.k === 'un' && hasLogic(e.a));
// mode: 'src' = zoals geschreven, 'sub' = variabelen vervangen door hun waarde, 'red' = alles behalve && || ! uitgerekend
function show(e, mode) {
  if (mode === 'red' && !hasLogic(e)) { try { return lit(ev(e)); } catch (x) { return '?'; } }
  switch (e.k) {
    case 'num': return e.raw;
    case 'str': return `"${e.v}"`;
    case 'interp': return '$"' + e.parts.map(p => typeof p === 'string' ? p.replace(/[{}]/g, '$&$&')
      : `{${mode === 'src' ? p.name : (() => { try { return csStr(ev(p)); } catch (x) { return p.name; } })()}}`).join('') + '"';
    case 'bool': return String(e.v);
    case 'var': if (mode === 'src') return e.name; try { return lit(ev(e)); } catch (x) { return e.name; }
    case 'paren': return `(${show(e.e, mode)})`;
    case 'un': return e.op + show(e.a, mode);
    case 'bin': {
      let a = show(e.a, mode), b = show(e.b, mode);
      if (mode === 'sub' && (e.op === '&&' || e.op === '||')) {
        if (e.a.k === 'bin' && !isLogic(e.a)) a = `(${a})`;
        if (e.b.k === 'bin' && !isLogic(e.b)) b = `(${b})`;
      }
      return `${a} ${e.op} ${b}`;
    }
  }
}
function trace(e) {
  const steps = [show(e, 'src')];
  const add = s => { if (steps[steps.length - 1] !== s) steps.push(s); };
  add(show(e, 'sub'));
  if (hasLogic(e)) add(show(e, 'red'));
  add(lit(ev(e)));
  return steps;
}
const traceHtml = e => trace(e).map((s, i, a) => i === a.length - 1 && ev(e).t === 'bool' ? tf(ev(e).v) : `<code>${esc(s)}</code>`).join(' → ');
const tf = b => `<span class="${b ? 't' : 'f'}">${b}</span>`;
const varsIn = (e, out = new Set()) => { if (e.k === 'var') out.add(e.name); for (const k of ['a', 'b', 'e']) if (e[k]) varsIn(e[k], out); return out; };
const TYPE_UITLEG = { int: 'een geheel getal', double: 'een kommagetal', bool: 'true of false', string: 'tekst' };

// =====================================================================
// 3. Het gebouw: elke regel een kamer
// =====================================================================
const N = [0, 1], S = [0, -1], E = [1, 0], W = [-1, 0];
class Builder {
  constructor() { this.floor = new Map(); this.rooms = []; this.gates = []; this.doors = []; this.belts = []; this.triggers = new Map(); this.minX = Infinity; this.maxX = -Infinity; }
  fl(x, y) { this.floor.set(x + ',' + y, [x, y]); this.minX = Math.min(this.minX, x); this.maxX = Math.max(this.maxX, x); }
  rect(x0, y0, w, h) { for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) this.fl(x, y); }
  get lo() { return this.minX === Infinity ? 0 : this.minX; }
  get hi() { return this.maxX === -Infinity ? 0 : this.maxX; }
  merge(o, dx, dy) {
    for (const [x, y] of o.floor.values()) this.fl(x + dx, y + dy);
    for (const r of o.rooms) this.rooms.push({ ...r, x: r.x + dx, y: r.y + dy });
    for (const g of o.gates) this.gates.push({ ...g, x: g.x + dx, y: g.y + dy });
    for (const d of o.doors) this.doors.push({ ...d, x: d.x + dx, y: d.y + dy });
    for (const b of o.belts) this.belts.push({ cells: b.cells.map(([x, y]) => [x + dx, y + dy]), path: b.path.map(([x, y]) => [x + dx, y + dy]) });
    for (const [k, id] of o.triggers) { const [x, y] = k.split(',').map(Number); this.triggers.set((x + dx) + ',' + (y + dy), id); }
  }
}
const P = (entries, belts = []) => ({ entries, belts });
const halfFor = pend => Math.max(2, ...pend.entries.map(Math.abs));
let junctionId = 0;

// Kamer van 5 vakken hoog; half = halve breedte. Regels hebben een vlak van 3x3 in het midden, condities zijn helemaal de regel.
function room(B, y0, half, pend, spec) {
  const cx = spec.cx || 0;
  B.rect(cx - half, y0, 2 * half + 1, 5);
  for (const bs of pend.belts) connectBelt(B, bs, half, y0);
  if (spec.trigger === 'pad') for (let x = cx - 1; x <= cx + 1; x++) for (let y = y0 + 1; y <= y0 + 3; y++) B.triggers.set(x + ',' + y, spec.id);
  if (spec.trigger === 'room') for (let x = cx - half; x <= cx + half; x++) for (let y = y0; y <= y0 + 4; y++) B.triggers.set(x + ',' + y, spec.id);
  B.rooms.push({ id: spec.id, kind: spec.kind, x: cx, y: y0 + 2, label: spec.label, type: spec.type, node: spec.node, part: spec.part });
}
const gate = (B, x, y, dir, req) => { B.fl(x, y); B.gates.push({ x, y, dir, req }); };
const door = (B, x, y, dir, decision, truth) => { B.fl(x, y); B.doors.push({ x, y, dir, decision, truth }); };

// Lopende band om een blok heen: van de false-deur naar de rechterkant van de volgende kamer
function connectBelt(B, bs, half, y0) {
  const rowEnd = y0 + 2, cx = Math.max(bs.cx, half + 2), cells = [];
  const add = (x, y) => { B.fl(x, y); cells.push([x, y]); };
  for (let x = bs.xStart; x < cx; x++) add(x, bs.yStart);
  for (let y = bs.yStart; y <= rowEnd; y++) { add(cx, y); add(cx + 1, y); }
  for (let x = half + 2; x < cx; x++) add(x, rowEnd);
  gate(B, half + 1, rowEnd, W, null);
  B.belts.push({ cells, path: [[bs.xStart - 0.5, bs.yStart], [cx + 0.5, bs.yStart], [cx + 0.5, rowEnd], [Math.min(half, 2), rowEnd]] });
}

// Lege kamer waar losse uitgangen en banden samenkomen
function junction(B, y, pend, endLabel) {
  room(B, y, halfFor(pend), pend, { id: 'j' + (++junctionId), kind: 'junction', trigger: null, label: endLabel || '}', type: endLabel ? 'out' : 'junction' });
}

function placeBlock(stmts, pendIn, resolve, endLabel) {
  const B = new Builder(); let y = 0, pend = pendIn;
  for (const st of stmts) { const r = placeStmt(B, st, y, pend); y = r.y; pend = r.pend; }
  const loose = pend.belts.length > 0 || pend.entries.length !== 1 || pend.entries[0] !== 0;
  if ((resolve && loose) || endLabel) {
    junction(B, y, pend, endLabel);
    if (resolve) gate(B, 0, y + 5, N, null);
    y += 6; pend = P([0]);
  }
  return { B, pend, yEnd: y };
}

function placeStmt(B, st, y0, pend) {
  switch (st.kind) {
    case 'decl': case 'assign': case 'incdec': case 'write':
      room(B, y0, halfFor(pend), pend, { id: st.id, kind: 'stmt', trigger: 'pad', label: st.src + ';', type: stmtType(st), node: st });
      gate(B, 0, y0 + 5, N, st.id);
      return { y: y0 + 6, pend: P([0]) };
    case 'if': return st.else ? placeIfElse(B, st, y0, pend) : placeIf(B, st, y0, pend);
    case 'for': return placeFor(B, st, y0, pend);
    case 'while': return placeWhile(B, st, y0, pend);
  }
}
const stmtType = st => st.kind === 'decl' ? 'decl' : st.kind === 'write' ? 'out' : 'assign';

function placeIf(B, st, y0, pend) {
  // true linksboven (het blok), false rechtsboven: een rechte lopende band langs het blok naar de volgende kamer.
  // De deuren staan symmetrisch rond het midden; d is zo klein mogelijk met één vak muur tussen blok en band.
  const T = placeBlock(st.then.body, P([0]), true);
  const d = Math.ceil((T.B.hi + 2) / 2), xl = -d, xr = d, yStart = y0 + 6;
  const h = Math.max(2, d, ...pend.entries.map(Math.abs));
  room(B, y0, h, pend, { id: st.id, kind: 'cond', trigger: 'room', label: `if (${st.condSrc})`, type: 'cond', node: st });
  door(B, xl, y0 + 5, N, st.id, true);
  door(B, xr, y0 + 5, N, st.id, false);
  B.merge(T.B, xl, yStart);
  const yEnd = Math.max(T.yEnd, 2);                      // ook bij een leeg blok: minstens één vak band + schuifdeur
  for (let y = yStart + T.yEnd; y < yStart + yEnd; y++) B.fl(xl, y);
  const yGate = yStart + yEnd - 1, yNext = yGate + 1, cells = [];
  for (let y = yStart; y < yGate; y++) { B.fl(xr, y); cells.push([xr, y]); }
  gate(B, xr, yGate, N, null);
  B.belts.push({ cells, path: [[xr, yStart], [xr, yNext]] });
  return { y: yNext, pend: P([xl, xr]) };
}

function placeIfElse(B, st, y0, pend) {
  const L = placeBlock(st.then.body, P([0]), true), R = placeBlock(st.else.body, P([0]), true);
  const xl = -L.B.hi - 1, xr = 1 - R.B.lo;
  const h = Math.max(2, -xl, xr, ...pend.entries.map(Math.abs));
  room(B, y0, h, pend, { id: st.id, kind: 'cond', trigger: 'room', label: `if (${st.condSrc})`, type: 'cond', node: st });
  door(B, xl, y0 + 5, N, st.id, true);
  door(B, xr, y0 + 5, N, st.id, false);
  B.merge(L.B, xl, y0 + 6); B.merge(R.B, xr, y0 + 6);
  const yEnd = Math.max(L.yEnd, R.yEnd);
  for (const [blk, x] of [[L, xl], [R, xr]]) for (let y = y0 + 6 + blk.yEnd; y < y0 + 6 + yEnd; y++) B.fl(x, y);
  return { y: y0 + 6 + yEnd, pend: P([xl, xr]) };
}

function placeFor(B, st, y0, pend) {
  room(B, y0, halfFor(pend), pend, { id: st.init.id, kind: 'stmt', trigger: 'pad', label: st.init.src, type: 'loop', node: st, part: 'init' });
  gate(B, 0, y0 + 5, N, st.init.id);
  // true linksboven (de body), false rechtsboven: een rechte lopende band langs de body naar de regel na de loop
  const Bd = placeBlock(st.body.body, P([0]), true);
  const d = Math.ceil((Bd.B.hi + 2) / 2), xl = -d, xr = d, yc = y0 + 6, h = Math.max(2, d);
  room(B, yc, h, P([0]), { id: st.id, kind: 'cond', trigger: 'room', label: st.condSrc, type: 'loop', node: st, part: 'cond' });
  door(B, xl, yc + 5, N, st.id, true);
  door(B, xr, yc + 5, N, st.id, false);
  B.merge(Bd.B, xl, yc + 6);
  const yb = yc + 6 + Bd.yEnd - 1;                       // rij met de uitgang van de body
  const xu = Math.min(-h - 4, xl + Bd.B.lo - 4);         // update-kamer links van de conditie
  room(B, yc, 2, P([]), { id: st.update.id, kind: 'stmt', trigger: 'pad', label: st.update.src, type: 'loop', node: st, part: 'update', cx: xu });
  gate(B, xu, yc + 5, S, null);
  gate(B, xu + 3, yc + 2, E, st.update.id);
  for (let x = xu + 4; x <= -h - 1; x++) B.fl(x, yc + 2);
  const cells = [];
  const add = (x, y) => { B.fl(x, y); cells.push([x, y]); };
  for (let x = xu - 1; x <= xl; x++) { add(x, yb + 1); add(x, yb + 2); }
  for (let y = yc + 6; y <= yb; y++) { add(xu - 1, y); add(xu, y); }
  B.belts.push({ cells, path: [[xl, yb + 1.5], [xu - 0.5, yb + 1.5], [xu - 0.5, yc + 7], [xu, yc + 6.2], [xu, yc + 4]] });
  // false-band: loopt door tot voorbij de terugkeerband en komt via een schuifdeur in de volgende kamer
  const yGate = yb + 3, falseCells = [];
  for (let y = yc + 6; y < yGate; y++) { B.fl(xr, y); falseCells.push([xr, y]); }
  gate(B, xr, yGate, N, null);
  B.belts.push({ cells: falseCells, path: [[xr, yc + 6], [xr, yGate + 1]] });
  return { y: yGate + 1, pend: P([xr]) };
}

function placeWhile(B, st, y0, pend) {
  // Een binnenkomende band eindigt rechts in de kamer, precies waar de false-deur van de while zit: eerst een lege kamer
  if (pend.belts.length) { junction(B, y0, pend); gate(B, 0, y0 + 5, N, null); y0 += 6; pend = P([0]); }
  const h = halfFor(pend);
  room(B, y0, h, pend, { id: st.id, kind: 'cond', trigger: 'room', label: `while (${st.condSrc})`, type: 'loop', node: st });
  door(B, 0, y0 + 5, N, st.id, true);
  door(B, h + 1, y0 + 2, E, st.id, false);
  const Bd = placeBlock(st.body.body, P([0]), true);
  B.merge(Bd.B, 0, y0 + 6);
  const yb = y0 + 6 + Bd.yEnd - 1;
  const xc = Math.min(-h - 3, Bd.B.lo - 3);
  const cells = [];
  const add = (x, y) => { B.fl(x, y); cells.push([x, y]); };
  for (let x = xc - 1; x <= 0; x++) { add(x, yb + 1); add(x, yb + 2); }
  for (let y = y0 + 2; y <= yb; y++) { add(xc - 1, y); add(xc, y); }
  for (let x = xc + 1; x <= -h - 2; x++) add(x, y0 + 2);
  gate(B, -h - 1, y0 + 2, E, null);
  B.belts.push({ cells, path: [[0, yb + 1.5], [xc - 0.5, yb + 1.5], [xc - 0.5, y0 + 2], [-h, y0 + 2]] });
  return { y: yb + 4, pend: P([], [{ xStart: h + 2, yStart: y0 + 2, cx: Math.max(h, Bd.B.hi, 2) + 2 }]) };
}

function buildLevel(prog) {
  const B = placeBlock(prog.body, P([0]), false, 'einde programma').B;
  B.rect(-1, -4, 3, 3); B.fl(0, -1);                     // startkamer
  return B;
}

// =====================================================================
// 4. Level laden (met duidelijke foutmelding voor de docent)
// =====================================================================
function normalize(code) {
  let lines = String(code || '').replace(/\t/g, '    ').replace(/\r/g, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const ind = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  return lines.map(l => l.slice(Number.isFinite(ind) ? ind : 0)).join('\n');
}
const CODE = normalize(LEVEL.code);
const CODE_LINES = CODE.split('\n');
let PROG, LAYOUT;
try {
  PROG = parse(CODE);
  check(PROG);
  LAYOUT = buildLevel(PROG);
} catch (err) {
  showLoadError(err);
  return;
}
function showLoadError(err) {
  const line = err.line || 0;
  const ctx = CODE_LINES.map((l, i) => i + 1 >= line - 2 && i + 1 <= line + 2
    ? `<div class="${i + 1 === line ? 'errline' : ''}"><span>${i + 1}</span>${esc(l) || ' '}</div>` : '').join('');
  $('intro').classList.add('hidden');
  $('loaderr').classList.remove('hidden');
  $('loaderrMsg').innerHTML = (line ? `Regel ${line}: ` : '') + esc(err.message);
  $('loaderrCode').innerHTML = ctx;
  if (!(err instanceof CodeError)) console.error(err);
}

// alle statements (ook genest) op een rij, voor het code-paneel en het eindoverzicht
const ALL = [];
(function walk(b) { for (const s of b.body) { ALL.push(s); if (s.then) walk(s.then); if (s.else) walk(s.else); if (s.body) walk(s.body); } })(PROG);
const has = k => ALL.some(s => s.kind === k);
const hasOp = op => ALL.some(s => s.cond && JSON.stringify(s.cond).includes(`"op":"${op}"`));

// =====================================================================
// 5. Code-paneel
// =====================================================================
const CSSCOL = { decl: '#38bdf8', assign: '#4ade80', cond: '#fbbf24', loop: '#e879f9', out: '#e5e7eb', junction: '#64748b', choice: '#60a5fa', bad: '#ff4d6d', ok: '#4ade80' };
function highlightCode(s) {
  // in een $-tekst krijgen de {variabelen} hun eigen kleur; {{ en }} blijven gewone tekst
  const gaten = t => t[0] !== '$' ? t : t.replace(/\{\{|\}\}|\{([^{}]*)\}/g, (h, n) => n === undefined ? h
    : `</span><span class="op">{</span>${n}<span class="op">}</span><span class="str">`);
  return s.replace(/(\$?"(?:[^"\\]|\\.)*")|(\/\/.*$)|\b(\d+(?:\.\d+)?)\b|\b(if|else|for|while|true|false|new|return)\b|\b(int|double|bool|string|char|var|void)\b|\b(Console)\b|(&amp;&amp;|\|\||!(?!=))|([^"$\/\w&|!]+|.)/g,
    (m, str, com, num, kw, ty, cls, op, rest) => str ? `<span class="str">${gaten(str)}</span>` : com ? `<span class="com">${com}</span>` : num ? `<span class="num">${num}</span>`
      : kw ? `<span class="kw">${kw}</span>` : ty ? `<span class="ty">${ty}</span>` : cls ? `<span class="cls">${cls}</span>` : op ? `<span class="op">${op}</span>` : m);
}
const codeEl = $('code');
const lineEls = [];
const partLines = {};               // regelnummer → for-node met kolommen per deel
for (const s of ALL) if (s.kind === 'for' && s.parts) partLines[s.line] = s;
CODE_LINES.forEach((txt, i) => {
  const no = i + 1, d = document.createElement('div');
  d.className = 'ln';
  let html;
  const f = partLines[no];
  if (f) {
    const cuts = [['init', ...f.parts.init], ['cond', ...f.parts.cond], ['update', ...f.parts.update]];
    html = ''; let pos = 0;
    for (const [name, a, b] of cuts) {
      html += highlightCode(esc(txt.slice(pos, a)));
      html += `<span class="fp" data-p="${name}">${highlightCode(esc(txt.slice(a, b)))}</span><sup class="pc" id="pc-${f.id}-${name}"></sup>`;
      pos = b;
    }
    html += highlightCode(esc(txt.slice(pos)));
  } else html = highlightCode(esc(txt));
  d.innerHTML = `<span class="no">${no}</span><span class="src">${html || ' '}</span><span class="cnt"></span>`;
  codeEl.appendChild(d); lineEls[no] = d;
});
function scrollToLine(el) {
  const top = el.offsetTop - codeEl.clientHeight / 2 + el.offsetHeight / 2;
  try { codeEl.scrollTo({ top, behavior: 'smooth' }); } catch (e) { codeEl.scrollTop = top; }
}
function highlight(line, type, part, forNode) {
  codeEl.querySelectorAll('.ln.active, .fp.active').forEach(e => e.classList.remove('active'));
  const el = lineEls[line]; if (!el) return;
  el.style.setProperty('--c', CSSCOL[type] || CSSCOL.decl);
  el.classList.add('active');
  if (part && forNode && forNode.parts) { const sp = el.querySelector(`[data-p="${part}"]`); if (sp) sp.classList.add('active'); }
  scrollToLine(el);
}
const lineCount = {};
const partCount = {};
function bump(line, forNode, part) {
  if (part && forNode && forNode.parts) {
    const k = forNode.id + '-' + part; partCount[k] = (partCount[k] || 0) + 1;
    const el = $('pc-' + k); if (el) el.textContent = '×' + partCount[k];
    return;
  }
  lineCount[line] = (lineCount[line] || 0) + 1;
  const c = lineEls[line] && lineEls[line].querySelector('.cnt');
  if (c) { c.textContent = '×' + lineCount[line]; c.classList.add('on'); }
}
// regels van een blok (zonder de regel met if/else zelf, tenzij die alleen het blok opent)
function blockLines(b, elseTok) {
  if (!b.open) { const s = b.body[0]; return [s.line, (s.last || s.first).line]; }
  let a = b.open.line, z = b.close.line;
  if (CODE_LINES[a - 1].trim() !== '{') a++;
  if (CODE_LINES[z - 1].trim() !== '}') z--;
  if (elseTok && CODE_LINES[elseTok.line - 1].trim() === 'else') a = elseTok.line;
  return [a, z];
}
function setLines(range, cls, on) { if (!range) return; for (let l = range[0]; l <= range[1]; l++) if (lineEls[l]) lineEls[l].classList.toggle(cls, on); }
function flashLines(range) {
  if (!range) return;
  for (let l = range[0]; l <= range[1]; l++) { const e = lineEls[l]; if (e) { e.classList.remove('jumpfx'); void e.offsetWidth; e.classList.add('jumpfx'); } }
  if (lineEls[range[0]]) scrollToLine(lineEls[range[0]]);
}

// =====================================================================
// 6. Inventory, console en berichten
// =====================================================================
const invList = $('invList');
const invEls = new Map();
function invEmpty() { invList.innerHTML = '<div class="empty">Nog leeg: er staan geen variabelen in het geheugen.</div>'; }
const shown = x => x.v === undefined ? '—' : lit({ t: x.type, v: x.v });
function invSet(name, x, note) {
  let el = invEls.get(name);
  if (!el) {
    const e = invList.querySelector('.empty'); if (e) e.remove();
    el = document.createElement('div'); el.className = 'item pop';
    el.innerHTML = `<span class="tb">${x.type}</span><span class="nm">${esc(name)}</span><span class="val"></span>` + (note ? `<span class="note">${note}</span>` : '');
    invList.appendChild(el); invEls.set(name, el);
    el.querySelector('.val').textContent = el.dataset.v = shown(x);
    return;
  }
  const val = el.querySelector('.val');
  val.innerHTML = `<s>${esc(el.dataset.v || '')}</s>→ ${esc(shown(x))}`;
  el.dataset.v = shown(x);
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  clearTimeout(el._t); el._t = setTimeout(() => { val.textContent = shown(x); }, 2200);
}
function invRemove(name) {
  const el = invEls.get(name); if (!el) return;
  invEls.delete(name); el.classList.add('gone');
  setTimeout(() => { el.remove(); if (!invEls.size) invEmpty(); }, 650);
}
const consoleOut = $('consoleOut');
const TYPE_MS = 500;                // zelfde duur als de typegeluiden
const conOutput = [];               // de volledige uitvoer, meteen bijgewerkt (ook voor de tests en het inleveren)
const conQueue = [];                // wat nog op het scherm getypt moet worden
let conOpen = false, conTimer = null, conCursor = null;
function consoleNewLine() {
  const line = document.createElement('div'); line.className = 'muted';
  line.appendChild(conCursor); consoleOut.appendChild(line);
}
function consoleClear() {
  clearTimeout(conTimer); conTimer = null; conQueue.length = 0;
  consoleOut.innerHTML = '';
  conCursor = document.createElement('span'); conCursor.className = 'cursor';
  consoleNewLine();
  conOpen = false; conOutput.length = 0;
}
function consoleTypeNext() {
  const job = conQueue.shift();
  if (!job) { conTimer = null; conCursor.classList.remove('busy'); return; }
  const line = conCursor.parentNode, chars = Array.from(job.text), start = performance.now();
  if (chars.length) line.classList.remove('muted');
  const node = document.createTextNode('');
  line.insertBefore(node, conCursor);
  conCursor.classList.add('busy');
  const tick = () => {
    const shown = Math.min(chars.length, Math.floor((performance.now() - start) / TYPE_MS * chars.length) + 1);
    node.data = chars.slice(0, shown).join('');
    if (shown < chars.length) { consoleOut.scrollTop = consoleOut.scrollHeight; conTimer = setTimeout(tick, 16); return; }
    if (job.newline) consoleNewLine();
    consoleOut.scrollTop = consoleOut.scrollHeight;
    consoleTypeNext();
  };
  tick();
}
function consoleWrite(text, newline) {
  if (!conOpen) conOutput.push('');
  conOutput[conOutput.length - 1] += text;
  conOpen = !newline;
  const box = $('consoleBox'); box.classList.remove('ping'); void box.offsetWidth; box.classList.add('ping');
  conQueue.push({ text, newline });
  if (conTimer === null) consoleTypeNext();
}
const msgCard = $('msgCard');
function message(type, tag, title, body, next = 'Volg het licht naar de volgende regel.', line) {
  const extra = line && LEVEL.uitleg && LEVEL.uitleg[line] ? `<p class="extra">${LEVEL.uitleg[line]}</p>` : '';
  msgCard.style.setProperty('--c', CSSCOL[type] || CSSCOL.decl);
  msgCard.innerHTML = `<span class="tag">${tag}</span><h3>${title}</h3><p>${body}</p>${extra}${next ? `<div class="next">→ ${next}</div>` : ''}`;
  msgCard.classList.remove('bump'); void msgCard.offsetWidth; msgCard.classList.add('bump');
}

// =====================================================================
// 6b. Geluid (Web Audio, geen bestanden nodig)
// =====================================================================
const Sound = (() => {
  let ctx = null, master = null, on = true;
  function init() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.45; master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { ctx = null; }
  }
  // één toon met een korte aanzet en uitsterven; f2 = eindtoonhoogte (glijden)
  function tone(f, at, dur, type = 'sine', vol = 0.15, f2) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, at);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(master); o.start(at); o.stop(at + dur + 0.02);
  }
  const ok = () => ctx && on && ctx.state === 'running';
  const PITCH = { decl: 880, assign: 698, loop: 784, junction: 587 };
  return {
    init,
    get on() { return on; },
    toggle() { on = !on; return on; },
    // een regel wordt uitgevoerd: kort, helder 'oppak'-geluidje (toonhoogte per soort regel)
    stmt(type) {
      if (!ok()) return; const t = ctx.currentTime, f = PITCH[type] || 740;
      tone(f, t, 0.12, 'sine', 0.16); tone(f * 1.5, t + 0.055, 0.16, 'sine', 0.1); tone(f * 2, t + 0.055, 0.1, 'triangle', 0.03);
    },
    // uitvoer naar de console: tikjes zoals de tekst intypt, daarna een zachte bevestiging
    console(text) {
      if (!ok()) return; const t = ctx.currentTime, n = Math.max(3, Math.min(18, text.length)), step = 0.5 / n;
      tone(220, t, 0.08, 'triangle', 0.08, 330);
      for (let i = 0; i < n; i++) tone(1500 + Math.random() * 700, t + 0.03 + i * step, 0.018, 'square', 0.025);
      tone(392, t + 0.03 + n * step, 0.16, 'triangle', 0.09); tone(587, t + 0.09 + n * step, 0.2, 'triangle', 0.07);
    },
    // een conditie: vragend motiefje
    question() { if (!ok()) return; const t = ctx.currentTime; tone(523, t, 0.16, 'triangle', 0.12); tone(659, t + 0.11, 0.22, 'triangle', 0.1, 622); },
    good() { if (!ok()) return; const t = ctx.currentTime; [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.07, 0.18, 'sine', 0.12)); },
    bad() { if (!ok()) return; const t = ctx.currentTime; tone(180, t, 0.28, 'sawtooth', 0.07, 110); tone(185, t, 0.28, 'square', 0.03, 112); },
  };
})();

// =====================================================================
// 7. Het programma uitvoeren, stap voor stap met de speler mee
//    De generator wacht ('wait') tot de speler in de kamer van een regel komt,
//    en bij een conditie ('choose') tot de speler de goede deur kiest.
// =====================================================================
const counts = {};                 // kamer-id → aantal keer uitgevoerd
const wrong = {};                  // conditie-id → foute keuzes
const trueCount = {};              // loop-id → aantal rondes
const scopeNames = [];             // per scope de namen, voor het opruimen
const pushScope = () => { scopes.push(new Map()); scopeNames.push([]); };
function popScope() { const m = scopes.pop(); scopeNames.pop(); for (const n of m.keys()) invRemove(n); }
function declare(name, type, v) { scopes[scopes.length - 1].set(name, { type, v }); }

function hit(node, roomId, type, part) {
  counts[roomId] = (counts[roomId] || 0) + 1;
  curLine = part === 'init' ? node.init.line : part === 'update' ? node.update.line : node.line;
  highlight(curLine, type, part, node.kind === 'for' ? node : null);
  bump(curLine, node.kind === 'for' ? node : null, part);
}

function exec(st, ctx) {
  curLine = st.line;
  const L = st.line;
  if (st.kind !== 'write') Sound.stmt(ctx ? 'loop' : stmtType(st));
  switch (st.kind) {
    case 'decl': {
      const v = st.init ? ev(st.init) : undefined;
      const value = v === undefined ? undefined : (st.type === 'double' ? v.v : v.v);
      declare(st.name, st.type, value);
      invSet(st.name, { type: st.type, v: value }, ctx === 'init' ? 'Bestaat alleen binnen de loop' : '');
      flyItem(st.id);
      const rhs = st.init && (st.init.k !== 'num' && st.init.k !== 'str' && st.init.k !== 'bool') ? ` Eerst wordt de rechterkant uitgerekend: ${traceHtml(st.init)}.` : '';
      const tag = ctx === 'init' ? 'for · initialisatie' : 'Declaratie';
      const pre = ctx === 'init' ? 'Het eerste deel van de for-loop wordt <b>één keer</b> uitgevoerd, vóór de eerste ronde. ' : '';
      message(ctx === 'init' ? 'loop' : 'decl', tag, ctx === 'init' ? 'Start van de loop' : 'Variabele declareren',
        `${pre}<code>${esc(st.src)}</code> maakt een nieuwe variabele aan: <b>${st.type}</b> is het type (${TYPE_UITLEG[st.type]}), <b>${esc(st.name)}</b> is de naam` +
        (st.init ? ` en <b>${esc(lit({ t: st.type, v: value }))}</b> is de beginwaarde.${rhs}` : '. Er staat nog geen waarde in.'), undefined, L);
      return;
    }
    case 'assign': {
      const x = lookup(st.name);
      const old = lit({ t: x.type, v: x.v === undefined ? '' : x.v });
      let e = st.expr, intro = '';
      if (st.op !== '=') { e = { k: 'bin', op: st.op[0], a: { k: 'var', name: st.name }, b: st.expr.k === 'bin' ? { k: 'paren', e: st.expr } : st.expr }; intro = `<code>${esc(st.src)}</code> betekent <code>${esc(st.name)} = ${esc(show(e, 'src'))}</code>. `; }
      const tr = traceHtml(e);
      const v = ev(e);
      x.v = v.v;
      invSet(st.name, x);
      message(ctx === 'update' ? 'loop' : 'assign', ctx === 'update' ? 'for · update' : 'Toekenning', ctx === 'update' ? 'Teller bijwerken' : 'Variabele wijzigen',
        `${intro}Eerst wordt de rechterkant uitgerekend: ${tr}. Daarna gaat die uitkomst in <b>${esc(st.name)}</b> (de oude waarde ${esc(old)} is weg).` +
        (ctx === 'update' ? ' Daarna gaat de loop terug naar de conditie.' : ''), undefined, L);
      return;
    }
    case 'incdec': {
      const x = lookup(st.name); const old = x.v;
      x.v = st.op === '++' ? old + 1 : old - 1;
      invSet(st.name, x);
      message(ctx === 'update' ? 'loop' : 'assign', ctx === 'update' ? 'for · update' : 'Toekenning', ctx === 'update' ? 'Teller bijwerken' : 'Eén erbij of eraf',
        `<code>${esc(st.src)}</code> ${st.op === '++' ? 'verhoogt' : 'verlaagt'} <b>${esc(st.name)}</b> met 1: van ${old} naar ${x.v}.` +
        (ctx === 'update' ? ' Dit gebeurt aan het eind van elke ronde. Kijk naar rechts: de conditie licht weer op, want die wordt opnieuw gecontroleerd.' : ''), undefined, L);
      return;
    }
    case 'write': {
      const v = st.expr ? ev(st.expr) : { t: 'string', v: '' };
      consoleWrite(csStr(v), st.newline);
      Sound.console(csStr(v));
      const tr = st.expr && st.expr.k !== 'str' ? ` Eerst wordt uitgerekend wat er geschreven moet worden: ${traceHtml(st.expr)}.` : '';
      message('out', 'Uitvoer', st.newline ? 'Console.WriteLine' : 'Console.Write',
        `<code>${esc(st.src)}</code> schrijft <b>${esc(csStr(v))}</b> naar de console (linksonder).${tr}` +
        (st.newline ? ' Daarna begint de console op een nieuwe regel.' : ' De console blijft op dezelfde regel.'), undefined, L);
      return;
    }
  }
}

function* runBlock(b) { pushScope(); for (const st of b.body) yield* runStmt(st); popScope(); }
function* runStmt(st) {
  switch (st.kind) {
    case 'decl': case 'assign': case 'incdec': case 'write':
      yield { wait: st.id };
      hit(st, st.id, stmtType(st));
      exec(st);
      return;
    case 'if': {
      yield { wait: st.id };
      hit(st, st.id, 'cond');
      const v = ev(st.cond).v;
      yield { choose: st, value: v };
      const thenR = blockLines(st.then), elseR = st.else ? blockLines(st.else, st.elseTok) : null;
      setLines(thenR, 'skipped', !v); setLines(elseR, 'skipped', v);
      if (v) yield* runBlock(st.then); else if (st.else) yield* runBlock(st.else);
      return;
    }
    case 'while': {
      while (true) {
        yield { wait: st.id };
        hit(st, st.id, 'loop');
        const v = ev(st.cond).v;
        yield { choose: st, value: v };
        if (!v) return;
        trueCount[st.id] = (trueCount[st.id] || 0) + 1;
        yield* runBlock(st.body);
      }
    }
    case 'for': {
      pushScope();
      yield { wait: st.init.id };
      hit(st, st.init.id, 'loop', 'init');
      exec(st.init, 'init');
      while (true) {
        yield { wait: st.id };
        hit(st, st.id, 'loop', 'cond');
        const v = ev(st.cond).v;
        yield { choose: st, value: v };
        if (!v) break;
        trueCount[st.id] = (trueCount[st.id] || 0) + 1;
        yield* runBlock(st.body);
        yield { wait: st.update.id };
        hit(st, st.update.id, 'loop', 'update');
        exec(st.update, 'update');
      }
      popScope();
      return;
    }
  }
}

let gen = null, cur = null, finished = false;
function advance() {
  try {
    const r = gen.next();
    cur = r.done ? null : r.value;
  } catch (err) {
    cur = null;
    message('bad', 'Fout', 'Het programma loopt vast', `${err.line ? `Regel ${err.line}: ` : ''}${esc(err.message)}`, '');
    if (!(err instanceof CodeError)) console.error(err);
    return;
  }
  if (!cur) { finished = true; setTimeout(showFinish, 1800); return; }
  if (cur.choose) askDecision(cur);
}
const waiting = () => cur && cur.wait;

// --- condities
const isLoop = n => n.kind === 'for' || n.kind === 'while';
function opUitleg(e) {
  const s = JSON.stringify(e); let t = '';
  if (s.includes('"op":"&&"')) t += ' <code>&amp;&amp;</code> betekent <b>en</b>: alleen true als beide kanten true zijn.';
  if (s.includes('"op":"||"')) t += ' <code>||</code> betekent <b>of</b>: true als minstens één kant true is.';
  if (s.includes('"op":"!"')) t += ' <code>!</code> betekent <b>niet</b>: het draait true en false om.';
  return t;
}
function askDecision(c) {
  const n = c.choose;
  Sound.question();
  for (const d of doorsOf[n.id] || []) setDoor(d, 'neutral');
  let intro;
  if (n.kind === 'if') intro = n.else ? 'Een <b>if-else</b>: bij true voert het programma de if-tak uit (deur linksboven), bij false de else-tak (deur rechtsboven).'
    : 'Een <b>if</b> zonder else: bij true voert het programma het blok uit (deur linksboven), bij false slaat het het blok over (deur rechtsboven).';
  else intro = `Vóór elke ronde controleert de ${n.kind}-loop de conditie. true (${n.kind === 'for' ? 'deur linksboven' : 'bovendeur'}): nog een ronde. false (${n.kind === 'for' ? 'deur rechtsboven' : 'rechterdeur'}): de loop stopt.`;
  const used = [...varsIn(n.cond)].map(v => { const x = lookup(v); return x ? `<b>${esc(v)}</b> = ${esc(shown(x))}` : ''; }).filter(Boolean).join(', ');
  message('cond', 'Conditie', isLoop(n) ? 'Nog een ronde?' : 'Welke deur kies je?',
    `${intro}${opUitleg(n.cond)} Reken uit: <code>${esc(n.condSrc)}</code>${used ? ` (${used})` : ''}. Loop daarna door de deur <b>true</b> of <b>false</b>.`,
    'Kies een deur.', n.line);
}
function chooseDoor(d) {
  if (!cur || !cur.choose || cur.choose.id !== d.decision || d.state !== 'neutral') return;
  const n = cur.choose, v = cur.value;
  if (d.truth === v) {
    setDoor(d, 'open');
    for (const o of doorsOf[n.id]) if (o !== d) setDoor(o, 'closed');
    let what;
    if (n.kind === 'if') {
      if (v) what = n.else ? 'De if-tak wordt uitgevoerd, de else-tak overgeslagen.' : 'Het programma voert het blok tussen de { } uit.';
      else what = n.else ? 'De if-tak wordt overgeslagen en de else-tak uitgevoerd.' : 'Er is geen else, dus het programma slaat het hele blok over. De lopende band brengt je naar de regel erna.';
      if (!v && !n.else) flashLines(blockLines(n.then));
      if (v && n.else) flashLines(blockLines(n.else, n.elseTok));
    } else {
      const gone = n.kind === 'for' ? [...scopes[scopes.length - 1].keys()] : [];
      what = v ? 'Nog een ronde: de deur naar de body gaat open.'
        : 'De loop stopt. De lopende band brengt je naar de regel na de loop.' + (gone.length ? ` ${gone.map(g => `<b>${esc(g)}</b>`).join(', ')} verdwijnt uit je inventory: die bestaat alleen binnen de loop (scope).` : '');
    }
    Sound.good();
    message('cond', 'Goed gekozen', String(v), `${traceHtml(n.cond)}. ${what}`, 'Loop door de open deur.', n.line);
    advance();
  } else {
    setDoor(d, 'closed');
    Sound.bad();
    wrong[n.id] = (wrong[n.id] || 0) + 1;
    const used = [...varsIn(n.cond)].map(x => { const y = lookup(x); return y ? `<b>${esc(x)}</b> is ${esc(shown(y))}` : ''; }).filter(Boolean).join(', ');
    message('bad', 'Niet goed', 'Deze deur blijft dicht', `Kijk nog eens in je inventory${used ? ': ' + used : ''}. Reken <code>${esc(n.condSrc)}</code> stap voor stap uit.`, 'Probeer de andere deur.');
  }
}

// =====================================================================
// 8. Three.js-scène
// =====================================================================
try {
  await Promise.race([
    Promise.all([document.fonts.load('600 40px "JetBrains Mono"'), document.fonts.ready]),
    new Promise(r => setTimeout(r, 1500))
  ]);
} catch (e) {}

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070c);
scene.fog = new THREE.Fog(0x05070c, 7, 42);
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 160);
camera.rotation.order = 'YXZ';
scene.add(camera);
scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x20142a, 0.75));
camera.add(new THREE.PointLight(0xdfe8ff, 0.9, 18, 1.6));

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
const wallTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#1a2335'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#121927'; g.lineWidth = 8; g.strokeRect(0, 0, w, h);
  g.strokeStyle = '#26334d'; g.lineWidth = 2; g.strokeRect(14, 14, w - 28, h - 28);
  g.fillStyle = 'rgba(34,211,238,.55)'; g.fillRect(0, h * .80, w, 4);
});
const floorTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#0f1420'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#1c2740'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
});
const ceilTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#0b0f19'; g.fillRect(0, 0, w, h); g.strokeStyle = '#161e30'; g.lineWidth = 3; g.strokeRect(1, 1, w - 2, h - 2); });

// grid (x naar rechts, y naar het noorden) → wereld (x, z = -y)
const WX = x => x * CELL, WZ = y => -y * CELL;
const wd = d => [d[0], -d[1]];
const key = (x, y) => x + ',' + y;
const isFloor = (x, y) => LAYOUT.floor.has(key(x, y));
const world = new THREE.Group(); scene.add(world);
const floorCells = [...LAYOUT.floor.values()];
const wallSet = new Map();
for (const [x, y] of floorCells) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (!isFloor(x + dx, y + dy)) wallSet.set(key(x + dx, y + dy), [x + dx, y + dy]);
const m4 = new THREE.Matrix4();
function instanced(geo, mat, cells, y) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, cells.length));
  cells.forEach(([x, gy], i) => { m4.makeTranslation(WX(x), y, WZ(gy)); im.setMatrixAt(i, m4); });
  im.count = cells.length;
  im.instanceMatrix.needsUpdate = true; world.add(im); return im;
}
instanced(new THREE.BoxGeometry(CELL, H, CELL), new THREE.MeshStandardMaterial({ map: wallTex, roughness: .85, metalness: .1 }), [...wallSet.values()], H / 2);
instanced(new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: .9 }), floorCells, 0);
instanced(new THREE.PlaneGeometry(CELL, CELL).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1 }), floorCells, H);
instanced(new THREE.PlaneGeometry(1.4, 0.22).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8fd3ff }), floorCells.filter(([x, y]) => !(x & 1) && !(y & 1)), H - 0.01);

function makeLabel(text, color, height = 0.42, maxW = 9) {
  const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false });   // labels blijven verlicht, ook op afstand
  const sprite = new THREE.Sprite(mat);
  function set(t, col) {
    const cv = document.createElement('canvas'), g = cv.getContext('2d');
    const font = '600 40px "JetBrains Mono", Consolas, monospace';
    g.font = font;
    const w = Math.ceil(g.measureText(t).width) + 56, h = 80;
    cv.width = w; cv.height = h; g.font = font;
    g.fillStyle = 'rgba(6,9,16,0.9)'; roundRect(g, 3, 3, w - 6, h - 6, 14); g.fill();
    g.lineWidth = 4; g.strokeStyle = col; g.stroke();
    g.fillStyle = col; g.textBaseline = 'middle'; g.fillText(t, 28, h / 2 + 2);
    const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    if (mat.map) mat.map.dispose();
    mat.map = tex; mat.needsUpdate = true;
    const hh = Math.min(height, maxW * h / w);
    sprite.scale.set(hh * w / h, hh, 1);
  }
  set(text, color);
  return { sprite, set };
}
const ringTex = canvasTex(256, 256, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,.35)'); grd.addColorStop(.7, 'rgba(255,255,255,.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, h / 2, w * .38, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 4; g.beginPath(); g.arc(w / 2, h / 2, w * .28, 0, Math.PI * 2); g.stroke();
});

// --- kamers: vlak + label (+ krat bij een declaratie)
const rooms = {};
for (const r of LAYOUT.rooms) {
  const col = CSSCOL[r.type];
  const o = { ...r };
  if (r.kind !== 'junction') {
    o.pad = new THREE.Mesh(new THREE.PlaneGeometry(3 * CELL * .95, 3 * CELL * .95).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: ringTex, color: new THREE.Color(col), transparent: true, depthWrite: false, opacity: .6 }));
    o.pad.position.set(WX(r.x), 0.02, WZ(r.y)); world.add(o.pad);
  }
  o.label = makeLabel(r.label, col, r.kind === 'junction' ? .34 : .42);
  o.label.sprite.position.set(WX(r.x), 2.05, WZ(r.y)); world.add(o.label.sprite);
  rooms[r.id] = o;
}
const items = {};
function makeCrate(colorHex) {
  const g = new THREE.Group(), col = new THREE.Color(colorHex);
  const box = new THREE.Mesh(new THREE.BoxGeometry(.7, .7, .7), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: .35, roughness: .4, transparent: true, opacity: .9 }));
  box.add(new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: 0xffffff })));
  g.add(box); g.userData.spin = box; return g;
}
for (const r of LAYOUT.rooms) {
  const n = r.part === 'init' ? r.node.init : r.node;
  if (n && n.kind === 'decl' && (r.part === 'init' || !r.part)) {
    const it = makeCrate(r.part === 'init' ? CSSCOL.loop : CSSCOL.decl);
    it.userData.home = { x: WX(r.x), y: 1.25, z: WZ(r.y) };
    it.position.set(it.userData.home.x, 1.25, it.userData.home.z);
    it.userData.room = r.id; it.userData.name = n.name;
    world.add(it); items[n.id] = it;
  }
}
const anims = [];
function flyItem(id) { const it = items[id]; if (it) anims.push({ obj: it, t: 0, dur: .5, from: it.position.clone() }); }

// --- pijlen op de vloer
const arrowTex = canvasTex(256, 256, (g, w, h) => {
  g.strokeStyle = '#fff'; g.lineWidth = 16; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const y of [h * .36, h * .62]) { g.beginPath(); g.moveTo(w / 2 - 56, y + 36); g.lineTo(w / 2, y - 20); g.lineTo(w / 2 + 56, y + 36); g.stroke(); }
});
function floorArrow(x, y, d, opacity = .5) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(CELL * .7, CELL * .7).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: arrowTex, color: 0xdbeafe, transparent: true, opacity, depthWrite: false }));
  m.position.set(WX(x), 0.025, WZ(y)); m.rotation.y = Math.atan2(-d[0], -d[1]);
  world.add(m);
}

// --- lopende banden
const beltTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#0a1322'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#334155'; g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h);
  g.fillStyle = '#facc15'; for (let y = 0; y < h; y += 16) { g.fillRect(2, y, 6, 8); g.fillRect(w - 8, y, 6, 8); }
  g.strokeStyle = 'rgba(125,211,252,.9)'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(w / 2 - 30, h * .62); g.lineTo(w / 2, h * .38); g.lineTo(w / 2 + 30, h * .62); g.stroke();
});
beltTex.wrapS = beltTex.wrapT = THREE.RepeatWrapping;
function segs(pts) {
  const out = [];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L > 1e-6) out.push({ a, dx: (b.x - a.x) / L, dz: (b.z - a.z) / L, L });
  }
  return out;
}
function closestOnRoute(rt, x, z) {
  let best = 1e9, bs = 0, dir = [0, -1], acc = 0;
  for (const sg of rt.segs) {
    const t = Math.max(0, Math.min(sg.L, (x - sg.a.x) * sg.dx + (z - sg.a.z) * sg.dz));
    const d = Math.hypot(sg.a.x + sg.dx * t - x, sg.a.z + sg.dz * t - z);
    if (d < best - 1e-6) { best = d; bs = acc + t; dir = [sg.dx, sg.dz]; }
    acc += sg.L;
  }
  return { s: bs, dir };
}
function routePoint(rt, s) {
  let acc = 0;
  for (let i = 0; i < rt.segs.length; i++) {
    const sg = rt.segs[i];
    if (s <= acc + sg.L || i === rt.segs.length - 1) {
      const t = Math.min(sg.L, Math.max(0, s - acc));
      return { x: sg.a.x + sg.dx * t, z: sg.a.z + sg.dz * t, dx: sg.dx, dz: sg.dz };
    }
    acc += sg.L;
  }
}
// Eén strook per stuk route, midden op het pad (dus ook midden in een gang van twee vakken breed),
// alleen over de vakken van de band zelf. Bij een bocht begint de volgende strook een halve breedte eerder.
const beltAt = {}, beltTexs = [], BELT_W = CELL;
const beltRoutes = LAYOUT.belts.map((b, i) => {
  const rt = { segs: segs(b.path.map(([x, y]) => ({ x: WX(x), z: WZ(y) }))) };
  rt.total = rt.segs.reduce((t, sg) => t + sg.L, 0);
  const own = new Set();
  for (const [x, y] of b.cells) { beltAt[key(x, y)] = i; own.add(key(x, y)); }
  const strip = (ax, ay, ux, uy, t0, t1, k) => {
    const len = t1 - t0, cx = ax + ux * (t0 + len / 2), cy = ay + uy * (t0 + len / 2);
    const tex = beltTex.clone(); tex.needsUpdate = true; tex.repeat.set(1, len); beltTexs.push(tex);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(BELT_W, len * CELL).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(WX(cx), 0.02 + k * 0.002, WZ(cy)); m.rotation.y = Math.atan2(-ux, uy);
    world.add(m);
  };
  for (let k = 1; k < b.path.length; k++) {
    const [ax, ay] = b.path[k - 1], [bx, by] = b.path[k], L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-6) continue;
    const ux = (bx - ax) / L, uy = (by - ay) / L, n = Math.max(1, Math.round(L / 0.05)), st = L / n;
    const inBelt = j => own.has(key(Math.round(ax + ux * (j + 0.5) * st), Math.round(ay + uy * (j + 0.5) * st)));
    for (let j = 0; j < n;) {
      if (!inBelt(j)) { j++; continue; }
      let e = j; while (e < n && inBelt(e)) e++;
      const ext = j === 0 && k > 1 ? BELT_W / CELL / 2 : 0;
      strip(ax, ay, ux, uy, j * st - ext, e * st, k);
      j = e;
    }
  }
  return rt;
});

// --- conditiedeuren: blauw = kiesbaar, groen = goed gekozen, rood = fout of niet gekozen
const fieldTex = canvasTex(64, 256, (g, w, h) => {
  for (let y = 0; y < h; y += 16) { g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(0, y, w, 3); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, y + 3, w, 5); }
});
fieldTex.wrapS = fieldTex.wrapT = THREE.RepeatWrapping; fieldTex.repeat.set(1, 2);
const doorAt = {}, doorsOf = {};
for (const d of LAYOUT.doors) {
  const o = { ...d, state: 'neutral', wd: wd(d.dir) };
  const alongZ = d.dir[0] === 0;
  o.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: fieldTex, transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(alongZ ? new THREE.BoxGeometry(CELL, H, 0.1) : new THREE.BoxGeometry(0.1, H, CELL), o.mat);
  mesh.position.set(WX(d.x), H / 2, WZ(d.y)); world.add(mesh);
  o.frameMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const yy of [0.06, H - 0.06]) {
    const b = new THREE.Mesh(alongZ ? new THREE.BoxGeometry(CELL, 0.12, 0.3) : new THREE.BoxGeometry(0.3, 0.12, CELL), o.frameMat);
    b.position.set(WX(d.x), yy, WZ(d.y)); world.add(b);
  }
  floorArrow(d.x, d.y, o.wd, .3);
  o.label = makeLabel(d.truth ? 'true' : 'false', CSSCOL.choice, 0.6);
  o.label.sprite.position.set(WX(d.x), 2.1, WZ(d.y)); world.add(o.label.sprite);
  doorAt[key(d.x, d.y)] = o;
  (doorsOf[d.decision] = doorsOf[d.decision] || []).push(o);
}
function setDoor(d, st) {
  d.state = st;
  const col = st === 'open' ? CSSCOL.ok : st === 'closed' ? CSSCOL.bad : CSSCOL.choice;
  d.mat.color.set(col); d.frameMat.color.set(col);
  d.label.set(d.truth ? 'true' : 'false', col);
}

// --- glazen schuifdeuren
const glassMat = new THREE.MeshStandardMaterial({ color: 0xcfe6ff, transparent: true, opacity: .2, roughness: .05, metalness: .3, depthWrite: false, side: THREE.DoubleSide });
const glassEdge = new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: .75 });
const frameMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: .6, roughness: .4 });
function glassDecal(front) {
  return canvasTex(320, 544, (g, w, h) => {
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, h * .26, w, h * .52);
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round';
    if (front) for (const y of [h * .40, h * .50]) { g.beginPath(); g.moveTo(w / 2 - 50, y + 24); g.lineTo(w / 2, y - 24); g.lineTo(w / 2 + 50, y + 24); g.stroke(); }
    else { g.beginPath(); g.arc(w / 2, h * .46, 50, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(w / 2 - 28, h * .46); g.lineTo(w / 2 + 28, h * .46); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '600 28px "Space Grotesk", sans-serif'; g.textAlign = 'center';
    g.fillText(front ? 'deze kant op' : 'terug kan', w / 2, h * .64); if (!front) g.fillText('niet', w / 2, h * .69);
  });
}
const decalFront = glassDecal(true), decalBack = glassDecal(false);
const halfTex = (src, off) => { const t = src.clone(); t.repeat.set(.5, 1); t.offset.set(off, 0); t.needsUpdate = true; return t; };
const gates = [], gateAt = {};
for (const g of LAYOUT.gates) {
  const d = wd(g.dir);
  const grp = new THREE.Group();
  grp.position.set(WX(g.x), 0, WZ(g.y));
  grp.rotation.y = Math.atan2(-d[0], -d[1]);
  const halves = [];
  for (const side of [-1, 1]) {
    const half = new THREE.Group();
    const pane = new THREE.Mesh(new THREE.BoxGeometry(CELL / 2, H - 0.2, 0.05), glassMat);
    pane.add(new THREE.LineSegments(new THREE.EdgesGeometry(pane.geometry), glassEdge)); half.add(pane);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(CELL / 2, H - 0.2), new THREE.MeshBasicMaterial({ map: halfTex(decalFront, side < 0 ? 0 : .5), transparent: true, depthWrite: false }));
    f.position.z = 0.03; half.add(f);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(CELL / 2, H - 0.2), new THREE.MeshBasicMaterial({ map: halfTex(decalBack, side < 0 ? .5 : 0), transparent: true, depthWrite: false }));
    b.position.z = -0.03; b.rotation.y = Math.PI; half.add(b);
    half.position.set(side * CELL / 4, (H - 0.2) / 2 + 0.1, 0);
    grp.add(half); halves.push({ half, side });
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(CELL, 0.14, 0.3), frameMat); top.position.y = H - 0.07; grp.add(top);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0x475569 });
  const light = new THREE.Mesh(new THREE.BoxGeometry(CELL * .9, 0.05, 0.32), lightMat); light.position.y = H - 0.15; grp.add(light);
  world.add(grp);
  floorArrow(g.x, g.y, d, .45);
  const o = { ...g, wd: d, halves, open: 0, lightMat };
  gates.push(o); gateAt[key(g.x, g.y)] = o;
}
// Een schuifdeur is op slot zolang de regel ervóór nog niet is uitgevoerd (of in een loop: weer aan de beurt is).
const gateLocked = g => !!g.req && !((counts[g.req] || 0) > 0 && waiting() !== g.req);
const along = (x, z, gx, gz, d) => (x - gx) * d[0] + (z - gz) * d[1];
const across = (x, z, gx, gz, d) => Math.abs((x - gx) * -d[1] + (z - gz) * d[0]);

// --- baken bij de volgende regel
const beacon = new THREE.Group();
const beamMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: .14, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, H, 32, 1, true), beamMat); beam.position.y = H / 2; beacon.add(beam);
const beaconLight = new THREE.PointLight(0x38bdf8, 1.4, 9, 1.5); beaconLight.position.y = 1.6; beacon.add(beaconLight);
scene.add(beacon);

// =====================================================================
// 9. Speler, besturing en lopende banden
// =====================================================================
let px = 0, pz = 0, yaw = 0, pitch = 0, bob = 0, lastCell = '', playing = false, ride = null;
const keys = {};
let touchedDoor = null;
const cellOf = (x, z) => [Math.round(x / CELL), Math.round(-z / CELL)];
function cellBlocks(cx, cy, ox, oz, nx, nz) {
  if (!isFloor(cx, cy)) return true;
  const k = key(cx, cy);
  let d = null;
  const dr = doorAt[k], g = gateAt[k];
  if (dr) { if (dr.state !== 'open') { touchedDoor = dr; return true; } d = dr.wd; }
  else if (g) d = g.wd;
  if (d) {
    const gx = WX(cx), gz = WZ(cy);
    const so = along(ox, oz, gx, gz, d), sn = along(nx, nz, gx, gz, d);
    if (sn < so && so >= RAD - 1e-6 && sn < RAD) return true;                                 // terug kan niet
    if (g && gateLocked(g) && sn > so && so <= -RAD + 1e-6 && sn > -RAD) return true;          // nog op slot
  }
  return false;
}
function canMove(ox, oz, nx, nz) {
  for (const dx of [-RAD, RAD]) for (const dz of [-RAD, RAD]) {
    const [cx, cy] = cellOf(nx + dx, nz + dz);
    if (cellBlocks(cx, cy, ox, oz, nx, nz)) return false;
  }
  return true;
}
addEventListener('keydown', e => { keys[e.code] = true; if (playing && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); });
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const hint = $('hint');
let dragging = false, lastMX = 0, lastMY = 0;
canvas.addEventListener('mousedown', e => { dragging = true; lastMX = e.clientX; lastMY = e.clientY; });
addEventListener('mouseup', () => { dragging = false; });
const lockMouse = () => { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} };
canvas.addEventListener('click', () => { if (playing && document.pointerLockElement !== canvas) lockMouse(); });
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === canvas) { if (!ride) yaw -= e.movementX * 0.0022; pitch -= e.movementY * 0.0022; }
  else if (dragging && playing) { if (!ride) yaw -= (e.clientX - lastMX) * 0.005; pitch -= (e.clientY - lastMY) * 0.005; lastMX = e.clientX; lastMY = e.clientY; }
  pitch = Math.max(-1.2, Math.min(1.2, pitch));
});
const HINT = 'Klik in het beeld om met de muis rond te kijken';
document.addEventListener('pointerlockchange', () => { if (!ride) hint.style.opacity = (document.pointerLockElement === canvas || !playing) ? 0 : 1; });

function onEnterCell(cx, cy) {
  const id = LAYOUT.triggers.get(key(cx, cy));
  if (id && waiting() === id) advance();
}
function startRide(i) {
  const rt = beltRoutes[i];
  const s0 = closestOnRoute(rt, px, pz).s;
  ride = { rt, s: s0, s0 };
  hint.textContent = 'Lopende band: je wordt naar de volgende regel gebracht'; hint.style.opacity = 1;
}
function updateRide(dt) {
  const { rt } = ride;
  const v = Math.max(1.8, Math.min(7, 1.8 + 3 * Math.min(ride.s - ride.s0, rt.total - ride.s)));
  ride.s = Math.min(rt.total, ride.s + v * dt);
  const p = routePoint(rt, ride.s);
  px = p.x; pz = p.z;
  let diff = Math.atan2(-p.dx, -p.dz) - yaw; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  yaw += diff * Math.min(1, dt * 5);
  pitch *= Math.max(0, 1 - dt * 3);
  if (ride.s >= rt.total - 1e-3) {
    ride = null;
    const [cx, cy] = cellOf(px, pz); lastCell = key(cx, cy);
    hint.textContent = HINT; hint.style.opacity = document.pointerLockElement === canvas ? 0 : 1;
    onEnterCell(cx, cy);
  }
}
function updatePlayer(dt) {
  if (!playing) return;
  if (ride) { updateRide(dt); return; }
  const turn = ((keys.ArrowLeft || keys.KeyQ) ? 1 : 0) - ((keys.ArrowRight || keys.KeyE) ? 1 : 0);
  yaw += turn * 2.2 * dt;
  const f = ((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0);
  const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  let vx = -Math.sin(yaw) * f + Math.cos(yaw) * s, vz = -Math.cos(yaw) * f - Math.sin(yaw) * s;
  const len = Math.hypot(vx, vz);
  if (len > 0) {
    const sp = SPEED * ((keys.ShiftLeft || keys.ShiftRight) ? 1.8 : 1) / Math.max(1, len);
    vx *= sp * dt; vz *= sp * dt;
    const stuck = !canMove(px, pz, px, pz);
    touchedDoor = null;
    if (stuck || canMove(px, pz, px + vx, pz)) px += vx;
    if (stuck || canMove(px, pz, px, pz + vz)) pz += vz;
    if (touchedDoor) chooseDoor(touchedDoor);
    bob += dt * 9;
  }
  const [cx, cy] = cellOf(px, pz), k = key(cx, cy);
  if (k !== lastCell) {
    lastCell = k; onEnterCell(cx, cy);
    if (beltAt[k] !== undefined) startRide(beltAt[k]);
  }
}

// =====================================================================
// 10. Plattegrond
// =====================================================================
const mm = $('minimap'), mg = mm.getContext('2d');
const MAPW = LAYOUT.maxX - LAYOUT.minX + 1;
const MMS = Math.max(3, Math.min(7, Math.floor(250 / MAPW)));
const MMH = Math.round(270 / MMS);
mm.width = MAPW * MMS; mm.height = MMH * MMS;
function drawMinimap(t) {
  mg.clearRect(0, 0, mm.width, mm.height);
  const py = -pz / CELL, topY = py + MMH / 2;
  const X = x => (x - LAYOUT.minX) * MMS, Y = y => (topY - y) * MMS;
  for (const [x, y] of floorCells) {
    const sy = Y(y); if (sy < -MMS || sy > mm.height) continue;
    const k = key(x, y), d = doorAt[k];
    mg.fillStyle = d ? (d.state === 'open' ? '#2f9a5c' : d.state === 'closed' ? '#b8324a' : '#3b6fb8')
      : gateAt[k] ? '#8090ad' : beltAt[k] !== undefined ? '#24405e' : '#1e2a42';
    mg.fillRect(X(x), sy - MMS, MMS, MMS);
  }
  for (const id in rooms) {
    const r = rooms[id]; if (r.kind === 'junction') continue;
    const sy = Y(r.y) - MMS / 2; if (sy < -5 || sy > mm.height + 5) continue;
    mg.globalAlpha = (counts[id] || 0) > 0 && waiting() !== id ? .35 : 1;
    mg.fillStyle = CSSCOL[r.type];
    mg.beginPath(); mg.arc(X(r.x) + MMS / 2, sy, 2.4, 0, 7); mg.fill();
    mg.globalAlpha = 1;
  }
  const w = rooms[waiting()];
  if (w) { mg.strokeStyle = CSSCOL[w.type]; mg.lineWidth = 1.5; mg.beginPath(); mg.arc(X(w.x) + MMS / 2, Y(w.y) - MMS / 2, 4.5 + Math.sin(t * 5) * 1.2, 0, 7); mg.stroke(); }
  mg.save(); mg.translate(X(px / CELL) + MMS / 2, Y(-pz / CELL) - MMS / 2); mg.rotate(-yaw);
  mg.fillStyle = '#fff'; mg.beginPath(); mg.moveTo(0, -5); mg.lineTo(3.5, 4); mg.lineTo(-3.5, 4); mg.closePath(); mg.fill();
  mg.restore();
}

// =====================================================================
// 11. NexEd: inleveren (alleen als NexEd dat toestaat)
// =====================================================================
const NEXED = /^https:\/\/(?:[a-z0-9-]+\.)?app\.nexed\.com$/;
let nexedOrigin = null, handin = null;
addEventListener('message', e => {
  if (!NEXED.test(e.origin)) return;
  nexedOrigin = e.origin;
  if (e.data && e.data.type === 'nexed:handin-config') handin = e.data;
  if (e.data && e.data.type === 'nexed:handin-ack') {
    $('btnHandin').textContent = e.data.accepted ? 'Ingeleverd' : 'Inleveren lukte niet';
  }
});
if (window.parent !== window) { try { window.parent.postMessage({ type: 'nexed:handin-init' }, '*'); } catch (e) {} }
function summaryText() {
  const lines = [`Code Gangen – ${LEVEL.titel || 'level'}: programma uitgevoerd.`];
  for (const s of ALL) if (s.cond) lines.push(`Regel ${s.line} (${s.condSrc}): ${wrong[s.id] ? wrong[s.id] + '× fout gekozen' : 'altijd goed gekozen'}`);
  lines.push('Console: ' + (conOutput.join(' | ') || '-'));
  return lines.join('\n');
}
$('btnHandin').addEventListener('click', () => {
  if (!handin || !nexedOrigin) return;
  const payload = handin.uploadType === 'TEXT' ? { text: summaryText() } : null;
  window.parent.postMessage({ type: 'nexed:handin', payload }, nexedOrigin);
  $('btnHandin').disabled = true; $('btnHandin').textContent = 'Bezig met inleveren…';
});

// =====================================================================
// 12. Schermen, opnieuw beginnen en de animatielus
// =====================================================================
const intro = $('intro'), finish = $('finish');
$('levelTitle').textContent = LEVEL.titel || '';
if (LEVEL.intro) $('levelIntro').innerHTML = LEVEL.intro;
document.querySelectorAll('[data-needs]').forEach(el => {
  const need = el.dataset.needs;
  const ok = need === 'cond' ? ALL.some(s => s.cond) : need === 'loop' ? has('for') || has('while') : need === 'belt' ? LAYOUT.belts.length > 0 : true;
  if (!ok) el.remove();
});
function startPlaying() {
  Sound.init();
  intro.classList.add('hidden'); finish.classList.add('hidden');
  playing = true; hint.style.opacity = 1; lockMouse();
}
function pause(overlay) {
  playing = false; for (const k in keys) keys[k] = false;
  hint.style.opacity = 0;
  if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();
  overlay.classList.remove('hidden');
}
function showFinish() {
  let html = '';
  for (const s of ALL) {
    if (!s.cond) continue;
    const label = s.kind === 'for' ? `for: ${s.condSrc}` : `${s.kind} (${s.condSrc})`;
    const w = wrong[s.id] || 0;
    html += `<span>${esc(label)}</span><span>${w ? `${w}× fout gekozen` : '<span class="ok">altijd goed gekozen</span>'}</span>`;
  }
  const loops = ALL.filter(isLoop);
  if (loops.length) html += '<span class="sep"></span>';
  for (const s of loops) html += `<span>${esc(s.kind === 'for' ? `for (… ${s.condSrc} …)` : `while (${s.condSrc})`)}</span><span>conditie <b>${counts[s.id] || 0}×</b> gecontroleerd, body <b>${trueCount[s.id] || 0}×</b> uitgevoerd</span>`;
  html += '<span class="sep"></span>';
  html += `<span>console</span><span>${esc(conOutput.join(' | ')) || '-'}</span>`;
  $('stats').innerHTML = html;
  $('finishText').innerHTML = loops.length ? 'De conditie van een loop wordt altijd één keer vaker gecontroleerd dan de body wordt uitgevoerd: de laatste controle is false en laat de loop stoppen.' : '';
  const canHand = handin && handin.canHandIn && nexedOrigin;
  $('btnHandin').hidden = !canHand; $('btnHandin').disabled = false; $('btnHandin').textContent = 'Inleveren';
  pause(finish);
}
function resetGame() {
  for (const k in counts) delete counts[k];
  for (const k in wrong) delete wrong[k];
  for (const k in trueCount) delete trueCount[k];
  for (const k in lineCount) delete lineCount[k];
  for (const k in partCount) delete partCount[k];
  scopes = []; scopeNames.length = 0; pushScope();
  for (const n of [...invEls.keys()]) { invEls.get(n).remove(); invEls.delete(n); }
  invEmpty(); consoleClear();
  for (const d of Object.values(doorAt)) setDoor(d, 'neutral');
  for (const g of gates) g.open = 0;
  anims.length = 0;
  codeEl.querySelectorAll('.active, .skipped, .jumpfx').forEach(e => e.classList.remove('active', 'skipped', 'jumpfx'));
  codeEl.querySelectorAll('.cnt').forEach(e => { e.textContent = ''; e.classList.remove('on'); });
  codeEl.querySelectorAll('sup.pc').forEach(e => { e.textContent = ''; });
  codeEl.scrollTop = 0;
  ride = null; finished = false;
  px = 0; pz = WZ(-3); yaw = 0; pitch = 0;
  lastCell = key(...cellOf(px, pz));
  gen = (function* () { for (const st of PROG.body) yield* runStmt(st); })();
  advance();
  message('decl', 'Start', 'Het programma begint bovenaan',
    'Een programma wordt van boven naar beneden uitgevoerd, regel voor regel. Een glazen schuifdeur gaat pas open als de regel ervoor is uitgevoerd, en terug kan niet.',
    'Loop rechtdoor naar het eerste gloeiende vlak.');
}
$('btnStart').onclick = startPlaying;
$('btnAgain').onclick = () => { resetGame(); startPlaying(); };
$('btnReset').onclick = () => { resetGame(); };
$('btnHelp').onclick = () => pause(intro);
const sndBtn = $('btnSound');
const showSound = () => { sndBtn.textContent = Sound.on ? 'Geluid aan' : 'Geluid uit'; sndBtn.classList.toggle('off', !Sound.on); };
sndBtn.onclick = () => { Sound.init(); Sound.toggle(); showSound(); sndBtn.blur(); };
addEventListener('keydown', e => { if (e.code === 'KeyM' && !e.repeat) { Sound.init(); Sound.toggle(); showSound(); } });
canvas.addEventListener('pointerdown', () => Sound.init());
showSound();
const fsBtn = $('btnFull');
if (!document.fullscreenEnabled) fsBtn.remove();
else fsBtn.onclick = () => { try { const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (e) {} };
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
resetGame();

const clock = new THREE.Clock();
const fwd = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  updatePlayer(dt);
  camera.position.set(px, EYE + Math.sin(bob) * 0.035, pz);
  camera.rotation.set(pitch, yaw, 0);
  const w = waiting();
  // kratten: zichtbaar zolang hun regel nog moet (of opnieuw moet)
  for (const id in items) {
    const it = items[id];
    if (anims.some(a => a.obj === it)) continue;
    it.visible = !counts[it.userData.room] || w === it.userData.room;
    it.userData.spin.rotation.y += dt * 1.6;
    it.position.set(it.userData.home.x, it.userData.home.y + Math.sin(t * 2 + it.userData.home.z) * 0.08, it.userData.home.z);
    it.scale.setScalar(1);
  }
  camera.getWorldDirection(fwd);
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i]; a.t += dt;
    const k = Math.min(1, a.t / a.dur), e = k * k * (3 - 2 * k);
    a.obj.position.set(a.from.x + (px + fwd.x * .7 - a.from.x) * e, a.from.y + (EYE - .35 - a.from.y) * e, a.from.z + (pz + fwd.z * .7 - a.from.z) * e);
    a.obj.scale.setScalar(1 - 0.85 * e);
    if (k >= 1) { a.obj.visible = false; anims.splice(i, 1); }
  }
  for (const id in rooms) {
    const r = rooms[id], next = id === w, ran = (counts[id] || 0) > 0;
    if (r.pad) r.pad.material.opacity = next ? 0.75 + Math.sin(t * 5) * 0.25 : (ran ? 0.18 : 0.45);
    r.label.sprite.material.opacity = next ? 1 : (ran ? 0.8 : 0.9);
  }
  const wr = rooms[w];
  if (wr && wr.kind !== 'junction') {
    beacon.visible = true; beacon.position.set(WX(wr.x), 0, WZ(wr.y));
    beamMat.color.set(CSSCOL[wr.type]); beaconLight.color.set(CSSCOL[wr.type]);
    beamMat.opacity = 0.12 + Math.sin(t * 3) * 0.05;
  } else beacon.visible = false;
  fieldTex.offset.y = (t * 0.4) % 1;
  for (const tx of beltTexs) tx.offset.y = 1 - ((t * 1.2) % 1);
  for (const d of Object.values(doorAt)) d.mat.opacity = d.state === 'open' ? 0.07 : d.state === 'closed' ? 0.5 + Math.sin(t * 4 + d.x) * 0.1 : 0.24 + Math.sin(t * 3 + d.x) * 0.06;
  for (const g of gates) {
    const gx = WX(g.x), gz = WZ(g.y);
    const sa = along(px, pz, gx, gz, g.wd), ac = across(px, pz, gx, gz, g.wd), locked = gateLocked(g);
    g.lightMat.color.setHex(locked ? 0x475569 : 0xe0f2fe);
    const target = (!locked && sa > -9 && sa < RAD + 0.3 && ac < 5) ? 1 : 0;
    g.open += (target - g.open) * Math.min(1, dt * 7);
    for (const h of g.halves) h.half.position.x = h.side * (CELL / 4 + g.open * (CELL / 2 - 0.08));
  }
  renderer.render(scene, camera);
  drawMinimap(t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// alleen voor testen
window.__game = {
  get waiting() { return waiting(); }, get choose() { return cur && cur.choose ? { id: cur.choose.id, value: cur.value } : null; },
  get finished() { return finished; }, get pos() { return { px, pz, yaw }; }, get riding() { return !!ride; },
  vars: () => Object.fromEntries(scopes.flatMap(m => [...m]).map(([k, v]) => [k, v.v])),
  room: id => rooms[id] && { x: rooms[id].x, y: rooms[id].y }, doors: id => (doorsOf[id] || []).map(d => ({ x: d.x, y: d.y, truth: d.truth, state: d.state, dir: d.dir })),
  rooms: () => LAYOUT.rooms.map(r => ({ id: r.id, kind: r.kind, label: r.label, x: r.x, y: r.y })),
  tp(x, y, yw) { px = WX(x); pz = WZ(y); if (yw !== undefined) { yaw = yw; pitch = 0; } },
  console: () => conOutput.slice(), sound: Sound,
  dump: () => ({ floor: [...LAYOUT.floor.values()], gates: LAYOUT.gates, doors: LAYOUT.doors.map(d => ({ ...d, state: doorAt[key(d.x, d.y)].state })),
    belts: LAYOUT.belts, rooms: LAYOUT.rooms.map(r => ({ id: r.id, kind: r.kind, x: r.x, y: r.y, label: r.label })),
    triggers: [...LAYOUT.triggers], locked: gates.filter(gateLocked).map(g => key(g.x, g.y)) }),
};
})();
