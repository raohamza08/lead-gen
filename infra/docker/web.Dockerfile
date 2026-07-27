FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/types/package.json packages/types/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --workspaces --if-present --include-workspace-root
COPY packages/types packages/types
COPY apps/web apps/web
RUN npm run build --workspace=packages/types
RUN npm run build --workspace=apps/web

FROM node:20-alpine
WORKDIR /repo/apps/web
ENV NODE_ENV=production
COPY --from=build /repo/apps/web ./
COPY --from=build /repo/node_modules /repo/node_modules
EXPOSE 3000
CMD ["npm", "run", "start"]
