FROM node:22-slim

# Install Docker CLI (not daemon - we use the host's Docker via socket)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        docker.io \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pinned: patches/apply-poll-binding.mjs anchors on this release's acp-client.
RUN npm install -g zooid@0.18.0

# Bind the poll MCP server to each agent session (room + thread headers) so a
# poll can never be placed in another conversation's thread. Fails the build if
# the anchor is gone rather than shipping an unbound poll tool.
COPY patches/ /patches/
RUN node /patches/apply-poll-binding.mjs

# Verify installation
RUN zooid --version

# Working directory for the workforce
WORKDIR /workforce

# Expose the daemon port
EXPOSE 9099

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:9099/health || exit 1

ENTRYPOINT ["zooid"]
CMD ["start"]
