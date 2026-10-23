# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build \
	&& npm prune --omit=dev \
	&& mkdir -p node_modules

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
	PORT=3000 \
	HOST=0.0.0.0 \
	KYARA_DATA_DIR=/data

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build

# /data contient la clé chiffrée + le key.bin : il doit appartenir à l'utilisateur
# qui fait tourner le process, sinon l'écriture échoue.
RUN mkdir -p /data && chown -R node:node /data /app

USER node
VOLUME ["/data"]
EXPOSE 3000

# Le dashboard peut répondre 303 (/login) ou 401 (/api/state) : tout sauf 5xx = vivant.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build"]
