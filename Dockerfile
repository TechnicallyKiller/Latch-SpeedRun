# --- stage 1: build the Rust verifier binary -------------------------------
FROM rust:1-bookworm AS verifier-build
WORKDIR /build
COPY verifier ./verifier
RUN cargo build --release --manifest-path verifier/Cargo.toml --bin agent_verify

# --- stage 2: Node runtime (no Rust toolchain shipped) ----------------------
FROM node:20-bookworm-slim
WORKDIR /app

# verifier source (for any data files it reads) + the prebuilt binary
COPY verifier ./verifier
COPY --from=verifier-build /build/verifier/target/release/agent_verify ./verifier/target/release/agent_verify

# agent server
COPY agents ./agents
WORKDIR /app/agents
RUN npm ci --omit=dev || npm install --omit=dev

ENV AGENT_VERIFY_BIN=/app/verifier/target/release/agent_verify
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "run", "server"]
