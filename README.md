# Writer-Share

L'atelier de scénario à plusieurs, entre PC et Mac. Une machine héberge, les
autres ouvrent une adresse dans leur navigateur : rien à installer chez eux.

- **Import PDF** : découpage en chapitres et repérage des personnages.
- **Écriture partagée en direct** : un chapitre s'écrit à une personne à la
  fois, les autres voient le texte arriver.
- **Réécriture sans risque** : un brouillon partagé et un historique de versions
  par chapitre.
- **Travail d'équipe** : annotations sur un passage, étoiles, fiches
  personnages à cases, mur d'idées, discussion.
- **IA facultative** (API Claude, clé gardée côté serveur) : analyse des enjeux,
  des arcs et de la structure, correction, réécriture, avis de lecture.

## Deux façons de l'utiliser

| | Mode local | Mode public |
| --- | --- | --- |
| Pour | une équipe sur le même Wi-Fi, ou reliée par Tailscale | une équipe à distance, sur un VPS |
| Lancement | double-clic sur `Lancer_Writer_Share.bat` (PC) ou `.command` (Mac) | service sur le serveur, derrière un proxy HTTPS |
| Connexion | prénom + code d'accès commun | un compte et un mot de passe par personne, sur invitation |
| Guide | [MANUEL.md](MANUEL.md) | [deploy/DEPLOIEMENT-VPS.md](deploy/DEPLOIEMENT-VPS.md) |

## Prérequis

Python 3.9 ou plus récent sur la machine qui héberge, sans autre dépendance.
Les fonctions IA demandent Python 3.10 et le module `anthropic`, que les
lanceurs installent tout seuls.

## Organisation

- `writer_share.py` : le serveur (bibliothèque standard de Python).
- `web/` : l'interface, sans étape de construction. `web/vendor/` contient
  pdf.js (licence Apache 2.0) pour lire les PDF dans le navigateur.
- `deploy/` : service systemd, exemples de proxy, sauvegarde, guide VPS.
- `writer_share_data/` : créé au premier lancement, jamais versionné. Il
  contient les scénarios, le code d'accès, les comptes et la clé API.
