// Static build: src/ -> dist/. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

export const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const HEX40 = /^0x[0-9a-fA-F]{40}$/;
const X_PATH = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
const GH_PATH = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z';
const ICON = {
  x: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${X_PATH}"/></svg>`,
  github: `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${GH_PATH}"/></svg>`
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STRIP = new Set(['recorded', 'source', 'scope']);

export function validate(reg) {
  const R = reg.records;
  for (const [k, r] of Object.entries(R)) {
    if (!['stated', 'absent', 'unconfirmed'].includes(r.state)) throw new Error(`record ${k}: bad state`);
    if (r.state !== 'stated' && ('value' in r || 'url' in r)) throw new Error(`record ${k}: inert record carries value or url`);
  }
  if (R.ca.state === 'stated' && !(BASE58.test(R.ca.value) || HEX40.test(R.ca.value))) throw new Error('ca: value is not address shaped');
  for (const k of ['x', 'github']) if (R[k].state === 'stated') new URL(R[k].url);
}

export function publicRegister(reg) {
  const out = { records: {} };
  for (const [k, r] of Object.entries(reg.records)) {
    if (r.state !== 'stated') { out.records[k] = { state: r.state, label: r.label }; continue; }
    out.records[k] = Object.fromEntries(Object.entries(r).filter(([f]) => !STRIP.has(f)));
  }
  return out;
}

export function handleOf(url) {
  return new URL(url).pathname.split('/').filter(Boolean)[0] || '';
}

function social(key, r) {
  if (r.state === 'stated') {
    const h = handleOf(r.url);
    const label = h ? `${r.label}, @${h}` : r.label;
    return `        <a class="social" data-record="${key}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}">${ICON[key]}</a>`;
  }
  return `        <a class="social is-inert" data-record="${key}" data-state="${r.state}" role="link" aria-disabled="true" aria-label="${esc(r.label)}, pending">${ICON[key]}</a>`;
}

function caSlot(r, indent) {
  if (r.state === 'stated') {
    return `${indent}<button type="button" class="ca" data-record="ca" data-state="stated" data-copy="${esc(r.value)}" aria-label="Copy contract address"><span class="ca-k"><span>${esc(r.label)}</span><span class="ca-act">Tap to copy</span></span><span class="ca-v">${esc(r.value)}</span></button>`;
  }
  return `${indent}<div class="ca is-inert" data-record="ca" data-state="${r.state}" aria-disabled="true"><span class="ca-k"><span>${esc(r.label)}</span></span><span class="ca-v">pending</span></div>`;
}

function recordList(reg) {
  return Object.entries(reg.records).map(([k, r]) => {
    const on = r.state === 'stated';
    const v = on ? (k === 'chain' ? esc(r.value) : 'Confirmed') : 'pending';
    return `      <li data-record="${k}" data-state="${r.state}" data-reveal data-spot><span class="rec-k">${esc(r.label)}</span><span class="rec-v${on ? ' on' : ''}"><i></i>${v}</span></li>`;
  }).join('\n');
}

function tokensCss() {
  const t = JSON.parse(fs.readFileSync(path.join(SRC, 'tokens.json'), 'utf8')).tokens;
  const notes = Object.entries(t).map(([k, v]) => `   ${k.padEnd(5)} ${v.hex}  ${v.file} @ (${v.x},${v.y})  cluster ${v.share}%`).join('\n');
  const body = Object.entries(t).map(([k, v]) => `  --${k}:${v.hex};`).join('\n');
  return {
    css: `/* Palette provenance: k-means (k=8, seed 1) over opaque pixels of the brand logo and the dark reference frame.\n   Each centre is snapped to the nearest real pixel, listed with its pixel coordinate.\n${notes}\n   This is the only stylesheet that holds colour literals; favicon.svg is generated from the same values. */\n:root{\n${body}\n}\n`,
    theme: t.ink.hex
  };
}

function copyChecked(from, to) {
  if (!fs.existsSync(from)) throw new Error(`missing asset ${path.relative(ROOT, from)}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

export function build({ registerPath = path.join(SRC, 'register.json'), outDir = path.join(ROOT, 'dist') } = {}) {
  const reg = JSON.parse(fs.readFileSync(registerPath, 'utf8'));
  validate(reg);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const { css, theme } = tokensCss();
  const R = reg.records;
  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const map = {
    THEME: theme,
    SOCIAL_X: social('x', R.x),
    SOCIAL_GITHUB: social('github', R.github),
    CA_SLOT: caSlot(R.ca, '    '),
    CA_FOOT: caSlot(R.ca, '      '),
    RECORD_LIST: recordList(reg),
    REGISTER_PUBLIC: JSON.stringify(publicRegister(reg)).replace(/</g, '\\u003c')
  };
  html = html.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => { if (!(k in map)) throw new Error('unknown slot ' + k); return map[k]; });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  fs.writeFileSync(path.join(outDir, 'tokens.css'), css);
  for (const f of ['styles.css', 'app.js', 'market.js']) copyChecked(path.join(SRC, f), path.join(outDir, f));
  // logo files are copied by name, on purpose: the page references exactly these paths
  for (const f of ['logo-512.png', 'logo-192.png']) copyChecked(path.join(SRC, 'assets', f), path.join(outDir, 'assets', f));
  copyChecked(path.join(SRC, 'assets', 'favicon.svg'), path.join(outDir, 'favicon.svg'));
  return outDir;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? path.resolve(a[i + 1]) : undefined; };
  const out = build({ registerPath: opt('--register'), outDir: opt('--out') });
  console.log('built ->', path.relative(ROOT, out) || out);
}
