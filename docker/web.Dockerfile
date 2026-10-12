# Build the static client, then serve it with nginx (which also proxies /ws to the server).
FROM node:24.21.0-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build:client

FROM nginx:1.30.5-alpine
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist/client /usr/share/nginx/html
EXPOSE 80
