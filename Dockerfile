FROM node:22-slim AS build

RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Build the zooid CLI from our fork instead of the upstream npm package, so
# fork-only fixes ship. Pinned to an explicit commit: this is a build input, and
# a floating ref would make image contents unreproducible. Bump deliberately.
# 3b9f147c = MarioCakeDev/zooid `main` after PR #37 merged: a prose boundary now
# flushes the closed tool/plan group's queued coalesced mirror frames, so a tool
# line lands complete (not a stale ⏳/•) before the prose it belongs to. This is a
# squash commit on `main` — a durable ref (previous: 9729d8a2, PR #36).
ARG ZOOID_REPO=https://github.com/MarioCakeDev/zooid
ARG ZOOID_REF=3b9f147c896c08dbb9020acd95736a077a02a0d9
RUN corepack enable && \
    git clone "$ZOOID_REPO" /src && \
    cd /src && git checkout "$ZOOID_REF" && \
    pnpm install --frozen-lockfile && \
    pnpm build && \
    cd packages/cli && pnpm pack --pack-destination /out

FROM node:22-slim

# Install Docker CLI (not daemon - we use the host's Docker via socket)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        docker.io \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install the built CLI globally, npm-style (flat, real node_modules) at
# /usr/local/lib/node_modules/zooid. This is NOT cosmetic: the daemon resolves
# `@zooid/context-mcp/bin` at runtime and bind-mounts its directory into each
# agent container as /zooid/context-mcp. The bind source must be a path the HOST
# can see, so it must stay at the flat path the host already has — a pnpm
# `.pnpm/<hash>` realpath is invisible to the host and mounts as an empty dir
# (which silently disables the zooid MCP: no zooid_* tools in any agent).
COPY --from=build /out/zooid-*.tgz /tmp/zooid.tgz
RUN npm install -g /tmp/zooid.tgz && rm /tmp/zooid.tgz

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
