# Minimal image for AWS App Runner (or any container host). No secrets and
# no .env file are baked in -- every environment variable in .env.example
# (MCP_SERVER_AUTH_TOKEN, AION_BACKEND_URL, AION_BACKEND_API_KEY, etc.) must
# be supplied by the hosting platform's own environment/secret configuration
# at deploy time, never at build time.
FROM node:20-slim

WORKDIR /app

# Install production dependencies only, in their own layer so source
# changes don't invalidate the (much slower) dependency install.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

ENV NODE_ENV=production
EXPOSE 3333

# server.js itself fails closed (see src/authConfig.js) if
# MCP_SERVER_AUTH_TOKEN is unset and MCP_ALLOW_NO_AUTH is not explicitly
# "true" -- there is no separate startup check needed here.
CMD ["node", "src/server.js"]
