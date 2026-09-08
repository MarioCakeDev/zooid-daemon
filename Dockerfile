FROM node:22-slim

# Install Docker CLI (not daemon - we use the host's Docker via socket)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        docker.io \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install zooid CLI globally
RUN npm install -g zooid@latest

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
