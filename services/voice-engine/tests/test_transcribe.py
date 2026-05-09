"""Tests for POST /v1/transcribe endpoint."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import httpx
import pytest

import server


async def test_transcribe_returns_text(client: httpx.AsyncClient, mock_asr: MagicMock) -> None:
    fake_wav = b"RIFF" + b"\x00" * 100  # minimal fake audio bytes

    response = await client.post(
        "/v1/transcribe",
        files={"file": ("test.wav", fake_wav, "audio/wav")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "Hello, this is a test transcription."


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


async def test_transcribe_accepts_bearer_token(client: httpx.AsyncClient, mock_asr: MagicMock, api_key: str) -> None:
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


async def test_transcribe_returns_empty_string_for_silent_audio(client: httpx.AsyncClient, mock_asr: MagicMock) -> None:
    from tests.helpers import FakeTranscription

    mock_asr.transcribe.return_value = [FakeTranscription("")]

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


async def test_transcribe_serializes_concurrent_calls(client: httpx.AsyncClient, mock_asr: MagicMock) -> None:
    # NeMo's RNNT freeze/unfreeze state is shared per-model. Without the lock,
    # two concurrent transcribe calls overlap inside `.transcribe()` and the
    # second one's cleanup hook raises ValueError. The lock guarantees the
    # underlying call is invoked one-at-a-time even when callers race.
    from tests.helpers import FakeTranscription

    in_flight = 0
    max_in_flight = 0

    def tracking_transcribe(_audio: object) -> list[object]:
        nonlocal in_flight, max_in_flight
        in_flight += 1
        max_in_flight = max(max_in_flight, in_flight)
        try:
            return [FakeTranscription("ok")]
        finally:
            in_flight -= 1

    mock_asr.transcribe.side_effect = tracking_transcribe
    fake_wav = b"RIFF" + b"\x00" * 100

    responses = await asyncio.gather(
        *(client.post("/v1/transcribe", files={"file": ("t.wav", fake_wav, "audio/wav")}) for _ in range(4))
    )

    assert all(r.status_code == 200 for r in responses)
    assert max_in_flight == 1
