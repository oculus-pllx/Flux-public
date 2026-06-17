FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
RUN npm install --production

COPY backend/ .
COPY install-agent.sh /install-agent.sh

# Bundle flux-agent as a downloadable tarball for the SSH install flow
COPY flux-agent/ /flux-agent/
RUN cd /flux-agent && npm install --production --silent && \
    tar czf /install-agent.tar.gz \
      --exclude='./__tests__' \
      --exclude='./windows' \
      -C /flux-agent .

RUN mkdir -p data

EXPOSE 5174

CMD ["node", "server.js"]
