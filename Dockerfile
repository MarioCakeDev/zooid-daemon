FROM node:22-slim AS build

RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Build the zooid CLI from our fork instead of the upstream npm package, so
# fork-only fixes ship. Pinned to an explicit commit: this is a build input, and
# a floating ref would make image contents unreproducible. Bump deliberately.
ARG ZOOID_REPO=https://github.com/MarioCakeDev/zooid
ARG ZOOID_REF=15f430d54f560829e288ff5abf686d48368ce87f
RUN corepack enable && \
    git clone "$ZOOID_REPO" /src && \
    cd /src && git checkout "$ZOOID_REF" && \
    pnpm install --frozen-lockfile && \
    pnpm build && \
    pnpm --filter zooid deploy --prod --legacy /app

FROM node:22-slim

# Install Docker CLI (not daemon - we use the host's Docker via socket)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        docker.io \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Deploy the built CLI and expose it as a global `zooid` on PATH. The dist is
# bundled (tsup noExternal @zooid/*), so the patch script below can target the
# same path the previous npm-installed image used.
COPY --from=build /app /app
RUN mkdir -p /usr/local/lib/node_modules && \
    ln -s /app /usr/local/lib/node_modules/zooid && \
    ln -s /app/dist/bin.js /usr/local/bin/zooid && \
    chmod +x /app/dist/bin.js

# Apply structural patches (inhibit_login for MAS/OAuth2, bootstrap retry).
COPY patches /tmp/patches
RUN node /tmp/patches/patch-zooid.mjs && rm -rf /tmp/patches

# Verify installation
RUN zooid --version

# Keep this path identical to the host path the workforce directory is mounted
# at (docker-compose.yaml binds /opt/matrix/zooid/workforce to itself), so bind
# sources the daemon hands to sibling agent containers (through the host Docker
# socket) resolve to the real host paths.
WORKDIR /opt/matrix/zooid/workforce

# Expose the daemon port
EXPOSE 9099

ENTRYPOINT ["zooid"]
CMD ["start"]
