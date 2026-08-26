# Self-hosted production image. Uses node:20-slim (Debian-based, glibc) rather
# than alpine specifically so the Prisma engine binary matches the
# "debian-openssl-3.0.x" target declared in prisma/schema.prisma — see the
# comment there and docs/SELF_HOSTING.md before changing the base image.

FROM node:20-slim AS base

# --- deps: install once, reused by both the builder and migrate stages ---
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: package.json's own "postinstall" runs `prisma generate`, which
# needs prisma/schema.prisma — not present in this stage (only package.json/
# package-lock.json are, so this layer caches across unrelated source changes).
# Harmless to skip here: the builder stage below has the full source and already
# runs `prisma generate` explicitly before `next build`.
RUN npm ci --ignore-scripts

# --- builder: full app build, including prisma generate + next build ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# --- migrate: one-shot container that applies pending migrations, ensures the
# super admin from SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD exists (no-op if already
# seeded or if those vars are unset — see prisma/seed.ts), then exits. Has the
# full node_modules (incl. the prisma CLI and tsx), unlike the slim runner below.
# Runs before `app` via docker-compose's dependency ordering.
FROM builder AS migrate
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts"]

# --- runner: minimal final image, only what next.config.ts's `output: "standalone"`
# actually needs to run the server ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Next.js's standalone-output file tracer doesn't reliably pick up Prisma's
# native query-engine binary (it's loaded dynamically, not via a static
# require() the tracer can follow) — copy the generated client explicitly
# rather than trusting the trace, to avoid a silent "works locally, crashes in
# the container" gap. See prisma/schema.prisma's binaryTargets comment.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client

USER nextjs
EXPOSE 3000

# Hits `/`, which queries the DB (getCompanySettings) — a 5xx here means either
# the Next.js process or its DB connection (e.g. RDS reachability) is down.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/'},r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"]

CMD ["node", "server.js"]
