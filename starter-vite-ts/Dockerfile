# Stage 1: Build Vite React application
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps || npm install
COPY . .
ENV VITE_SERVER_URL=""
RUN npm run build

# Stage 2: Serve using Nginx
FROM nginx:alpine AS runner
# The stock IPv6 script runs `apk manifest`, which on Alpine 3.24 (apk-tools 3) goes to the
# Alpine CDN: slow from the VPS, and nginx did not start inside the health-check window. Our
# default.conf replaces the packaged one, so the script would change nothing anyway.
RUN rm -f /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
