"""Tests for TTS reference audio upload and validation in /v1/tts."""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import pytest

import server as server_mod
from server import voice_cache


async def test_tts_with_reference_audio_caches_voice(
    client: httpx.AsyncClient, mock_tts: MagicMock
) -> None:
    """Uploading reference_audio should register the voice in cache."""
    response = await client.post(
        "/v1/tts",
        data={"text": "Hello world", "voice_id": "new-voice"},
        files={"reference_audio": ("ref.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 200
    assert "new-voice" in voice_cache
    mock_tts.get_state_for_audio_prompt.assert_called_once()


async def test_tts_rejects_oversized_reference_audio(
    client: httpx.AsyncClient, mock_tts: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Reference audio exceeding MAX_AUDIO_UPLOAD_BYTES should be rejected."""
    monkeypatch.setattr(server_mod, "MAX_AUDIO_UPLOAD_BYTES", 100)

    response = await client.post(
        "/v1/tts",
        data={"text": "Hello", "voice_id": "test-voice"},
        files={"reference_audio": ("ref.wav", b"\x00" * 101, "audio/wav")},
    )

    assert response.status_code == 413
    assert "too large" in response.json()["detail"].lower()


async def test_tts_rejects_unsupported_reference_mime_type(
    client: httpx.AsyncClient, mock_tts: MagicMock
) -> None:
    """Reference audio with unsupported MIME type should be rejected."""
    response = await client.post(
        "/v1/tts",
        data={"text": "Hello", "voice_id": "test-voice"},
        files={"reference_audio": ("ref.txt", b"not audio", "text/plain")},
    )

    assert response.status_code == 400
    assert "unsupported audio type" in response.json()["detail"].lower()


async def test_tts_generic_exception_returns_500(
    client: httpx.AsyncClient, mock_tts: MagicMock
) -> None:
    """Unexpected exceptions during TTS should return 500."""
    voice_cache["alba"] = {"state": "mock"}
    mock_tts.generate_audio.side_effect = RuntimeError("Unexpected model error")

    response = await client.post(
        "/v1/tts",
        data={"text": "Hello", "voice_id": "alba"},
    )

    assert response.status_code == 500
    assert "Speech generation failed" in response.json()["detail"]


async def test_tts_uses_cached_voice_without_reference(
    client: httpx.AsyncClient, mock_tts: MagicMock
) -> None:
    """When voice_id is in cache, use it without needing reference audio."""
    voice_cache["cached-voice"] = {"state": "pre-cached"}

    response = await client.post(
        "/v1/tts",
        data={"text": "Hello", "voice_id": "cached-voice"},
    )

    assert response.status_code == 200
    # Should have called generate_audio with the cached state
    mock_tts.generate_audio.assert_called_once()
    # The first arg to generate_audio should be the cached voice state
    call_args = mock_tts.generate_audio.call_args
    assert call_args is not None
    assert call_args[0][0] == {"state": "pre-cached"}
