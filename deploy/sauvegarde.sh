#!/bin/bash
# Sauvegarde quotidienne des donnees de Writer-Share (scenarios, comptes, reglages).
# Installation : voir DEPLOIEMENT-VPS.md. Garde 30 jours d'archives.
set -euo pipefail

SOURCE=/var/lib/writer-share
DEST=/var/backups/writer-share
KEEP_DAYS=30

mkdir -p "$DEST"
chmod 700 "$DEST"
tar -czf "$DEST/writer-share-$(date +%F).tar.gz" -C "$(dirname "$SOURCE")" "$(basename "$SOURCE")"
find "$DEST" -name 'writer-share-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
