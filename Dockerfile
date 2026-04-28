FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml* package-lock.json* npm-shrinkwrap.json* ./
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY . .
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm run build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod || pnpm install --prod
COPY --from=builder /app/dist ./dist
RUN mkdir -p /var/cache/kontent-proxy
ENV CACHE_DIR=/var/cache/kontent-proxy
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
