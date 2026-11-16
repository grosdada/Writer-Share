#!/bin/bash
# Lanceur Mac : double-clic dans le Finder.
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python n'est pas installé sur ce Mac."
  echo "Installe-le depuis https://www.python.org/downloads/ puis relance ce fichier."
  read -r -p "Appuie sur Entrée pour fermer."
  exit 1
fi
# Module optionnel pour les fonctions IA : installé une seule fois.
python3 -c "import anthropic" 2>/dev/null || {
  echo "Installation du module IA, une seule fois..."
  python3 -m pip install --quiet --user --disable-pip-version-check anthropic || echo "(module IA non installé : l'appli marche quand même, sans IA)"
}
python3 writer_share.py "$@"
read -r -p "Appuie sur Entrée pour fermer."
