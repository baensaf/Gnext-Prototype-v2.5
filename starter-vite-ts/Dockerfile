# Stage 1: Build Vite React application
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps || npm install
COPY . .
ENV VITE_SERVER_URL="
RUN npm run build

# Stage 2: Serve using Nginx
FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD [nginx, -g, daemon off;]
