FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV CI=true
COPY package.json pnpm-lock.yaml* package-lock.json* npm-shrinkwrap.json* ./
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY . .
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV CI=true
RUN corepack enable && corepack prepare pnpm@latest --activate
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml* ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends dialog openssh-server \
  && echo "root:Docker!" | chpasswd \
  && mkdir -p /run/sshd /var/cache/kontent-proxy \
  && rm -rf /var/lib/apt/lists/*
COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh ./
RUN chmod u+x ./entrypoint.sh
COPY --from=builder /app/dist ./dist
RUN pnpm install --frozen-lockfile --prod || pnpm install --prod
ENV CACHE_DIR=/var/cache/kontent-proxy
ENV PORT=8080
EXPOSE 8080 2222
ENTRYPOINT ["./entrypoint.sh"]
