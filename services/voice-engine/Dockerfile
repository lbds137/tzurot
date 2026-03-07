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

# Create non-root user (CWE-250: least privilege)
RUN useradd -m -u 1000 appuser \
    && mkdir -p /app/voices \
    && chown -R appuser:appuser /app/voices
USER appuser

# Default port (Railway will set PORT env var)
ENV PORT=8000
# Ensure print() output appears immediately in Railway logs (no buffering)
ENV PYTHONUNBUFFERED=1
EXPOSE ${PORT}

# Health check — the 120s start-period accommodates model loading on cold boot.
# This is especially important with Railway Serverless mode, where the container
# starts from scratch each time it wakes from sleep.
HEALTHCHECK --interval=30s --timeout=30s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["python", "server.py"]
