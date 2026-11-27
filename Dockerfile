# Stage 1: Build the Vite + React + PWA frontend bundle
FROM node:22.22.0-bookworm-slim AS builder

WORKDIR /app

# Install exact locked dependencies reproducibly from package-lock.json
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy project source and compile dist/
COPY . .
RUN npm run build

# Stage 2: Lean production runtime (Node 22.22.0 native TypeScript execution)
FROM node:22.22.0-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV TRUST_PROXY=1

# Install only production dependencies from the same package-lock.json
# so build and runtime stages use identical resolved dependency versions
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

# Copy built frontend and server runtime modules with non-root ownership
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server.ts ./server.ts
COPY --from=builder --chown=node:node /app/src/server ./src/server
COPY --from=builder --chown=node:node /app/src/engine ./src/engine
COPY --from=builder --chown=node:node /app/src/lib/settings.ts ./src/lib/settings.ts
COPY --from=builder --chown=node:node /app/src/lib/trickHistory.ts ./src/lib/trickHistory.ts

# Ensure non-root runtime user can read all app files and node_modules
RUN chown -R node:node /app
USER node

# Documentation hint only: explicitly configure Northflank public HTTP(S) ingress target port as 3000
EXPOSE 3000

# Exec form ensures node is PID 1 and receives SIGTERM directly for graceful shutdown
CMD ["node", "server.ts"]
