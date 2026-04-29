# ===== Atlas — Production Dockerfile =====
# Multi-stage build for minimal image size

# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --production && npm cache clean --force

# Stage 2: Production image
FROM node:20-alpine AS production
LABEL maintainer="atlas-team"
LABEL app="atlas"

# Security: run as non-root user
RUN addgroup -g 1001 -S atlas && \
    adduser -S atlas -u 1001 -G atlas

WORKDIR /app

# Copy dependencies from builder
COPY --from=deps /app/backend/node_modules ./backend/node_modules

# Copy application code
COPY backend/ ./backend/
COPY frontend/build/ ./frontend/build/

# Create writable directories for SQLite + uploads
RUN mkdir -p /app/data /app/backend/uploads && \
    chown -R atlas:atlas /app/data /app/backend/uploads

# Remove test files from production image
RUN rm -rf ./backend/tests ./backend/jest.config.* ./backend/.babelrc

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data

EXPOSE 3001

# Switch to non-root user
USER atlas

WORKDIR /app/backend

CMD ["node", "server.js"]
