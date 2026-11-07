FROM node:25-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:25-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DB_PATH=/data/grocery.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
VOLUME /data
EXPOSE 3001
CMD ["node", "server/index.ts"]
