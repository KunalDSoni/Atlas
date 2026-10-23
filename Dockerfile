# ===== Atlas — Production Dockerfile =====
# Multi-stage build for minimal image size

# Stage 1: Install backend dependencies
FROM node:20-alpine AS deps
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --production && npm cache clean --force

# Stage 2: Build the frontend (Vite + React + Tailwind → static assets)
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 3: Production image
FROM node:20-alpine AS production
LABEL maintainer="atlas-team"
LABEL app="atlas"

# Security: run as non-root user
RUN addgroup -g 1001 -S atlas && \
    adduser -S atlas -u 1001 -G atlas

WORKDIR /app

# Copy dependencies from builder
COPY --from=deps /app/backend/node_modules ./backend/node_modules

# Copy application code (some source files are mode 0600 on the host —
# --chown + a normalizing chmod ensure the non-root atlas user can read them)
COPY --chown=atlas:atlas backend/ ./backend/
# Built from source in the `frontend` stage — not copied from the host.
COPY --from=frontend --chown=atlas:atlas /app/frontend/build/ ./frontend/build/
RUN chmod -R u+rwX,go+rX /app/backend /app/frontend

# Create writable directories for SQLite + uploads
RUN mkdir -p /app/data /app/backend/uploads && \
    chown -R atlas:atlas /app/data /app/backend/uploads

# Remove test files from production image
RUN rm -rf ./backend/tests ./backend/jest.config.* ./backend/.babelrc

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data
ENV SQLITE_PATH=/app/data/data.db

EXPOSE 3001

# Switch to non-root user
USER atlas

WORKDIR /app/backend

CMD ["node", "server.js"]
