"""Tests for POST /v1/tts endpoint."""

from __future__ import annotations

import asyncio
import subprocess
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest

from server import MAX_TTS_TEXT_LENGTH, voice_cache


async def test_tts_returns_opus_audio_by_default(
    client: httpx.AsyncClient, mock_tts: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Happy path: raw WAV is transcoded to Opus-in-Ogg via ffmpeg."""
    import server

    async def fake_encode(_wav_bytes: bytes, _loop: Any) -> tuple[bytes, str]:
        return b"OggS\x00fake-opus-payload", "audio/ogg"

    monkeypatch.setattr(server, "_encode_opus", fake_encode)
    voice_cache["alba"] = {"state": "mock"}

    response = await client.post(
        "/v1/tts",
        data={"text": "Hello world", "voice_id": "alba"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/ogg"
    assert len(response.content) > 0


async def test_tts_falls_back_to_wav_when_ffmpeg_unavailable(
    client: httpx.AsyncClient, mock_tts: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Defensive: if ffmpeg fails, the endpoint still returns playable WAV."""
    import server

    async def fake_encode_fail(wav_bytes: bytes, _loop: Any) -> tuple[bytes, str]:
        return wav_bytes, "audio/wav"

    monkeypatch.setattr(server, "_encode_opus", fake_encode_fail)
    voice_cache["alba"] = {"state": "mock"}

    response = await client.post(
        "/v1/tts",
        data={"text": "Hello world", "voice_id": "alba"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert len(response.content) > 0


async def test_encode_opus_labels_success_as_ogg(monkeypatch: pytest.MonkeyPatch) -> None:
    """_encode_opus returns audio/ogg and the ffmpeg stdout on success."""
    import server

    fake_result = MagicMock()
    fake_result.stdout = b"OggS\x00" + b"fake-opus-payload"
    monkeypatch.setattr("subprocess.run", lambda *_a, **_kw: fake_result)

    out, media_type = await server._encode_opus(b"RIFFfake-wav", asyncio.get_running_loop())

    assert media_type == "audio/ogg"
    assert out.startswith(b"OggS")


async def test_encode_opus_falls_back_to_wav_on_subprocess_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When ffmpeg returns non-zero, caller gets the original WAV with audio/wav label."""
    import server

    def fake_run_fail(args: Any, **_kw: Any) -> Any:
        raise subprocess.CalledProcessError(returncode=1, cmd=args, stderr=b"libopus not built")

    monkeypatch.setattr("subprocess.run", fake_run_fail)
    wav_in = b"RIFF\x24\x00\x00\x00WAVE-fake-data"

    out, media_type = await server._encode_opus(wav_in, asyncio.get_running_loop())

    assert media_type == "audio/wav"
    assert out == wav_in


async def test_encode_opus_falls_back_to_wav_when_binary_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the ffmpeg binary is absent (FileNotFoundError), still return the WAV."""
    import server

    def fake_run_missing(args: Any, **_kw: Any) -> Any:
        raise FileNotFoundError("No such file or directory: 'ffmpeg'")

    monkeypatch.setattr("subprocess.run", fake_run_missing)
    wav_in = b"RIFF-wav-bytes"

    out, media_type = await server._encode_opus(wav_in, asyncio.get_running_loop())

    assert media_type == "audio/wav"
    assert out == wav_in


async def test_encode_opus_falls_back_to_wav_on_generic_oserror(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Non-FileNotFoundError OSError subclasses (PermissionError, etc.) also fall back.

    Complements the FileNotFoundError test above — FileNotFoundError is itself an
    OSError subclass, so a PermissionError exercises the generalized branch and
    confirms we're not narrowly catching just the missing-binary case.
    """
    import server

    def fake_run_denied(args: Any, **_kw: Any) -> Any:
        raise PermissionError("Permission denied: 'ffmpeg'")

    monkeypatch.setattr("subprocess.run", fake_run_denied)
    wav_in = b"RIFF-wav-bytes"

    out, media_type = await server._encode_opus(wav_in, asyncio.get_running_loop())

    assert media_type == "audio/wav"
    assert out == wav_in


async def test_tts_format_wav_bypasses_opus_encode(
    client: httpx.AsyncClient, mock_tts: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """format=wav: callers that need raw PCM (multi-chunk concat) get WAV back directly."""
    import server

    called = False

    async def tracking_encode(wav_bytes: bytes, _loop: Any) -> tuple[bytes, str]:
        nonlocal called
        called = True
        return wav_bytes, "audio/wav"

    monkeypatch.setattr(server, "_encode_opus", tracking_encode)
    voice_cache["alba"] = {"state": "mock"}

    response = await client.post(
        "/v1/tts",
        data={"text": "Hello world", "voice_id": "alba", "format": "wav"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert called is False, "_encode_opus should not be invoked when format=wav"


async def test_tts_format_invalid_returns_400(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    """Unknown format values are rejected with 400."""
    voice_cache["alba"] = {"state": "mock"}

    response = await client.post(
        "/v1/tts",
        data={"text": "Hello", "voice_id": "alba", "format": "flac"},
    )

    assert response.status_code == 400
    assert "Unsupported format" in response.json()["detail"]


async def test_encode_opus_falls_back_when_output_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    """Empty ffmpeg stdout (edge case) still yields a usable fallback."""
    import server

    empty_result = MagicMock()
    empty_result.stdout = b""
    monkeypatch.setattr("subprocess.run", lambda *_a, **_kw: empty_result)

    wav_in = b"RIFF-wav-bytes"
    out, media_type = await server._encode_opus(wav_in, asyncio.get_running_loop())

    assert media_type == "audio/wav"
    assert out == wav_in


async def test_tts_strips_audio_tags(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    voice_cache["alba"] = {"state": "mock"}

    response = await client.post(
        "/v1/tts",
        data={"text": "[whisper]Hello world[laugh]", "voice_id": "alba"},
    )

    assert response.status_code == 200
    # Verify the clean text was passed to generate_audio
    call_args = mock_tts.generate_audio.call_args
    assert call_args is not None
    clean_text = call_args[0][1]
    assert "[whisper]" not in clean_text
    assert "[laugh]" not in clean_text
    assert "Hello world" in clean_text


async def test_tts_rejects_text_over_limit(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    voice_cache["alba"] = {"state": "mock"}
    long_text = "a" * (MAX_TTS_TEXT_LENGTH + 1)

    response = await client.post(
        "/v1/tts",
        data={"text": long_text, "voice_id": "alba"},
    )

    assert response.status_code == 400
    assert "too long" in response.json()["detail"].lower()


async def test_tts_returns_404_for_unknown_voice(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    # Voice not in cache, and get_state_for_audio_prompt fails
    mock_tts.get_state_for_audio_prompt.side_effect = FileNotFoundError("Voice not found")

    response = await client.post(
        "/v1/tts",
        data={"text": "Hello", "voice_id": "nonexistent"},
    )

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


async def test_tts_returns_503_when_model_not_loaded(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/v1/tts",
        data={"text": "Hello", "voice_id": "alba"},
    )

    assert response.status_code == 503
    assert "TTS model not loaded" in response.json()["detail"]


async def test_tts_rejects_invalid_voice_id(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    response = await client.post(
        "/v1/tts",
        data={"text": "Hello", "voice_id": "../etc/passwd"},
    )

    assert response.status_code == 400
    assert "voice_id" in response.json()["detail"]


async def test_tts_rejects_empty_text_after_tag_stripping(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    voice_cache["alba"] = {"state": "mock"}

    response = await client.post(
        "/v1/tts",
        data={"text": "[whisper][laugh]", "voice_id": "alba"},
    )

    assert response.status_code == 400
    assert "No text to synthesize" in response.json()["detail"]


async def test_tts_requires_auth_when_key_set(client: httpx.AsyncClient, mock_tts: MagicMock, api_key: str) -> None:
    response = await client.post(
        "/v1/tts",
        data={"text": "Hello", "voice_id": "alba"},
    )

    assert response.status_code == 401


async def test_tts_lazy_loads_voice_from_disk(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    """Voice not in cache but file exists on disk — should lazy-load from disk path."""
    # _find_voice_on_disk returns a disk path; get_state_for_audio_prompt is called with it
    fake_path = "/app/voices/my-custom-voice.wav"
    with patch("server._find_voice_on_disk", return_value=fake_path):
        response = await client.post(
            "/v1/tts",
            data={"text": "Hello", "voice_id": "my-custom-voice"},
        )

    assert response.status_code == 200
    # Verify get_state_for_audio_prompt was called with the disk path, not the bare voice_id
    mock_tts.get_state_for_audio_prompt.assert_called_once_with(fake_path)
    # Voice should now be cached
    assert "my-custom-voice" in voice_cache


async def test_tts_concurrent_requests_compute_voice_state_once(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    """Two concurrent TTS requests for the same uncached voice should only compute state once."""
    fake_path = "/app/voices/shared-voice.wav"

    # Simulate slow voice state computation (~0.1s) to expose concurrency
    original_return = mock_tts.get_state_for_audio_prompt.return_value

    def slow_load(path: str) -> Any:
        import time

        time.sleep(0.05)
        return original_return

    mock_tts.get_state_for_audio_prompt.side_effect = slow_load

    with patch("server._find_voice_on_disk", return_value=fake_path):
        results = await asyncio.gather(
            client.post("/v1/tts", data={"text": "Hello 1", "voice_id": "shared-voice"}),
            client.post("/v1/tts", data={"text": "Hello 2", "voice_id": "shared-voice"}),
        )

    assert results[0].status_code == 200
    assert results[1].status_code == 200
    # Per-voice lock should deduplicate: state computed once, second request uses cache
    assert mock_tts.get_state_for_audio_prompt.call_count == 1
