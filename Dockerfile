# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build

ENV HUSKY=0
WORKDIR /app

COPY package.json yarn.lock ./
RUN corepack enable \
    && corepack yarn install --frozen-lockfile --non-interactive

COPY . .
RUN corepack yarn web:build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY --from=build --chown=101:101 /app/dist/web/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
