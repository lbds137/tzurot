"""Tests for POST /v1/transcribe endpoint."""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import pytest

import server
from server import MAX_AUDIO_UPLOAD_BYTES


async def test_transcribe_returns_text(client: httpx.AsyncClient, mock_asr: MagicMock) -> None:
    fake_wav = b"RIFF" + b"\x00" * 100  # minimal fake audio bytes

    response = await client.post(
        "/v1/transcribe",
        files={"file": ("test.wav", fake_wav, "audio/wav")},
    )

    assert response.status_code == 200
    body = response.json()
    assert "text" in body
    assert isinstance(body["text"], str)
    assert len(body["text"]) > 0


async def test_transcribe_returns_503_when_model_not_loaded(client: httpx.AsyncClient) -> None:
    # No mock_asr fixture — models dict is empty
    response = await client.post(
        "/v1/transcribe",
        files={"file": ("test.wav", b"fake-audio", "audio/wav")},
    )

    assert response.status_code == 503
    assert "STT model not loaded" in response.json()["detail"]


async def test_transcribe_rejects_oversized_file(
    client: httpx.AsyncClient, mock_asr: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Patch to a tiny limit so we don't allocate 50MB in tests
    monkeypatch.setattr(server, "MAX_AUDIO_UPLOAD_BYTES", 100)
    oversized = b"\x00" * 101

    response = await client.post(
        "/v1/transcribe",
        files={"file": ("huge.wav", oversized, "audio/wav")},
    )

    assert response.status_code == 413
    assert "too large" in response.json()["detail"]


async def test_transcribe_requires_auth_when_key_set(
    client: httpx.AsyncClient, mock_asr: MagicMock, api_key: str
) -> None:
    response = await client.post(
        "/v1/transcribe",
        files={"file": ("test.wav", b"fake-audio", "audio/wav")},
    )

    assert response.status_code == 401


async def test_transcribe_accepts_bearer_token(
    client: httpx.AsyncClient, mock_asr: MagicMock, api_key: str
) -> None:
    response = await client.post(
        "/v1/transcribe",
        files={"file": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
        headers={"Authorization": f"Bearer {api_key}"},
    )

    assert response.status_code == 200


async def test_transcribe_accepts_x_api_key_header(
    client: httpx.AsyncClient, mock_asr: MagicMock, api_key: str
) -> None:
    response = await client.post(
        "/v1/transcribe",
        files={"file": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
        headers={"X-API-Key": api_key},
    )

    assert response.status_code == 200


async def test_transcribe_returns_empty_string_for_silent_audio(
    client: httpx.AsyncClient, mock_asr: MagicMock
) -> None:
    from tests.conftest import _FakeTranscription

    mock_asr.transcribe.return_value = [_FakeTranscription("")]

    response = await client.post(
        "/v1/transcribe",
        files={"file": ("silence.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json()["text"] == ""


async def test_transcribe_handles_model_error(client: httpx.AsyncClient, mock_asr: MagicMock) -> None:
    mock_asr.transcribe.side_effect = RuntimeError("Model inference failed")

    response = await client.post(
        "/v1/transcribe",
        files={"file": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 500
    assert "Transcription failed" in response.json()["detail"]
