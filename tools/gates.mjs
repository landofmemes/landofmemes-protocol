// Gate runner: node tools/gates.mjs  (exit 0 only when every gate passes)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, validate, BASE58, HEX40, handleOf } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const TMP = path.join(ROOT, '.gate-tmp');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(...p));
const results = [];
function gate(name, fn) {
  return Promise.resolve().then(fn).then(() => results.push([name, true]), (e) => results.push([name, false, e && e.message || String(e)]));
}
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const randB58 = (n = 44) => Array.from(crypto.randomBytes(n), (b) => B58[b % 58]).join('');
const randHex = () => '0x' + crypto.randomBytes(20).toString('hex');
const ADDR_RE = /\b(?:0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/g;

export function scanAddresses(text, stated, exempt = []) {
  const bad = [];
  for (const m of text.match(ADDR_RE) || []) if (!stated.has(m) && !exempt.includes(m)) bad.push(m);
  return bad;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.md', '.txt', '.py']);
const textFiles = (dir) => walk(dir).filter((f) => TEXT_EXT.has(path.extname(f)) || path.basename(f) === 'LICENSE');

function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
function jsStrings(js) {
  return (js.match(/'[^'\n]{4,}'/g) || []).map((s) => s.slice(1, -1)).filter((s) => /^[A-Z][A-Za-z ,.']+$/.test(s));
}

const DATE_RES = [
  [/\b\d{4}-\d{2}-\d{2}\b/, 'iso date'],
  [/\b\d{1,2}:\d{2}(:\d{2})?\b/, 'clock string'],
  [/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i, 'month day'],
  [/\b(?:as of|checked|updated|timestamp|ago|last seen|today|yesterday)\b/i, 'time phrase'],
  [/\b(?:19|20)\d{2}\b/, 'year']
];
const dateHits = (t) => DATE_RES.filter(([re]) => re.test(t)).map(([, n]) => n);

const tokensOf = (t) => t.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
const FUNCTION_WORDS = new Set('a an and or but of in on at to for from by with as is are be it its this that these those you your we our us not no can up so all one then now before every until each the what when where who how if than there their they them he she his her i me my was were been has have had do does did will would just only also into out over under about more most some any other such own same too very s t get got here wait see like'.split(' '));
const BRAND_OK = new Set(['land', 'memes', 'meme', 'lom', 'solana']);

function copyOverlap(text) {
  const ref = tokensOf(read(ROOT, 'tools', 'fixtures', 'reference-copy.txt'));
  const mine = tokensOf(text);
  const refBi = new Set(), myBi = new Set();
  const fw = (w) => FUNCTION_WORDS.has(w) || BRAND_OK.has(w);
  const skip = (a, b) => BRAND_OK.has(a) && BRAND_OK.has(b);
  for (let i = 0; i < ref.length - 1; i++) refBi.add(ref[i] + ' ' + ref[i + 1]);
  const shared = [];
  for (let i = 0; i < mine.length - 1; i++) {
    const g = mine[i] + ' ' + mine[i + 1];
    if (refBi.has(g) && !skip(mine[i], mine[i + 1]) && !(fw(mine[i]) && fw(mine[i + 1]))) shared.push(g);
  }
  const refSet = new Set(ref.filter((w) => !FUNCTION_WORDS.has(w) && !BRAND_OK.has(w)));
  const words = [...new Set(mine.filter((w) => refSet.has(w)))];
  return { bigrams: [...new Set(shared)], words };
}

function htmlOf(dir) { return read(dir, 'index.html'); }
function branchBuild(name, reg) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  const rp = path.join(dir, 'register.json');
  fs.writeFileSync(rp, JSON.stringify(reg));
  const out = path.join(dir, 'dist');
  build({ registerPath: rp, outDir: out });
  return out;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

// anchors read the live record at runtime, never a hard-coded state
function expectRecord(html, key, rec) {
  const stated = rec.state === 'stated';
  const tags = [...html.matchAll(new RegExp(`<(a|button|div)\\b[^>]*data-record="${key}"[^>]*>`, 'g'))].map((m) => m[0]);
  ok(tags.length > 0, `no anchor for ${key}`);
  for (const t of tags) {
    ok(t.includes(`data-state="${rec.state}"`), `${key}: state attribute mismatch`);
    if (key === 'ca') {
      if (stated) ok(/data-copy="/.test(t) && t.includes(rec.value), 'ca stated should carry the address');
      else ok(!/data-copy=|href=/.test(t), 'ca inert must carry no copy value');
    } else if (key === 'x' || key === 'github') {
      if (stated) { ok(t.includes(`href="${rec.url}"`), `${key} href`); ok(t.includes(`@${handleOf(rec.url)}`), `${key} derived handle`); }
      else ok(!/href=/.test(t), `${key} inert must have no href`);
    }
  }
  if (key === 'ca') {
    const hasAddr = html.includes(`class="ca-v">${rec.value}</span>`);
    ok(stated ? hasAddr : !/class="ca-v">(?!pending)/.test(html), 'ca slot text');
  }
}

const REAL = JSON.parse(read(SRC, 'register.json'));

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const real = build();   // fresh dist from the real register
  const html = htmlOf(DIST);
  const R = REAL.records;

  // ---------------- build output and logo ----------------
  await gate('dist has index.html and every referenced local file', () => {
    const refs = [...html.matchAll(/(?:src|href)="([^"#:]+?)"/g)].map((m) => m[1]).filter((r) => !/^(https?:|\/\/)/.test(r));
    ok(refs.length > 0);
    for (const r of refs) ok(exists(DIST, r), 'missing ' + r);
  });
  await gate('logo files exist in dist and are real PNGs of expected size', () => {
    for (const [f, n] of [['logo-512.png', 512], ['logo-192.png', 192]]) {
      const b = fs.readFileSync(path.join(DIST, 'assets', f));
      ok(b.slice(1, 4).toString() === 'PNG', f + ' signature');
      ok(b.readUInt32BE(16) === n && b.readUInt32BE(20) === n, f + ' dimensions');
      ok(b[25] === 6, f + ' colour type RGBA');
    }
  });
  await gate('index.html references the logo with the correct relative path', () => {
    ok(html.includes('src="assets/logo-192.png"') && html.includes('src="assets/logo-512.png"'));
    ok(!/src="\//.test(html), 'no root-absolute src');
  });
  await gate('build script copies the logo by explicit name', () => {
    const b = read(ROOT, 'tools', 'build.mjs');
    ok(b.includes("'logo-512.png'") && b.includes("'logo-192.png'") && b.includes('copyChecked'));
  });
  await gate('logo is premultiplied-resized: no dark fringe on edge pixels', async () => {
    const buf = fs.readFileSync(path.join(DIST, 'assets', 'logo-512.png'));
    const { inflateSync } = await import('node:zlib');
    let off = 8, idat = [];
    while (off < buf.length) { const len = buf.readUInt32BE(off), type = buf.slice(off + 4, off + 8).toString(); if (type === 'IDAT') idat.push(buf.slice(off + 8, off + 8 + len)); off += 12 + len; }
    const raw = inflateSync(Buffer.concat(idat)); const w = 512, stride = w * 4 + 1;
    const px = Buffer.alloc(w * 512 * 4);
    for (let y = 0; y < 512; y++) {
      const f = raw[y * stride];
      for (let x = 0; x < w * 4; x++) {
        const a = raw[y * stride + 1 + x], l = x >= 4 ? px[y * w * 4 + x - 4] : 0, u = y ? px[(y - 1) * w * 4 + x] : 0, ul = y && x >= 4 ? px[(y - 1) * w * 4 + x - 4] : 0;
        let v = a;
        if (f === 1) v = a + l; else if (f === 2) v = a + u; else if (f === 3) v = a + ((l + u) >> 1);
        else if (f === 4) { const p = l + u - ul, pa = Math.abs(p - l), pb = Math.abs(p - u), pc = Math.abs(p - ul); v = a + (pa <= pb && pa <= pc ? l : pb <= pc ? u : ul); }
        px[y * w * 4 + x] = v & 255;
      }
    }
    let edge = 0, dark = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 20 && px[i + 3] < 235) { edge++; if (px[i] < 200) dark++; }
    ok(edge > 500, 'expected antialiased edge pixels');
    ok(dark / edge < 0.02, `dark fringe share ${(dark / edge).toFixed(3)}`);
  });
  await gate('favicon: 32x32, parses as svg, no comments, no double hyphen', () => {
    const s = read(DIST, 'favicon.svg');
    ok(/width="32"/.test(s) && /height="32"/.test(s) && /viewBox="0 0 32 32"/.test(s));
    ok(!s.includes('<!--') && !s.includes('--'), 'no comments or double hyphen');
    ok(/<path[^>]+d="M/.test(s) && s.trim().endsWith('</svg>'));
    ok(html.includes('rel="icon"') && html.includes('href="favicon.svg"'));
  });
  await gate('favicon colours come from the token file', () => {
    const s = read(DIST, 'favicon.svg'), t = read(DIST, 'tokens.css');
    for (const h of s.match(/#[0-9a-f]{6}/g)) ok(t.includes(h), h + ' not in tokens.css');
  });

  // ---------------- register ----------------
  await gate('register validates and inert records carry no value or url', () => {
    validate(REAL);
    for (const [k, r] of Object.entries(R)) if (r.state !== 'stated') ok(!('value' in r) && !('url' in r), k);
  });
  await gate('every record has state stated, absent or unconfirmed', () => {
    for (const r of Object.values(R)) ok(['stated', 'absent', 'unconfirmed'].includes(r.state));
  });
  await gate('chain record states Solana, the rpc and the client source', () => {
    ok(R.chain.value === 'Solana' && R.chain.rpc === 'https://solana-rpc.publicnode.com' && R.chain.source === 'client statement' && R.chain.scope === 'batch-level');
  });
  await gate('public register in dist carries no dates and no inert payload', () => {
    const j = JSON.parse(html.match(/id="register">([\s\S]*?)<\/script>/)[1]);
    for (const [k, r] of Object.entries(j.records)) { ok(!('recorded' in r)); if (r.state !== 'stated') ok(!('value' in r) && !('url' in r), k); }
  });
  await gate('register.json is not shipped in dist', () => ok(!exists(DIST, 'register.json') && !walk(DIST).some((f) => f.endsWith('register.json'))));

  // ---------------- live record anchors on the real build ----------------
  for (const k of ['ca', 'x', 'github']) {
    await gate(`real build: ${k} renders per its current state (${R[k].state})`, () => expectRecord(html, k, R[k]));
  }
  await gate('x and github icons present, official paths, in header, both breakpoints (no hidden class)', () => {
    const hdr = html.match(/<header[\s\S]*?<\/header>/)[0];
    ok(/data-record="x"/.test(hdr) && /data-record="github"/.test(hdr));
    ok(hdr.includes('M18.244 2.25h3.308') && hdr.includes('M8 0c4.42 0 8 3.58 8 8'));
    const css = read(DIST, 'styles.css');
    ok(!/\.social[^{]*\{[^}]*display:none/.test(css) && !/\.socials[^{]*\{[^}]*display:none/.test(css));
    const labels = hdr.match(/<a class="social[\s\S]*?<\/a>/g).map((a) => a.replace(/<svg[\s\S]*?<\/svg>/, ''));
    for (const l of labels) ok(!/>\s*\w/.test(l.replace(/<a[^>]*>/, '')), 'icon only, no text label');
  });
  await gate('ca slot sits in the sticky top stack, before main', () => {
    ok(html.indexOf('data-record="ca"') < html.indexOf('<main'));
    ok(/\.topstack\{[^}]*position:sticky/.test(read(DIST, 'styles.css')));
  });

  // ---------------- both branches, mutation harness ----------------
  const stateAddr = randB58();
  const allStated = clone(REAL);
  allStated.records.ca = { ...allStated.records.ca, state: 'stated', value: stateAddr };
  allStated.records.x = { ...allStated.records.x, state: 'stated', url: 'https://x.com/fixture_handle' };
  allStated.records.github = { ...allStated.records.github, state: 'stated', url: 'https://github.com/fixture-org/fixture-repo' };
  const allAbsent = clone(REAL);
  for (const k of ['ca', 'x', 'github']) { allAbsent.records[k] = { state: 'absent', label: allAbsent.records[k].label, source: allAbsent.records[k].source, scope: allAbsent.records[k].scope, recorded: allAbsent.records[k].recorded }; }
  const dirS = branchBuild('stated', allStated), dirA = branchBuild('absent', allAbsent);
  const hS = htmlOf(dirS), hA = htmlOf(dirA);
  for (const k of ['ca', 'x', 'github']) {
    await gate(`branch stated: ${k} live`, () => expectRecord(hS, k, allStated.records[k]));
    await gate(`branch absent: ${k} inert`, () => expectRecord(hA, k, allAbsent.records[k]));
  }
  await gate('branch stated: link rule, handle derived from stored url', () => {
    ok(hS.includes('aria-label="X, @fixture_handle"') && hS.includes('aria-label="GitHub, @fixture-org"'));
  });
  await gate('branch absent: no outbound social href, no address-shaped value anywhere in html', () => {
    const header = hA.match(/<header[\s\S]*?<\/header>/)[0];
    ok(!/href="https?:/.test(header));
    ok(scanAddresses(visibleText(hA), new Set()).length === 0);
  });
  await gate('branch stated: ca address appears in slot and footer, scanner exempts it', () => {
    ok(hS.split(`data-copy="${stateAddr}"`).length - 1 === 2);
    ok(scanAddresses(hS, new Set(), [stateAddr]).length === 0);
    ok(scanAddresses(hS, new Set()).length > 0, 'without exemption it would be flagged');
  });
  for (const k of ['ca', 'x', 'github']) {
    await gate(`mutation: flip ${k} from its current state, anchors follow`, () => {
      const m = clone(REAL); const cur = m.records[k];
      if (cur.state === 'stated') m.records[k] = { state: 'absent', label: cur.label };
      else m.records[k] = { ...cur, state: 'stated', ...(k === 'ca' ? { value: randHex() } : { url: `https://${k === 'x' ? 'x.com' : 'github.com'}/mut_${k}` }) };
      const out = branchBuild('mut-' + k, m);
      expectRecord(htmlOf(out), k, m.records[k]);
      for (const other of ['ca', 'x', 'github'].filter((o) => o !== k)) expectRecord(htmlOf(out), other, m.records[other]);
    });
  }
  await gate('mutation: inert record that carries a value is refused by the build', () => {
    const m = clone(REAL); m.records.x = { ...m.records.x, state: 'absent', url: 'https://x.com/nope' };
    let threw = false; try { build({ registerPath: (() => { const p = path.join(TMP, 'bad.json'); fs.writeFileSync(p, JSON.stringify(m)); return p; })(), outDir: path.join(TMP, 'bad') }); } catch { threw = true; }
    ok(threw);
  });
  await gate('mutation: non address-shaped ca value is refused', () => {
    const m = clone(REAL); m.records.ca = { ...m.records.ca, state: 'stated', value: 'not an address' };
    const p = path.join(TMP, 'bad2.json'); fs.writeFileSync(p, JSON.stringify(m));
    let threw = false; try { build({ registerPath: p, outDir: path.join(TMP, 'bad2') }); } catch { threw = true; }
    ok(threw);
  });
  await gate('mutation: market record untouched by ca flips (page market wiring identical)', () => {
    const a = fs.readFileSync(path.join(dirS, 'market.js')).toString('hex'), b = fs.readFileSync(path.join(dirA, 'market.js')).toString('hex');
    ok(a === b);
    const ra = JSON.parse(hA.match(/id="register">([\s\S]*?)<\/script>/)[1]).records.market;
    const rs = JSON.parse(hS.match(/id="register">([\s\S]*?)<\/script>/)[1]).records.market;
    ok(JSON.stringify(ra) === JSON.stringify(rs));
  });

  // ---------------- address scanner ----------------
  await gate('scanner: unregistered 0x address is flagged', () => ok(scanAddresses(`x ${randHex()} y`, new Set()).length === 1));
  await gate('scanner: registered 0x address is not rejected (no blanket 0x ban)', () => { const a = randHex(); ok(scanAddresses(`x ${a} y`, new Set([a])).length === 0); });
  await gate('scanner: unregistered base58 address is flagged, registered one passes', () => { const a = randB58(), b = randB58(); ok(scanAddresses(`${a} ${b}`, new Set([b])).length === 1); });
  await gate('real dist: no address-shaped string outside the stated registry', () => {
    const stated = new Set(Object.values(R).filter((r) => r.state === 'stated' && typeof r.value === 'string').map((r) => r.value));
    const ex = R.ca.state === 'stated' ? [R.ca.value] : [];
    for (const f of textFiles(DIST)) { const bad = scanAddresses(fs.readFileSync(f, 'utf8'), stated, ex); ok(bad.length === 0, `${path.basename(f)}: ${bad[0]}`); }
  });

  // ---------------- dates, colour, units, motion ----------------
  await gate('no dates, clocks or time phrases in visible text, attributes or script strings', () => {
    const sets = { visible: visibleText(html), attrs: (html.match(/(?:aria-label|title|alt|content)="[^"]*"/g) || []).join(' '), js: jsStrings(read(DIST, 'app.js')).join(' ') + ' ' + jsStrings(read(DIST, 'market.js')).join(' ') };
    for (const [n, t] of Object.entries(sets)) ok(dateHits(t).length === 0, `${n}: ${dateHits(t)}`);
  });
  await gate('no dates anywhere in dist html (including inline json)', () => { const t = html.replace(/<link[^>]*>/g, ''); ok(dateHits(t).length === 0, dateHits(t).join()); });
  await gate('date detector self-test catches seeded dates', () => { for (const s of ['2026-10-27', 'updated 12:30', 'as of now', '3 minutes ago']) ok(dateHits(s).length > 0, s); });
  await gate('register keeps dates as data (recorded field present)', () => ok(Object.values(R).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.recorded))));
  await gate('colour literals live in tokens.css and favicon.svg only', () => {
    const files = [...textFiles(DIST).filter((f) => !/tokens\.css$|favicon\.svg$/.test(f)), ...['styles.css', 'app.js', 'market.js', 'index.html'].map((f) => path.join(SRC, f))];
    for (const f of files) {
      let t = fs.readFileSync(f, 'utf8');
      if (f.endsWith('index.html')) t = t.replace(/<meta name="theme-color"[^>]*>/, '');
      t = t.replace(/href="#[a-z]+"/g, '').replace(/getElementById\('[^']*'\)|\$\('#[A-Za-z]+'\)/g, '').replace(/\$\('#[A-Za-z]+/g, '');
      ok(!/(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.test(t.replace(/url\(#[^)]*\)/g, '').replace(/#(?:progress|toast|rows|tiles|ticker|ring|top|world|market|board|join|hero)\b/g, '')), `${path.basename(f)} has hex literal`);
      ok(!/\brgba?\(|\bhsla?\(|\boklch\(/.test(t), `${path.basename(f)} has functional colour literal`);
    }
  });
  await gate('every colour token traces to a pixel coordinate of a real asset', () => {
    const t = JSON.parse(read(SRC, 'tokens.json')).tokens;
    for (const [k, v] of Object.entries(t)) ok(v.file && Number.isInteger(v.x) && Number.isInteger(v.y) && /^#[0-9a-f]{6}$/.test(v.hex), k);
    ok(/Palette provenance: k-means/.test(read(DIST, 'tokens.css')));
  });
  await gate('no ch units in css or inline styles', () => { for (const f of [...textFiles(DIST)]) ok(!/\d(?:\.\d+)?ch\b/.test(fs.readFileSync(f, 'utf8')), f); });
  await gate('prefers-reduced-motion: css kills animation+transition, js checks matchMedia', () => {
    const css = read(DIST, 'styles.css'), js = read(DIST, 'app.js');
    const blk = css.slice(css.indexOf('@media(prefers-reduced-motion:reduce)'));
    ok(blk.includes('animation:none!important') && blk.includes('transition:none!important'));
    ok(blk.includes('data-reveal') && js.includes("prefers-reduced-motion: reduce") && js.includes('noMotion'));
  });
  await gate('tap target token is 44px and used by every control', () => {
    const css = read(DIST, 'styles.css');
    ok(/--tap:44px/.test(css));
    for (const sel of ['.social{', '.copy{', '.tabs button{', '.nav a{', '.btn{', '.pill{', '.ca{']) { const i = css.indexOf(sel); ok(i >= 0, sel); ok(css.slice(i, css.indexOf('}', i)).includes('var(--tap)'), sel + ' lacks tap token'); }
  });
  await gate('motion features present: spring solver, progress bar, parallax, spotlight, count-up, skeleton', () => {
    const js = read(DIST, 'app.js'), css = read(DIST, 'styles.css');
    ok(/-K \* \(x - 1\) - C \* v/.test(js), 'damped spring');
    ok(js.includes('#progress') && html.includes('id="progress"'));
    ok(js.includes('data-depth') && js.includes('style.translate'));
    ok(css.includes('[data-spot]::before') && js.includes("'--mx'"));
    ok(js.includes('function tween') && js.includes('flash-up') && css.includes('@keyframes fup'));
    ok(css.includes('@keyframes shimmer') && css.includes('.fade-in') && css.includes('calc(var(--n,0)*45ms)'));
    ok(css.includes('@keyframes ping') && html.includes('class="dot"'));
    ok(css.includes('@keyframes marquee') && html.includes('id="ticker"'));
  });
  await gate('hero has gradient mesh and three parallax layers', () => ok((html.match(/class="blob b\d"/g) || []).length === 3 && /\.mesh\{/.test(read(DIST, 'styles.css'))));
  await gate('animated logo and coin icon are absent', () => ok(!/coin|spin-logo|logo-spin/i.test(html + read(DIST, 'styles.css') + read(DIST, 'app.js'))));

  // ---------------- copy originality ----------------
  await gate('copy: zero shared 2-grams with the reference', () => {
    const t = visibleText(html) + ' ' + jsStrings(read(DIST, 'app.js')).join(' ');
    const { bigrams } = copyOverlap(t); ok(bigrams.length === 0, bigrams.join(' | '));
  });
  await gate('copy: zero shared content words with the reference (brand and chain names excepted)', () => {
    const t = visibleText(html) + ' ' + jsStrings(read(DIST, 'app.js')).join(' ');
    const { words } = copyOverlap(t); ok(words.length === 0, words.join(', '));
  });

  // ---------------- market behaviour (market.js executed against stubs) ----------------
  const marketSrc = read(DIST, 'market.js');
  async function runMarket({ registerJson, fetchImpl, hiddenInit = false }) {
    const timers = []; let tid = 0; const listeners = {}; const doc = { hidden: hiddenInit, getElementById: () => ({ textContent: registerJson }), addEventListener: (e, f) => { listeners[e] = f; } };
    const calls = [];
    const ctx = { document: doc, window: {}, fetch: (u, o) => { calls.push(u); return fetchImpl(u, o, calls); }, AbortController, setTimeout: (fn, ms) => { const id = ++tid; timers.push({ id, fn, ms }); return id; }, clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); }, Promise, Math, JSON, Object, Array, Number, String, isFinite, RegExp, Error };
    vm.createContext(ctx); vm.runInContext(marketSrc, ctx);
    const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
    return { ctx, timers, doc, listeners, calls, flush, M: ctx.window.LOMMarket };
  }
  const solAddr = (i) => `So${String(i).padStart(2, '0')}${'1'.repeat(38)}`;
  const mkBoosts = (n) => [...Array.from({ length: n }, (_, i) => ({ chainId: 'solana', tokenAddress: solAddr(i) })), { chainId: 'ethereum', tokenAddress: randHex() }, { chainId: 'base', tokenAddress: randHex() }];
  const mkPairs = (u) => u.split('/solana/')[1].split(',').map((a, i) => ({ chainId: 'solana', baseToken: { address: a, symbol: 'T' + a.slice(2, 4), name: 'Token ' + a.slice(2, 4) }, priceUsd: '0.001', priceChange: { h24: 5 }, volume: { h24: Number(a.slice(2, 4)) * 1000 + 1 }, liquidity: { usd: 5000 }, info: { imageUrl: 'https://img.example/x.png' } }));
  const okFetch = (n) => (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(u.includes('token-boosts') ? mkBoosts(n) : mkPairs(u)) });
  const mkReg = (ca) => JSON.stringify({ records: { ...clone(REAL).records, ca, market: { state: 'stated', label: 'Market feed', boosts: R.market.boosts, pairs: R.market.pairs } } });

  await gate('market: keeps solana only, requests pairs, returns top 10 by 24h volume descending', async () => {
    const h = await runMarket({ registerJson: mkReg({ state: 'absent', label: 'c' }), fetchImpl: okFetch(15) }); h.M.start(); await h.flush();
    const s = h.M.state; ok(s.status === 'live' && s.items.length === 10);
    for (let i = 1; i < 10; i++) ok(s.items[i - 1].volume >= s.items[i].volume);
    ok(h.calls[0] === R.market.boosts && h.calls.slice(1).every((u) => u.includes('/tokens/v1/solana/') && !u.includes('0x')));
  });
  await gate('market: large lists are chunked to at most 30 addresses per request', async () => {
    const h = await runMarket({ registerJson: mkReg({ state: 'absent', label: 'c' }), fetchImpl: okFetch(45) }); h.M.start(); await h.flush();
    const pairCalls = h.calls.filter((u) => u.includes('/solana/')); ok(pairCalls.length === 2 && pairCalls.every((u) => u.split('/solana/')[1].split(',').length <= 30));
  });
  await gate('market: ca state has zero effect on requests or results', async () => {
    const a = await runMarket({ registerJson: mkReg({ state: 'absent', label: 'c' }), fetchImpl: okFetch(12) });
    const b = await runMarket({ registerJson: mkReg({ state: 'stated', label: 'c', value: randB58() }), fetchImpl: okFetch(12) });
    a.M.start(); b.M.start(); await a.flush(); await b.flush();
    ok(JSON.stringify(a.calls) === JSON.stringify(b.calls) && JSON.stringify(a.M.state.items) === JSON.stringify(b.M.state.items) && a.M.state.status === 'live' && b.M.state.status === 'live');
  });
  await gate('market: market.js never reads the ca record', () => ok(!/records\.ca\b|\['ca'\]|"ca"|data-record/.test(marketSrc)));
  await gate('market: polls every 60s after success', async () => {
    const h = await runMarket({ registerJson: mkReg({ state: 'absent', label: 'c' }), fetchImpl: okFetch(12) }); h.M.start(); await h.flush();
    ok(h.timers.length === 1 && h.timers[0].ms === 60000, JSON.stringify(h.timers.map((t) => t.ms)));
  });
  await gate('market: failures back off exponentially, state keeps last good data', async () => {
    let fail = false;
    const f = (u) => fail ? Promise.reject(new Error('down')) : okFetch(12)(u);
    const h = await runMarket({ registerJson: mkReg({ state: 'absent', label: 'c' }), fetchImpl: f }); h.M.start(); await h.flush();
    const good = JSON.stringify(h.M.state.items); fail = true;
    const waits = [];
    for (let i = 0; i < 5; i++) { const t = h.timers.shift(); h.timers.length = 0; t.fn(); await h.flush(); waits.push(h.timers[0] && h.timers[0].ms); if (i === 0) ok(h.M.state.status === 'error' && h.M.state.hasData && JSON.stringify(h.M.state.items) === good, 'kept last good'); }
    // first retry follows the 60s poll timer; subsequent ones are the backoff series with +-15% jitter
    const base = [2000, 4000, 8000, 16000];
    for (let i = 0; i < 4; i++) ok(waits[i] >= base[i] * 0.85 - 1 && waits[i] <= base[i] * 1.15 + 1, `retry ${i}: ${waits[i]}`);
    ok(waits[3] > waits[2] && waits[2] > waits[1] && waits[1] > waits[0]);
  });
  await gate('market: first-load failure surfaces error with no data (dash path)', async () => {
    const h = await runMarket({ registerJson: mkReg({ state: 'absent', label: 'c' }), fetchImpl: () => Promise.reject(new Error('down')) }); h.M.start(); await h.flush();
    ok(h.M.state.status === 'error' && !h.M.state.hasData && h.M.state.items.length === 0);
  });
  await gate('market: pauses while hidden, fetches immediately when visible', async () => {
    const h = await runMarket({ registerJson: mkReg({ state: 'absent', label: 'c' }), fetchImpl: okFetch(12) }); h.M.start(); await h.flush();
    h.doc.hidden = true; h.listeners.visibilitychange(); ok(h.timers.length === 0, 'timer cleared when hidden');
    const before = h.calls.length; h.doc.hidden = false; h.listeners.visibilitychange(); await h.flush(); ok(h.calls.length > before, 'refetched on visible');
  });
  await gate('market: no timer is armed if a poll finishes while the tab is hidden', async () => {
    const h = await runMarket({ registerJson: mkReg({ state: 'absent', label: 'c' }), fetchImpl: okFetch(12), hiddenInit: true }); h.M.start(); await h.flush();
    ok(h.timers.length === 0);
  });
  await gate('market ui: letter tile fallback, logo from imageUrl, copy per address, 10 rows of skeleton', () => {
    const js = read(DIST, 'app.js');
    ok(js.includes("'letter'") && js.includes("addEventListener('error'") && js.includes('item.image') && js.includes("'data-copy', item.address"));
    ok(js.includes('i < 10') && js.includes('skeletonRows'));
    ok(js.includes('item.address'));
  });
  await gate('market ui: ticker uses the same live data', () => { const js = read(DIST, 'app.js'); ok(js.includes('renderTicker(current)') && js.includes('renderRows(current)') && js.includes('fillRing(current)')); });
  await gate('market ui: status text carries no time', () => ok(/'On air'/.test(read(DIST, 'app.js'))));

  // ---------------- repo hygiene and content ----------------
  await gate('repo files exist: README, whitepaper, LICENSE; none inside dist', () => {
    for (const f of ['README.md', path.join('docs', 'whitepaper.md'), 'LICENSE']) ok(exists(ROOT, f), f);
    for (const f of walk(DIST)) ok(!/README|LICENSE|whitepaper/i.test(path.basename(f)), f);
  });
  await gate('LICENSE is MIT, copyright Land of Memes, 2026', () => { const l = read(ROOT, 'LICENSE'); ok(/MIT License/.test(l) && /Copyright \(c\) 2026 Land of Memes/.test(l)); });
  await gate('README has badge, Solana, CA placeholder, Overview/Features/Links', () => {
    const r = read(ROOT, 'README.md');
    ok(/img\.shields\.io/.test(r) && /landofmemes\.fun/.test(r) && /Solana/.test(r) && /## Overview/.test(r) && /## Features/.test(r) && /## Links/.test(r) && /Contract address/i.test(r) && /pending/i.test(r));
  });
  await gate('whitepaper has vision, tokenomics placeholders, 3-4 phase roadmap, team placeholder', () => {
    const w = read(ROOT, 'docs', 'whitepaper.md');
    ok(/Vision/i.test(w) && /Mission/i.test(w) && /Tokenomics/i.test(w) && /Team/i.test(w));
    const ph = (w.match(/^### Phase \d/gm) || []).length; ok(ph >= 3 && ph <= 4, 'phases ' + ph);
  });
  await gate('no AI mentions or attribution anywhere in the project', () => {
    const bad = new RegExp(['cla' + 'ude', 'anth' + 'ropic', 'co-authored', 'generated (?:by|with)', '\\bA' + 'I\\b', '\\bLL' + 'M\\b', 'chat' + 'gpt'].join('|'), 'i');
    const files = [...textFiles(ROOT).filter((f) => !/node_modules|\.gate-tmp|[\\/]brand[\\/]|[\\/]reference[\\/]|tokens\.json$/.test(f) && !/tools[\\/](fixtures|gates\.mjs)/.test(f))];
    for (const f of files) { const t = fs.readFileSync(f, 'utf8'); ok(!bad.test(t), path.relative(ROOT, f)); }
  });
  await gate('no agent config files or folders in the project', () => { for (const n of ['CL' + 'AUDE.md', '.cla' + 'ude']) ok(!exists(ROOT, n), n); });
  await gate('no files written outside the project: build writes only dist/ and gate temp', () => ok(fs.realpathSync(DIST).startsWith(fs.realpathSync(ROOT))));
  await gate('page has no external script and one stylesheet host (fonts)', () => {
    ok(!/<script[^>]+src="https?:/.test(html));
    const hosts = new Set([...html.matchAll(/<link[^>]+href="(https?:\/\/[^"/]+)/g)].map((m) => m[1])); ok([...hosts].every((h) => /fonts\.g/.test(h)));
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  const failed = results.filter((r) => !r[1]);
  for (const [n, p, m] of results) console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p ? '' : '\n      ' + m}`);
  console.log(`\ngates: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { fs.rmSync(TMP, { recursive: true, force: true }); console.error(e); process.exit(2); });
