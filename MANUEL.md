# Writer-Share — petit manuel

L'atelier de scénario à plusieurs, entre PC et Mac.

**Le principe en une phrase :** une seule personne lance Writer-Share sur son
ordinateur (« l'hôte »). Les autres n'installent rien : ils ouvrent une adresse
dans leur navigateur, tapent leur prénom et un code.

---

## 1. Pour la personne qui héberge

### Lancer l'application

| Sur PC (Windows) | Sur Mac |
| --- | --- |
| Double-clic sur `Lancer_Writer_Share.bat` | Double-clic sur `Lancer_Writer_Share.command` |

Une fenêtre noire s'ouvre et affiche trois choses à retenir :

```
Sur cette machine      : http://localhost:8777
Adresse à partager     : http://192.168.1.20:8777
Code d'accès           : plume-4827
```

Le navigateur s'ouvre tout seul. **Laisse la fenêtre noire ouverte** tant que
l'équipe travaille : la fermer arrête Writer-Share (tout est déjà enregistré).

Il faut Python sur la machine hôte (gratuit, <https://www.python.org/downloads/>).
Sur PC, coche « Add python.exe to PATH » pendant l'installation.

> **Mac, la première fois.** Si le double-clic sur le `.command` est refusé :
> clic droit sur le fichier → Ouvrir → Ouvrir. Si macOS dit que le fichier
> « n'est pas exécutable », ouvre le Terminal, tape `chmod +x ` (avec l'espace),
> glisse le fichier dans la fenêtre, puis Entrée. Autre solution : dans le
> Terminal, `cd` vers le dossier puis `python3 writer_share.py`.

### Inviter l'équipe

Envoie aux autres **l'adresse à partager** et **le code d'accès**. C'est tout.

### Autoriser le pare-feu (PC hôte) — la cause n°1 des « ça ne se connecte pas »

Au premier lancement, Windows demande s'il faut autoriser Python sur le réseau :
coche **Réseaux privés** puis **Autoriser l'accès**.

Si la question n'est pas apparue ou a été refusée : menu Démarrer → tape
« PowerShell » → clic droit → *Exécuter en tant qu'administrateur*, puis colle :

```
netsh advfirewall firewall add rule name="Writer-Share" dir=in action=allow protocol=TCP localport=8777 profile=private
```

Sur un Mac hôte, macOS pose la même question : réponds **Autoriser**.

---

## 2. Pour se connecter (tout le monde)

1. Ouvre l'adresse reçue (du type `http://192.168.1.20:8777`) dans Safari,
   Chrome, Firefox ou Edge. Sur Mac comme sur PC.
2. Écris ton **prénom** (c'est lui qui signera tes annotations et tes idées).
3. Écris le **code d'accès**.
4. Clique **Entrer**, puis choisis le scénario.

Le navigateur se souvient de toi : la prochaine fois, tu arrives directement
dans le scénario. Astuce Mac : dans Safari, *Fichier → Ajouter au Dock* crée une
icône Writer-Share comme une vraie application.

### Vous n'êtes pas au même endroit ?

L'adresse `192.168…` ne marche que **sur le même réseau** (même box, même
Wi-Fi). Pour travailler à distance, le plus simple et le plus sûr est un réseau
privé gratuit de type **Tailscale** (<https://tailscale.com>) :

1. Chacun installe Tailscale et se connecte au même compte / réseau partagé.
2. L'hôte relance Writer-Share : une adresse en `100.x.x.x` apparaît dans la
   fenêtre noire (et dans Réglages ⚙).
3. L'équipe utilise cette adresse à la place de l'autre.

Autre solution, sans rien installer chez personne : mettre Writer-Share sur un
serveur (VPS). Il tourne alors en permanence à une adresse `https://…`, et
chacun a son compte et son mot de passe. Voir `deploy/DEPLOIEMENT-VPS.md`.

N'ouvre jamais de port sur ta box Internet pour Writer-Share : le code d'accès
protège une équipe de confiance, pas un service exposé au monde entier.
Ne le place pas non plus derrière un « tunnel » public ou un proxy (ngrok,
Cloudflare Tunnel…) : tous les visiteurs seraient pris pour la machine hôte et
auraient accès aux Réglages.

---

## 3. Écrire ensemble

**Scénario** — la liste des chapitres à gauche, le texte au milieu, les
annotations à droite.

- **Tout s'enregistre tout seul**, en continu.
- **Un chapitre = une plume à la fois.** Quand quelqu'un écrit dans un chapitre,
  les autres voient son texte arriver en direct et un bandeau le signale. On
  travaille en parallèle sur des chapitres différents. « Prendre la main » sert
  si la personne a fini mais que le chapitre reste bloqué.
- **Brouillon** : chaque chapitre a un brouillon partagé. On y tente une
  réécriture sans toucher au texte. Quand elle plaît : **Adopter ce brouillon**.
- **Versions** : à chaque réécriture, l'ancien texte est gardé. On peut relire,
  restaurer, ou renvoyer une version dans le brouillon. Rien ne se perd.
- **Annoter** : sélectionne un passage → **✎ Annoter**. Les autres répondent,
  mettent une étoile (important) ou cochent ✓ (traité).
- **Étoiles** : note chaque chapitre de 1 à 5, et indique son état (premier jet,
  en réécriture, à relire, validé).
- **Glisser un chapitre** dans la liste change l'ordre.
- **Lire** : aperçu mis en page comme un vrai scénario.
- **Exporter** (en haut) : fichier texte, fiches personnages, impression / PDF.

**Mise en forme, version simple**

| Tu écris | Writer-Share comprend |
| --- | --- |
| `INT. CUISINE – JOUR` | un intitulé de scène |
| `PAUL` seul sur sa ligne, puis du texte dessous | une réplique de Paul |
| `(à voix basse)` | une indication de jeu |
| `COUPE À :` | une transition |
| tout le reste | de la description |

Les boutons **Scène / Personnage / (Jeu) / Transition** font la mise en forme de
la ligne où se trouve le curseur.

**Personnages** — une fiche par personnage, avec des cases à remplir (Âge,
Description, Objectif, Obstacle, Arc, Relations, Notes). On peut renommer une
case, en ajouter, en retirer. « Détecter dans le texte » recompte les répliques
et ajoute les nouveaux personnages. Si un personnage apparaît sous deux noms,
menu **⋯ → Fusionner dans**.

**Idées** — le mur de post-its de l'équipe : on y lance une idée, les autres
rebondissent et la notent.

**Discussion** — la bulle 💬 en bas à droite, pour se parler en direct.

---

## 4. Importer un scénario en PDF

**Importer** → dépose le PDF. Writer-Share :

1. lit le texte (rien ne quitte ton ordinateur) ;
2. le **découpe en chapitres** — par scène, par titres (ACTE, SÉQUENCE…) ou par
   blocs de pages : tu choisis avant de valider ;
3. **repère les personnages** (les noms en majuscules avant les répliques),
   compte leurs répliques et propose un rôle : principal, secondaire, figurant ;
4. si l'IA est active, lance l'**analyse complète**.

Le PDF doit contenir du vrai texte (exporté depuis Final Draft, Celtx, Word,
Pages…). Un PDF scanné — des photos de pages — ne peut pas être lu : il faut
d'abord le passer dans un outil de reconnaissance de texte (OCR).

La détection des personnages est automatique, donc imparfaite : corrige les
rôles, fusionne les doublons, supprime les intrus.

---

## 5. Orthographe

- **Au fil de la frappe** : ton navigateur souligne les fautes ; clic droit pour
  corriger. Si rien n'est souligné, active le français dans le correcteur du
  navigateur (Chrome : Paramètres → Langues ; Safari : Édition → Orthographe et
  grammaire ; Firefox : clic droit dans le texte → Langues).
- **Bouton Orthographe** (avec l'IA) : corrige tout le chapitre et place le
  résultat dans le brouillon, pour relecture avant d'adopter.

---

## 6. L'intelligence artificielle (facultatif)

Sans clé, tout le reste fonctionne. Avec une clé, l'équipe gagne :

- **Analyse** : logline, synopsis, enjeux, thèmes, structure, arcs des
  personnages, relations, rythme, dialogues, forces, faiblesses, incohérences,
  pistes de réécriture — et un bouton pour **remplir les fiches personnages**
  (seulement les cases vides) ;
- **Demander à l'IA** : une question libre sur le scénario ;
- par chapitre : **Orthographe**, **Réécrire** (avec ta consigne), **Avis** de
  lecture, **Résumer**.

L'IA ne modifie jamais le texte toute seule : ses propositions vont dans le
brouillon ou dans une fenêtre, et c'est vous qui décidez.

**Brancher la clé (l'hôte, une seule fois)**

1. Crée une clé sur <https://console.anthropic.com> (rubrique *API Keys*).
2. Sur la machine hôte, ouvre `http://localhost:8777` → **⚙ Réglages**.
3. Colle la clé, choisis le modèle, **Enregistrer**.

La clé reste dans `writer_share_data/config.json` sur la machine hôte. Elle
n'est jamais envoyée aux autres postes, mais elle sert à toute l'équipe : les
demandes de chacun sont facturées sur ce compte. Une analyse complète envoie
tout le scénario au service d'Anthropic.

---

## 7. Sauvegardes

Tout est dans le dossier **`writer_share_data`**, à côté de l'application :

- `scenarios/` : un fichier par scénario (texte, versions, fiches, annotations,
  idées, discussion) ;
- `corbeille/` : les scénarios supprimés ;
- `config.json` : le code d'accès et la clé API.

Pour sauvegarder ou changer de machine hôte : copie ce dossier.

---

## 8. Ça ne marche pas ?

| Problème | Solution |
| --- | --- |
| La page ne s'ouvre pas chez un invité | Même Wi-Fi que l'hôte ? Fenêtre noire toujours ouverte ? Pare-feu autorisé (voir 1) ? |
| « Code d'accès incorrect » | Le code est dans la fenêtre noire et dans ⚙ Réglages, sur la machine hôte. |
| « Reconnexion… » en haut | L'hôte s'est mis en veille ou a fermé la fenêtre. Dès qu'il revient, tout se resynchronise. |
| Je ne peux pas écrire dans un chapitre | Quelqu'un y écrit (bandeau en haut). Attends, change de chapitre, ou « Prendre la main ». |
| L'adresse a changé | La box peut redistribuer les adresses : relis celle de la fenêtre noire. |
| « Le port 8777 est déjà utilisé » | Writer-Share tourne déjà : ouvre simplement `http://localhost:8777`. |
| Boutons IA grisés | Pas de clé API, ou module manquant : sur l'hôte, `pip install anthropic` (Python 3.10 ou plus récent). |
| PDF « sans texte » | C'est un scan : exporte un vrai PDF depuis ton logiciel, ou passe-le à l'OCR. |

Changer le code d'accès ou le port : ⚙ Réglages pour le code ;
`python writer_share.py --port 8778` pour le port.
