"""Tests for voice management endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import pytest

import server as server_mod
from server import voice_cache


async def test_list_voices_returns_cached(client: httpx.AsyncClient) -> None:
    voice_cache["alba"] = {"state": "mock"}
    voice_cache["bria"] = {"state": "mock"}

    response = await client.get("/v1/voices")

    assert response.status_code == 200
    body = response.json()
    voice_ids = [v["id"] for v in body["voices"]]
    assert "alba" in voice_ids
    assert "bria" in voice_ids


async def test_list_voices_empty(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/voices")

    assert response.status_code == 200
    assert response.json()["voices"] == []


async def test_register_voice_success(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    response = await client.post(
        "/v1/voices/register",
        data={"voice_id": "test-voice"},
        files={"audio": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["voice_id"] == "test-voice"
    assert "test-voice" in voice_cache


async def test_register_voice_rejects_path_traversal(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    response = await client.post(
        "/v1/voices/register",
        data={"voice_id": "../etc/passwd"},
        files={"audio": ("test.wav", b"fake-audio", "audio/wav")},
    )

    assert response.status_code == 400
    assert "voice_id" in response.json()["detail"]


async def test_register_voice_rejects_too_long_id(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    response = await client.post(
        "/v1/voices/register",
        data={"voice_id": "a" * 65},
        files={"audio": ("test.wav", b"fake-audio", "audio/wav")},
    )

    assert response.status_code == 400


async def test_register_voice_returns_503_when_model_not_loaded(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/v1/voices/register",
        data={"voice_id": "test-voice"},
        files={"audio": ("test.wav", b"fake-audio", "audio/wav")},
    )

    assert response.status_code == 503


async def test_register_voice_requires_auth(
    client: httpx.AsyncClient, mock_tts: MagicMock, api_key: str
) -> None:
    response = await client.post(
        "/v1/voices/register",
        data={"voice_id": "test-voice"},
        files={"audio": ("test.wav", b"fake-audio", "audio/wav")},
    )

    assert response.status_code == 401


async def test_list_voices_requires_auth(client: httpx.AsyncClient, api_key: str) -> None:
    response = await client.get("/v1/voices")

    assert response.status_code == 401


def test_voice_cache_lru_eviction(monkeypatch: pytest.MonkeyPatch) -> None:
    """When cache exceeds MAX_VOICE_CACHE_SIZE, the oldest entry is evicted."""
    monkeypatch.setattr(server_mod, "MAX_VOICE_CACHE_SIZE", 3)

    server_mod._cache_voice("v1", {"state": "first"})
    server_mod._cache_voice("v2", {"state": "second"})
    server_mod._cache_voice("v3", {"state": "third"})
    assert len(voice_cache) == 3

    # Adding a 4th entry should evict the oldest (v1)
    server_mod._cache_voice("v4", {"state": "fourth"})
    assert len(voice_cache) == 3
    assert "v1" not in voice_cache
    assert "v2" in voice_cache
    assert "v3" in voice_cache
    assert "v4" in voice_cache


def test_voice_cache_lru_refresh(monkeypatch: pytest.MonkeyPatch) -> None:
    """Re-caching an existing voice refreshes its LRU position."""
    monkeypatch.setattr(server_mod, "MAX_VOICE_CACHE_SIZE", 3)

    server_mod._cache_voice("v1", {"state": "first"})
    server_mod._cache_voice("v2", {"state": "second"})
    server_mod._cache_voice("v3", {"state": "third"})

    # Refresh v1 — it becomes newest
    server_mod._cache_voice("v1", {"state": "refreshed"})

    # Adding v4 should evict v2 (now oldest), not v1
    server_mod._cache_voice("v4", {"state": "fourth"})
    assert "v1" in voice_cache
    assert "v2" not in voice_cache
    assert "v3" in voice_cache
    assert "v4" in voice_cache
