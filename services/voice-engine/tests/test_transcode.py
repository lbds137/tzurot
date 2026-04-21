"""Tests for POST /v1/audio/transcode endpoint.

Covers the multi-chunk TTS path's re-encode step: ai-worker concatenates PCM
into a combined WAV, posts it here, and expects Opus-in-Ogg back. On ffmpeg
failure, the endpoint returns the original WAV so callers still get playable
audio — matching /v1/tts's defensive fallback.
"""

from __future__ import annotations

import logging
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
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """When _encode_opus falls back (returns WAV + audio/wav), endpoint passes it through
    AND logs at WARNING — not INFO — so log triage sees the degraded path clearly.
    """
    import server

    async def fake_encode_fallback(wav_bytes: bytes, _loop: Any) -> tuple[bytes, str]:
        return wav_bytes, "audio/wav"

    monkeypatch.setattr(server, "_encode_opus", fake_encode_fallback)
    # server._setup_logging sets propagate=False so JSON logs don't double-emit
    # to root in prod. Re-enable for this test so pytest's caplog (root-handler)
    # captures the records; monkeypatch undoes it after the test.
    monkeypatch.setattr(server.logger, "propagate", True)
    wav_in = b"RIFF\x24\x00\x00\x00WAVE-fallback-data"

    with caplog.at_level(logging.WARNING, logger="voice-engine"):
        response = await client.post(
            "/v1/audio/transcode",
            files={"file": ("combined.wav", wav_in, "audio/wav")},
        )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content == wav_in

    # Verify the fallback produces a WARNING-level "Transcoded audio" record with
    # ffmpeg_fallback=True, rather than the info-level success line that would
    # otherwise mask the degraded path during log triage.
    fallback_records = [
        r
        for r in caplog.records
        if r.name == "voice-engine"
        and r.msg == "Transcoded audio"
        and r.levelno == logging.WARNING
        and getattr(r, "ffmpeg_fallback", False) is True
    ]
    assert len(fallback_records) == 1, (
        f"Expected one WARNING 'Transcoded audio' record with ffmpeg_fallback=True, "
        f"got: {[(r.levelname, r.msg, getattr(r, 'ffmpeg_fallback', None)) for r in caplog.records]}"
    )


async def test_transcode_logs_info_on_successful_opus_encode(
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Happy path logs at INFO with ffmpeg_fallback=False — complementary to the
    WARNING assertion above; together they pin the log-level contract."""
    import server

    async def fake_encode(_wav_bytes: bytes, _loop: Any) -> tuple[bytes, str]:
        return b"OggS\x00fake", "audio/ogg"

    monkeypatch.setattr(server, "_encode_opus", fake_encode)
    monkeypatch.setattr(server.logger, "propagate", True)

    with caplog.at_level(logging.INFO, logger="voice-engine"):
        response = await client.post(
            "/v1/audio/transcode",
            files={"file": ("combined.wav", b"RIFFfake", "audio/wav")},
        )

    assert response.status_code == 200
    info_records = [
        r
        for r in caplog.records
        if r.name == "voice-engine"
        and r.msg == "Transcoded audio"
        and r.levelno == logging.INFO
        and getattr(r, "ffmpeg_fallback", None) is False
    ]
    assert len(info_records) == 1


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
