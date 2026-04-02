FROM node:22-alpine AS deps
WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./package.json
COPY backend/package*.json ./backend/
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY backend ./backend

RUN cd backend && npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./package.json
COPY backend/package*.json ./backend/
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/db ./backend/db
COPY backend/entrypoint.sh ./backend/entrypoint.sh

RUN chmod +x ./backend/entrypoint.sh

WORKDIR /app/backend

CMD ["./entrypoint.sh"]
