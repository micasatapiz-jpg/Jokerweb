FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
ENV VITE_SALES_API_URL=/api
RUN npm run build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server ./
RUN DATABASE_URL=postgresql://build:build@localhost/build npm run prisma:generate
RUN npm run build

FROM base
WORKDIR /app/server
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/server/prisma ./prisma
COPY --from=build /app/server/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/dist /app/web
ENV NODE_ENV=production
ENV AI_PROVIDER=openai
ENV WEB_DIST_DIR=/app/web
ENV VISUAL_PROPOSALS_DIR=/data/visual-proposals
ENV QUOTE_ATTACHMENTS_DIR=/data/quote-attachments
CMD ["npm", "start"]
