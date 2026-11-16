// Lecture d'un texte de scénario : repère scènes, personnages, répliques.
// Sert à la fois à l'aperçu « Lire », à l'import PDF et aux statistiques.

const SCENE_RE = /^\s*(?:\d+[A-Za-z]?\s*[.)\-–]?\s*)?(?:INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|INT\.?|EXT\.?|I\/E\.?|Int\.|Ext\.|INTÉRIEUR|EXTÉRIEUR|INTERIEUR|EXTERIEUR)(?=[\s.\-–:/]|$)/;
const CHAPTER_RE = /^\s*(?:CHAPITRE|ACTE|SÉQUENCE|SEQUENCE|PARTIE|ÉPISODE|EPISODE|PROLOGUE|ÉPILOGUE|EPILOGUE)\b/i;
const TRANSITION_RE = /^\s*(?:FONDU|CUT\b|COUPE\b|NOIR\b|FIN\b|FADE\b|OUVERTURE AU NOIR|RACCORD|SMASH CUT|GÉNÉRIQUE|GENERIQUE)/;
const NOT_A_NAME = new Set(['SUITE', 'FIN', 'NOIR', 'PLUS TARD', 'CONTINUED', 'INSERT', 'FLASHBACK', 'FLASH-BACK',
  'TITRE', 'CARTON', 'GÉNÉRIQUE', 'GENERIQUE', 'MONTAGE', 'ELLIPSE', 'RETOUR', 'PLUS LOIN', 'AU MÊME MOMENT',
  'À SUIVRE', 'A SUIVRE', 'THE END', 'SUPER', 'INTERTITRE', 'BLACK', 'OFF', 'VOIX OFF', 'ÉCRAN NOIR', 'ECRAN NOIR']);

export function isUpper(line) {
  const letters = line.replace(/[^\p{L}]/gu, '');
  return letters.length >= 2 && line === line.toUpperCase();
}

export function isScene(line) { return SCENE_RE.test(line); }
export function isChapterHeading(line) { return CHAPTER_RE.test(line) && line.trim().length < 70; }
function isTransition(line) {
  const t = line.trim();
  return isUpper(t) && (TRANSITION_RE.test(t) || /:$/.test(t) && t.length < 30 && !/\s:\s*\S/.test(t));
}

// « PAUL (V.O.) » -> « PAUL » ; renvoie '' si ce n'est pas un nom plausible.
export function cueName(line) {
  let name = line.replace(/\([^)]*\)/g, ' ').replace(/[:：]\s*$/, '').replace(/\s+/g, ' ').trim();
  name = name.replace(/^[-–—]\s*/, '');
  if (!name || name.length > 34 || name.split(' ').length > 4) return '';
  if (/[.!?…,;]$/.test(name) || /^\d+$/.test(name) || NOT_A_NAME.has(name)) return '';
  if (!/^[\p{Lu}0-9]/u.test(name)) return '';
  return name;
}

// Découpe un texte en éléments typés.
export function parse(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inDialogue = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], line = raw.trim();
    const prevBlank = i === 0 || !lines[i - 1].trim();
    const next = (lines[i + 1] || '').trim();
    if (!line) { out.push({ type: 'blank', text: '' }); inDialogue = false; continue; }
    if (isScene(line)) { out.push({ type: 'scene', text: line }); inDialogue = false; continue; }
    if (prevBlank && isChapterHeading(line)) { out.push({ type: 'chapter', text: line }); inDialogue = false; continue; }
    if (inDialogue) {
      out.push({ type: /^\(.*\)?$/.test(line) && line.startsWith('(') ? 'paren' : 'dialogue', text: line });
      continue;
    }
    if (prevBlank && isUpper(line) && isTransition(line)) { out.push({ type: 'transition', text: line }); continue; }
    // Forme « PAUL : Bonjour. » sur une seule ligne.
    const inline = line.match(/^([\p{Lu}][\p{Lu}0-9 .'’\-]{1,30}?)\s*(\([^)]*\))?\s*[:：]\s+(\S.*)$/u);
    if (inline && isUpper(inline[1]) && cueName(inline[1])) {
      out.push({ type: 'character', text: inline[1].trim() + (inline[2] ? ' ' + inline[2] : ''), name: cueName(inline[1]) });
      out.push({ type: 'dialogue', text: inline[3] });
      continue;
    }
    if (prevBlank && next && isUpper(line.replace(/\([^)]*\)/g, '')) && line.length <= 45) {
      const name = cueName(line);
      if (name) { out.push({ type: 'character', text: line, name }); inDialogue = true; continue; }
    }
    out.push({ type: 'action', text: line });
  }
  return out;
}

const countWords = (s) => (s.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []).length;

// Statistiques d'un ensemble de chapitres [{id, title, text}].
export function analyze(chapters) {
  const chars = new Map();
  const perChapter = [];
  let scenes = 0, int = 0, ext = 0, day = 0, night = 0, words = 0, dialogueWords = 0;
  for (const ch of chapters) {
    const tokens = parse(ch.text || '');
    let current = null, chScenes = 0, chWords = 0;
    const present = new Map();
    for (const tk of tokens) {
      const w = countWords(tk.text);
      chWords += w;
      if (tk.type === 'scene') {
        chScenes++; current = null;
        const up = tk.text.toUpperCase();
        if (/INT/.test(up.slice(0, 12))) int++;
        if (/EXT/.test(up.slice(0, 12))) ext++;
        if (/\b(NUIT|SOIR|NIGHT|CRÉPUSCULE|CREPUSCULE)\b/.test(up)) night++;
        else if (/\b(JOUR|MATIN|AUBE|DAY|APRÈS-MIDI|APRES-MIDI|MIDI)\b/.test(up)) day++;
      } else if (tk.type === 'character') {
        current = tk.name;
        if (!chars.has(current)) chars.set(current, { name: current, lines: 0, words: 0, chapters: new Set() });
        const c = chars.get(current);
        c.lines++; c.chapters.add(ch.id);
        present.set(current, (present.get(current) || 0) + 1);
      } else if (tk.type === 'dialogue' && current) {
        chars.get(current).words += w; dialogueWords += w;
      } else if (tk.type !== 'paren' && tk.type !== 'dialogue') current = null;
    }
    scenes += chScenes; words += chWords;
    perChapter.push({ id: ch.id, title: ch.title, scenes: chScenes, words: chWords, present });
  }
  const characters = [...chars.values()]
    .map((c) => ({ ...c, chapters: [...c.chapters] }))
    .sort((a, b) => b.lines - a.lines);
  return { characters, perChapter, scenes, int, ext, day, night, words, dialogueWords,
    pages: Math.max(1, Math.round(words / 190)) };
}

// Découpage d'un long texte en chapitres. mode : auto | titres | scenes | pages
export function splitChapters(text, mode = 'auto', scenesPerChapter = 1) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const headingIdx = [], sceneIdx = [];
  lines.forEach((l, i) => {
    const prevBlank = i === 0 || !lines[i - 1].trim();
    if (prevBlank && isChapterHeading(l.trim()) && isUpper(l.trim().split(/\s+/)[0])) headingIdx.push(i);
    if (isScene(l.trim())) sceneIdx.push(i);
  });
  let used = mode;
  if (mode === 'auto') used = headingIdx.length >= 2 ? 'titres' : sceneIdx.length >= 2 ? 'scenes' : 'pages';
  let cuts = [];
  if (used === 'titres') cuts = headingIdx;
  else if (used === 'scenes') cuts = sceneIdx.filter((_, i) => i % Math.max(1, scenesPerChapter) === 0);
  if (used === 'pages' || !cuts.length) {
    used = 'pages'; cuts = [];
    // Environ 5 pages (~270 lignes), en coupant sur une ligne vide.
    let last = 0;
    for (let i = 0; i < lines.length; i++) {
      if (i - last >= 270 && !lines[i].trim()) { cuts.push(i + 1); last = i + 1; }
    }
    cuts.unshift(0);
  }
  if (cuts[0] !== 0) cuts.unshift(0);
  const chapters = [];
  for (let k = 0; k < cuts.length; k++) {
    const body = lines.slice(cuts[k], k + 1 < cuts.length ? cuts[k + 1] : lines.length);
    const textPart = body.join('\n').replace(/^\n+|\s+$/g, '');
    if (!textPart) continue;
    const first = body.find((l) => l.trim()) || '';
    let title;
    if (cuts[k] === 0 && !isScene(first.trim()) && !isChapterHeading(first.trim()) && used !== 'pages') title = 'Ouverture';
    else if (used === 'pages') title = `Partie ${chapters.length + 1}`;
    else title = first.trim().replace(/^\d+[A-Za-z]?\s*[.)\-–]?\s*/, '').replace(/\s+\d+[A-Za-z]?$/, '').slice(0, 90);
    chapters.push({ title: title || `Chapitre ${chapters.length + 1}`, text: textPart });
  }
  return { chapters, used, found: { titres: headingIdx.length, scenes: sceneIdx.length } };
}

// ---- Lecture de PDF (pdf.js chargé à la demande) ---------------------------
export async function readPdf(file, onProgress) {
  const pdfjs = await import('./vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  let chars = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const height = page.getViewport({ scale: 1 }).height;
    // Regroupe les fragments par ligne (même hauteur), puis de gauche à droite.
    const rows = [];
    for (const it of content.items) {
      if (!it.str) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, w: it.width || 0, s: it.str, h: it.height || 10 });
    }
    rows.sort((a, b) => b.y - a.y);
    const lineList = rows.map((r) => {
      r.items.sort((a, b) => a.x - b.x);
      let s = '', end = null;
      for (const it of r.items) {
        if (end !== null && it.x - end > it.h * 0.22 && !s.endsWith(' ') && !it.s.startsWith(' ')) s += ' ';
        s += it.s; end = it.x + it.w;
      }
      return { y: r.y, text: s.replace(/\s+/g, ' ').trim() };
    }).filter((l) => l.text);
    // Écart « normal » entre deux lignes : au-delà, c'est une ligne vide.
    const gaps = [];
    for (let i = 1; i < lineList.length; i++) gaps.push(lineList[i - 1].y - lineList[i].y);
    const sorted = gaps.filter((g) => g > 4).sort((a, b) => a - b);
    const base = sorted.length ? sorted[Math.floor(sorted.length * 0.2)] : 12;
    const out = [];
    lineList.forEach((l, i) => {
      const edge = l.y > height * 0.92 || l.y < height * 0.07;
      // Numéros de page et mentions de continuation en haut/bas de page.
      if (edge && /^(?:page\s*)?\d{1,4}\s*[.\-]?$|^-\s*\d+\s*-$/i.test(l.text)) return;
      if (/^\(?(?:SUITE|CONTINUED|À SUIVRE|A SUIVRE|CONT'D)\)?\.?:?$/i.test(l.text)) return;
      if (i > 0 && out.length && lineList[i - 1].y - l.y > base * 1.45) out.push('');
      out.push(l.text);
      chars += l.text.length;
    });
    pages.push(out.join('\n'));
    if (onProgress) onProgress(n, doc.numPages);
  }
  const text = unwrap(pages.join('\n\n').replace(/\n{3,}/g, '\n\n'));
  return { text, pages: doc.numPages, scanned: chars < doc.numPages * 40 };
}

// Un PDF coupe les phrases en fin de ligne : on recolle chaque paragraphe
// (description, réplique) pour qu'il se réécrive comme un texte normal.
export function unwrap(text) {
  return text.split(/\n{2,}/).map((block) => {
    const out = [];
    let glue = false;
    block.split('\n').forEach((line, i) => {
      const t = line.trim();
      const alone = isScene(t) || isChapterHeading(t) || /^\(.*\)$/.test(t) ||
        (i === 0 && isUpper(t.replace(/\([^)]*\)/g, '')) && t.length <= 45);
      if (alone || !glue) out.push(t);
      else out[out.length - 1] += (/[\p{L}]-$/u.test(out[out.length - 1]) ? '' : ' ') + t;
      glue = !alone;
    });
    return out.join('\n');
  }).join('\n\n');
}
