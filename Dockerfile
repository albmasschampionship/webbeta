# Node image for the full ticketing app (real Stripe payments).
# The GitHub Pages build is the static showcase; this image runs the API.
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321

COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public

# Registrations are written here (mount a volume or use a managed disk).
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4321/api/config >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
