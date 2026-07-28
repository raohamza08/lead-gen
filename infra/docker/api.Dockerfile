# Built with repo root as context so it can access packages/types (Part E3 folder structure).
FROM node:20-alpine AS build
# Prisma probes for libssl to decide which query engine to load. node:20-alpine
# ships neither the openssl package nor libssl3, so the probe fails, Prisma
# falls back to its openssl-1.1.x engine, and the container dies at boot with
# "Error loading shared library libssl.so.1.1". Needed in the build stage so
# `prisma generate` resolves the same target the runtime stage will.
RUN apk add --no-cache openssl
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/types/package.json packages/types/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm install --workspaces --if-present --include-workspace-root
COPY packages/types packages/types
COPY apps/api apps/api
RUN npm run build --workspace=packages/types
# The :ci variant, not the plain one — the plain script wraps prisma in
# `dotenv -e ../../.env`, and there is no repo-root .env inside the build
# context, so dotenv-cli would exit non-zero and fail the image build.
RUN npm run prisma:generate:ci --workspace=apps/api
RUN npm run build --workspace=apps/api

FROM node:20-alpine
# Same reason as the build stage — this is the one that actually runs the engine.
RUN apk add --no-cache openssl
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/types ./packages/types
COPY --from=build /repo/apps/api ./apps/api
WORKDIR /repo/apps/api
# Managed hosts inject PORT; main.ts prefers it and falls back to API_PORT/4000.
# EXPOSE is documentation only and doesn't constrain the injected value.
EXPOSE 4000
CMD ["node", "dist/main.js"]
