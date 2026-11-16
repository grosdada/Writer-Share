# Installer Writer-Share sur un VPS

Le VPS devient l'hôte permanent : plus de fenêtre à laisser ouverte, plus de
pare-feu ni de Tailscale. Chacun a son compte et son mot de passe.

Ce guide vise Ubuntu ou Debian. Remplace partout `scenario.exemple.fr` par ton
sous-domaine. Les commandes se lancent en SSH sur le VPS.

## Avant de commencer

1. Chez ton registrar, crée un enregistrement DNS de type **A** :
   `scenario.exemple.fr` → l'adresse IP du VPS.
2. Vérifie que les ports **80** et **443** sont ouverts sur le VPS. Le port 8777
   doit rester fermé de l'extérieur : l'appli n'écoute que sur `127.0.0.1`.

## 1. Installer l'application

```bash
sudo apt update && sudo apt install -y python3 python3-venv git
sudo useradd --system --home /opt/writer-share --shell /usr/sbin/nologin writershare
sudo git clone https://github.com/grosdada/Writer-Share.git /opt/writer-share
sudo python3 -m venv /opt/writer-share/venv
sudo /opt/writer-share/venv/bin/pip install anthropic
sudo mkdir -p /var/lib/writer-share
sudo chown writershare:writershare /var/lib/writer-share
sudo chmod 700 /var/lib/writer-share
```

L'IA demande Python 3.10 ou plus récent (`python3 --version`). Avec une version
plus ancienne, tout fonctionne sauf l'IA.

## 2. Réglages du service

```bash
sudo nano /etc/writer-share.env
```

Contenu (la clé API est facultative ; elle peut aussi se saisir plus tard dans
les Réglages de l'appli) :

```
WRITER_SHARE_URL=https://scenario.exemple.fr
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
sudo chmod 600 /etc/writer-share.env
sudo cp /opt/writer-share/deploy/writer-share.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now writer-share
```

## 3. HTTPS

**Si rien ne tourne encore sur les ports 80/443 : Caddy** (certificat automatique).

```bash
sudo apt install -y caddy
sudo cp /opt/writer-share/deploy/Caddyfile.exemple /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # mets ton sous-domaine
sudo systemctl reload caddy
```

Si Caddy sert déjà d'autres sites, ajoute le bloc de `Caddyfile.exemple` à ton
Caddyfile au lieu de le remplacer.

**Si nginx tourne déjà sur le VPS :**

```bash
sudo cp /opt/writer-share/deploy/nginx.exemple.conf /etc/nginx/sites-available/writer-share
sudo nano /etc/nginx/sites-available/writer-share   # mets ton sous-domaine
sudo ln -s /etc/nginx/sites-available/writer-share /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d scenario.exemple.fr
```

## 4. Créer ton compte administrateur

Au premier lancement, le service écrit un lien à usage unique dans son journal :

```bash
sudo journalctl -u writer-share -n 20 --no-pager
```

Ouvre ce lien (`https://scenario.exemple.fr/?invite=…`), choisis ton prénom et
ton mot de passe : tu es administrateur.

## 5. Inviter l'équipe

Dans l'appli : **⚙ Réglages → + Inviter un auteur**. Copie le lien et envoie-le.
Chaque lien sert une seule fois et expire au bout de 7 jours. Au même endroit :
« Mot de passe oublié » (génère un lien de réinitialisation) et « Retirer ».

## 6. Sauvegarde quotidienne

```bash
sudo cp /opt/writer-share/deploy/sauvegarde.sh /usr/local/bin/writer-share-sauvegarde
sudo chmod +x /usr/local/bin/writer-share-sauvegarde
echo '15 4 * * * root /usr/local/bin/writer-share-sauvegarde' | sudo tee /etc/cron.d/writer-share
```

Une archive par jour dans `/var/backups/writer-share`, 30 jours gardés. Ces
archives restent sur le VPS : copie-les ailleurs de temps en temps (elles
contiennent tous les scénarios). Pour restaurer : arrête le service, décompresse
l'archive dans `/var/lib/`, relance le service.

## Au quotidien

| Besoin | Commande |
| --- | --- |
| Mettre à jour | `sudo git -C /opt/writer-share pull && sudo systemctl restart writer-share` |
| Voir si ça tourne | `systemctl status writer-share` |
| Lire le journal | `sudo journalctl -u writer-share -n 50 --no-pager` |
| Redémarrer | `sudo systemctl restart writer-share` |

Un redémarrage prend deux secondes ; les navigateurs se reconnectent tout seuls
et rien de ce qui est en cours de frappe n'est perdu.

**Plus aucun administrateur ne peut se connecter ?**

```bash
sudo systemctl stop writer-share
sudo -u writershare /opt/writer-share/venv/bin/python /opt/writer-share/writer_share.py \
  --admin-invite --data /var/lib/writer-share --url https://scenario.exemple.fr
sudo systemctl start writer-share
```

## Reprendre des scénarios commencés en local

Copie les fichiers de `writer_share_data/scenarios/` de ton ordinateur vers
`/var/lib/writer-share/scenarios/` sur le VPS, puis :

```bash
sudo chown -R writershare:writershare /var/lib/writer-share
sudo systemctl restart writer-share
```

## Ce qu'il faut savoir sur la sécurité

- L'appli ne doit jamais être lancée avec `--host 0.0.0.0` en mode public :
  elle fait confiance à l'adresse que lui transmet le proxy.
- Les mots de passe sont stockés hachés. La clé API reste sur le serveur.
- Après 8 essais ratés, un compte (et l'adresse qui essaie) est bloqué 5 minutes.
  Quelqu'un qui connaît un prénom peut donc gêner sa connexion, sans pouvoir entrer.
- Tous les membres voient et modifient tous les scénarios du serveur : il n'y a
  pas de cloisonnement par projet. Seuls les administrateurs peuvent supprimer
  un scénario, inviter ou changer les réglages.
