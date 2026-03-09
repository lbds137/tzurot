"""Tests for OpenAI-compatible API endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx

from server import voice_cache


async def test_openai_transcriptions_delegates_to_transcribe(
    client: httpx.AsyncClient, mock_asr: MagicMock
) -> None:
    """POST /v1/audio/transcriptions should return same result as /v1/transcribe."""
    response = await client.post(
        "/v1/audio/transcriptions",
        data={"model": "whisper-1"},
        files={"file": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json()["text"] == "Hello, this is a test transcription."


async def test_openai_transcriptions_ignores_model_param(
    client: httpx.AsyncClient, mock_asr: MagicMock
) -> None:
    """Model parameter is accepted but ignored (always uses Parakeet)."""
    response = await client.post(
        "/v1/audio/transcriptions",
        data={"model": "completely-different-model"},
        files={"file": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json()["text"] == "Hello, this is a test transcription."


async def test_openai_speech_delegates_to_tts(
    client: httpx.AsyncClient, mock_tts: MagicMock
) -> None:
    """POST /v1/audio/speech should return WAV audio."""
    voice_cache["alba"] = {"state": "mock"}

    response = await client.post(
        "/v1/audio/speech",
        data={"input": "Hello world", "model": "tts-1", "voice": "alba"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert len(response.content) > 0


async def test_openai_speech_ignores_model_param(
    client: httpx.AsyncClient, mock_tts: MagicMock
) -> None:
    """Model parameter is accepted but ignored (always uses Pocket TTS)."""
    voice_cache["alba"] = {"state": "mock"}

    response = await client.post(
        "/v1/audio/speech",
        data={"input": "Hello", "model": "completely-different", "voice": "alba"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"


async def test_openai_speech_returns_503_when_model_not_loaded(
    client: httpx.AsyncClient,
) -> None:
    """POST /v1/audio/speech returns 503 when TTS model is not loaded."""
    response = await client.post(
        "/v1/audio/speech",
        data={"input": "Hello", "model": "tts-1", "voice": "alba"},
    )

    assert response.status_code == 503
