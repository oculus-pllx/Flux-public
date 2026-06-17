FROM docker:27-cli
RUN apk add --no-cache git nodejs openssh-client docker-cli-compose
COPY server.js /updater/server.js
# The docker:cli entrypoint treats "node" as `docker node`; bypass it entirely.
ENTRYPOINT ["node", "/updater/server.js"]
