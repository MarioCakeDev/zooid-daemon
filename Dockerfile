FROM node:22-slim AS build

RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Build the zooid CLI from our fork instead of the upstream npm package, so
# fork-only fixes ship. Pinned to an explicit commit: this is a build input, and
# a floating ref would make image contents unreproducible. Bump deliberately.
# fe0e5b06 = MarioCakeDev/zooid main after PR #47 (merge of upstream zooid-ai/zooid
# @ 55a51bd0, 0.17.0 -> 0.18.0; fast-forward, so main IS the merge commit). Brings
# upstream typing-registry, dev.zooid.turn.end turn_id/stop_reason, thread-history
# has_more/batching, createRoom creator retry, send-message alias, context-mcp
# describeRole surfacing, per-agent runtime: + the vm runtime (packages/runtime-vm) —
# on top of the fork delta (Element mirror, reaction approvals, /interrupt, ACP
# resilience, unconditional task tools, Code-Mode tagline). FORK-DELTA.md regenerated.
# Previous pin: a9b04665 = main after PR #46 (Code Mode script literal newlines).
ARG ZOOID_REPO=https://github.com/MarioCakeDev/zooid
ARG ZOOID_REF=fe0e5b06081d4390d70971f65dbfe7e0ffc66923
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

# Overwrite the registry-installed context-mcp with our fork build. The CLI
# tarball declares `@zooid/context-mcp` as a normal dependency, so the npm
# install above fetches it from the npm registry (upstream) — every fork-only
# change to packages/context-mcp would silently never ship (the CLI's own code
# is bundled by tsup and does ship; this runtime-resolved package does not).
# The daemon resolves `@zooid/context-mcp/bin` and bind-mounts this directory
# into agents, so this COPY is what actually delivers context-mcp fixes.
COPY --from=build /src/packages/context-mcp/dist /usr/local/lib/node_modules/zooid/node_modules/@zooid/context-mcp/dist

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
