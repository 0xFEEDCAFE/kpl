FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# WebSocket URL of the backend as seen from the player's browser.
# Vite bakes it into the bundle at build time. Required: without it the bundle
# would fall back to a hard-coded upstream server.
ARG VITE_SERVER_URL
RUN test -n "$VITE_SERVER_URL" || { echo "VITE_SERVER_URL build arg is required" >&2; exit 1; }
ENV VITE_SERVER_URL=$VITE_SERVER_URL

RUN npx vite build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
