FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    DB_PATH=/data/learning.db

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# The SQLite database lives here. Attach a persistent volume at /data (on Railway: service → Volumes).
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
