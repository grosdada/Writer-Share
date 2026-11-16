import * as SP from './screenplay.js';

// ============================================================ utilitaires
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const COLORS = ['jaune', 'rose', 'bleu', 'vert', 'violet'];
const STATUSES = ['à écrire', 'premier jet', 'en réécriture', 'à relire', 'validé'];
const STATUS_COLOR = { 'à écrire': '#9a968c', 'premier jet': '#d99a1c', 'en réécriture': '#c2410c', 'à relire': '#4b8fd8', 'validé': '#2f7d57' };
const ROLES = ['principal', 'secondaire', 'figurant'];
const PALETTE = ['#c2410c', '#0f766e', '#7c3aed', '#be185d', '#1d4ed8', '#4d7c0f', '#b45309', '#0e7490'];

// replaceChildren écrirait « null » en toutes lettres : on ignore les enfants vides, comme h().
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function replaceChildren(...kids) {
  return nativeReplace.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
};

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const colorFor = (name) => PALETTE[[...new TextEncoder().encode(name.toLowerCase())].reduce((a, b) => a + b, 0) % PALETTE.length];
const chip = (name) => h('span', { class: 'chip', style: `background:${colorFor(name)}` }, name);
const plural = (n, one, many) => `${n} ${n > 1 ? many || one + 's' : one}`;
function fmt(at) {
  if (!at) return '';
  const d = new Date(at), now = new Date();
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + time;
}
function toast(message, isError) {
  const el = h('div', { class: 'toast' + (isError ? ' err' : '') }, message);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), isError ? 6500 : 3200);
}
function debounce(fn, ms) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.now = (...a) => { clearTimeout(t); fn(...a); };
  return wrapped;
}
function autogrow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }
function stars(value, onChange) {
  return h('span', { class: 'stars' + (onChange ? '' : ' ro'), title: onChange ? 'Noter' : '' },
    [1, 2, 3, 4, 5].map((n) => h('button', { class: n <= value ? 'on' : '', type: 'button',
      onclick: onChange ? (e) => { e.stopPropagation(); onChange(n === value ? 0 : n); } : null }, '★')));
}
function colorPicker(value, onChange) {
  return h('span', { class: 'colors' }, COLORS.map((c) => h('button', { type: 'button', title: c,
    class: `c-${c}` + (c === value ? ' on' : ''), onclick: () => onChange(c) })));
}
// Ne pas redessiner une zone pendant que quelqu'un y tape : on attend qu'il sorte du champ.
const pending = new Map();
function guarded(key, container, draw) {
  const a = document.activeElement;
  if (container && a && container.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) {
    pending.set(key, draw);
    return;
  }
  pending.delete(key);
  draw();
}
document.addEventListener('focusout', () => setTimeout(() => {
  for (const [key, draw] of [...pending]) { pending.delete(key); draw(); }
}, 60));

function modal(title, body, buttons = [], cls = '') {
  const close = () => overlay.remove();
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal ' + cls },
      h('header', {}, h('h2', {}, title), h('button', { class: 'ghost', onclick: close, title: 'Fermer' }, '✕')),
      h('div', { class: 'body' }, body),
      buttons.length ? h('footer', {}, buttons.map((b) => h('button', { class: b.class || '', disabled: b.disabled,
        onclick: async (e) => {
          e.target.disabled = true;
          try { if ((await b.action(close)) !== false) close(); } catch (err) { toast(err.message, true); }
          e.target.disabled = false;
        } }, b.label))) : null));
  document.body.append(overlay);
  const first = overlay.querySelector('input,textarea,select');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, overlay };
}
const confirmBox = (title, text, label = 'Confirmer', cls = 'primary') => new Promise((resolve) => {
  let done = false;
  const m = modal(title, h('p', {}, text), [
    { label: 'Annuler', action: () => { done = true; resolve(false); } },
    { label, class: cls, action: () => { done = true; resolve(true); } }]);
  new MutationObserver(() => { if (!m.overlay.isConnected && !done) resolve(false); }).observe(document.body, { childList: true });
});
const promptBox = (title, label, value = '', okLabel = 'Valider') => new Promise((resolve) => {
  let done = false;
  const input = h('input', { type: 'text', value, onkeydown: (e) => { if (e.key === 'Enter') { done = true; resolve(input.value.trim()); m.close(); } } });
  const m = modal(title, [h('label', {}, label), input], [
    { label: 'Annuler', action: () => { done = true; resolve(null); } },
    { label: okLabel, class: 'primary', action: () => { done = true; resolve(input.value.trim()); } }]);
  new MutationObserver(() => { if (!m.overlay.isConnected && !done) resolve(null); }).observe(document.body, { childList: true });
});

// ============================================================ état et réseau
const S = {
  token: localStorage.getItem('ws_token') || '', name: localStorage.getItem('ws_name') || '',
  cid: Math.random().toString(36).slice(2, 12), pid: '', project: null, settings: {},
  presence: { users: [], locks: {} }, view: 'script', chapterId: '', chatOpen: false, unread: 0,
  online: true, aiRunning: null, answer: '', ideaSort: 'recent',
  mode: { public: false }, invite: null,
};
const ED = { pane: 'text', mode: 'write', key: '', baseRev: 0, dirty: false, timer: null, hasLock: false, lastInput: 0, saving: null, noteDraft: null };
let es = null;

async function api(path, body) {
  let r;
  try {
    r = await fetch(path, { method: body ? 'POST' : 'GET', keepalive: !!(body && body.keepalive),
      headers: { 'Content-Type': 'application/json', 'X-Token': S.token, 'X-Client': S.cid },
      body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw Object.assign(new Error('Serveur injoignable. Vérifie que Writer-Share tourne sur la machine hôte.'), { status: 0 });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && S.token) { logout(); }
    throw Object.assign(new Error(data.error || `Erreur ${r.status}`), { status: r.status, data });
  }
  return data;
}
const op = (name, args = {}) => api(`/api/project/${S.pid}/op`, { op: name, ...args });
// Opération courante : affiche l'erreur au lieu de la laisser passer en silence.
const act = (name, args) => op(name, args).catch((e) => { toast(e.message, true); throw e; });
const chapter = (id) => S.project?.chapters.find((c) => c.id === id);
const cur = () => chapter(S.chapterId);

function logout() {
  // Ferme aussi la session côté serveur (le jeton ne pourra plus servir).
  if (S.token) fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': S.token }, body: '{}' }).catch(() => {});
  S.token = ''; S.pid = ''; S.project = null;
  localStorage.removeItem('ws_token');
  stopEvents();
  render();
}

// ============================================================ écrans d'entrée
function render() {
  if (S.invite) return signupScreen();
  if (!S.token) return loginScreen();
  if (!S.project) return pickerScreen();
  workspace();
}

// Création de compte (ou nouveau mot de passe) depuis un lien d'invitation : mode public seulement.
function signupScreen() {
  const inv = S.invite;
  const leave = () => { S.invite = null; history.replaceState(null, '', location.pathname); };
  if (!inv.ok) {
    app.replaceChildren(h('div', { class: 'center' }, h('div', { class: 'card' },
      h('div', { class: 'brand' }, h('img', { src: 'icon.svg', alt: '' }), h('h1', {}, 'Writer-Share')),
      h('p', {}, 'Ce lien d\'invitation n\'est plus valable : il a déjà servi ou il a expiré.'),
      h('p', { class: 'muted' }, 'Demande un nouveau lien à la personne qui administre Writer-Share.'),
      h('button', { class: 'primary', style: 'width:100%;padding:11px', onclick: () => { leave(); render(); } }, 'J\'ai déjà un compte'))));
    return;
  }
  const name = h('input', { type: 'text', maxLength: 24, placeholder: 'Ex. Camille', autocomplete: 'username', value: inv.reset || '', disabled: !!inv.reset });
  const pass = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '8 caractères au moins' });
  const pass2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Encore une fois' });
  const err = h('p', { class: 'small', style: 'color:var(--danger);min-height:1.4em;margin:10px 0 0' });
  const go = async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (pass.value !== pass2.value) { err.textContent = 'Les deux mots de passe ne sont pas identiques.'; return; }
    try {
      const r = await api('/api/signup', { invite: inv.token, name: name.value, password: pass.value });
      S.token = r.token; S.name = r.name;
      localStorage.setItem('ws_token', r.token); localStorage.setItem('ws_name', r.name);
      leave();
      await boot();
    } catch (ex) { err.textContent = ex.message; }
  };
  app.replaceChildren(h('div', { class: 'center' }, h('form', { class: 'card', onsubmit: go },
    h('div', { class: 'brand' }, h('img', { src: 'icon.svg', alt: '' }), h('h1', {}, 'Writer-Share')),
    h('p', { class: 'muted', style: 'margin:0' }, inv.reset ? 'Choisis ton nouveau mot de passe.' : 'Bienvenue dans l\'équipe ! Crée ton compte.'),
    h('label', {}, 'Ton prénom'), name,
    inv.reset ? null : h('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Il signera tes annotations et tes idées.'),
    h('label', {}, 'Mot de passe'), pass,
    h('label', {}, 'Confirme le mot de passe'), pass2,
    err,
    h('button', { class: 'primary', style: 'width:100%;padding:11px;font-size:16px;margin-top:6px' }, inv.reset ? 'Enregistrer' : 'Créer mon compte'))));
  (inv.reset ? pass : name).focus();
}

function loginScreen() {
  const pub = S.mode.public;
  const name = h('input', { type: 'text', value: S.name, maxLength: 24, placeholder: 'Ex. Camille', autocomplete: pub ? 'username' : 'given-name' });
  const code = pub ? h('input', { type: 'password', autocomplete: 'current-password' })
    : h('input', { type: 'text', placeholder: 'Ex. plume-1234', autocomplete: 'off', autocapitalize: 'none', spellcheck: false });
  const err = h('p', { class: 'small', style: 'color:var(--danger);min-height:1.4em;margin:10px 0 0' });
  const go = async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      const r = await api('/api/login', pub ? { name: name.value, password: code.value } : { name: name.value, code: code.value });
      S.token = r.token; S.name = r.name;
      localStorage.setItem('ws_token', r.token); localStorage.setItem('ws_name', r.name);
      await boot();
    } catch (ex) { err.textContent = ex.message; }
  };
  app.replaceChildren(h('div', { class: 'center' }, h('form', { class: 'card', onsubmit: go },
    h('div', { class: 'brand' }, h('img', { src: 'icon.svg', alt: '' }), h('h1', {}, 'Writer-Share')),
    h('p', { class: 'muted', style: 'margin:0' }, 'L\'atelier de scénario à plusieurs.'),
    h('label', {}, 'Ton prénom'), name,
    h('label', {}, pub ? 'Mot de passe' : 'Code d\'accès'), code,
    h('p', { class: 'muted small', style: 'margin:6px 0 0' }, pub
      ? 'Pas encore de compte, ou mot de passe oublié ? Demande un lien à la personne qui administre Writer-Share.'
      : 'Le code est donné par la personne qui héberge Writer-Share.'),
    err,
    h('button', { class: 'primary', style: 'width:100%;padding:11px;font-size:16px;margin-top:6px' }, 'Entrer'))));
  (S.name ? code : name).focus();
}

async function pickerScreen() {
  let list = [];
  try { list = (await api('/api/projects')).projects; } catch (e) { if (!S.token) return; toast(e.message, true); }
  if (!S.token || S.project) return;
  const name = h('input', { type: 'text', placeholder: 'Titre du scénario', maxLength: 120 });
  const create = async (e) => {
    e.preventDefault();
    if (!name.value.trim()) return name.focus();
    const r = await api('/api/projects', { name: name.value.trim() });
    openProject(r.id);
  };
  app.replaceChildren(h('div', { class: 'center' }, h('div', { class: 'card wide' },
    h('div', { class: 'row' }, h('div', { class: 'brand grow' }, h('img', { src: 'icon.svg', alt: '' }), h('h1', {}, 'Bonjour ' + S.name)),
      h('button', { class: 'ghost', onclick: openHelp }, '? Aide'), h('button', { class: 'ghost', onclick: openSettings }, 'Réglages'),
      h('button', { class: 'ghost', onclick: logout }, S.mode.public ? 'Se déconnecter' : 'Changer de nom')),
    list.length ? h('p', { class: 'muted' }, 'Choisis un scénario :') : h('p', { class: 'muted' }, 'Aucun scénario pour l\'instant. Crée le premier, tu pourras ensuite y importer un PDF.'),
    h('div', { class: 'plist' }, list.map((p) => h('div', { class: 'pitem', onclick: () => openProject(p.id) },
      h('div', { class: 'grow' }, h('b', {}, p.name), h('div', { class: 'muted small' },
        `${plural(p.chapters, 'chapitre')} · modifié ${fmt(p.updated)}`)),
      S.mode.public && !S.settings.host ? null : h('button', { class: 'ghost small danger', title: 'Supprimer ce scénario', onclick: async (e) => {
        e.stopPropagation();
        if (await confirmBox('Supprimer ce scénario ?', `« ${p.name} » disparaîtra pour tout le monde. Une copie reste dans le dossier « corbeille » de la machine hôte.`, 'Supprimer', 'danger')) {
          await api(`/api/project/${p.id}/delete`, {}); pickerScreen();
        }
      } }, 'Supprimer')))),
    h('form', { class: 'row', onsubmit: create }, name, h('button', { class: 'primary' }, '+ Nouveau scénario')))));
}

async function openProject(pid) {
  try {
    S.pid = pid;
    await loadProject();
    localStorage.setItem('ws_project', pid);
    connect();
    render();
  } catch (e) {
    S.pid = ''; S.project = null; localStorage.removeItem('ws_project');
    if (S.token) { toast(e.message, true); render(); }
  }
}

async function loadProject() {
  const p = await api(`/api/project/${S.pid}`);
  S.presence = p.presence || S.presence;
  S.aiRunning = p.ai_job ? p.ai_job.by : null;
  S.project = p;
  if (!chapter(S.chapterId)) S.chapterId = p.chapters[0]?.id || '';
  resetEditor();
}

async function closeProject() {
  await leaveEditor();
  stopEvents();
  S.pid = ''; S.project = null; S.view = 'script';
  localStorage.removeItem('ws_project');
  render();
}

// Flux temps réel. Chaque connexion s'ouvre avec un ticket à usage unique (le jeton
// de session ne passe jamais dans une adresse), donc on gère nous-mêmes la reconnexion.
let esRun = 0, esTimer = null;
function stopEvents() {
  esRun++;
  clearTimeout(esTimer);
  if (es) es.close();
  es = null;
}
function connect() {
  stopEvents();
  const run = esRun, pid = S.pid;
  let lost = false;
  const retry = () => {
    if (run !== esRun) return;
    if (es) es.close();
    lost = true; S.online = false; drawTop();
    clearTimeout(esTimer);
    esTimer = setTimeout(open, 2500);
  };
  const open = async () => {
    if (run !== esRun || !S.token) return;
    let ticket;
    try { ticket = (await api('/api/ticket', {})).ticket; } catch (e) { if (e.status !== 401) retry(); return; }
    if (run !== esRun) return;
    es = new EventSource(`/api/events?ticket=${ticket}&project=${pid}&cid=${S.cid}`);
    es.onopen = async () => {
      S.online = true;
      if (lost && S.project) { lost = false; await safeReload(); }
      drawTop();
    };
    es.onerror = retry;
    es.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  };
  open();
}

// Recharge le scénario depuis le serveur sans jamais jeter un texte non enregistré :
// on l'enregistre d'abord (en cas de conflit il part dans Versions). Si le serveur
// ne répond toujours pas, on ne touche pas à l'écran et l'enregistrement réessaiera.
async function safeReload() {
  if (ED.dirty) await saveNow();
  if (ED.dirty) return false;
  try { await loadProject(); workspace(); return true; } catch (e) { return false; }
}

function onEvent(ev) {
  const p = S.project;
  if (!p) return;
  switch (ev.t) {
    case 'presence':
      S.presence = ev; drawTop(); drawChapters(); applyLock(); break;
    case 'chapter': {
      const i = p.chapters.findIndex((c) => c.id === ev.chapter.id);
      if (i < 0) break;
      const old = p.chapters[i], next = ev.chapter;
      // Un événement en retard ne doit jamais écraser un texte plus récent.
      if (next.rev < old.rev) { next.text = old.text; next.rev = old.rev; }
      if ((next.draft_rev || 1) < (old.draft_rev || 1)) { next.draft = old.draft; next.draft_rev = old.draft_rev; }
      p.chapters[i] = next;
      drawChapters();
      if (next.id === S.chapterId) { drawEdHead(); syncEditor(); drawSide(); }
      break;
    }
    case 'chapters': {
      const mine = cur();
      p.chapters = ev.chapters.map((c) => (mine && c.id === mine.id && c.rev < mine.rev ? { ...c, text: mine.text, rev: mine.rev } : c));
      if (!chapter(S.chapterId)) { S.chapterId = p.chapters[0]?.id || ''; resetEditor(); drawView(); } else drawChapters();
      break;
    }
    case 'characters': p.characters = ev.characters; if (S.view === 'chars') drawView(); break;
    case 'notes': p.notes = ev.notes; drawSide(); drawChapters(); if (ED.mode === 'read') drawEdBody(); break;
    case 'ideas': p.ideas = ev.ideas; if (S.view === 'ideas') drawView(); break;
    case 'chat':
      if (!p.chat.some((m) => m.id === ev.msg.id)) p.chat.push(ev.msg);
      if (!S.chatOpen && ev.msg.sender !== S.name) S.unread++;
      drawChat(); break;
    case 'analysis': p.analysis = ev.analysis; S.aiRunning = null; toast('Analyse IA terminée : onglet Analyse.'); if (S.view === 'analysis') drawView(); break;
    case 'ai':
      S.aiRunning = ev.state === 'running' ? ev.by : null;
      if (ev.state === 'error') toast('Analyse IA : ' + ev.message, true);
      if (S.view === 'analysis') drawView(); break;
    case 'reload': safeReload().then((ok) => { if (ok && ev.by !== S.name) toast(`${ev.by} vient d'importer un texte.`); }); break;
    case 'project': p.name = ev.name; drawTop(); break;
    case 'deleted': toast('Ce scénario a été supprimé.'); closeProject(); break;
    case 'settings': loadSettings().then(() => drawView()); break;
  }
}

async function loadSettings() { try { S.settings = await api('/api/settings'); } catch (e) { /* hors ligne */ } }

// ============================================================ espace de travail
function workspace() {
  app.replaceChildren(h('div', { id: 'shell' }, h('header', { id: 'top' }), h('main', { id: 'main' })),
    h('button', { id: 'chatbtn', title: 'Discussion', onclick: () => { S.chatOpen = !S.chatOpen; S.unread = 0; drawChat(); } }),
    h('div', { id: 'chatbox' }));
  drawTop(); drawView(true); drawChat();
}

function drawTop() {
  const top = $('#top');
  if (!top) return;
  const tab = (id, label) => h('button', { class: S.view === id ? 'on' : '', onclick: () => setView(id) }, label);
  top.replaceChildren(
    h('img', { class: 'logo', src: 'icon.svg', alt: '' }),
    h('span', { class: 'pname', title: 'Renommer le scénario', onclick: async () => {
      const name = await promptBox('Renommer le scénario', 'Titre', S.project.name);
      if (name) act('project.rename', { name });
    } }, S.project.name),
    h('div', { class: 'tabs' }, tab('script', 'Scénario'), tab('chars', 'Personnages'), tab('ideas', 'Idées'), tab('analysis', 'Analyse')),
    h('span', { class: 'grow' }),
    S.online ? null : h('span', { class: 'offline' }, 'Reconnexion…'),
    h('div', { class: 'avatars', title: 'Connectés : ' + S.presence.users.map((u) => u.name).join(', ') },
      S.presence.users.map((u) => h('span', { class: 'avatar', style: `background:${u.color}`, title: u.name }, u.name.slice(0, 2).toUpperCase()))),
    h('button', { class: 'ghost', onclick: openExport }, 'Exporter'),
    h('button', { class: 'ghost', onclick: closeProject, title: 'Changer de scénario' }, 'Scénarios'),
    h('button', { class: 'ghost', onclick: openHelp, title: 'Mode d\'emploi' }, '?'),
    h('button', { class: 'ghost', onclick: openSettings, title: 'Réglages' }, '⚙'),
    h('button', { class: 'ghost', title: 'Thème clair / sombre', onclick: toggleTheme }, '◐'));
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem('ws_theme', dark ? 'dark' : 'light');
}

async function setView(view) {
  if (view === S.view) return;
  await leaveEditor();
  S.view = view;
  drawTop(); drawView(true);
}

function drawView(force) {
  const main = $('#main');
  if (!main) return;
  if (S.view === 'script') { pending.delete('view'); return drawScript(); }
  const draw = () => {
    if (S.view === 'chars') drawChars(main);
    else if (S.view === 'ideas') drawIdeas(main);
    else if (S.view === 'analysis') drawAnalysis(main);
  };
  // Changement d'onglet : on dessine tout de suite, même si le curseur était dans un champ.
  if (force === true) { pending.clear(); draw(); } else guarded('view', main, draw);
}

// ============================================================ scénario : chapitres
function drawScript() {
  const typed = ED.dirty && $('#ta') ? $('#ta').value : null;
  $('#main').replaceChildren(h('div', { class: 'script' },
    h('nav', { id: 'chapters' }),
    h('section', { id: 'editor' }, h('div', { id: 'edhead' }), h('div', { id: 'edbanner', class: 'hidden' }), h('div', { id: 'edbody' })),
    h('aside', { id: 'side' })));
  drawChapters(); drawEdHead(); drawEdBody(typed); drawSide(); applyLock();
}

let dragId = null;
function drawChapters() {
  const nav = $('#chapters');
  if (!nav || S.view !== 'script') return;
  const p = S.project;
  const scroll = $('#chlist')?.scrollTop || 0;
  nav.replaceChildren(
    h('div', { class: 'head' },
      h('button', { class: 'primary grow', onclick: addChapter }, '+ Chapitre'),
      h('button', { onclick: openImport, title: 'Importer un PDF ou un texte' }, 'Importer')),
    h('div', { id: 'chlist' }, p.chapters.length ? p.chapters.map((c, i) => {
      const lock = S.presence.locks['c:' + c.id] || S.presence.locks['d:' + c.id];
      const notes = p.notes.filter((n) => n.chapter === c.id && !n.resolved).length;
      return h('div', { class: 'ch' + (c.id === S.chapterId ? ' on' : ''), draggable: true,
        onclick: () => { $('.script')?.classList.remove('list'); openChapter(c.id); },
        ondragstart: () => { dragId = c.id; },
        ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); },
        ondragleave: (e) => e.currentTarget.classList.remove('over'),
        ondrop: (e) => {
          e.preventDefault(); e.currentTarget.classList.remove('over');
          if (!dragId || dragId === c.id) return;
          const ids = p.chapters.map((x) => x.id).filter((x) => x !== dragId);
          ids.splice(ids.indexOf(c.id), 0, dragId);
          act('chapter.order', { ids });
        } },
        h('span', { class: 'n' }, i + 1),
        h('span', { class: 't', title: c.title }, c.title || 'Sans titre'),
        h('div', { class: 'm' },
          h('span', { class: 'dot', style: `background:${STATUS_COLOR[c.status] || '#999'}`, title: c.status }),
          c.stars ? h('span', { style: 'color:var(--star)' }, '★'.repeat(c.stars)) : null,
          notes ? h('span', { title: 'Annotations ouvertes' }, '✎ ' + notes) : null,
          lock ? h('span', { class: 'who', style: `background:${colorFor(lock.name)}` }, lock.cid === S.cid ? 'toi' : lock.name) : null));
    }) : h('p', { class: 'muted', style: 'padding:14px' }, 'Pas encore de chapitre. Importe un PDF ou crée le premier.')));
  $('#chlist').scrollTop = scroll;
}

async function addChapter() {
  const title = await promptBox('Nouveau chapitre', 'Titre du chapitre', `Chapitre ${S.project.chapters.length + 1}`, 'Créer');
  if (title === null) return;
  const r = await act('chapter.add', { title, after: S.chapterId });
  if (!chapter(r.chapter.id)) S.project.chapters.push(r.chapter);
  openChapter(r.chapter.id);
}

// ============================================================ scénario : éditeur partagé
function resetEditor() {
  clearTimeout(ED.timer);
  const c = cur();
  if (ED.pane === 'versions' || !c) ED.pane = 'text';
  ED.key = c ? (ED.pane === 'draft' ? 'd:' : 'c:') + c.id : '';
  ED.baseRev = c ? (ED.pane === 'draft' ? c.draft_rev || 1 : c.rev) : 0;
  ED.dirty = false; ED.hasLock = false; ED.noteDraft = null;
}
const edText = (c) => (ED.pane === 'draft' ? c.draft || '' : c.text);

async function leaveEditor() {
  clearTimeout(ED.timer);
  if (ED.dirty) await saveNow();
  if (ED.hasLock) { ED.hasLock = false; op('lock.release', { key: ED.key }).catch(() => {}); }
}

async function openChapter(id, pane) {
  if (id === S.chapterId && (!pane || pane === ED.pane)) return;
  await leaveEditor();
  S.chapterId = id;
  ED.pane = pane || 'text';
  resetEditor();
  ED.pane = pane || 'text';
  if (S.view !== 'script') { S.view = 'script'; drawTop(); }
  drawScript();
}

async function setPane(pane) {
  if (pane === ED.pane) return;
  await leaveEditor();
  ED.pane = pane;
  const keep = pane;
  resetEditor();
  ED.pane = keep;
  if (keep === 'versions') ED.key = '';
  drawEdHead(); drawEdBody(); applyLock();
}

function setSave(state) {
  const el = $('#savestate');
  if (!el) return;
  el.className = 'save' + (state === 'error' ? ' err' : '');
  el.textContent = { saving: 'Enregistrement…', saved: 'Enregistré ✓', error: 'Non enregistré !', dirty: 'Modifié…' }[state] || '';
}

function drawEdHead() {
  const head = $('#edhead');
  if (!head) return;
  const c = cur();
  if (!c) { head.replaceChildren(); return; }
  guarded('edhead', head, () => {
    const ai = S.settings.ai;
    const aiTip = ai ? '' : 'IA inactive : l\'hôte doit saisir une clé API dans Réglages';
    const paneBtn = (id, label) => h('button', { class: ED.pane === id ? 'on' : '', onclick: () => setPane(id) }, label);
    const writing = ED.pane !== 'versions';
    head.replaceChildren(
      h('div', { class: 'row' },
        h('button', { class: 'ghost small', title: 'Liste des chapitres', onclick: () => $('.script').classList.toggle('list') }, '☰'),
        h('input', { class: 'title grow', type: 'text', value: c.title, maxLength: 160, spellcheck: true, lang: 'fr',
          onchange: (e) => act('chapter.meta', { id: c.id, title: e.target.value.trim() || 'Sans titre' }) }),
        stars(c.stars, (n) => act('chapter.meta', { id: c.id, stars: n })),
        h('select', { title: 'État du chapitre', onchange: (e) => act('chapter.meta', { id: c.id, status: e.target.value }) },
          STATUSES.map((s) => h('option', { value: s, selected: s === c.status }, s))),
        h('button', { class: 'ghost small danger', title: 'Supprimer ce chapitre', onclick: deleteChapter }, 'Supprimer')),
      h('div', { class: 'toolbar' },
        h('div', { class: 'tabs' }, paneBtn('text', 'Texte'), paneBtn('draft', 'Brouillon' + ((c.draft || '').trim() ? ' •' : '')), paneBtn('versions', `Versions (${c.nver || 0})`)),
        writing ? [
          h('span', { class: 'sep' }),
          h('div', { class: 'tabs' },
            h('button', { class: ED.mode === 'write' ? 'on' : '', onclick: () => setMode('write') }, 'Écrire'),
            h('button', { class: ED.mode === 'read' ? 'on' : '', onclick: () => setMode('read'), title: 'Aperçu mis en page façon scénario' }, 'Lire')),
          ED.mode === 'write' ? [
            h('span', { class: 'sep' }),
            h('button', { class: 'small', title: 'Transformer la ligne en intitulé de scène (INT./EXT.)', onclick: () => formatLine('scene') }, 'Scène'),
            h('button', { class: 'small', title: 'Transformer la ligne en nom de personnage', onclick: () => formatLine('character') }, 'Personnage'),
            h('button', { class: 'small', title: 'Mettre la ligne entre parenthèses (indication de jeu)', onclick: () => formatLine('paren') }, '(Jeu)'),
            h('button', { class: 'small', title: 'Transformer la ligne en transition', onclick: () => formatLine('transition') }, 'Transition')] : null,
          h('span', { class: 'sep' }),
          h('button', { class: 'small', title: 'Annoter le passage sélectionné', onclick: annotateSelection }, '✎ Annoter'),
          h('button', { class: 'small', disabled: !ai, title: aiTip || 'Corriger l\'orthographe avec l\'IA', onclick: () => aiChapter('correct') }, 'Orthographe'),
          h('button', { class: 'small', disabled: !ai, title: aiTip || 'Demander une réécriture à l\'IA', onclick: aiRewrite }, 'Réécrire'),
          h('button', { class: 'small', disabled: !ai, title: aiTip || 'Avis de lecture de l\'IA', onclick: () => aiChapter('feedback') }, 'Avis'),
          ED.pane === 'draft' ? [
            h('span', { class: 'sep' }),
            h('button', { class: 'small', title: 'Copier le texte du chapitre dans le brouillon', onclick: copyToDraft }, 'Partir du texte'),
            h('button', { class: 'small primary', title: 'Le brouillon devient le texte du chapitre (l\'ancien texte reste dans Versions)', onclick: applyDraft }, 'Adopter ce brouillon')] : null,
          h('span', { class: 'grow' }),
          h('span', { id: 'savestate', class: 'save' }, ED.dirty ? 'Modifié…' : ''),
        ] : [h('span', { class: 'grow' }), h('button', { class: 'small', onclick: snapshot }, 'Enregistrer une version nommée')]));
  });
}

async function setMode(mode) {
  if (ED.mode === mode) return;
  if (ED.dirty) await saveNow();
  ED.mode = mode;
  drawEdHead(); drawEdBody(); applyLock();
}

function drawEdBody(typed) {
  const body = $('#edbody');
  if (!body) return;
  const c = cur();
  if (!c) {
    body.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'Bienvenue dans « ' + S.project.name + ' »'),
      h('p', {}, 'Importe ton scénario en PDF : il sera découpé en chapitres et les personnages seront repérés.'),
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'primary', onclick: openImport }, 'Importer un PDF'), h('button', { onclick: addChapter }, 'Commencer une page blanche'))));
    return;
  }
  if (ED.pane === 'versions') return drawVersions(body, c);
  if (ED.mode === 'read') {
    body.replaceChildren(h('div', { class: 'page' }, readView(edText(c), c)));
    return;
  }
  const ta = h('textarea', { id: 'ta', spellcheck: true, lang: 'fr', autocapitalize: 'sentences',
    placeholder: ED.pane === 'draft'
      ? 'Brouillon partagé de ce chapitre : essayez une réécriture ici sans toucher au texte. Quand elle vous plaît : « Adopter ce brouillon ».'
      : 'Écris ici. Un intitulé de scène commence par INT. ou EXT. ; un nom en MAJUSCULES seul sur sa ligne annonce une réplique.',
    oninput: onInput,
    onkeydown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow().then(() => toast('Enregistré.')); } } });
  ta.value = typeof typed === 'string' ? typed : edText(c);
  body.replaceChildren(h('div', { class: 'page' }, ta));
  growTa();
}

// La zone de texte prend la hauteur de son contenu : c'est la page qui défile.
function growTa() {
  const ta = $('#ta'), body = $('#edbody');
  if (!ta || !body) return;
  const scroll = body.scrollTop;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 40 + 'px';
  body.scrollTop = scroll;
}
window.addEventListener('resize', growTa);

function readView(text, c) {
  const notes = S.project.notes.filter((n) => n.chapter === c.id && !n.resolved && n.quote)
    .map((n) => ({ n, needle: n.quote.split('\n')[0].trim(), used: false })).filter((x) => x.needle.length > 2);
  const withMarks = (line) => {
    for (const x of notes) {
      const i = x.used ? -1 : line.indexOf(x.needle);
      if (i >= 0) {
        x.used = true;
        return [line.slice(0, i), h('mark', { class: x.n.color, 'data-note': x.n.id, title: `${x.n.author} : ${x.n.text}`,
          onclick: () => focusNote(x.n.id) }, x.needle), line.slice(i + x.needle.length)];
      }
    }
    return line;
  };
  const tokens = SP.parse(text);
  if (!text.trim()) return h('div', { class: 'read muted' }, 'Rien à lire pour l\'instant.');
  return h('div', { class: 'read', lang: 'fr' }, tokens.filter((t) => t.type !== 'blank').map((t) => h('div', { class: t.type }, withMarks(t.text))));
}

function onInput() {
  ED.dirty = true; ED.lastInput = Date.now();
  growTa();
  setSave('dirty');
  if (!ED.hasLock) acquire();
  clearTimeout(ED.timer);
  ED.timer = setTimeout(saveNow, 1100);
}

async function acquire(steal) {
  const key = ED.key;
  ED.hasLock = true;
  try {
    const r = await op('lock.acquire', { key, steal });
    if (!r.ok && key === ED.key) { ED.hasLock = false; toast(`${r.holder} écrit déjà ici.`); }
  } catch (e) { /* le prochain enregistrement réessaiera */ }
}

async function saveNow() {
  clearTimeout(ED.timer);
  if (ED.saving) await ED.saving;
  const ta = $('#ta');
  if (!ED.dirty || !ta) return;
  const text = ta.value, id = S.chapterId, pane = ED.pane;
  ED.dirty = false;
  setSave('saving');
  ED.saving = (async () => {
    try {
      const r = await op(pane === 'draft' ? 'draft.save' : 'chapter.save', { id, text, base_rev: ED.baseRev });
      const c = chapter(id);
      if (c) {
        if (pane === 'draft') { c.draft = text; c.draft_rev = r.rev; } else { c.text = text; c.rev = r.rev; c.updated_by = S.name; c.updated_at = Date.now(); }
      }
      if (S.chapterId === id && ED.pane === pane) { ED.baseRev = r.rev; ED.hasLock = true; }
      setSave(ED.dirty ? 'dirty' : 'saved');
    } catch (e) {
      if (e.status === 409 || e.status === 423) await conflict(id, pane, text, e);
      else if (e.status === 404) {
        await op('idea.add', { text: "Texte récupéré d'un chapitre supprimé pendant que j'y écrivais :\n\n" + text.slice(0, 5800), color: 'rose' }).catch(() => {});
        toast("Ce chapitre a été supprimé. Ton texte est gardé dans l'onglet Idées.", true);
      }
      else { ED.dirty = true; setSave('error'); ED.timer = setTimeout(saveNow, 4000); }
    } finally { ED.saving = null; }
  })();
  await ED.saving;
}

// Deux personnes ont écrit en même temps : on ne perd rien, le texte refusé part dans Versions.
async function conflict(id, pane, text, e) {
  const c = chapter(id);
  const serverText = e.data.chapter ? (pane === 'draft' ? e.data.chapter.draft : e.data.chapter.text) : c && edText(c);
  if (text !== serverText) {
    await op('chapter.stash', { id, text, label: `Copie de secours de ${S.name}` }).catch(() => {});
    toast('Quelqu\'un a modifié ce passage en même temps que toi. Ton texte est gardé dans l\'onglet Versions.', true);
  }
  if (e.data.chapter && c) Object.assign(c, e.data.chapter);
  if (S.chapterId === id && ED.pane === pane) {
    ED.hasLock = false;
    const fresh = chapter(id);
    ED.baseRev = pane === 'draft' ? fresh.draft_rev || 1 : fresh.rev;
    const ta = $('#ta');
    if (ta) { ta.value = edText(fresh); growTa(); }
    setSave('');
    applyLock();
  }
}

// Le texte du chapitre a changé côté serveur : on met à jour l'écran si on n'est pas en train d'écrire.
function syncEditor() {
  const c = cur();
  if (!c || ED.pane === 'versions') { if (ED.pane === 'versions') drawEdBody(); return; }
  const rev = ED.pane === 'draft' ? c.draft_rev || 1 : c.rev;
  if (rev === ED.baseRev || ED.dirty) return;
  ED.baseRev = rev;
  const ta = $('#ta');
  if (ta) {
    if (ta.value !== edText(c)) {
      const { scrollTop, selectionStart, selectionEnd } = ta;
      const body = $('#edbody'), bodyScroll = body.scrollTop;
      ta.value = edText(c);
      growTa();
      ta.scrollTop = scrollTop; body.scrollTop = bodyScroll;
      if (document.activeElement === ta) ta.setSelectionRange(selectionStart, selectionEnd);
    }
  } else drawEdBody();
}

function applyLock() {
  const banner = $('#edbanner');
  if (!banner) return;
  const lock = ED.key ? S.presence.locks[ED.key] : null;
  const other = lock && lock.cid !== S.cid ? lock : null;
  const ta = $('#ta');
  if (ta) ta.readOnly = !!other;
  if (other && ED.hasLock) { ED.hasLock = false; if (ED.dirty) saveNow(); }
  banner.classList.toggle('hidden', !other);
  if (other) {
    banner.replaceChildren(chip(other.name), h('span', { class: 'grow' }, ' écrit ici en ce moment. Tu vois son texte arriver en direct.'),
      h('button', { class: 'small', title: 'À utiliser si la personne a fini mais que le chapitre reste bloqué',
        onclick: async () => { await acquire(true); const t = $('#ta'); if (t) { t.readOnly = false; t.focus(); } } }, 'Prendre la main'));
  }
}

setInterval(() => {
  if (!ED.hasLock || !S.project) return;
  if (Date.now() - ED.lastInput < 75_000) op('lock.acquire', { key: ED.key }).catch(() => {});
  else if (!ED.dirty) { ED.hasLock = false; op('lock.release', { key: ED.key }).catch(() => {}); }
}, 15_000);

window.addEventListener('beforeunload', () => {
  const ta = $('#ta');
  if (ED.dirty && ta && S.pid) {
    api(`/api/project/${S.pid}/op`, { op: ED.pane === 'draft' ? 'draft.save' : 'chapter.save', id: S.chapterId, text: ta.value, base_rev: ED.baseRev, keepalive: true }).catch(() => {});
  }
});

function formatLine(kind) {
  const ta = $('#ta');
  if (!ta || ta.readOnly) return;
  const v = ta.value, pos = ta.selectionStart;
  const start = v.lastIndexOf('\n', pos - 1) + 1;
  let end = v.indexOf('\n', pos);
  if (end < 0) end = v.length;
  let line = v.slice(start, end).trim();
  const blankBefore = start === 0 || v.slice(0, start).endsWith('\n\n') ? '' : '\n';
  if (kind === 'scene') {
    line = line.toUpperCase();
    if (!SP.isScene(line)) line = 'INT. ' + (line || 'LIEU – JOUR');
    line = blankBefore + line + (v.slice(end, end + 2) === '\n\n' || end === v.length ? '' : '\n');
  } else if (kind === 'character') {
    line = blankBefore + (line.toUpperCase() || 'PERSONNAGE');
  } else if (kind === 'paren') {
    line = '(' + (line.replace(/^\(|\)$/g, '') || 'un temps') + ')';
  } else if (kind === 'transition') {
    line = blankBefore + (line.toUpperCase().replace(/\s*:$/, '') || 'COUPE À') + ' :';
  }
  ta.focus();
  ta.setSelectionRange(start, end);
  // insertText garde le « annuler » (Ctrl+Z) du navigateur.
  if (!document.execCommand('insertText', false, line)) { ta.setRangeText(line, start, end, 'end'); onInput(); }
}

async function deleteChapter() {
  const c = cur();
  if (!c || !(await confirmBox('Supprimer ce chapitre ?', `« ${c.title} » et ses annotations seront retirés pour tout le monde.`, 'Supprimer', 'danger'))) return;
  ED.dirty = false;
  await act('chapter.delete', { id: c.id });
}

async function copyToDraft() {
  const c = cur();
  if ((c.draft || '').trim() && !(await confirmBox('Remplacer le brouillon ?', 'Le brouillon actuel sera remplacé par une copie du texte du chapitre.', 'Remplacer'))) return;
  await putInDraft(c.text);
}

async function putInDraft(text) {
  const c = cur();
  await leaveEditor();
  try {
    const r = await op('draft.save', { id: c.id, text, base_rev: c.draft_rev || 1 });
    c.draft = text; c.draft_rev = r.rev;
    op('lock.release', { key: 'd:' + c.id }).catch(() => {});
  } catch (e) { toast(e.status === 423 ? e.message + ' Réessaie quand le brouillon est libre.' : e.message, true); return; }
  ED.pane = 'draft'; resetEditor(); ED.pane = 'draft'; ED.key = 'd:' + c.id; ED.baseRev = c.draft_rev;
  ED.mode = 'write';
  drawEdHead(); drawEdBody(); applyLock();
}

async function applyDraft() {
  const c = cur();
  await saveNow();
  if (!(await confirmBox('Adopter ce brouillon ?', 'Le brouillon devient le texte du chapitre. Le texte actuel reste disponible dans l\'onglet Versions.', 'Adopter'))) return;
  const r = await act('draft.apply', { id: c.id });
  Object.assign(c, r.chapter);
  toast('Brouillon adopté. L\'ancien texte est dans Versions.');
  setPane('text');
}

async function snapshot() {
  const label = await promptBox('Enregistrer une version', 'Nom de cette version', 'Version du ' + new Date().toLocaleDateString('fr-FR'));
  if (label === null) return;
  await act('chapter.snapshot', { id: S.chapterId, label });
  drawEdBody();
}

async function drawVersions(body, c) {
  body.replaceChildren(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  let versions = [];
  try { versions = (await op('chapter.versions', { id: c.id })).versions; } catch (e) { toast(e.message, true); }
  if (ED.pane !== 'versions' || S.chapterId !== c.id) return;
  body.replaceChildren(h('div', { class: 'vlist' },
    h('p', { class: 'muted' }, 'Chaque réécriture garde l\'ancien texte ici. Rien n\'est jamais perdu : tu peux relire, restaurer, ou envoyer une version dans le brouillon.'),
    versions.length ? versions.slice().reverse().map((v) => {
      const pre = h('pre', { class: 'hidden' }, v.text);
      return h('div', { class: 'vitem' },
        h('div', { class: 'row wrap' }, h('b', {}, v.label || 'Version automatique'), chip(v.by), h('span', { class: 'muted small grow' }, `${fmt(v.at)} · ${v.text.split(/\s+/).filter(Boolean).length} mots`),
          h('button', { class: 'small', onclick: () => pre.classList.toggle('hidden') }, 'Lire'),
          h('button', { class: 'small', onclick: () => putInDraft(v.text) }, 'Mettre dans le brouillon'),
          h('button', { class: 'small', onclick: async () => {
            if (!(await confirmBox('Restaurer cette version ?', 'Le texte actuel du chapitre sera lui aussi gardé dans Versions.', 'Restaurer'))) return;
            const r = await act('chapter.restore', { id: c.id, vid: v.id });
            Object.assign(c, r.chapter);
            setPane('text');
          } }, 'Restaurer')),
        pre);
    }) : h('div', { class: 'empty' }, 'Pas encore de version pour ce chapitre.')));
}

// ============================================================ scénario : annotations
function annotateSelection() {
  const ta = $('#ta');
  let quote = '';
  if (ta && ED.mode === 'write') quote = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  else quote = String(window.getSelection() || '');
  quote = quote.trim().slice(0, 600);
  ED.noteDraft = { quote, color: 'jaune' };
  $('.script')?.classList.add('notes');
  drawSide(true);
  if (!quote) toast('Astuce : sélectionne d\'abord un passage pour l\'accrocher à l\'annotation.');
}

function focusNote(id) {
  $('.script')?.classList.add('notes');
  const el = $(`[data-nid="${id}"]`);
  if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.style.outline = '2px solid var(--accent)'; setTimeout(() => { el.style.outline = ''; }, 1400); }
}

function showQuote(note) {
  const needle = note.quote.split('\n')[0].trim();
  if (!needle) return;
  const ta = $('#ta');
  if (ta && ED.mode === 'write') {
    const i = ta.value.indexOf(needle);
    if (i < 0) return toast('Ce passage a été réécrit depuis.');
    ta.focus(); ta.setSelectionRange(i, i + needle.length);
    // Fait défiler jusqu'à la sélection.
    const lines = ta.value.slice(0, i).split('\n').length;
    $('#edbody').scrollTop = Math.max(0, lines * 23 - 160);
  } else {
    const mark = $(`mark[data-note="${note.id}"]`);
    if (!mark) return toast('Ce passage a été réécrit depuis.');
    mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
    mark.classList.add('flash'); setTimeout(() => mark.classList.remove('flash'), 1400);
  }
}

function drawSide(force) {
  const side = $('#side');
  if (!side || S.view !== 'script') return;
  const c = cur();
  if (!c) { side.replaceChildren(); return; }
  const draw = () => {
    const notes = S.project.notes.filter((n) => n.chapter === c.id).sort((a, b) => a.resolved - b.resolved || b.star - a.star || a.at - b.at);
    const d = ED.noteDraft;
    const text = h('textarea', { placeholder: 'Ta remarque…', spellcheck: true, lang: 'fr' });
    const saveSummary = debounce((v) => op('chapter.meta', { id: c.id, summary: v }).catch((e) => toast(e.message, true)), 700);
    const summary = h('textarea', { placeholder: 'En deux phrases : que se passe-t-il dans ce chapitre ?', spellcheck: true, lang: 'fr',
      oninput: (e) => { autogrow(e.target); saveSummary(e.target.value); } });
    summary.value = c.summary || '';
    side.replaceChildren(
      h('div', { class: 'head' }, h('span', { class: 'grow' }, 'Résumé'),
        h('button', { class: 'small', disabled: !S.settings.ai, title: S.settings.ai ? 'Résumer avec l\'IA' : 'IA inactive', onclick: () => aiChapter('summary') }, 'Résumer'),
        h('button', { class: 'ghost small', onclick: () => $('.script').classList.remove('notes') }, '✕')),
      h('div', { style: 'padding:0 12px' }, h('div', { class: 'box' }, summary)),
      h('div', { class: 'head' }, h('span', { class: 'grow' }, `Annotations (${notes.filter((n) => !n.resolved).length})`),
        d ? null : h('button', { class: 'small', onclick: annotateSelection }, '+ Annoter')),
      h('div', { class: 'scroll' },
        d ? h('div', { class: 'box' },
          d.quote ? h('div', { class: 'quote' }, d.quote) : h('p', { class: 'muted small', style: 'margin:0 0 6px' }, 'Remarque générale sur le chapitre'),
          text,
          h('div', { class: 'row', style: 'margin-top:6px' }, colorPicker(d.color, (col) => { d.color = col; d.text = text.value; drawSide(true); }), h('span', { class: 'grow' }),
            h('button', { class: 'small', onclick: () => { ED.noteDraft = null; drawSide(true); } }, 'Annuler'),
            h('button', { class: 'small primary', onclick: async () => {
              await act('note.add', { chapter: c.id, quote: d.quote, text: text.value, color: d.color });
              ED.noteDraft = null; drawSide(true);
            } }, 'Ajouter'))) : null,
        notes.length || d ? null : h('p', { class: 'muted small' }, 'Sélectionne un passage du texte puis clique « ✎ Annoter » pour laisser une remarque à l\'équipe.'),
        notes.map((n) => {
          const reply = h('input', { type: 'text', placeholder: 'Répondre…', style: 'width:100%;margin-top:8px', onkeydown: (e) => {
            if (e.key === 'Enter' && e.target.value.trim()) { act('note.reply', { id: n.id, text: e.target.value }); e.target.value = ''; e.target.blur(); }
          } });
          return h('div', { class: `box note ${n.color}` + (n.resolved ? ' done' : ''), 'data-nid': n.id },
            n.quote ? h('div', { class: 'quote', title: 'Voir le passage', onclick: () => showQuote(n) }, n.quote) : null,
            h('div', { class: 'meta' }, chip(n.author), fmt(n.at), h('span', { class: 'grow' }),
              h('button', { class: 'ghost small', title: 'Important', style: `color:${n.star ? 'var(--star)' : 'var(--line)'};font-size:16px;padding:0 4px`,
                onclick: () => act('note.update', { id: n.id, star: !n.star }) }, '★'),
              h('button', { class: 'ghost small', title: n.resolved ? 'Rouvrir' : 'Marquer comme traité', onclick: () => act('note.update', { id: n.id, resolved: !n.resolved }) }, n.resolved ? '↺' : '✓'),
              h('button', { class: 'ghost small', title: 'Supprimer', onclick: async () => { if (await confirmBox('Supprimer cette annotation ?', n.text, 'Supprimer', 'danger')) act('note.delete', { id: n.id }); } }, '✕')),
            h('div', { class: 'txt' }, n.text),
            n.replies.map((r) => h('div', { class: 'reply' }, chip(r.author), ' ', h('span', { class: 'muted small' }, fmt(r.at)), h('div', { class: 'txt' }, r.text))),
            n.resolved ? null : reply);
        })));
    if (d && d.text) text.value = d.text;
    autogrow(summary);
    if (d && force) text.focus();
  };
  if (force) draw(); else guarded('side', side, draw);
}

// ============================================================ IA sur un chapitre
function aiResult(title, text, kind) {
  const c = cur();
  const buttons = [{ label: 'Copier', action: async () => { await navigator.clipboard.writeText(text); toast('Copié.'); return false; } }];
  if (kind === 'text') buttons.push({ label: 'Mettre dans le brouillon', class: 'primary', action: async () => {
    if ((c.draft || '').trim() && !(await confirmBox('Remplacer le brouillon ?', 'Le brouillon actuel de ce chapitre sera remplacé par la proposition de l\'IA.', 'Remplacer'))) return false;
    await putInDraft(text);
    toast('Proposition placée dans le brouillon : relis-la, puis « Adopter ce brouillon ».');
  } });
  if (kind === 'summary') buttons.push({ label: 'Enregistrer comme résumé', class: 'primary', action: async () => { await act('chapter.meta', { id: c.id, summary: text }); } });
  if (kind === 'feedback') buttons.push({ label: 'Ajouter aux annotations', class: 'primary', action: async () => { await act('note.add', { chapter: c.id, quote: '', text: 'Avis IA\n\n' + text.slice(0, 3900), color: 'violet' }); } });
  modal(title, h('pre', { class: 'out' }, text), buttons, 'big');
}

async function aiChapter(action, extra = {}) {
  const c = cur();
  await saveNow();
  const labels = { correct: 'Correction orthographique', rewrite: 'Proposition de réécriture', summary: 'Résumé', feedback: 'Avis de lecture' };
  const wait = modal(labels[action], h('p', {}, h('span', { class: 'spinner' }), ' L\'IA lit le chapitre… cela peut prendre une minute.'));
  try {
    const r = await api(`/api/project/${S.pid}/ai`, { action, chapter: c.id, from: ED.pane === 'draft' ? 'draft' : 'text', ...extra });
    wait.close();
    if (action === 'correct' && r.text.trim() === (ED.pane === 'draft' ? c.draft : c.text).trim()) return toast('Aucune faute trouvée.');
    aiResult(labels[action], r.text, r.kind);
  } catch (e) { wait.close(); toast(e.message, true); }
}

function aiRewrite() {
  const input = h('textarea', { style: 'min-height:90px', placeholder: 'Ex. Resserre la scène, rends Paul plus menaçant, et termine sur un silence.', spellcheck: true, lang: 'fr' });
  modal('Réécrire avec l\'IA', [h('label', {}, 'Ta consigne'), input,
    h('p', { class: 'muted small' }, 'La proposition n\'écrase rien : tu pourras la placer dans le brouillon du chapitre.')],
  [{ label: 'Annuler', action: () => {} }, { label: 'Proposer une réécriture', class: 'primary', action: () => { aiChapter('rewrite', { instruction: input.value }); } }]);
}

// ============================================================ personnages
function localStats() { return SP.analyze(S.project.chapters); }

async function detectCharacters(create = true, quiet = false) {
  const stats = localStats();
  const before = S.project.characters.length;
  const r = await act('char.sync', { found: stats.characters.map((c) => ({ name: c.name, lines: c.lines, words: c.words, chapters: c.chapters })), create });
  S.project.characters = r.characters;
  if (!quiet) toast(r.characters.length > before ? `${plural(r.characters.length - before, 'personnage')} ajouté${r.characters.length - before > 1 ? 's' : ''}.` : 'Répliques recomptées, aucun nouveau personnage.');
  if (S.view === 'chars') drawView();
}

function drawChars(main) {
  const p = S.project;
  const chNum = new Map(p.chapters.map((c, i) => [c.id, i + 1]));
  const saveField = debounce((id, fid, patch) => op('char.field', { id, fid, ...patch }).catch((e) => toast(e.message, true)), 600);
  const scroll = main.firstChild?.scrollTop || 0;
  main.replaceChildren(h('div', { class: 'view' }, h('div', { class: 'inner' },
    h('div', { class: 'vhead' }, h('h2', { class: 'grow' }, `Personnages (${p.characters.length})`),
      h('button', { onclick: () => detectCharacters(true), title: 'Relit tout le scénario : ajoute les nouveaux personnages et recompte les répliques' }, 'Détecter dans le texte'),
      h('button', { class: 'primary', onclick: async () => {
        const name = await promptBox('Nouveau personnage', 'Nom', '', 'Créer');
        if (name) { const r = await act('char.add', { name }); p.characters = r.characters; drawView(); }
      } }, '+ Personnage')),
    p.characters.length ? h('div', { class: 'grid' }, p.characters.map((c) => h('div', { class: 'pcard', style: `border-top-color:${c.color}` },
      h('div', { class: 'row' },
        h('input', { class: 'name', type: 'text', value: c.name, maxLength: 60, onchange: (e) => act('char.update', { id: c.id, name: e.target.value.trim() || c.name }) }),
        stars(c.stars, (n) => act('char.update', { id: c.id, stars: n }))),
      h('div', { class: 'row wrap', style: 'margin-top:6px' },
        h('select', { onchange: (e) => act('char.update', { id: c.id, role: e.target.value }) }, ROLES.map((r) => h('option', { value: r, selected: r === c.role }, 'Rôle ' + r))),
        h('span', { class: 'muted small grow' }, c.lines ? `${plural(c.lines, 'réplique')} · ${c.words} mots` : 'Aucune réplique repérée'),
        h('select', { title: 'Autres actions', onchange: async (e) => {
          const v = e.target.value; e.target.value = '';
          if (v === 'del') { if (await confirmBox('Supprimer ce personnage ?', `La fiche de ${c.name} sera retirée pour tout le monde.`, 'Supprimer', 'danger')) act('char.delete', { id: c.id }); }
          else if (v) act('char.merge', { id: c.id, into: v });
        } }, h('option', { value: '' }, '⋯'),
        h('optgroup', { label: 'Fusionner dans (même personnage)' }, p.characters.filter((o) => o.id !== c.id).map((o) => h('option', { value: o.id }, o.name))),
        h('option', { value: 'del' }, 'Supprimer la fiche'))),
      c.chapters.length ? h('div', { class: 'muted small', style: 'margin-top:4px' }, 'Chapitres : ' + c.chapters.map((id) => chNum.get(id)).filter(Boolean).sort((a, b) => a - b).join(', ')) : null,
      (c.aliases || []).length ? h('div', { class: 'muted small' }, 'Aussi appelé : ' + c.aliases.join(', ')) : null,
      c.fields.map((f) => {
        const ta = h('textarea', { rows: 1, spellcheck: true, lang: 'fr', placeholder: '…', oninput: (e) => { autogrow(e.target); saveField(c.id, f.id, { v: e.target.value }); } });
        ta.value = f.v;
        setTimeout(() => autogrow(ta));
        return h('div', { class: 'field' },
          h('div', { class: 'frow' }, h('input', { class: 'k', type: 'text', value: f.k, maxLength: 60, title: 'Renommer cette case', onchange: (e) => act('char.field', { id: c.id, fid: f.id, k: e.target.value }) }),
            h('button', { class: 'ghost small x', title: 'Retirer cette case', onclick: async () => {
              if (!f.v.trim() || await confirmBox('Retirer cette case ?', `« ${f.k} » et son contenu seront supprimés.`, 'Retirer', 'danger')) act('char.field.del', { id: c.id, fid: f.id });
            } }, '✕')),
          ta);
      }),
      h('button', { class: 'ghost small', style: 'margin-top:8px', onclick: async () => {
        const k = await promptBox('Nouvelle case', 'Nom de la case (ex. Secret, Costume, Voix…)', '', 'Ajouter');
        if (k) act('char.field.add', { id: c.id, k });
      } }, '+ Ajouter une case'))))
      : h('div', { class: 'empty' }, h('p', {}, 'Aucun personnage pour l\'instant.'),
        h('p', {}, 'Clique « Détecter dans le texte » : Writer-Share repère les noms en majuscules qui précèdent les répliques.')))));
  main.firstChild.scrollTop = scroll;
}

// ============================================================ idées
function drawIdeas(main) {
  const p = S.project;
  const ideas = p.ideas.slice().sort((a, b) => (S.ideaSort === 'stars' ? b.stars - a.stars || b.at - a.at : b.at - a.at));
  const text = h('textarea', { placeholder: 'Une idée, une piste, une question pour l\'équipe…', spellcheck: true, lang: 'fr' });
  let color = 'jaune';
  const picker = h('span', {});
  const drawPicker = () => picker.replaceChildren(colorPicker(color, (c) => { color = c; drawPicker(); }));
  drawPicker();
  const link = h('select', {}, h('option', { value: '' }, 'Tout le scénario'), p.chapters.map((c, i) => h('option', { value: c.id }, `${i + 1}. ${c.title}`)));
  const scroll = main.firstChild?.scrollTop || 0;
  main.replaceChildren(h('div', { class: 'view' }, h('div', { class: 'inner' },
    h('div', { class: 'vhead' }, h('h2', { class: 'grow' }, 'Idées et brouillons partagés'),
      h('select', { onchange: (e) => { S.ideaSort = e.target.value; drawView(); } },
        h('option', { value: 'recent', selected: S.ideaSort === 'recent' }, 'Les plus récentes'), h('option', { value: 'stars', selected: S.ideaSort === 'stars' }, 'Les mieux notées'))),
    h('div', { class: 'composer' }, text, h('div', { class: 'row wrap' }, picker, h('span', { class: 'muted small' }, 'Concerne :'), link, h('span', { class: 'grow' }),
      h('button', { class: 'primary', onclick: async () => {
        if (!text.value.trim()) return text.focus();
        const r = await act('idea.add', { text: text.value, color, chapter: link.value });
        p.ideas = r.ideas; text.value = ''; text.blur(); drawIdeas(main);
      } }, 'Partager l\'idée'))),
    ideas.length ? h('div', { class: 'grid' }, ideas.map((i) => {
      const ch = chapter(i.chapter);
      const body = h('div', { class: 'txt', title: 'Cliquer pour modifier', style: 'cursor:text', onclick: () => {
        const ta = h('textarea', { spellcheck: true, lang: 'fr', onblur: (e) => { if (e.target.value.trim() && e.target.value !== i.text) act('idea.update', { id: i.id, text: e.target.value }); else drawView(); } });
        ta.value = i.text; body.replaceWith(ta); autogrow(ta); ta.focus();
      } }, i.text);
      return h('div', { class: 'idea ' + i.color },
        h('div', { class: 'meta' }, chip(i.author), fmt(i.at), h('span', { class: 'grow' }), stars(i.stars, (n) => act('idea.update', { id: i.id, stars: n })),
          h('button', { class: 'ghost small', title: 'Supprimer', onclick: async () => { if (await confirmBox('Supprimer cette idée ?', i.text.slice(0, 200), 'Supprimer', 'danger')) act('idea.delete', { id: i.id }); } }, '✕')),
        body,
        ch ? h('button', { class: 'ghost small', onclick: () => openChapter(ch.id) }, '→ ' + ch.title) : null,
        (i.replies || []).map((r) => h('div', { class: 'reply' }, chip(r.author), ' ', h('span', { class: 'muted small' }, fmt(r.at)), h('div', { class: 'txt' }, r.text))),
        h('input', { type: 'text', placeholder: 'Rebondir…', style: 'width:100%;margin-top:8px;background:#fff6', onkeydown: (e) => {
          if (e.key === 'Enter' && e.target.value.trim()) { act('idea.reply', { id: i.id, text: e.target.value }); e.target.value = ''; e.target.blur(); }
        } }));
    })) : h('div', { class: 'empty' }, 'Le mur d\'idées est vide. Lance la première !'))));
  main.firstChild.scrollTop = scroll;
}

// ============================================================ analyse
function drawAnalysis(main) {
  const p = S.project, st = localStats(), ai = S.settings.ai;
  const a = p.analysis?.data;
  const top = st.characters.slice(0, 12), max = Math.max(1, ...top.map((c) => c.lines));
  const tile = (value, label) => h('div', { class: 'tile' }, h('b', {}, value), h('span', { class: 'muted small' }, label));
  const list = (items) => h('ul', {}, (items || []).map((x) => h('li', {}, typeof x === 'string' ? x : [h('b', {}, (x.titre || x.partie || x.entre || '') + (x.type ? ` (${x.type})` : '') + (x.chapitres ? ` · chap. ${x.chapitres}` : '') + ' : '), x.description || ''])));
  const section = (title, content) => (content && (!Array.isArray(content) || content.length) ? h('div', { class: 'section' }, h('h3', {}, title), typeof content === 'string' ? h('p', {}, content) : content) : null);
  const question = h('input', { type: 'text', class: 'grow', placeholder: 'Ex. Le retournement du chapitre 7 est-il assez préparé ?', onkeydown: (e) => { if (e.key === 'Enter') ask(); } });
  const ask = async () => {
    if (!question.value.trim()) return;
    S.answer = '…'; const q = question.value; drawAnalysis(main);
    try { S.answer = `Question : ${q}\n\n` + (await api(`/api/project/${S.pid}/ai`, { action: 'ask', question: q })).text; } catch (e) { S.answer = ''; toast(e.message, true); }
    if (S.view === 'analysis') drawAnalysis(main);
  };
  const scroll = main.firstChild?.scrollTop || 0;
  main.replaceChildren(h('div', { class: 'view' }, h('div', { class: 'inner' },
    h('div', { class: 'vhead' }, h('h2', { class: 'grow' }, 'Analyse du scénario')),
    h('div', { class: 'tiles' }, tile(p.chapters.length, 'chapitres'), tile(st.scenes, 'scènes repérées'), tile(st.words.toLocaleString('fr-FR'), 'mots'),
      tile('≈ ' + st.pages, 'pages (≈ minutes)'), tile(`${st.int} / ${st.ext}`, 'intérieurs / extérieurs'), tile(`${st.day} / ${st.night}`, 'jour / nuit'),
      tile(st.words ? Math.round(st.dialogueWords / st.words * 100) + ' %' : '–', 'de dialogues')),
    top.length ? h('div', { class: 'section' }, h('h3', {}, 'Qui parle le plus (nombre de répliques)'),
      h('div', { class: 'bars' }, top.map((c) => [h('span', {}, c.name), h('div', { class: 'bar', style: `width:${c.lines / max * 100}%` }), h('span', { class: 'muted small' }, c.lines)]))) : null,
    top.length && p.chapters.length > 1 ? h('div', { class: 'section' }, h('h3', {}, 'Présence des personnages par chapitre'),
      h('div', { class: 'matrix' }, h('table', {},
        h('tr', {}, h('th', {}, ''), st.perChapter.map((c, i) => h('th', { title: c.title }, i + 1))),
        top.slice(0, 10).map((c) => h('tr', {}, h('td', {}, c.name), st.perChapter.map((pc) => {
          const n = pc.present.get(c.name) || 0, size = n ? Math.min(14, 5 + n) : 0;
          return h('td', { title: n ? `${pc.title} : ${plural(n, 'réplique')}` : '' }, n ? h('span', { class: 'p', style: `width:${size}px;height:${size}px` }) : '');
        })))))) : null,
    h('div', { class: 'section' }, h('h3', {}, 'Lecture par l\'IA : enjeux, arcs, structure'),
      !ai ? h('p', { class: 'muted' }, S.settings.has_key && !S.settings.ai_module ? 'La clé API est enregistrée mais le module « anthropic » manque sur la machine hôte (voir le manuel).'
        : 'IA inactive. La personne qui héberge Writer-Share peut saisir une clé API Anthropic dans Réglages (⚙) ; elle servira à toute l\'équipe.') : null,
      S.aiRunning ? h('p', {}, h('span', { class: 'spinner' }), ` Analyse lancée par ${S.aiRunning} en cours… quelques minutes pour un long métrage. Tu peux continuer à travailler.`)
        : h('div', { class: 'row wrap' },
          h('button', { class: 'primary', disabled: !ai || !p.chapters.length, onclick: runAnalysis }, a ? 'Relancer l\'analyse' : 'Lancer l\'analyse complète'),
          a && a.personnages ? h('button', { disabled: !ai && !a, onclick: fillCharacters, title: 'Complète les cases vides des fiches (description, objectif, obstacle, arc, relations)' }, 'Remplir les fiches personnages') : null,
          p.analysis ? h('span', { class: 'muted small' }, `Analyse du ${fmt(p.analysis.at)} par ${p.analysis.by}`) : null),
      h('div', { class: 'row sub' }, question, h('button', { disabled: !ai, onclick: ask }, 'Demander à l\'IA')),
      S.answer ? h('p', {}, S.answer === '…' ? [h('span', { class: 'spinner' }), ' L\'IA réfléchit…'] : S.answer) : null),
    a ? [
      a.texte_libre ? section('Analyse', a.texte_libre) : null,
      section('Logline', a.logline), section('Synopsis', a.synopsis), section('Genre et ton', a.genre_ton),
      section('Enjeux', a.enjeux?.length ? list(a.enjeux) : null),
      section('Thèmes', a.themes?.length ? list(a.themes) : null),
      section('Structure', a.structure?.length ? list(a.structure) : null),
      a.personnages?.length ? h('div', { class: 'section' }, h('h3', {}, 'Personnages et arcs'), a.personnages.map((c, i) => h('div', { class: i ? 'sub' : '' },
        h('p', {}, h('b', {}, c.nom), ` · ${c.role || ''}${c.fonction ? ' · ' + c.fonction : ''}`),
        h('dl', { class: 'kv' }, [['Description', c.description], ['Objectif', c.objectif], ['Besoin', c.besoin], ['Obstacle', c.obstacle], ['Arc', c.arc], ['Relations', c.relations]]
          .filter(([, v]) => v).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))))) : null,
      section('Relations', a.relations?.length ? list(a.relations) : null),
      section('Rythme', a.rythme), section('Dialogues', a.dialogues),
      section('Forces', a.forces?.length ? list(a.forces) : null),
      section('Faiblesses', a.faiblesses?.length ? list(a.faiblesses) : null),
      section('Incohérences et questions', a.incoherences?.length ? list(a.incoherences) : null),
      section('Pistes de réécriture', a.pistes?.length ? list(a.pistes) : null),
    ] : null)));
  main.firstChild.scrollTop = scroll;
}

async function runAnalysis() {
  try { await api(`/api/project/${S.pid}/ai`, { action: 'analyze' }); S.aiRunning = S.name; if (S.view === 'analysis') drawView(); } catch (e) { toast(e.message, true); }
}

async function fillCharacters() {
  const a = S.project.analysis?.data;
  if (!a?.personnages) return;
  const norm = (s) => s.trim().toUpperCase();
  let filled = 0;
  for (const pc of a.personnages) {
    if (!pc.nom) continue;
    let c = S.project.characters.find((x) => [x.name, ...(x.aliases || [])].some((n) => norm(n) === norm(pc.nom)));
    if (!c) {
      const r = await act('char.add', { name: pc.nom, role: ROLES.includes(pc.role) ? pc.role : 'secondaire' });
      S.project.characters = r.characters;
      c = r.characters.find((x) => norm(x.name) === norm(pc.nom));
    }
    if (!c) continue;
    const map = { Description: [pc.fonction, pc.description].filter(Boolean).join(' – '), Objectif: [pc.objectif, pc.besoin ? 'Besoin : ' + pc.besoin : ''].filter(Boolean).join('\n'), Obstacle: pc.obstacle, Arc: pc.arc, Relations: pc.relations };
    for (const [k, v] of Object.entries(map)) {
      const f = c.fields.find((x) => x.k.toLowerCase() === k.toLowerCase());
      // On ne remplit que les cases vides : ce que l'équipe a écrit reste intact.
      if (v && f && !f.v.trim()) { const r = await act('char.field', { id: c.id, fid: f.id, v }); S.project.characters = r.characters; filled++; }
    }
  }
  toast(filled ? `${plural(filled, 'case')} remplie${filled > 1 ? 's' : ''} dans les fiches personnages.` : 'Les fiches étaient déjà remplies : rien n\'a été écrasé.');
}

// ============================================================ discussion
function drawChat() {
  const btn = $('#chatbtn'), box = $('#chatbox');
  if (!btn || !box) return;
  btn.replaceChildren('💬', S.unread ? h('span', { class: 'badge' }, S.unread) : '');
  if (!S.chatOpen) { box.replaceChildren(); return; }
  const input = $('#chat input');
  const typed = input ? input.value : '';
  const focused = document.activeElement === input;
  const field = h('input', { type: 'text', placeholder: 'Message à l\'équipe…', maxLength: 4000, spellcheck: true, lang: 'fr', value: typed });
  const log = h('div', { id: 'chatlog' }, S.project.chat.length ? S.project.chat.map((m) => h('div', { class: 'msg' + (m.sender === S.name ? ' mine' : '') },
    h('div', { class: 'who', style: `color:${colorFor(m.sender)}` }, m.sender, h('span', { class: 'muted', style: 'font-weight:400' }, ' · ' + fmt(m.at))), h('p', {}, m.text)))
    : h('p', { class: 'muted small' }, 'La discussion de l\'équipe apparaît ici.'));
  box.replaceChildren(h('div', { id: 'chat' }, h('div', { class: 'head' }, 'Discussion · ' + S.presence.users.map((u) => u.name).join(', ')), log,
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const text = field.value.trim();
      if (!text) return;
      field.value = '';
      try { const r = await op('chat.send', { text }); if (!S.project.chat.some((m) => m.id === r.msg.id)) S.project.chat.push(r.msg); drawChat(); $('#chat input').focus(); } catch (err) { field.value = text; toast(err.message, true); }
    } }, field, h('button', { class: 'primary' }, 'Envoyer'))));
  log.scrollTop = log.scrollHeight;
  if (focused || !input) field.focus();
}

// ============================================================ import
function openImport() {
  const state = { text: '', pages: 0, name: '', mode: 'auto', per: 1 };
  const info = h('div', {});
  const fileInput = h('input', { type: 'file', accept: '.pdf,.txt,.fountain,.md,application/pdf,text/plain', class: 'hidden', onchange: (e) => load(e.target.files[0]) });
  const drop = h('div', { class: 'drop', onclick: () => fileInput.click(),
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); load(e.dataTransfer.files[0]); } },
  h('b', {}, 'Dépose ton scénario ici'), h('div', { class: 'muted' }, 'PDF, .txt ou .fountain — ou clique pour choisir un fichier'));
  const paste = h('textarea', { style: 'min-height:80px', placeholder: '…ou colle ton texte ici', oninput: (e) => { state.text = e.target.value; state.name = 'texte collé'; state.pages = 0; preview(); } });
  const hasChapters = S.project.chapters.length > 0;
  const replace = h('input', { type: 'radio', name: 'imode', checked: !hasChapters });
  const detect = h('input', { type: 'checkbox', checked: true });
  const analyze = h('input', { type: 'checkbox', checked: !!S.settings.ai, disabled: !S.settings.ai });

  async function load(file) {
    if (!file) return;
    state.name = file.name;
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        info.replaceChildren(h('p', {}, h('span', { class: 'spinner' }), ' Lecture du PDF…'));
        const r = await SP.readPdf(file, (n, total) => info.replaceChildren(h('p', {}, h('span', { class: 'spinner' }), ` Lecture du PDF… page ${n} / ${total}`)));
        if (r.scanned) {
          state.text = '';
          info.replaceChildren(h('p', { style: 'color:var(--danger)' }, 'Ce PDF ne contient pas de texte : c\'est sans doute un scan (des images de pages). Exporte le scénario en PDF depuis ton logiciel d\'écriture, ou passe-le d\'abord dans un outil de reconnaissance de texte (OCR).'));
          return;
        }
        state.text = r.text; state.pages = r.pages;
      } else { state.text = await file.text(); state.pages = 0; }
      preview();
    } catch (e) { console.error(e); info.replaceChildren(h('p', { style: 'color:var(--danger)' }, 'Impossible de lire ce fichier : ' + e.message)); }
  }

  function preview() {
    if (!state.text.trim()) { info.replaceChildren(); return; }
    const r = SP.splitChapters(state.text, state.mode, state.per);
    const stats = SP.analyze(r.chapters.map((c, i) => ({ id: String(i), ...c })));
    const opt = (id, label) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'split', checked: state.mode === id, onchange: () => { state.mode = id; preview(); } }), h('span', {}, label));
    info.replaceChildren(
      h('p', {}, h('b', {}, state.name), state.pages ? ` · ${state.pages} pages` : '', ` · ${stats.words.toLocaleString('fr-FR')} mots · ${plural(r.found.scenes, 'scène')} repérée${r.found.scenes > 1 ? 's' : ''} · ${plural(stats.characters.filter((c) => c.lines > 1).length, 'personnage')}`),
      h('label', {}, 'Découpage en chapitres'),
      opt('auto', 'Automatique (recommandé)'),
      opt('titres', `Par titres : ACTE, CHAPITRE, SÉQUENCE… (${r.found.titres} trouvés)`),
      h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'split', checked: state.mode === 'scenes', onchange: () => { state.mode = 'scenes'; preview(); } }),
        h('span', {}, 'Par scènes (INT./EXT.), ', h('input', { type: 'number', min: 1, max: 30, value: state.per, style: 'width:64px;padding:2px 6px',
          onchange: (e) => { state.per = Math.max(1, +e.target.value || 1); state.mode = 'scenes'; preview(); } }), ' scène(s) par chapitre')),
      opt('pages', 'Par blocs d\'environ 5 pages'),
      h('p', {}, '→ ', h('b', {}, plural(r.chapters.length, 'chapitre')), ' : ', h('span', { class: 'muted' }, r.chapters.slice(0, 4).map((c) => c.title).join(' · ') + (r.chapters.length > 4 ? ' …' : ''))),
      hasChapters ? [h('label', {}, 'Ce scénario contient déjà des chapitres'),
        h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'imode', checked: true }), h('span', {}, 'Ajouter à la suite')),
        h('label', { class: 'radio' }, replace, h('span', {}, 'Remplacer tout le texte actuel (une copie est gardée sur la machine hôte)'))] : null,
      h('label', { class: 'radio', style: 'margin-top:8px!important' }, detect, h('span', {}, 'Créer les fiches des personnages repérés')),
      h('label', { class: 'radio' }, analyze, h('span', {}, 'Lancer l\'analyse IA (enjeux, arcs, structure)' + (S.settings.ai ? '' : ' — IA inactive'))));
    state.result = r;
  }

  modal('Importer un scénario', [drop, fileInput, paste, info], [
    { label: 'Annuler', action: () => {} },
    { label: 'Importer', class: 'primary', action: async () => {
      if (!state.result?.chapters.length) { toast('Choisis d\'abord un fichier ou colle un texte.', true); return false; }
      await leaveEditor();
      await act('import', { mode: replace.checked ? 'replace' : 'append', chapters: state.result.chapters, source: { name: state.name, pages: state.pages } });
      await loadProject();
      if (detect.checked) await detectCharacters(true, true);
      S.view = 'script'; workspace();
      toast(`${plural(state.result.chapters.length, 'chapitre')} importé${state.result.chapters.length > 1 ? 's' : ''}${detect.checked ? `, ${plural(S.project.characters.length, 'personnage')}` : ''}.`);
      if (analyze.checked && S.settings.ai) runAnalysis();
    } }], 'big');
}

// ============================================================ export
function fullText() {
  return S.project.chapters.map((c, i) => `${'='.repeat(60)}\n${i + 1}. ${c.title}\n${'='.repeat(60)}\n\n${c.text}`).join('\n\n\n');
}
function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
async function openExport() {
  await saveNow();
  const safe = S.project.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'scenario';
  modal('Exporter', h('p', {}, 'Récupère le scénario complet, dans l\'ordre des chapitres.'), [
    { label: 'Fichier texte (.txt)', action: () => download(safe + '.txt', fullText()) },
    { label: 'Fiches personnages (.txt)', action: () => download(safe + ' - personnages.txt', S.project.characters.map((c) => `${c.name.toUpperCase()} (${c.role})\n` + c.fields.filter((f) => f.v.trim()).map((f) => `${f.k} : ${f.v}`).join('\n')).join('\n\n----------\n\n')) },
    { label: 'Imprimer / PDF', class: 'primary', action: printScript }]);
}
function printScript() {
  const w = window.open('', '_blank');
  if (!w) return toast('Autorise les fenêtres pop-up pour imprimer.', true);
  const esc = (s) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  const body = S.project.chapters.map((c, i) => `<h2>${i + 1}. ${esc(c.title)}</h2>` + SP.parse(c.text).filter((t) => t.type !== 'blank').map((t) => `<div class="${t.type}">${esc(t.text)}</div>`).join('')).join('');
  w.document.write(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>${esc(S.project.name)}</title><style>
    @page{margin:2.5cm 2.5cm 2.5cm 3.5cm}body{font:12pt/1.35 "Courier Prime","Courier New",Courier,monospace;color:#000}
    h1{text-align:center;margin:35vh 0 0;page-break-after:always;font-size:18pt}h2{font-size:12pt;text-decoration:underline;margin:2em 0 1em;page-break-after:avoid}
    .scene{font-weight:bold;text-transform:uppercase;margin:1.4em 0 .7em;page-break-after:avoid}.character{margin:1em 0 0 37%;font-weight:bold;page-break-after:avoid}
    .dialogue{margin:0 16% 0 20%}.paren{margin:0 26% 0 29%}.transition{text-align:right;margin:1em 0}.action{margin:.7em 0}.chapter{text-align:center;font-weight:bold;margin:1.5em 0}
  </style><h1>${esc(S.project.name)}</h1>${body}`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

// ============================================================ aide et réglages
function openHelp() {
  const urls = S.settings.urls || [];
  modal('Mode d\'emploi', h('div', { class: 'help' },
    h('h3', {}, 'Se connecter'),
    S.mode.public ? h('ul', {},
      h('li', {}, 'Ouvre ', h('code', {}, location.origin), ' dans Safari, Chrome ou Firefox, sur Mac ou PC : rien à installer.'),
      h('li', {}, 'Première fois : ouvre le lien d\'invitation reçu, choisis ton prénom et ton mot de passe.'),
      h('li', {}, 'Mot de passe oublié : demande un lien de réinitialisation à un administrateur (⚙ Réglages → Équipe).'))
    : h('ol', {},
      h('li', {}, 'La personne qui héberge lance Writer-Share sur son ordinateur et le laisse allumé.'),
      h('li', {}, 'Elle t\'envoie une adresse', urls.length ? [' (', urls.map((u, i) => [i ? ' ou ' : '', h('code', {}, u)]), ')'] : ' du type http://192.168.1.20:8777', ' et le code d\'accès', S.settings.access_code ? [' (', h('code', {}, S.settings.access_code), ')'] : '', '.'),
      h('li', {}, 'Tu ouvres cette adresse dans Safari, Chrome ou Firefox, sur Mac ou PC. Tu tapes ton prénom et le code. C\'est tout : rien à installer.')),
    h('h3', {}, 'Écrire à plusieurs'),
    h('ul', {},
      h('li', {}, 'Tout s\'enregistre tout seul. Un chapitre n\'est écrit que par une personne à la fois : les autres voient le texte arriver en direct et peuvent travailler sur un autre chapitre.'),
      h('li', {}, h('b', {}, 'Brouillon'), ' : chaque chapitre a un brouillon partagé pour tenter une réécriture sans toucher au texte. « Adopter ce brouillon » le fait passer en texte officiel.'),
      h('li', {}, h('b', {}, 'Versions'), ' : l\'ancien texte est gardé à chaque réécriture. Tu peux relire ou restaurer n\'importe quelle version.'),
      h('li', {}, h('b', {}, 'Annoter'), ' : sélectionne un passage, clique « ✎ Annoter ». Les autres peuvent répondre, mettre une étoile, ou marquer comme traité.'),
      h('li', {}, h('b', {}, 'Étoiles'), ' : note les chapitres, les personnages et les idées de 1 à 5.')),
    h('h3', {}, 'Mise en forme du scénario'),
    h('ul', {},
      h('li', {}, 'Une ligne qui commence par ', h('code', {}, 'INT.'), ' ou ', h('code', {}, 'EXT.'), ' est un intitulé de scène.'),
      h('li', {}, 'Un nom en MAJUSCULES seul sur sa ligne, suivi du texte dessous, est une réplique.'),
      h('li', {}, 'Le bouton « Lire » montre la mise en page façon scénario ; « Exporter » permet d\'imprimer ou de faire un PDF.')),
    h('h3', {}, 'Orthographe'),
    h('p', {}, 'Les fautes sont soulignées par ton navigateur (clic droit pour les corrections). Le bouton « Orthographe » demande une correction complète à l\'IA, proposée dans le brouillon.'),
    h('h3', {}, 'Intelligence artificielle'),
    h('p', {}, 'L\'hôte saisit une clé API Anthropic dans Réglages (⚙) : elle sert à toute l\'équipe et ne quitte jamais sa machine. L\'onglet Analyse donne alors enjeux, arcs des personnages, structure, forces et faiblesses.'),
    h('p', { class: 'muted small' }, 'Manuel complet : fichier MANUEL.md dans le dossier de Writer-Share.')), [], 'big');
}

async function openSettings() {
  await loadSettings();
  const s = S.settings;
  if (!s.host) {
    return modal('Réglages', h('div', {},
      h('p', {}, 'IA : ', h('b', {}, s.ai ? `active (${s.model})` : 'inactive')),
      h('p', { class: 'muted' }, s.public ? 'L\'équipe, les invitations et la clé API sont gérées par les administrateurs.'
        : 'Le code d\'accès et la clé API se règlent sur la machine qui héberge Writer-Share, en ouvrant http://localhost:8777 sur cette machine.'),
      h('p', {}, 'Connecté en tant que ', chip(S.name), ' ', h('button', { class: 'small', onclick: () => { document.querySelector('.overlay')?.remove(); logout(); } }, s.public ? 'Se déconnecter' : 'Changer de nom'))));
  }
  if (s.public) return adminSettings(s);
  const key = h('input', { type: 'password', placeholder: s.has_key ? 'Clé enregistrée — laisser vide pour la garder' : 'sk-ant-…', autocomplete: 'off' });
  const model = h('select', {}, [['claude-opus-5-5', 'Claude Opus 5.5 (recommandé)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (plus économique)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (le moins cher)'], ['claude-fable-5-2', 'Claude Fable 5.2 (le plus puissant)']]
    .map(([v, l]) => h('option', { value: v, selected: v === s.model }, l)));
  const code = h('input', { type: 'text', value: s.access_code, autocomplete: 'off', spellcheck: false });
  modal('Réglages de l\'hôte', h('div', {},
    h('label', {}, 'Adresse à donner à l\'équipe'),
    s.urls.length ? s.urls.map((u, i) => h('p', { style: 'margin:2px 0' }, h('code', { class: 'kbd' }, u),
      h('span', { class: 'muted small' }, i === 0 ? '  ← même Wi-Fi / même box' : /\/\/100\./.test(u) ? '  ← à distance, via Tailscale' : '  (autre réseau de cette machine)'))) : h('p', { class: 'muted' }, 'Aucune adresse réseau trouvée : cette machine est-elle connectée ?'),
    h('label', {}, 'Code d\'accès'), code,
    h('p', { class: 'muted small' }, 'Si tu le changes, les personnes déjà connectées le restent ; les nouvelles devront utiliser le nouveau code.'),
    h('label', {}, 'Clé API Anthropic (pour l\'IA)'), key,
    h('p', { class: 'muted small' }, 'La clé se crée sur console.anthropic.com. Elle reste dans le fichier writer_share_data/config.json de cette machine et n\'est jamais envoyée aux autres postes. ',
      s.ai_module ? '' : h('b', { style: 'color:var(--danger)' }, 'Le module « anthropic » n\'est pas installé : relance Writer-Share avec le lanceur, ou tape « pip install anthropic ».')),
    s.has_key ? h('button', { class: 'small danger', onclick: async () => { await api('/api/settings', { api_key: '' }); toast('Clé effacée.'); document.querySelector('.overlay')?.remove(); loadSettings().then(drawView); } }, 'Effacer la clé') : null,
    h('label', {}, 'Modèle'), model), [
    { label: 'Annuler', action: () => {} },
    { label: 'Enregistrer', class: 'primary', action: async () => {
      const body = { model: model.value, access_code: code.value };
      if (key.value.trim()) body.api_key = key.value.trim();
      await api('/api/settings', body);
      await loadSettings();
      if (S.project) { drawView(); }
      toast('Réglages enregistrés.');
    } }]);
}

// Réglages en mode public : équipe, invitations, IA. Réservé aux administrateurs.
function adminSettings(s) {
  const box = h('div', {});
  const linkBox = h('div', {});
  const showLink = (token, text) => {
    const url = `${location.origin}/?invite=${token}`;
    linkBox.replaceChildren(h('div', { class: 'box', style: 'margin-top:10px' },
      h('p', { style: 'margin:0 0 6px' }, text),
      h('div', { class: 'row' }, h('input', { type: 'text', value: url, readOnly: true, onfocus: (e) => e.target.select() }),
        h('button', { class: 'primary', onclick: async () => { await navigator.clipboard.writeText(url); toast('Lien copié.'); } }, 'Copier')),
      h('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Valable 7 jours, utilisable une seule fois. Envoie-le par le canal de ton choix.')));
  };
  const admin = (body) => api('/api/admin', body).catch((e) => { toast(e.message, true); throw e; });
  const draw = () => box.replaceChildren(
    h('label', {}, `Équipe (${s.users.length})`),
    s.users.map((u) => h('div', { class: 'row', style: 'padding:4px 0' }, chip(u.name), u.admin ? h('span', { class: 'muted small' }, 'administrateur') : null, h('span', { class: 'grow' }),
      h('button', { class: 'small', title: 'Crée un lien pour choisir un nouveau mot de passe', onclick: async () => {
        const r = await admin({ action: 'reset', name: u.name });
        showLink(r.invite, `Lien pour que ${u.name} choisisse un nouveau mot de passe :`);
      } }, 'Mot de passe oublié'),
      u.name === S.name ? null : h('button', { class: 'small danger', onclick: async () => {
        if (!(await confirmBox('Retirer ce compte ?', `${u.name} ne pourra plus se connecter. Ses textes, annotations et idées restent dans les scénarios.`, 'Retirer', 'danger'))) return;
        await admin({ action: 'remove', name: u.name });
        await loadSettings(); s = S.settings; draw();
      } }, 'Retirer'))),
    h('div', { class: 'row wrap', style: 'margin-top:8px' },
      h('button', { class: 'primary', onclick: async () => showLink((await admin({ action: 'invite' })).invite, 'Lien d\'invitation pour un nouvel auteur :') }, '+ Inviter un auteur'),
      h('button', { onclick: async () => showLink((await admin({ action: 'invite', admin: true })).invite, 'Lien d\'invitation pour un nouvel administrateur :') }, 'Inviter un administrateur'),
      s.invites ? h('span', { class: 'muted small' }, `${plural(s.invites, 'invitation')} en attente`) : null),
    linkBox);
  draw();
  const key = h('input', { type: 'password', placeholder: s.has_key ? 'Clé enregistrée — laisser vide pour la garder' : 'sk-ant-…', autocomplete: 'off', disabled: s.env_key });
  const model = h('select', {}, [['claude-opus-5-5', 'Claude Opus 5.5 (recommandé)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (plus économique)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (le moins cher)'], ['claude-fable-5-2', 'Claude Fable 5.2 (le plus puissant)']]
    .map(([v, l]) => h('option', { value: v, selected: v === s.model }, l)));
  modal('Réglages', h('div', {}, box,
    h('label', {}, 'Clé API Anthropic (pour l\'IA)'), key,
    h('p', { class: 'muted small' }, s.env_key ? 'La clé est fournie par le serveur (variable ANTHROPIC_API_KEY) : elle se change sur le VPS.'
      : 'La clé reste sur le serveur et n\'est jamais envoyée aux navigateurs. Elle sert à toute l\'équipe.',
    s.ai_module ? '' : h('b', { style: 'color:var(--danger)' }, ' Le module « anthropic » n\'est pas installé sur le serveur.')),
    h('label', {}, 'Modèle'), model,
    h('p', { style: 'margin-top:14px' }, 'Connecté en tant que ', chip(S.name), ' ', h('button', { class: 'small', onclick: () => { document.querySelector('.overlay')?.remove(); logout(); } }, 'Se déconnecter'))), [
    { label: 'Fermer', action: () => {} },
    { label: 'Enregistrer', class: 'primary', action: async () => {
      const body = { model: model.value };
      if (key.value.trim()) body.api_key = key.value.trim();
      await api('/api/settings', body);
      await loadSettings();
      if (S.project) drawView();
      toast('Réglages enregistrés.');
    } }]);
}

// ============================================================ démarrage
async function boot() {
  await loadSettings();
  const last = localStorage.getItem('ws_project');
  if (S.token && last) return openProject(last);
  render();
}
async function start() {
  // Le serveur dit s'il tourne en mode local (code commun) ou public (comptes), et si le lien d'invitation est valable.
  const token = new URLSearchParams(location.search).get('invite') || '';
  try {
    const r = await fetch('/api/mode' + (token ? '?invite=' + encodeURIComponent(token) : ''));
    S.mode = await r.json();
    if (S.mode.public && token) S.invite = { token, ...(S.mode.invite || { ok: false }) };
  } catch (e) { /* serveur injoignable : l'écran de connexion le dira */ }
  if (S.token && !S.invite) boot(); else render();
}
document.documentElement.dataset.theme = localStorage.getItem('ws_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
start();
