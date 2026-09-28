# Wardrobe — web app + API in one container. Built for Synology Container
# Manager (DSM 7.2+), but runs on any Docker host (amd64 or arm64).
#
#   docker compose up -d --build
#
# All closet data (library.json, outfits.json, photos, cutouts and the
# background-removal model cache) lives in the /data volume.

ARG NODE_VERSION=22

# ---- 1. Install every dependency and build the web app --------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.mjs ./
COPY public ./public
COPY src ./src
COPY scripts ./scripts
COPY shared ./shared
RUN npm run build

# ---- 2. Production dependencies only --------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
# Set to "false" for a ~250 MB smaller image without on-device background
# removal (imports then keep the photo background, or you retry later).
ARG WITH_CUTOUT=true
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && if [ "$WITH_CUTOUT" != "true" ]; then rm -rf node_modules/@huggingface node_modules/onnxruntime-node node_modules/onnxruntime-web node_modules/onnxruntime-common; fi \
 && npm cache clean --force

# ---- 3. Runtime ------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="Wardrobe" \
      org.opencontainers.image.description="Self-hosted AI wardrobe: web app + API for the iOS app" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    WARDROBE_HOST=0.0.0.0 \
    PORT=4173 \
    WARDROBE_DATA_DIR=/data \
    WARDROBE_MODEL_CACHE=/data/models \
    HOME=/tmp \
    PUID=1000 \
    PGID=1000

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY scripts ./scripts
COPY shared ./shared
COPY docker/entrypoint.sh /usr/local/bin/wardrobe-entrypoint
RUN chmod 0755 /usr/local/bin/wardrobe-entrypoint && mkdir -p /data

VOLUME ["/data"]
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["wardrobe-entrypoint"]
CMD ["node", "scripts/serve.mjs"]
