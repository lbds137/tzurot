FROM python:3.11-slim

WORKDIR /app

# System dependencies for audio processing
# espeak-ng: included defensively (may be needed by Pocket TTS for phonemization)
# curl: needed for HEALTHCHECK command
# build-essential: needed for pip install of native extensions (purged after)
RUN apt-get update && apt-get install -y \
    libsndfile1 \
    ffmpeg \
    espeak-ng \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch first (saves ~2GB vs CUDA version)
RUN pip install --no-cache-dir \
    "torch>=2.5.0,<3.0.0" "torchaudio>=2.5.0,<3.0.0" \
    --index-url https://download.pytorch.org/whl/cpu

# Install remaining Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Purge build tools — only needed during pip install (~200-300MB savings)
RUN apt-get purge -y build-essential && apt-get autoremove -y \
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
EXPOSE ${PORT}

# Health check — the 120s start-period accommodates model loading on cold boot.
# This is especially important with Railway Serverless mode, where the container
# starts from scratch each time it wakes from sleep.
HEALTHCHECK --interval=30s --timeout=30s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["python", "server.py"]
