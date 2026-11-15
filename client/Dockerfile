FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# WebSocket URL of the backend as seen from the player's browser.
# Vite bakes it into the bundle at build time.
ARG VITE_SERVER_URL=ws://localhost:3001
ENV VITE_SERVER_URL=$VITE_SERVER_URL

RUN npx vite build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
