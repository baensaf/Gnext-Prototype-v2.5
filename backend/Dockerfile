FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps || npm install
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps || npm install --omit=dev
COPY --from=builder /app/dist ./dist
# Iran Burger's product photos; the seed copies them into the uploads volume.
COPY --from=builder /app/seed-assets ./seed-assets
RUN mkdir -p /app/uploads /app/data

EXPOSE 3100
CMD ["sh", "-c", "node dist/src/scripts/migration-fresh.js && node dist/src/main.js"]
