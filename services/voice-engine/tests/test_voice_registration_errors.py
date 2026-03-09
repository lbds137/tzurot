"""Tests for voice registration error paths."""

from __future__ import annotations

import os
import pathlib
from unittest.mock import MagicMock

import httpx
import pytest

import server as server_mod
from server import voice_cache


async def test_register_voice_rejects_oversized_audio(
    client: httpx.AsyncClient, mock_tts: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Audio exceeding MAX_AUDIO_UPLOAD_BYTES should be rejected."""
    monkeypatch.setattr(server_mod, "MAX_AUDIO_UPLOAD_BYTES", 100)

    response = await client.post(
        "/v1/voices/register",
        data={"voice_id": "test-voice"},
        files={"audio": ("test.wav", b"\x00" * 101, "audio/wav")},
    )

    assert response.status_code == 413
    assert "too large" in response.json()["detail"].lower()


async def test_register_voice_generic_error_returns_500(
    client: httpx.AsyncClient, mock_tts: MagicMock
) -> None:
    """Unexpected errors during registration should return 500."""
    mock_tts.get_state_for_audio_prompt.side_effect = RuntimeError("Model crashed")

    response = await client.post(
        "/v1/voices/register",
        data={"voice_id": "test-voice"},
        files={"audio": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 500
    assert "Voice registration failed" in response.json()["detail"]
    # Voice should NOT be in cache after failure
    assert "test-voice" not in voice_cache


async def test_register_voice_cleans_stale_files(
    client: httpx.AsyncClient, mock_tts: MagicMock, tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Re-registering a voice with different MIME type should clean up old file."""
    voices_dir = tmp_path / "voices"
    voices_dir.mkdir()
    monkeypatch.setenv("VOICES_DIR", str(voices_dir))

    # Create a stale file from prior registration
    stale_file = voices_dir / "test-voice.wav"
    stale_file.write_bytes(b"old audio data")

    # Register with MP3 content type — should remove the stale .wav
    response = await client.post(
        "/v1/voices/register",
        data={"voice_id": "test-voice"},
        files={"audio": ("test.mp3", b"RIFF" + b"\x00" * 100, "audio/mpeg")},
    )

    assert response.status_code == 200
    # Stale .wav should be cleaned up
    assert not stale_file.exists()
    # New .mp3 should exist
    assert (voices_dir / "test-voice.mp3").exists()


async def test_register_voice_cleans_up_file_on_model_error(
    client: httpx.AsyncClient, mock_tts: MagicMock, tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If model fails during registration, the written audio file should be removed."""
    voices_dir = tmp_path / "voices"
    voices_dir.mkdir()
    monkeypatch.setenv("VOICES_DIR", str(voices_dir))

    mock_tts.get_state_for_audio_prompt.side_effect = RuntimeError("Model OOM")

    response = await client.post(
        "/v1/voices/register",
        data={"voice_id": "fail-voice"},
        files={"audio": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 500
    # The written file should have been cleaned up on error
    assert not (voices_dir / "fail-voice.wav").exists()
    assert "fail-voice" not in voice_cache


async def test_register_voice_creates_voices_dir_if_missing(
    client: httpx.AsyncClient, mock_tts: MagicMock, tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The voices directory should be created automatically if it doesn't exist."""
    voices_dir = tmp_path / "new-voices-dir"
    monkeypatch.setenv("VOICES_DIR", str(voices_dir))
    assert not voices_dir.exists()

    response = await client.post(
        "/v1/voices/register",
        data={"voice_id": "first-voice"},
        files={"audio": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 200
    assert voices_dir.exists()
    assert (voices_dir / "first-voice.wav").exists()
