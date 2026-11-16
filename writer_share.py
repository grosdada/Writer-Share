#!/usr/bin/env python3
"""Writer-Share : atelier de scenario partage (PC et Mac).

Une seule machine lance ce fichier (l'hote). Tous les autres ouvrent simplement
l'adresse affichee dans leur navigateur, tapent leur prenom et le code d'acces.
Rien a installer chez eux. Le serveur n'utilise que la bibliotheque standard de
Python ; seul le module optionnel `anthropic` est requis pour les fonctions IA.
"""

import argparse
import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import socket
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

APP_VERSION = "1.0.0"
FROZEN = getattr(sys, "frozen", False)
ROOT = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
WEB_DIR = (Path(getattr(sys, "_MEIPASS", ROOT)) if FROZEN else ROOT) / "web"
DATA_DIR = ROOT / "writer_share_data"
PROJECT_DIR = DATA_DIR / "scenarios"
TRASH_DIR = DATA_DIR / "corbeille"
CONFIG_FILE = DATA_DIR / "config.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"
# Mode public (--public) : pour un serveur joignable depuis Internet, derriere un
# proxy HTTPS. Chacun a son compte et son mot de passe ; les reglages sont
# reserves aux administrateurs au lieu de « la machine hote ».
PUBLIC = False
SESSION_DAYS = 30
INVITE_DAYS = 7


def set_data_dir(path):
    global DATA_DIR, PROJECT_DIR, TRASH_DIR, CONFIG_FILE, SESSIONS_FILE
    DATA_DIR = Path(path).expanduser().resolve()
    PROJECT_DIR, TRASH_DIR = DATA_DIR / "scenarios", DATA_DIR / "corbeille"
    CONFIG_FILE, SESSIONS_FILE = DATA_DIR / "config.json", DATA_DIR / "sessions.json"


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 240_000)
    return salt, digest.hex()


def new_invite(config, by, admin=False, reset=""):
    """Cree un lien d'invitation a usage unique (ou de reinitialisation de mot de passe)."""
    token = secrets.token_urlsafe(18)
    config.setdefault("invites", {})[token] = {"by": by, "admin": admin, "reset": reset, "at": now_ms()}
    return token


def valid_invite(config, token):
    invite = config.get("invites", {}).get(token or "")
    if not invite or now_ms() - invite["at"] > INVITE_DAYS * 86_400_000:
        return None
    return invite
DEFAULT_PORT = 8777
DEFAULT_MODEL = "claude-opus-5-5"
MAX_REQUEST_BYTES = 40 * 1024 * 1024
MAX_VERSIONS = 40
LOCK_TTL = 45  # secondes sans signe de vie avant de liberer un chapitre
# Les types sont fixes ici : sous Windows, `mimetypes` lit le registre et peut
# renvoyer text/plain pour .js/.mjs, ce que les navigateurs refusent.
MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8", ".md": "text/plain; charset=utf-8",
    ".woff2": "font/woff2",
}
PALETTE = ["#c2410c", "#0f766e", "#7c3aed", "#be185d", "#1d4ed8", "#4d7c0f", "#b45309", "#0e7490"]
DEFAULT_FIELDS = ["Âge", "Description", "Objectif", "Obstacle", "Arc", "Relations", "Notes"]
WORDS = ["plume", "encre", "scene", "clap", "acte", "role", "decor", "replique", "intrigue", "pitch"]


def now_ms():
    return int(time.time() * 1000)


def new_id():
    return uuid.uuid4().hex[:12]


def color_for(name):
    return PALETTE[sum(name.lower().encode("utf-8")) % len(PALETTE)]


def write_json(path, payload):
    """Ecriture atomique : jamais de fichier a moitie ecrit si le PC s'eteint."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    if os.name == "posix":
        os.chmod(tmp, 0o600)  # ces fichiers contiennent mots de passe haches, jetons et cle API
    os.replace(tmp, path)


def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


class OpError(Exception):
    def __init__(self, status, message, extra=None):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra or {}


# --------------------------------------------------------------------------
# Stockage
# --------------------------------------------------------------------------
class Store:
    def __init__(self):
        for folder in (DATA_DIR, PROJECT_DIR, TRASH_DIR):
            folder.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.config = read_json(CONFIG_FILE, {})
        changed = False
        if not self.config.get("access_code"):
            self.config["access_code"] = f"{secrets.choice(WORDS)}-{secrets.randbelow(9000) + 1000}"
            changed = True
        if not self.config.get("model"):
            self.config["model"] = DEFAULT_MODEL
            changed = True
        if changed:
            self.save_config()
        self.sessions = read_json(SESSIONS_FILE, {})
        self.projects = {}
        for file in PROJECT_DIR.glob("*.json"):
            project = read_json(file, None)
            if isinstance(project, dict) and project.get("id"):
                self.projects[project["id"]] = project
        self.dirty = set()
        threading.Thread(target=self._saver, daemon=True).start()

    def save_config(self):
        write_json(CONFIG_FILE, self.config)

    def save_sessions(self):
        write_json(SESSIONS_FILE, self.sessions)

    def touch(self, pid):
        with self.lock:
            self.dirty.add(pid)

    def flush(self):
        with self.lock:
            pending, self.dirty = self.dirty, set()
            snapshots = {pid: json.dumps(self.projects[pid], ensure_ascii=False)
                         for pid in pending if pid in self.projects}
        for pid, text in snapshots.items():
            path = PROJECT_DIR / f"{pid}.json"
            tmp = path.with_suffix(".json.tmp")
            try:
                tmp.write_text(text, encoding="utf-8")
                os.replace(tmp, path)
            except OSError as exc:
                print("Sauvegarde impossible :", exc)
                self.touch(pid)

    def _saver(self):
        while True:
            time.sleep(1.5)
            self.flush()

    def new_project(self, name, user):
        project = {
            "id": new_id(), "name": name[:120] or "Sans titre", "created": now_ms(),
            "created_by": user, "chapters": [], "characters": [], "notes": [],
            "ideas": [], "chat": [], "analysis": None, "trash": [], "source": None,
        }
        with self.lock:
            self.projects[project["id"]] = project
        self.touch(project["id"])
        return project

    def delete_project(self, pid):
        with self.lock:
            project = self.projects.pop(pid, None)
            self.dirty.discard(pid)
        if project:
            write_json(TRASH_DIR / f"{pid}-{int(time.time())}.json", project)
            (PROJECT_DIR / f"{pid}.json").unlink(missing_ok=True)


# --------------------------------------------------------------------------
# Temps reel : presence, verrous de chapitre, diffusion des evenements (SSE)
# --------------------------------------------------------------------------
class Hub:
    def __init__(self):
        self.lock = threading.RLock()
        self.clients = {}
        self.locks = {}

    def connect(self, cid, name, pid):
        q = queue.Queue(maxsize=500)
        with self.lock:
            self.clients[cid] = {"name": name, "project": pid, "q": q}
        self.send_presence(pid)
        return q

    def disconnect(self, cid, q):
        with self.lock:
            client = self.clients.get(cid)
            if not client or client["q"] is not q:
                return
            del self.clients[cid]
            for key in [k for k, v in self.locks.items() if v["cid"] == cid]:
                del self.locks[key]
        self.send_presence(client["project"])

    def broadcast(self, pid, event, exclude=None):
        with self.lock:
            targets = [c["q"] for cid, c in self.clients.items()
                       if (pid is None or c["project"] == pid) and cid != exclude]
        for q in targets:
            try:
                q.put_nowait(event)
            except queue.Full:
                pass

    def presence(self, pid):
        cutoff = time.time() - LOCK_TTL
        with self.lock:
            for key in [k for k, v in self.locks.items() if v["at"] < cutoff]:
                del self.locks[key]
            users = {}
            for client in self.clients.values():
                if client["project"] == pid:
                    users[client["name"]] = {"name": client["name"], "color": color_for(client["name"])}
            locks = {key[1]: {"name": v["name"], "cid": v["cid"]}
                     for key, v in self.locks.items() if key[0] == pid}
        return {"t": "presence", "users": sorted(users.values(), key=lambda u: u["name"].lower()), "locks": locks}

    def send_presence(self, pid):
        self.broadcast(pid, self.presence(pid))

    def holder(self, pid, key):
        with self.lock:
            entry = self.locks.get((pid, key))
            if entry and entry["at"] < time.time() - LOCK_TTL:
                del self.locks[(pid, key)]
                return None
            return entry

    def acquire(self, pid, key, cid, name, steal=False):
        with self.lock:
            entry = self.holder(pid, key)
            if entry and entry["cid"] != cid and not steal:
                return entry
            self.locks[(pid, key)] = {"cid": cid, "name": name, "at": time.time()}
        return None

    def release(self, pid, key, cid):
        with self.lock:
            entry = self.locks.get((pid, key))
            if entry and entry["cid"] == cid:
                del self.locks[(pid, key)]

    def expire_loop(self):
        while True:
            time.sleep(10)
            cutoff = time.time() - LOCK_TTL
            with self.lock:
                stale = {k[0] for k, v in self.locks.items() if v["at"] < cutoff}
            for pid in stale:
                self.send_presence(pid)


STORE = None
HUB = Hub()


# --------------------------------------------------------------------------
# Operations sur un scenario
# --------------------------------------------------------------------------
def chapter_public(ch):
    out = {k: v for k, v in ch.items() if k != "versions"}
    out["nver"] = len(ch.get("versions", []))
    return out


def project_public(p):
    out = {k: v for k, v in p.items() if k not in ("chapters", "trash")}
    out["chapters"] = [chapter_public(c) for c in p["chapters"]]
    out["chat"] = p["chat"][-200:]
    return out


def find(items, item_id, what="Élément"):
    for item in items:
        if item.get("id") == item_id:
            return item
    raise OpError(404, f"{what} introuvable (peut-être supprimé par quelqu'un d'autre).")


def add_version(ch, user, label=""):
    text = ch.get("text", "")
    versions = ch.setdefault("versions", [])
    if not text.strip() or (versions and versions[-1]["text"] == text):
        return
    versions.append({"id": new_id(), "text": text, "title": ch.get("title", ""), "by": ch.get("updated_by") or user,
                     "at": ch.get("updated_at") or now_ms(), "label": label[:80]})
    # On garde toujours les versions nommees ; on elague les automatiques.
    while len(versions) > MAX_VERSIONS:
        index = next((i for i, v in enumerate(versions) if not v.get("label")), 0)
        versions.pop(index)


def new_chapter(title, text, user):
    return {"id": new_id(), "title": title[:160], "text": text, "rev": 1, "draft": "", "draft_rev": 1,
            "stars": 0, "status": "premier jet", "color": "", "summary": "",
            "updated_by": user, "updated_at": now_ms(), "versions": []}


def new_character(name, role="secondaire"):
    return {"id": new_id(), "name": name[:60], "role": role, "stars": 0, "color": color_for(name),
            "lines": 0, "words": 0, "chapters": [],
            "fields": [{"id": new_id(), "k": label, "v": ""} for label in DEFAULT_FIELDS]}


def check_lock(pid, key, cid):
    entry = HUB.holder(pid, key)
    if entry and entry["cid"] != cid:
        raise OpError(423, f"{entry['name']} est en train d'écrire ici.", {"holder": entry["name"]})


def clean(value, limit):
    return str(value or "")[:limit]


def apply_op(p, op, a, user, cid):
    """Applique une operation ; renvoie (resultat, evenements a diffuser)."""
    pid = p["id"]
    ev = []

    def chapters_event():
        ev.append({"t": "chapters", "chapters": [chapter_public(c) for c in p["chapters"]]})

    # ---- chapitres -------------------------------------------------------
    if op == "chapter.add":
        ch = new_chapter(clean(a.get("title"), 160) or f"Chapitre {len(p['chapters']) + 1}", clean(a.get("text"), 2_000_000), user)
        after = a.get("after")
        index = next((i + 1 for i, c in enumerate(p["chapters"]) if c["id"] == after), len(p["chapters"]))
        p["chapters"].insert(index, ch)
        chapters_event()
        return {"chapter": chapter_public(ch)}, ev

    if op == "chapter.save":
        ch = find(p["chapters"], a.get("id"), "Chapitre")
        check_lock(pid, "c:" + ch["id"], cid)
        if a.get("base_rev") != ch["rev"]:
            raise OpError(409, "Ce chapitre a changé entre-temps.", {"chapter": chapter_public(ch)})
        text = clean(a.get("text"), 2_000_000)
        if text != ch["text"]:
            versions = ch.get("versions", [])
            last = versions[-1]["at"] if versions else 0
            # Une version automatique quand l'auteur change ou toutes les 10 min.
            if ch.get("updated_by") != user or ch.get("updated_at", 0) - last > 600_000:
                add_version(ch, user)
            ch.update(text=text, rev=ch["rev"] + 1, updated_by=user, updated_at=now_ms())
        HUB.acquire(pid, "c:" + ch["id"], cid, user)
        ev.append({"t": "chapter", "chapter": chapter_public(ch)})
        return {"rev": ch["rev"]}, ev

    if op == "chapter.meta":
        ch = find(p["chapters"], a.get("id"), "Chapitre")
        if "title" in a: ch["title"] = clean(a["title"], 160)
        if "stars" in a: ch["stars"] = max(0, min(5, int(a["stars"])))
        if "status" in a: ch["status"] = clean(a["status"], 40)
        if "color" in a: ch["color"] = clean(a["color"], 20)
        if "summary" in a: ch["summary"] = clean(a["summary"], 4000)
        ev.append({"t": "chapter", "chapter": chapter_public(ch)})
        return {}, ev

    if op == "chapter.delete":
        ch = find(p["chapters"], a.get("id"), "Chapitre")
        check_lock(pid, "c:" + ch["id"], cid)
        p["chapters"].remove(ch)
        ch["deleted_by"], ch["deleted_at"] = user, now_ms()
        p["trash"] = (p.get("trash", []) + [ch])[-30:]
        p["notes"] = [n for n in p["notes"] if n.get("chapter") != ch["id"]]
        chapters_event()
        ev.append({"t": "notes", "notes": p["notes"]})
        return {}, ev

    if op == "chapter.order":
        by_id = {c["id"]: c for c in p["chapters"]}
        ordered = [by_id.pop(i) for i in a.get("ids", []) if i in by_id]
        p["chapters"] = ordered + list(by_id.values())
        chapters_event()
        return {}, ev

    if op == "chapter.versions":
        ch = find(p["chapters"], a.get("id"), "Chapitre")
        return {"versions": ch.get("versions", [])}, ev

    if op == "chapter.snapshot":
        ch = find(p["chapters"], a.get("id"), "Chapitre")
        versions = ch.setdefault("versions", [])
        label = clean(a.get("label"), 80) or "Version enregistrée"
        if versions and versions[-1]["text"] == ch["text"]:
            versions[-1]["label"] = label
        else:
            add_version(ch, user, label)
        ev.append({"t": "chapter", "chapter": chapter_public(ch)})
        return {}, ev

    if op == "chapter.stash":
        # Copie de secours d'un texte qui n'a pas pu etre enregistre (conflit).
        ch = find(p["chapters"], a.get("id"), "Chapitre")
        ch.setdefault("versions", []).append({"id": new_id(), "text": clean(a.get("text"), 2_000_000),
                                             "title": ch["title"], "by": user, "at": now_ms(),
                                             "label": clean(a.get("label"), 80) or f"Copie de secours de {user}"})
        ev.append({"t": "chapter", "chapter": chapter_public(ch)})
        return {}, ev

    if op == "chapter.restore":
        ch = find(p["chapters"], a.get("id"), "Chapitre")
        check_lock(pid, "c:" + ch["id"], cid)
        version = find(ch.get("versions", []), a.get("vid"), "Version")
        add_version(ch, user, "Avant restauration")
        ch.update(text=version["text"], rev=ch["rev"] + 1, updated_by=user, updated_at=now_ms())
        ev.append({"t": "chapter", "chapter": chapter_public(ch)})
        return {"chapter": chapter_public(ch)}, ev

    if op == "draft.save":
        ch = find(p["chapters"], a.get("id"), "Chapitre")
        check_lock(pid, "d:" + ch["id"], cid)
        if a.get("base_rev") != ch.get("draft_rev", 1):
            raise OpError(409, "Le brouillon a changé entre-temps.", {"chapter": chapter_public(ch)})
        ch["draft"] = clean(a.get("text"), 2_000_000)
        ch["draft_rev"] = ch.get("draft_rev", 1) + 1
        ch["draft_by"], ch["draft_at"] = user, now_ms()
        HUB.acquire(pid, "d:" + ch["id"], cid, user)
        ev.append({"t": "chapter", "chapter": chapter_public(ch)})
        return {"rev": ch["draft_rev"]}, ev

    if op == "draft.apply":
        ch = find(p["chapters"], a.get("id"), "Chapitre")
        check_lock(pid, "c:" + ch["id"], cid)
        if not ch.get("draft", "").strip():
            raise OpError(400, "Le brouillon est vide.")
        add_version(ch, user, "Avant remplacement par le brouillon")
        ch.update(text=ch["draft"], rev=ch["rev"] + 1, updated_by=user, updated_at=now_ms())
        ev.append({"t": "chapter", "chapter": chapter_public(ch)})
        return {"chapter": chapter_public(ch)}, ev

    # ---- personnages -----------------------------------------------------
    if op.startswith("char."):
        chars = p["characters"]
        if op == "char.add":
            name = clean(a.get("name"), 60).strip()
            if not name:
                raise OpError(400, "Donne un nom au personnage.")
            chars.append(new_character(name, clean(a.get("role"), 20) or "secondaire"))
        elif op == "char.update":
            c = find(chars, a.get("id"), "Personnage")
            if "name" in a: c["name"] = clean(a["name"], 60)
            if "role" in a: c["role"] = clean(a["role"], 20)
            if "stars" in a: c["stars"] = max(0, min(5, int(a["stars"])))
        elif op == "char.field":
            c = find(chars, a.get("id"), "Personnage")
            f = find(c["fields"], a.get("fid"), "Case")
            if "k" in a: f["k"] = clean(a["k"], 60)
            if "v" in a: f["v"] = clean(a["v"], 20000)
        elif op == "char.field.add":
            c = find(chars, a.get("id"), "Personnage")
            c["fields"].append({"id": new_id(), "k": clean(a.get("k"), 60) or "Nouvelle case", "v": ""})
        elif op == "char.field.del":
            c = find(chars, a.get("id"), "Personnage")
            c["fields"] = [f for f in c["fields"] if f["id"] != a.get("fid")]
        elif op == "char.delete":
            chars.remove(find(chars, a.get("id"), "Personnage"))
        elif op == "char.merge":
            src, dst = find(chars, a.get("id"), "Personnage"), find(chars, a.get("into"), "Personnage")
            if src is dst:
                raise OpError(400, "Choisis un autre personnage.")
            dst["lines"] += src.get("lines", 0)
            dst["words"] += src.get("words", 0)
            dst["chapters"] = sorted(set(dst.get("chapters", [])) | set(src.get("chapters", [])))
            aliases = dst.setdefault("aliases", [])
            for alias in [src["name"]] + src.get("aliases", []):
                if alias not in aliases:
                    aliases.append(alias)
            for f in src["fields"]:
                if f["v"].strip():
                    target = next((x for x in dst["fields"] if x["k"] == f["k"]), None)
                    if target is None:
                        dst["fields"].append(f)
                    elif not target["v"].strip():
                        target["v"] = f["v"]
                    else:
                        target["v"] += "\n" + f["v"]
            chars.remove(src)
        elif op == "char.sync":
            # Resultat de la detection faite dans le navigateur.
            by_name = {}
            for c in chars:
                for alias in [c["name"]] + c.get("aliases", []):
                    by_name[alias.strip().upper()] = c
            seen = set()
            for c in chars:
                c["lines"], c["words"], c["chapters"] = 0, 0, []
            found = a.get("found", [])
            top = max([int(f.get("lines", 0)) for f in found] + [1])
            for f in found:
                name = clean(f.get("name"), 60).strip()
                lines = int(f.get("lines", 0))
                if not name:
                    continue
                c = by_name.get(name.upper())
                if c is None:
                    if not a.get("create") or lines < 2:
                        continue
                    role = "principal" if lines >= max(5, top * 0.25) else ("secondaire" if lines >= max(3, top * 0.06) else "figurant")
                    c = new_character(name.title() if name.isupper() else name, role)
                    chars.append(c)
                    by_name[name.upper()] = c
                c["lines"] += lines
                c["words"] += int(f.get("words", 0))
                c["chapters"] = sorted(set(c["chapters"]) | set(f.get("chapters", [])))
                seen.add(c["id"])
            order = {"principal": 0, "secondaire": 1, "figurant": 2}
            chars.sort(key=lambda c: (order.get(c["role"], 3), -c.get("lines", 0)))
        else:
            raise OpError(400, "Opération inconnue.")
        ev.append({"t": "characters", "characters": chars})
        return {"characters": chars}, ev

    # ---- annotations -----------------------------------------------------
    if op.startswith("note."):
        notes = p["notes"]
        if op == "note.add":
            text = clean(a.get("text"), 4000).strip()
            if not text:
                raise OpError(400, "L'annotation est vide.")
            notes.append({"id": new_id(), "chapter": a.get("chapter"), "quote": clean(a.get("quote"), 600),
                          "text": text, "author": user, "at": now_ms(), "color": clean(a.get("color"), 20) or "jaune",
                          "star": False, "resolved": False, "replies": []})
        elif op == "note.update":
            n = find(notes, a.get("id"), "Annotation")
            if "text" in a: n["text"] = clean(a["text"], 4000)
            if "star" in a: n["star"] = bool(a["star"])
            if "resolved" in a: n["resolved"] = bool(a["resolved"])
            if "color" in a: n["color"] = clean(a["color"], 20)
        elif op == "note.reply":
            n = find(notes, a.get("id"), "Annotation")
            text = clean(a.get("text"), 2000).strip()
            if text:
                n["replies"].append({"id": new_id(), "text": text, "author": user, "at": now_ms()})
        elif op == "note.delete":
            notes.remove(find(notes, a.get("id"), "Annotation"))
        else:
            raise OpError(400, "Opération inconnue.")
        ev.append({"t": "notes", "notes": notes})
        return {"notes": notes}, ev

    # ---- idees -----------------------------------------------------------
    if op.startswith("idea."):
        ideas = p["ideas"]
        if op == "idea.add":
            text = clean(a.get("text"), 6000).strip()
            if not text:
                raise OpError(400, "L'idée est vide.")
            ideas.append({"id": new_id(), "text": text, "author": user, "at": now_ms(), "stars": 0,
                          "color": clean(a.get("color"), 20) or "jaune", "chapter": a.get("chapter") or "",
                          "replies": []})
        elif op == "idea.update":
            i = find(ideas, a.get("id"), "Idée")
            if "text" in a: i["text"] = clean(a["text"], 6000)
            if "stars" in a: i["stars"] = max(0, min(5, int(a["stars"])))
            if "color" in a: i["color"] = clean(a["color"], 20)
            if "chapter" in a: i["chapter"] = clean(a["chapter"], 20)
        elif op == "idea.reply":
            i = find(ideas, a.get("id"), "Idée")
            text = clean(a.get("text"), 2000).strip()
            if text:
                i.setdefault("replies", []).append({"id": new_id(), "text": text, "author": user, "at": now_ms()})
        elif op == "idea.delete":
            ideas.remove(find(ideas, a.get("id"), "Idée"))
        else:
            raise OpError(400, "Opération inconnue.")
        ev.append({"t": "ideas", "ideas": ideas})
        return {"ideas": ideas}, ev

    # ---- discussion ------------------------------------------------------
    if op == "chat.send":
        text = clean(a.get("text"), 4000).strip()
        if not text:
            raise OpError(400, "Message vide.")
        msg = {"id": new_id(), "sender": user, "text": text, "at": now_ms()}
        p["chat"] = (p["chat"] + [msg])[-1000:]
        ev.append({"t": "chat", "msg": msg})
        return {"msg": msg}, ev

    # ---- verrous ---------------------------------------------------------
    if op == "lock.acquire":
        other = HUB.acquire(pid, clean(a.get("key"), 40), cid, user, bool(a.get("steal")))
        ev.append(HUB.presence(pid))
        return {"ok": other is None, "holder": other["name"] if other else None}, ev
    if op == "lock.release":
        HUB.release(pid, clean(a.get("key"), 40), cid)
        ev.append(HUB.presence(pid))
        return {}, ev

    # ---- import ----------------------------------------------------------
    if op == "import":
        incoming = [c for c in a.get("chapters", []) if isinstance(c, dict)]
        if not incoming:
            raise OpError(400, "Aucun texte à importer.")
        if a.get("mode") == "replace":
            for ch in p["chapters"]:
                check_lock(pid, "c:" + ch["id"], cid)
                ch["deleted_by"], ch["deleted_at"] = user, now_ms()
            p["trash"] = (p.get("trash", []) + p["chapters"])[-200:]
            p["chapters"] = []
            p["notes"] = []
        for c in incoming[:2000]:
            p["chapters"].append(new_chapter(clean(c.get("title"), 160) or f"Chapitre {len(p['chapters']) + 1}",
                                             clean(c.get("text"), 2_000_000), user))
        source = a.get("source") or {}
        p["source"] = {"name": clean(source.get("name"), 200), "pages": int(source.get("pages") or 0),
                       "by": user, "at": now_ms()}
        ev.append({"t": "reload"})
        return {"count": len(incoming)}, ev

    if op == "project.rename":
        p["name"] = clean(a.get("name"), 120).strip() or p["name"]
        ev.append({"t": "project", "name": p["name"]})
        return {}, ev

    raise OpError(400, "Opération inconnue.")


# --------------------------------------------------------------------------
# Intelligence artificielle (cle conservee sur l'hote, jamais envoyee aux postes)
# --------------------------------------------------------------------------
FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1"}

SYSTEM_BASE = (
    "Tu es un script doctor francophone expérimenté, à la fois dramaturge et lecteur attentif. "
    "Tu travailles avec une petite équipe d'auteurs sur leur scénario. Tu es précis, concret, "
    "bienveillant mais franc : tu cites des scènes et des répliques du texte plutôt que de rester "
    "dans les généralités. Tu respectes la voix des auteurs et tu n'inventes jamais d'éléments "
    "qui ne sont pas dans le texte sans le signaler comme une proposition. Tu réponds en français."
)

ANALYSIS_PROMPT = """Analyse en profondeur le scénario fourni. Réponds UNIQUEMENT par un objet JSON valide (sans texte autour, sans balises de code), avec exactement ces clés :

{
 "logline": "une phrase",
 "synopsis": "un paragraphe de 8 à 12 lignes",
 "genre_ton": "genre, ton, références éventuelles",
 "themes": [{"titre": "...", "description": "..."}],
 "enjeux": [{"titre": "...", "type": "dramatique | émotionnel | moral | relationnel | sociétal", "description": "ce qui est en jeu, pour qui, et ce qui se passe en cas d'échec"}],
 "structure": [{"partie": "ex. Acte I – Exposition", "chapitres": "numéros de chapitres concernés", "description": "ce qui s'y joue, avec les pivots : incident déclencheur, point de non-retour, climax, résolution"}],
 "personnages": [{"nom": "...", "role": "principal | secondaire | figurant", "fonction": "protagoniste, antagoniste, mentor, allié...", "description": "...", "objectif": "ce qu'il veut", "besoin": "ce dont il a réellement besoin", "obstacle": "...", "arc": "d'où il part, par quoi il passe, où il arrive", "relations": "liens avec les autres personnages"}],
 "relations": [{"entre": "A et B", "description": "nature et évolution du lien"}],
 "rythme": "analyse du rythme, des temps forts et des temps morts, chapitre par chapitre si utile",
 "dialogues": "analyse des dialogues : voix des personnages, sous-texte, répliques marquantes",
 "forces": ["..."],
 "faiblesses": ["..."],
 "incoherences": ["trous de scénario, contradictions, questions sans réponse"],
 "pistes": ["propositions concrètes de réécriture, classées par priorité"]
}

Sois complet sur les personnages qui parlent le plus, concis sur les figurants. Chaque point doit s'appuyer sur le texte."""


def ai_available():
    try:
        import anthropic  # noqa: F401
        return True
    except ImportError:
        return False


def ai_call(system_blocks, user_text, max_tokens=32000, effort="medium"):
    key = STORE.config.get("api_key") or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise OpError(400, "Aucune clé API : l'hôte doit en saisir une dans Réglages.")
    try:
        import anthropic
    except ImportError:
        raise OpError(500, "Le module « anthropic » n'est pas installé sur la machine hôte "
                           "(commande : pip install anthropic).")
    model = STORE.config.get("model") or DEFAULT_MODEL
    client = anthropic.Anthropic(api_key=key)
    kwargs = dict(model=model, max_tokens=max_tokens, system=system_blocks,
                  messages=[{"role": "user", "content": user_text}],
                  output_config={"effort": effort})

    def run(with_fallback):
        if with_fallback:
            # Si le modele decline une scene (violence, etc.), l'API relance
            # d'elle-meme la demande sur un modele de secours.
            stream = client.beta.messages.stream(betas=["server-side-fallback-2026-07-01"],
                                                 fallbacks="default", **kwargs)
        else:
            stream = client.messages.stream(**kwargs)
        with stream as s:
            return s.get_final_message()

    try:
        try:
            message = run(model in FALLBACK_MODELS)
        except (anthropic.BadRequestError, TypeError):
            if model not in FALLBACK_MODELS:
                raise
            message = run(False)
    except TypeError:
        raise OpError(500, "Le module « anthropic » de la machine hôte est trop ancien. Il faut Python 3.10 ou plus "
                           "récent, puis : pip install -U anthropic")
    except anthropic.AuthenticationError:
        raise OpError(502, "Clé API refusée : vérifie-la dans Réglages.")
    except anthropic.PermissionDeniedError:
        raise OpError(502, "Cette clé API n'a pas accès au modèle choisi.")
    except anthropic.NotFoundError:
        raise OpError(502, f"Modèle « {model} » introuvable : corrige-le dans Réglages.")
    except anthropic.RateLimitError:
        raise OpError(502, "Trop de demandes à la fois : réessaie dans une minute.")
    except anthropic.BadRequestError as exc:
        raise OpError(502, f"Demande refusée par l'API : {exc.message}")
    except anthropic.APIStatusError as exc:
        raise OpError(502, f"Erreur du service IA ({exc.status_code}). Réessaie plus tard.")
    except anthropic.APIConnectionError:
        raise OpError(502, "Connexion à l'IA impossible : la machine hôte a-t-elle Internet ?")
    if message.stop_reason == "refusal":
        raise OpError(502, "L'IA a décliné cette demande.")
    text = "".join(block.text for block in message.content if block.type == "text").strip()
    if message.stop_reason == "max_tokens":
        text += "\n\n[Réponse coupée : trop longue.]"
    return text


def script_text(p):
    parts = []
    for index, ch in enumerate(p["chapters"], 1):
        parts.append(f"===== CHAPITRE {index} : {ch['title']} =====\n{ch['text']}")
    return "\n\n".join(parts)


def script_system(p):
    # Le scenario est place dans un bloc mis en cache : les demandes suivantes
    # sur le meme texte coutent beaucoup moins cher.
    return [{"type": "text", "text": SYSTEM_BASE},
            {"type": "text", "text": f"Voici le scénario « {p['name']} », découpé en chapitres :\n\n{script_text(p)}",
             "cache_control": {"type": "ephemeral"}}]


def parse_json_reply(text):
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("pas de JSON")
    return json.loads(text[start:end + 1])


def run_analysis(pid, user):
    def fail(message):
        with STORE.lock:
            project = STORE.projects.get(pid)
            if project:
                project["ai_job"] = None
        HUB.broadcast(pid, {"t": "ai", "state": "error", "message": message})

    try:
        with STORE.lock:
            p = STORE.projects.get(pid)
            if not p:
                return
            system = script_system(p)
        text = ai_call(system, ANALYSIS_PROMPT, max_tokens=48000, effort="high")
        try:
            data = parse_json_reply(text)
        except ValueError:
            data = {"texte_libre": text}
        with STORE.lock:
            p = STORE.projects.get(pid)
            if not p:
                return
            p["analysis"] = {"data": data, "at": now_ms(), "by": user, "model": STORE.config.get("model")}
            p["ai_job"] = None
            analysis = p["analysis"]
        STORE.touch(pid)
        HUB.broadcast(pid, {"t": "analysis", "analysis": analysis})
    except OpError as exc:
        fail(exc.message)
    except Exception as exc:  # ne jamais laisser l'analyse « en cours » pour toujours
        fail(f"Analyse interrompue : {exc}")


def ai_action(p, action, a, user):
    pid = p["id"]
    if action == "analyze":
        with STORE.lock:
            if not p["chapters"]:
                raise OpError(400, "Le scénario est vide.")
            job = p.get("ai_job")
            if job and now_ms() - job["at"] < 15 * 60_000:
                raise OpError(409, f"Une analyse lancée par {job['by']} est déjà en cours.")
            p["ai_job"] = {"by": user, "at": now_ms()}
        HUB.broadcast(pid, {"t": "ai", "state": "running", "by": user})
        threading.Thread(target=run_analysis, args=(pid, user), daemon=True).start()
        return {"started": True}

    if action == "ask":
        question = clean(a.get("question"), 4000).strip()
        if not question:
            raise OpError(400, "Pose une question.")
        with STORE.lock:
            system = script_system(p)
        return {"text": ai_call(system, question, max_tokens=16000)}

    with STORE.lock:
        ch = find(p["chapters"], a.get("chapter"), "Chapitre")
        source = ch["draft"] if a.get("from") == "draft" and ch.get("draft", "").strip() else ch["text"]
        title = ch["title"]
        context = ""
        analysis = (p.get("analysis") or {}).get("data") or {}
        if analysis.get("synopsis"):
            context = f"Pour contexte, synopsis de l'ensemble du scénario « {p['name']} » : {analysis['synopsis']}\n\n"
    if not source.strip():
        raise OpError(400, "Ce chapitre est vide.")
    body = f"{context}Chapitre « {title} » :\n\n{source}"
    system = [{"type": "text", "text": SYSTEM_BASE}]
    if action == "correct":
        prompt = ("Corrige uniquement l'orthographe, la grammaire, la conjugaison, la ponctuation et la typographie "
                  "française du chapitre ci-dessous. Ne change ni le style, ni le sens, ni la mise en page du scénario "
                  "(intitulés de scène, noms en capitales, retours à la ligne). Réponds UNIQUEMENT par le texte corrigé "
                  "complet, sans commentaire.\n\n")
        return {"text": ai_call(system, prompt + body, max_tokens=64000, effort="low"), "kind": "text"}
    if action == "rewrite":
        instruction = clean(a.get("instruction"), 2000).strip() or "Améliore le rythme et la force des dialogues."
        prompt = (f"Réécris le chapitre ci-dessous en suivant cette consigne des auteurs : « {instruction} ». "
                  "Garde le format scénario (intitulés de scène, noms des personnages en capitales avant les répliques) "
                  "et la continuité avec le reste de l'histoire. Réponds UNIQUEMENT par le chapitre réécrit, sans "
                  "commentaire.\n\n")
        return {"text": ai_call(system, prompt + body, max_tokens=64000, effort="high"), "kind": "text"}
    if action == "summary":
        prompt = ("Résume ce chapitre en 3 à 5 phrases : ce qui se passe, ce qui change pour les personnages, "
                  "et sur quoi on reste à la fin. Réponds uniquement par le résumé.\n\n")
        return {"text": ai_call(system, prompt + body, max_tokens=4000, effort="low"), "kind": "summary"}
    if action == "feedback":
        prompt = ("Donne un retour de lecture sur ce chapitre : ce qui fonctionne, ce qui fonctionne moins "
                  "(enjeu de la scène, conflit, rythme, dialogues, clarté), puis 3 à 5 pistes concrètes de réécriture. "
                  "Cite les passages concernés. Texte simple, sans tableau.\n\n")
        return {"text": ai_call(system, prompt + body, max_tokens=12000), "kind": "feedback"}
    raise OpError(400, "Action IA inconnue.")


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------
FAILED_LOGINS = {}
TICKETS = {}


def lan_addresses():
    found = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))
            found.append(sock.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            if info[4][0] not in found:
                found.append(info[4][0])
    except OSError:
        pass
    return [ip for ip in found if not ip.startswith("127.")]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    port = DEFAULT_PORT

    def log_message(self, fmt, *args):
        pass

    # -- utilitaires -------------------------------------------------------
    def send_bytes(self, body, content_type, status=200, cache="no-store"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def json(self, payload, status=200):
        self.send_bytes(json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                        "application/json; charset=utf-8", status)

    def error(self, status, message, extra=None):
        self.json({"error": message, **(extra or {})}, status)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_REQUEST_BYTES:
            raise OpError(413, "Requête trop volumineuse.")
        if length <= 0:
            return {}
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise OpError(400, "Requête illisible.")
        return data if isinstance(data, dict) else {}

    def client_ip(self):
        # En mode public, l'appli n'ecoute que le proxy local : la vraie adresse
        # du visiteur est la derniere que le proxy a ajoutee a X-Forwarded-For.
        forwarded = self.headers.get("X-Forwarded-For", "") if PUBLIC else ""
        return forwarded.split(",")[-1].strip() or self.client_address[0]

    def is_admin(self, name):
        if PUBLIC:
            return bool(STORE.config.get("users", {}).get(name.lower(), {}).get("admin"))
        # Mode local : l'administrateur est la personne assise devant la machine hote.
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def user(self, token=None):
        token = token or self.headers.get("X-Token", "")
        session = STORE.sessions.get(token)
        if session and PUBLIC:
            expired = now_ms() - session["at"] > SESSION_DAYS * 86_400_000
            if expired or session["name"].lower() not in STORE.config.get("users", {}):
                session = None
        if not session:
            raise OpError(401, "Session expirée : reconnecte-toi.")
        return session["name"]

    def throttle(self, key):
        fails = FAILED_LOGINS.get(key, [0, 0])
        if fails[0] >= 8 and time.time() - fails[1] < 300:
            raise OpError(429, "Trop d'essais. Patiente 5 minutes.")
        return fails

    def open_session(self, name):
        token = secrets.token_urlsafe(24)
        with STORE.lock:
            STORE.sessions[token] = {"name": name, "at": now_ms()}
            if len(STORE.sessions) > 300:
                for old in sorted(STORE.sessions, key=lambda t: STORE.sessions[t]["at"])[:100]:
                    del STORE.sessions[old]
            STORE.save_sessions()
        self.json({"token": token, "name": name, "color": color_for(name)})

    # -- GET ---------------------------------------------------------------
    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        try:
            if path == "/api/events":
                return self.events(parse_qs(url.query))
            if path == "/api/mode":
                payload = {"public": PUBLIC, "version": APP_VERSION}
                token = parse_qs(url.query).get("invite", [""])[0]
                if PUBLIC and token:
                    invite = valid_invite(STORE.config, token)
                    payload["invite"] = {"ok": bool(invite), "reset": invite.get("reset", "") if invite else ""}
                return self.json(payload)
            if path == "/api/projects":
                self.user()
                with STORE.lock:
                    items = [{"id": p["id"], "name": p["name"], "chapters": len(p["chapters"]),
                              "created_by": p.get("created_by", ""),
                              "updated": max([c.get("updated_at", 0) for c in p["chapters"]] + [p["created"]])}
                             for p in STORE.projects.values()]
                return self.json({"projects": sorted(items, key=lambda i: -i["updated"])})
            if path.startswith("/api/project/"):
                self.user()
                pid = path.split("/")[3]
                with STORE.lock:
                    p = STORE.projects.get(pid)
                    if not p:
                        raise OpError(404, "Ce scénario n'existe plus.")
                    payload = project_public(p)
                payload["presence"] = HUB.presence(pid)
                return self.json(payload)
            if path == "/api/settings":
                host = self.is_admin(self.user())
                has_key = bool(STORE.config.get("api_key") or os.environ.get("ANTHROPIC_API_KEY"))
                payload = {"ai": has_key and ai_available(), "has_key": has_key, "ai_module": ai_available(),
                           "model": STORE.config.get("model"), "host": host, "version": APP_VERSION,
                           "public": PUBLIC, "env_key": bool(os.environ.get("ANTHROPIC_API_KEY"))}
                if host and PUBLIC:
                    with STORE.lock:
                        payload["users"] = sorted(({"name": u["name"], "admin": bool(u.get("admin"))}
                                                   for u in STORE.config.get("users", {}).values()),
                                                  key=lambda u: u["name"].lower())
                        payload["invites"] = sum(1 for t in STORE.config.get("invites", {})
                                                 if valid_invite(STORE.config, t))
                elif host:
                    payload["access_code"] = STORE.config["access_code"]
                    payload["urls"] = [f"http://{ip}:{self.port}" for ip in lan_addresses()]
                return self.json(payload)
            if path.startswith("/api/"):
                raise OpError(404, "Adresse inconnue.")
            return self.static(path)
        except OpError as exc:
            self.error(exc.status, exc.message, exc.extra)
        except (BrokenPipeError, ConnectionError):
            pass

    def static(self, path):
        name = "index.html" if path in ("/", "") else unquote(path).lstrip("/")
        file = (WEB_DIR / name).resolve()
        if WEB_DIR.resolve() not in file.parents or not file.is_file():
            if name == "MANUEL.md" and (ROOT / "MANUEL.md").is_file():
                file = ROOT / "MANUEL.md"
            else:
                return self.send_bytes(b"Introuvable", "text/plain; charset=utf-8", 404)
        cache = "public, max-age=86400" if "vendor" in file.parts else "no-cache"
        self.send_bytes(file.read_bytes(), MIME.get(file.suffix.lower(), "application/octet-stream"), cache=cache)

    def events(self, query):
        # Le flux temps reel s'ouvre avec un ticket a usage unique de 30 s : le
        # vrai jeton de session ne figure ainsi jamais dans une adresse (ni donc
        # dans les journaux d'un proxy).
        with STORE.lock:
            ticket = TICKETS.pop(query.get("ticket", [""])[0], None)
        if not ticket or ticket[1] < time.time():
            raise OpError(401, "Session expirée : reconnecte-toi.")
        name = ticket[0]
        pid = query.get("project", [""])[0]
        cid = query.get("cid", [""])[0][:40] or new_id()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True
        q = HUB.connect(cid, name, pid)
        try:
            self.wfile.write(b"retry: 2000\n\n")
            self.wfile.flush()
            while True:
                try:
                    event = q.get(timeout=15)
                    data = json.dumps(event, ensure_ascii=False)
                    self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except (OSError, ValueError):
            pass
        finally:
            HUB.disconnect(cid, q)

    # -- POST --------------------------------------------------------------
    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.read_body()
            if path == "/api/login":
                return self.login(body)
            if path == "/api/signup":
                return self.signup(body)
            user = self.user()
            cid = self.headers.get("X-Client", "")[:40]
            if path == "/api/ticket":
                ticket = secrets.token_urlsafe(18)
                with STORE.lock:
                    for old in [t for t, v in TICKETS.items() if v[1] < time.time()]:
                        del TICKETS[old]
                    TICKETS[ticket] = (user, time.time() + 30)
                return self.json({"ticket": ticket})
            if path == "/api/logout":
                with STORE.lock:
                    STORE.sessions.pop(self.headers.get("X-Token", ""), None)
                    STORE.save_sessions()
                return self.json({"ok": True})
            if path == "/api/admin":
                return self.admin(body, user)
            if path == "/api/projects":
                project = STORE.new_project(clean(body.get("name"), 120).strip(), user)
                HUB.broadcast(None, {"t": "projects"})
                return self.json({"id": project["id"]})
            if path == "/api/settings":
                if not self.is_admin(user):
                    raise OpError(403, "Les réglages sont réservés aux administrateurs." if PUBLIC
                                  else "Les réglages se modifient depuis la machine hôte.")
                if "api_key" in body:
                    STORE.config["api_key"] = clean(body["api_key"], 300).strip()
                if body.get("model"):
                    STORE.config["model"] = clean(body["model"], 80).strip()
                if body.get("access_code"):
                    code = clean(body["access_code"], 60).strip()
                    if len(code) < 4:
                        raise OpError(400, "Le code d'accès doit faire au moins 4 caractères.")
                    STORE.config["access_code"] = code
                STORE.save_config()
                HUB.broadcast(None, {"t": "settings"})
                return self.json({"ok": True})
            parts = path.split("/")
            if len(parts) == 5 and parts[1] == "api" and parts[2] == "project":
                pid, action = parts[3], parts[4]
                with STORE.lock:
                    p = STORE.projects.get(pid)
                if not p:
                    raise OpError(404, "Ce scénario n'existe plus.")
                if action == "op":
                    with STORE.lock:
                        result, events = apply_op(p, clean(body.get("op"), 40), body, user, cid)
                    if events:
                        if not body.get("op", "").startswith(("lock.", "chapter.versions")):
                            STORE.touch(pid)
                        for event in events:
                            # L'auteur d'une frappe n'a pas besoin de recevoir son propre texte.
                            exclude = cid if event["t"] == "chapter" and body.get("op") in ("chapter.save", "draft.save") else None
                            HUB.broadcast(pid, dict(event, by=user), exclude=exclude)
                    return self.json(result)
                if action == "ai":
                    return self.json(ai_action(p, clean(body.get("action"), 20), body, user))
                if action == "delete":
                    if PUBLIC and not self.is_admin(user):
                        raise OpError(403, "Seul un administrateur peut supprimer un scénario.")
                    STORE.delete_project(pid)
                    HUB.broadcast(pid, {"t": "deleted"})
                    HUB.broadcast(None, {"t": "projects"})
                    return self.json({"ok": True})
            raise OpError(404, "Adresse inconnue.")
        except OpError as exc:
            self.error(exc.status, exc.message, exc.extra)
        except (BrokenPipeError, ConnectionError):
            pass
        except Exception as exc:
            print("Erreur :", repr(exc))
            self.error(500, "Erreur interne du serveur.")

    def login(self, body):
        ip = self.client_ip()
        fails = self.throttle(ip)
        name = re.sub(r"\s+", " ", clean(body.get("name"), 24)).strip()
        if not name:
            raise OpError(400, "Écris ton prénom.")
        if PUBLIC:
            # Un compte par personne. Les essais sont comptes par adresse ET par
            # compte, pour qu'un attaquant ne contourne pas la limite en changeant d'adresse.
            account_key = "compte:" + name.lower()
            account_fails = self.throttle(account_key)
            account = STORE.config.get("users", {}).get(name.lower())
            password = clean(body.get("password"), 200)
            salt = account["salt"] if account else "00" * 16
            digest = hash_password(password, salt)[1]  # calcule meme si le compte n'existe pas
            if not account or not hmac.compare_digest(digest, account["hash"]):
                FAILED_LOGINS[ip] = [fails[0] + 1, time.time()]
                FAILED_LOGINS[account_key] = [account_fails[0] + 1, time.time()]
                time.sleep(0.6)
                raise OpError(403, "Prénom ou mot de passe incorrect.")
            FAILED_LOGINS.pop(ip, None)
            FAILED_LOGINS.pop(account_key, None)
            return self.open_session(account["name"])
        code = clean(body.get("code"), 60).strip().lower()
        expected = STORE.config["access_code"].strip().lower()
        if not hmac.compare_digest(code.encode("utf-8"), expected.encode("utf-8")):
            FAILED_LOGINS[ip] = [fails[0] + 1, time.time()]
            time.sleep(0.6)
            raise OpError(403, "Code d'accès incorrect.")
        FAILED_LOGINS.pop(ip, None)
        self.open_session(name)

    def signup(self, body):
        """Cree un compte (ou change un mot de passe) a partir d'un lien d'invitation."""
        if not PUBLIC:
            raise OpError(404, "Adresse inconnue.")
        ip = self.client_ip()
        fails = self.throttle(ip)
        password = clean(body.get("password"), 200)
        with STORE.lock:
            token = clean(body.get("invite"), 80)
            invite = valid_invite(STORE.config, token)
            if not invite:
                FAILED_LOGINS[ip] = [fails[0] + 1, time.time()]
                raise OpError(403, "Ce lien d'invitation n'est plus valable. Demande-en un nouveau.")
            if len(password) < 8:
                raise OpError(400, "Choisis un mot de passe d'au moins 8 caractères.")
            users = STORE.config.setdefault("users", {})
            if invite.get("reset"):
                account = users.get(invite["reset"].lower())
                if not account:
                    raise OpError(404, "Ce compte n'existe plus.")
            else:
                name = re.sub(r"\s+", " ", clean(body.get("name"), 24)).strip()
                if not name:
                    raise OpError(400, "Écris ton prénom.")
                if name.lower() in users:
                    raise OpError(409, "Ce prénom est déjà pris : ajoute une initiale.")
                account = users[name.lower()] = {"name": name, "admin": bool(invite.get("admin")), "created": now_ms()}
            account["salt"], account["hash"] = hash_password(password)
            del STORE.config["invites"][token]
            # Un nouveau mot de passe ferme les sessions ouvertes de ce compte.
            for old in [t for t, s in STORE.sessions.items() if s["name"].lower() == account["name"].lower()]:
                del STORE.sessions[old]
            STORE.save_config()
        self.open_session(account["name"])

    def admin(self, body, user):
        if not PUBLIC or not self.is_admin(user):
            raise OpError(403, "Réservé aux administrateurs.")
        action, target = clean(body.get("action"), 20), clean(body.get("name"), 24).strip().lower()
        with STORE.lock:
            users = STORE.config.setdefault("users", {})
            if action == "invite":
                token = new_invite(STORE.config, user, admin=bool(body.get("admin")))
            elif action == "reset":
                if target not in users:
                    raise OpError(404, "Compte introuvable.")
                token = new_invite(STORE.config, user, reset=users[target]["name"])
            elif action == "remove":
                if target not in users:
                    raise OpError(404, "Compte introuvable.")
                if target == user.lower():
                    raise OpError(400, "Tu ne peux pas retirer ton propre compte.")
                name = users.pop(target)["name"]
                for old in [t for t, s in STORE.sessions.items() if s["name"].lower() == target]:
                    del STORE.sessions[old]
                STORE.save_sessions()
                STORE.save_config()
                return self.json({"ok": True, "removed": name})
            else:
                raise OpError(400, "Action inconnue.")
            STORE.save_config()
        self.json({"invite": token, "days": INVITE_DAYS})


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Un navigateur qui ferme un onglet coupe sa connexion : rien d'anormal,
        # inutile d'afficher une erreur dans la fenetre de l'hote.
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def main():
    global STORE
    parser = argparse.ArgumentParser(description="Writer-Share : atelier de scénario partagé")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true", help="n'ouvre pas le navigateur")
    parser.add_argument("--public", action="store_true",
                        help="mode serveur Internet : comptes avec mot de passe, à placer derrière un proxy HTTPS")
    parser.add_argument("--host", default="", help="adresse d'écoute (défaut : 127.0.0.1 en mode public, sinon 0.0.0.0)")
    parser.add_argument("--data", default=os.environ.get("WRITER_SHARE_DATA", ""), help="dossier des données")
    parser.add_argument("--url", default=os.environ.get("WRITER_SHARE_URL", ""),
                        help="adresse publique (ex. https://scenario.exemple.fr), pour afficher des liens complets")
    parser.add_argument("--admin-invite", action="store_true",
                        help="crée un lien d'invitation administrateur puis s'arrête (service arrêté)")
    args = parser.parse_args()
    global PUBLIC
    PUBLIC = args.public or args.admin_invite
    if args.data:
        set_data_dir(args.data)
    STORE = Store()
    base = args.url.rstrip("/") or "https://TON-DOMAINE"
    if args.admin_invite:
        token = new_invite(STORE.config, "console", admin=True)
        STORE.save_config()
        print(f"Lien administrateur (valable {INVITE_DAYS} jours, usage unique) :\n  {base}/?invite={token}")
        return
    Handler.port = args.port
    threading.Thread(target=HUB.expire_loop, daemon=True).start()
    host = args.host or ("127.0.0.1" if PUBLIC else "0.0.0.0")
    try:
        server = Server((host, args.port), Handler)
    except OSError:
        print(f"Le port {args.port} est déjà utilisé : Writer-Share tourne peut-être déjà.")
        print(f"Ouvre http://localhost:{args.port} ou relance avec --port 8778")
        sys.exit(1)
    line = "=" * 62
    if PUBLIC:
        print(line)
        print(f"  WRITER-SHARE {APP_VERSION} - mode public, écoute sur {host}:{args.port}")
        print(f"  Données : {DATA_DIR}")
        if not any(u.get("admin") for u in STORE.config.get("users", {}).values()):
            # Premier lancement : sans ce lien, personne ne pourrait creer le premier compte.
            token = next((t for t, i in STORE.config.get("invites", {}).items()
                          if i.get("admin") and valid_invite(STORE.config, t)), None)
            if not token:
                token = new_invite(STORE.config, "console", admin=True)
                STORE.save_config()
            print("  Aucun administrateur. Crée ton compte avec ce lien (usage unique) :")
            print(f"    {base}/?invite={token}")
        print(line, flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            STORE.flush()
        return
    print(line)
    print(f"  WRITER-SHARE {APP_VERSION} est lancé. Laisse cette fenêtre ouverte.")
    print(line)
    print(f"  Sur cette machine      : http://localhost:{args.port}")
    for index, ip in enumerate(lan_addresses()):
        label = "Adresse à partager     " if index == 0 else ("Via Tailscale (distance)" if ip.startswith("100.") else "Autre réseau           ")
        print(f"  {label}: http://{ip}:{args.port}")
    print(f"  Code d'accès           : {STORE.config['access_code']}")
    print(f"  IA                     : {'clé enregistrée' if STORE.config.get('api_key') else 'pas de clé (Réglages)'}"
          f"{'' if ai_available() else ' - module anthropic absent'}")
    print(line)
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(f"http://localhost:{args.port}")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        STORE.flush()
        print("Writer-Share arrêté, tout est enregistré.")


if __name__ == "__main__":
    main()
