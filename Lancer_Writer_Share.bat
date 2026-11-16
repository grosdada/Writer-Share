@echo off
chcp 65001 >nul
title Writer-Share
cd /d "%~dp0"
set PY=python
where python >nul 2>nul || set PY=py -3
%PY% --version >nul 2>nul || (
  echo Python n'est pas installe sur ce PC.
  echo Installe-le depuis https://www.python.org/downloads/ en cochant "Add python.exe to PATH", puis relance ce fichier.
  pause
  exit /b 1
)
rem Module optionnel pour les fonctions IA : installe une seule fois.
%PY% -c "import anthropic" 2>nul || (
  echo Installation du module IA, une seule fois...
  %PY% -m pip install --quiet --user --disable-pip-version-check anthropic
)
%PY% writer_share.py %*
pause
