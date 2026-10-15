# Production image for the bot.
#   docker build -t my-discord-bot .
#   docker run -d --name my-discord-bot --restart unless-stopped --env-file .env -v my-bot-data:/app/data my-discord-bot
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# The database lives in /app/data. Mount a volume there so it survives updates and restarts.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
