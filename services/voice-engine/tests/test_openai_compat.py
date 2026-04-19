"""Tests for OpenAI-compatible API endpoints."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest

from server import voice_cache


async def _stub_opus(_wav_bytes: bytes, _loop: Any) -> tuple[bytes, str]:
    """Stub that satisfies `_encode_opus`'s contract without invoking ffmpeg.

    CI runners don't have ffmpeg installed, so the real helper would hit its
    defensive WAV fallback and leak WAV into tests that assert audio/ogg.
    """
    return b"OggS\x00stub-opus-payload", "audio/ogg"


async def test_openai_transcriptions_delegates_to_transcribe(client: httpx.AsyncClient, mock_asr: MagicMock) -> None:
    """POST /v1/audio/transcriptions should return same result as /v1/transcribe."""
    response = await client.post(
        "/v1/audio/transcriptions",
        data={"model": "whisper-1"},
        files={"file": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json()["text"] == "Hello, this is a test transcription."


async def test_openai_transcriptions_ignores_model_param(client: httpx.AsyncClient, mock_asr: MagicMock) -> None:
    """Model parameter is accepted but ignored (always uses Parakeet)."""
    response = await client.post(
        "/v1/audio/transcriptions",
        data={"model": "completely-different-model"},
        files={"file": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json()["text"] == "Hello, this is a test transcription."


async def test_openai_speech_delegates_to_tts(
    client: httpx.AsyncClient, mock_tts: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """POST /v1/audio/speech should return Opus-in-Ogg audio (same pipeline as /v1/tts)."""
    import server

    monkeypatch.setattr(server, "_encode_opus", _stub_opus)
    voice_cache["alba"] = {"state": "mock"}

    response = await client.post(
        "/v1/audio/speech",
        data={"input": "Hello world", "model": "tts-1", "voice": "alba"},
    )

    assert response.status_code == 200
    # audio/ogg is also more OpenAI-compatible — OpenAI's TTS API supports Opus as a
    # response_format; WAV used to be our default only because scipy.io.wavfile.write
    # was the simplest path from Pocket TTS output.
    assert response.headers["content-type"] == "audio/ogg"
    assert len(response.content) > 0


async def test_openai_speech_ignores_model_param(
    client: httpx.AsyncClient, mock_tts: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Model parameter is accepted but ignored (always uses Pocket TTS)."""
    import server

    monkeypatch.setattr(server, "_encode_opus", _stub_opus)
    voice_cache["alba"] = {"state": "mock"}

    response = await client.post(
        "/v1/audio/speech",
        data={"input": "Hello", "model": "completely-different", "voice": "alba"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/ogg"


async def test_openai_speech_returns_503_when_model_not_loaded(
    client: httpx.AsyncClient,
) -> None:
    """POST /v1/audio/speech returns 503 when TTS model is not loaded."""
    response = await client.post(
        "/v1/audio/speech",
        data={"input": "Hello", "model": "tts-1", "voice": "alba"},
    )

    assert response.status_code == 503
