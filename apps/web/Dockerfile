FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

ARG VERSION=0.1.0
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Logs" \
      org.opencontainers.image.source="https://github.com/everyonesoftware/logs" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$REVISION"

WORKDIR /opt/logs/apps/web
COPY apps/web/app.js apps/web/settings.js apps/web/index.html apps/web/logs.cjs apps/web/package.json apps/web/server.cjs apps/web/styles.css ./
RUN npm version "$VERSION" --allow-same-version --no-git-tag-version --ignore-scripts \
    && install -d -m 0700 -o node -g node /var/lib/logs \
    && touch /var/lib/logs/.keep

ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 LOGS_DB_PATH=/var/lib/logs/logs.sqlite
EXPOSE 4173
USER node
CMD ["node", "server.cjs"]
