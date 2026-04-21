"""Tests for POST /v1/audio/transcode endpoint.

Covers the multi-chunk TTS path's re-encode step: ai-worker concatenates PCM
into a combined WAV, posts it here, and expects Opus-in-Ogg back. On ffmpeg
failure, the endpoint returns the original WAV so callers still get playable
audio — matching /v1/tts's defensive fallback.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from server import MAX_AUDIO_UPLOAD_BYTES


async def test_transcode_returns_opus_on_happy_path(client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Posted WAV is transcoded to Opus-in-Ogg via _encode_opus."""
    import server

    async def fake_encode(_wav_bytes: bytes, _loop: Any) -> tuple[bytes, str]:
        return b"OggS\x00fake-opus-payload", "audio/ogg"

    monkeypatch.setattr(server, "_encode_opus", fake_encode)

    response = await client.post(
        "/v1/audio/transcode",
        files={"file": ("combined.wav", b"RIFF\x24\x00\x00\x00WAVE-fake", "audio/wav")},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/ogg"
    assert response.content == b"OggS\x00fake-opus-payload"


async def test_transcode_falls_back_to_wav_when_ffmpeg_fails(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When _encode_opus falls back (returns WAV + audio/wav), endpoint passes it through."""
    import server

    async def fake_encode_fallback(wav_bytes: bytes, _loop: Any) -> tuple[bytes, str]:
        return wav_bytes, "audio/wav"

    monkeypatch.setattr(server, "_encode_opus", fake_encode_fallback)
    wav_in = b"RIFF\x24\x00\x00\x00WAVE-fallback-data"

    response = await client.post(
        "/v1/audio/transcode",
        files={"file": ("combined.wav", wav_in, "audio/wav")},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content == wav_in


async def test_transcode_rejects_oversize_upload(client: httpx.AsyncClient) -> None:
    """Uploads larger than MAX_AUDIO_UPLOAD_BYTES (50 MB) are rejected with 413."""
    oversize = b"\x00" * (MAX_AUDIO_UPLOAD_BYTES + 1)

    response = await client.post(
        "/v1/audio/transcode",
        files={"file": ("huge.wav", oversize, "audio/wav")},
    )

    assert response.status_code == 413


async def test_transcode_rejects_empty_body(client: httpx.AsyncClient) -> None:
    """Empty uploads return 400 (not a silent encode of nothing)."""
    response = await client.post(
        "/v1/audio/transcode",
        files={"file": ("empty.wav", b"", "audio/wav")},
    )

    assert response.status_code == 400


async def test_transcode_surfaces_unexpected_exceptions_as_500(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Unexpected errors inside _encode_opus become 500 with a generic detail."""
    import server

    async def fake_encode_raise(_wav_bytes: bytes, _loop: Any) -> tuple[bytes, str]:
        raise RuntimeError("something internal went wrong")

    monkeypatch.setattr(server, "_encode_opus", fake_encode_raise)

    response = await client.post(
        "/v1/audio/transcode",
        files={"file": ("combined.wav", b"RIFFdata", "audio/wav")},
    )

    assert response.status_code == 500
