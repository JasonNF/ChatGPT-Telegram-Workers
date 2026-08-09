import * as fs from 'node:fs/promises';
import path from 'node:path';

const dockerfile = `
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS prod

ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/JasonNF/ChatGPT-Telegram-Workers" \\
      org.opencontainers.image.revision="\${VCS_REF}"

WORKDIR /app
COPY index.js package.json package-lock.json healthcheck.mjs /app/
RUN apk add --no-cache sqlite && \
npm ci --omit=dev && \
npm cache clean --force
ENV NODE_ENV=production
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD ["node", "/app/healthcheck.mjs"]
CMD ["node", "index.js"]
`;

export function createDockerPlugin(targetDir: string) {
    return {
        name: 'docker',
        async closeBundle() {
            await fs.writeFile(path.resolve(targetDir, 'Dockerfile'), dockerfile.trim());

            await Promise.all([
                fs.copyFile(path.resolve(process.cwd(), 'package.json'), path.resolve(targetDir, 'package.json')),
                fs.copyFile(path.resolve(process.cwd(), 'package-lock.json'), path.resolve(targetDir, 'package-lock.json')),
                fs.copyFile(path.resolve(process.cwd(), 'scripts/plugins/docker/healthcheck.mjs'), path.resolve(targetDir, 'healthcheck.mjs')),
            ]);
        },
    };
}
