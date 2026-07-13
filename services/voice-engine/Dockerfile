FROM python:3.11-slim

WORKDIR /app

# Runtime system dependencies for audio processing
# espeak-ng: included defensively (may be needed by Pocket TTS for phonemization)
# curl: needed for HEALTHCHECK command
RUN apt-get update && apt-get install -y \
    libsndfile1 \
    ffmpeg \
    espeak-ng \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch first (saves ~2GB vs CUDA version)
# Pre-built wheels — no build-essential needed
RUN pip install --no-cache-dir \
    "torch>=2.5.0,<3.0.0" "torchaudio>=2.5.0,<3.0.0" \
    --index-url https://download.pytorch.org/whl/cpu

# Install remaining Python dependencies
# build-essential is installed and purged in the SAME layer so the compiler
# toolchain doesn't persist in any layer of the final image (~200-300MB savings).
# Multi-stage build would be cleaner but is deferred to Phase 2.
COPY requirements.txt .
RUN apt-get update && apt-get install -y build-essential \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y build-essential && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy application code
COPY server.py .

# Ensure voices directory exists for volume mount
RUN mkdir -p /app/voices

# Default port (Railway will set PORT env var)
ENV PORT=8000
# Ensure print() output appears immediately in Railway logs (no buffering)
ENV PYTHONUNBUFFERED=1
EXPOSE ${PORT}

# Health check — the 120s start-period accommodates model loading on cold boot.
# This is especially important with Railway Serverless mode, where the container
# starts from scratch each time it wakes from sleep.
# Hardcoded port 8000 rather than ${PORT} — ENV PORT=8000 above is baked at build
# time, not overridden by Railway's runtime PORT, so the variable would always
# resolve to 8000 anyway. Uses [::1] (IPv6 loopback) since the server binds to ::.
HEALTHCHECK --interval=30s --timeout=30s --start-period=120s --retries=3 \
    CMD curl -f http://[::1]:8000/health || exit 1

# Model caches live on the Railway volume (when mounted) so downloaded models
# survive redeploys: a fresh deployment reuses the cached Parakeet/Pocket
# weights instead of re-downloading multi-GB files from HuggingFace at first
# wake — HF availability from datacenter IPs is not reliable enough to sit on
# the boot path (a platform-wide anonymous-download outage froze a dev boot
# indefinitely at "Loading Parakeet").
#
# Shell-form CMD so the env expands at CONTAINER START, before Python exists —
# huggingface_hub snapshots HF_HOME at import time, and server.py imports the
# model libraries at module top, so setting these any later is too late.
# HF_HOME covers huggingface_hub downloads (Parakeet's .nemo via NeMo's HF
# routing, Pocket TTS weights); NEMO_CACHE_DIR covers NeMo's extraction cache
# (honored by nemo_toolkit 2.x; harmlessly ignored if a future version drops
# it — extraction would then redo per fresh container at local-disk speed).
# No volume mounted (local docker runs) → library-default caches, old behavior.
# `exec` keeps python as PID 1 for signal handling.
CMD if [ -n "$RAILWAY_VOLUME_MOUNT_PATH" ]; then \
      export HF_HOME="$RAILWAY_VOLUME_MOUNT_PATH/model-cache/huggingface" \
             NEMO_CACHE_DIR="$RAILWAY_VOLUME_MOUNT_PATH/model-cache/nemo"; \
    fi; \
    exec python server.py
