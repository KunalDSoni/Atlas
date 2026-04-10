FROM node:20-alpine

WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --production

# Copy backend code
COPY backend/ ./backend/

# Copy frontend build
COPY frontend/build/ ./frontend/build/

# Environment
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

WORKDIR /app/backend
CMD ["node", "server.js"]
