FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN chown -R node:node /app
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node --input-type=module -e "import http from 'node:http'; const port = Number(process.env.PORT || 8787); const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 4000 }, (res) => process.exit(res.statusCode === 200 ? 0 : 1)); req.on('error', () => process.exit(1)); req.on('timeout', () => { req.destroy(); process.exit(1); });"

CMD ["node", "server.js"]
