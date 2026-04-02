FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./package.json
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

COPY frontend ./frontend

ARG VITE_API_BASE=
ENV VITE_API_BASE=$VITE_API_BASE

RUN cd frontend && npm run build

FROM nginx:1.27-alpine AS runtime

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
