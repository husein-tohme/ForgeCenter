# ForgeCenter website and bot runner in one image.
#   docker compose up -d        (see docker-compose.yml: runs both)
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY templates/discord-bot/package.json templates/discord-bot/package-lock.json ./templates/discord-bot/
RUN npm ci --omit=dev --prefix templates/discord-bot && npm cache clean --force

COPY src ./src
COPY public ./public
COPY templates/discord-bot/src ./templates/discord-bot/src

# Accounts, orders and customer bot databases live in /app/data. Mount a volume there.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
