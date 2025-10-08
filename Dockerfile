# Use an official Node.js runtime as the base image
FROM node:18-alpine

RUN apk add --no-cache curl yarn

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

COPY --chown=nodejs:nodejs package*.json yarn.lock ./

RUN yarn install --production --frozen-lockfile && yarn cache clean
COPY --chown=nodejs:nodejs . .
RUN mkdir -p logs && chown nodejs:nodejs logs
USER nodejs
EXPOSE 8787
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:8787/health || exit 1

# Command to run the bot
CMD ["node", "index.js"]
