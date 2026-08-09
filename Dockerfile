FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS DEV

WORKDIR /app
COPY package.json package-lock.json vite.config.ts tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm ci && npm run build:local

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS PROD

ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/JasonNF/ChatGPT-Telegram-Workers" \
      org.opencontainers.image.revision="${VCS_REF}"

WORKDIR /app
COPY --from=DEV /app/dist/index.js /app/dist/index.js
COPY --from=DEV /app/package.json /app/package-lock.json /app/
COPY --from=DEV /app/dist/healthcheck.mjs /app/healthcheck.mjs
RUN apk add --no-cache sqlite && \
    npm ci --omit=dev && \
    npm cache clean --force
ENV NODE_ENV=production
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD ["node", "/app/healthcheck.mjs"]
CMD ["npm", "run", "start:dist"]
