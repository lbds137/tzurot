"""Tests for POST /v1/tts endpoint."""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import pytest

from server import MAX_TTS_TEXT_LENGTH, voice_cache


@pytest.mark.asyncio
async def test_tts_returns_wav_audio(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    voice_cache["alba"] = {"state": "mock"}

    response = await client.post(
        "/v1/tts",
        data={"text": "Hello world", "voice_id": "alba"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert len(response.content) > 0


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_tts_rejects_text_over_limit(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    voice_cache["alba"] = {"state": "mock"}
    long_text = "a" * (MAX_TTS_TEXT_LENGTH + 1)

    response = await client.post(
        "/v1/tts",
        data={"text": long_text, "voice_id": "alba"},
    )

    assert response.status_code == 400
    assert "too long" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_tts_returns_404_for_unknown_voice(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    # Voice not in cache, and get_state_for_audio_prompt fails
    mock_tts.get_state_for_audio_prompt.side_effect = FileNotFoundError("Voice not found")

    response = await client.post(
        "/v1/tts",
        data={"text": "Hello", "voice_id": "nonexistent"},
    )

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_tts_returns_503_when_model_not_loaded(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/v1/tts",
        data={"text": "Hello", "voice_id": "alba"},
    )

    assert response.status_code == 503
    assert "TTS model not loaded" in response.json()["detail"]


@pytest.mark.asyncio
async def test_tts_rejects_invalid_voice_id(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    response = await client.post(
        "/v1/tts",
        data={"text": "Hello", "voice_id": "../etc/passwd"},
    )

    assert response.status_code == 400
    assert "voice_id" in response.json()["detail"]


@pytest.mark.asyncio
async def test_tts_rejects_empty_text_after_tag_stripping(
    client: httpx.AsyncClient, mock_tts: MagicMock
) -> None:
    voice_cache["alba"] = {"state": "mock"}

    response = await client.post(
        "/v1/tts",
        data={"text": "[whisper][laugh]", "voice_id": "alba"},
    )

    assert response.status_code == 400
    assert "No text to synthesize" in response.json()["detail"]


@pytest.mark.asyncio
async def test_tts_requires_auth_when_key_set(
    client: httpx.AsyncClient, mock_tts: MagicMock, api_key: str
) -> None:
    response = await client.post(
        "/v1/tts",
        data={"text": "Hello", "voice_id": "alba"},
    )

    assert response.status_code == 401
