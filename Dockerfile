# Image de Writer-Share en mode public, prévue pour tourner derrière un proxy
# HTTPS (Traefik, Caddy, nginx). Voir docker-compose.yml.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

# Le module anthropic ne sert qu'aux fonctions IA ; l'appli tourne sans.
RUN pip install --no-cache-dir anthropic \
 && useradd --system --uid 10001 --no-create-home writershare \
 && mkdir /data && chown writershare:writershare /data

WORKDIR /app
COPY writer_share.py MANUEL.md ./
COPY web ./web

USER writershare
VOLUME /data
EXPOSE 8777

# Dans le conteneur on écoute sur toutes les interfaces : le port n'est pas
# publié sur l'hôte, seul le proxy du réseau Docker peut l'atteindre.
CMD ["python", "writer_share.py", "--public", "--no-browser", "--host", "0.0.0.0", "--port", "8777", "--data", "/data"]
