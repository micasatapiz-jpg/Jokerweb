FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Optional build-only CA for environments with an HTTPS proxy. Never disable TLS
# verification or put the proxy certificate in the production image.
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; npm ci --no-audit --fetch-retries=1 --fetch-timeout=30000
COPY index.html vite.config.js ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
ARG VITE_SITE_URL
ENV VITE_SITE_URL=$VITE_SITE_URL
ENV VITE_ENABLE_SALES_APP=false
RUN npm run build

FROM caddy:2-alpine
RUN mkdir -p /srv /config /data && chown -R 10001:10001 /srv /config /data
COPY --from=build --chown=10001:10001 /app/dist /srv
COPY --chown=10001:10001 Caddyfile /etc/caddy/Caddyfile
ENV PORT=3000
USER 10001:10001
EXPOSE 3000
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
