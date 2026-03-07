"""Tests for GET /health endpoint."""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import pytest

from server import models, voice_cache


@pytest.mark.asyncio
async def test_health_returns_model_status(client: httpx.AsyncClient, mock_asr: MagicMock, mock_tts: MagicMock) -> None:
    response = await client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["asr_loaded"] is True
    assert body["tts_loaded"] is True
    assert body["voices_loaded"] == 0


@pytest.mark.asyncio
async def test_health_degraded_no_models(client: httpx.AsyncClient) -> None:
    # models dict is empty (cleared by autouse fixture)
    response = await client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["asr_loaded"] is False
    assert body["tts_loaded"] is False


@pytest.mark.asyncio
async def test_health_reflects_voice_count(client: httpx.AsyncClient, mock_tts: MagicMock) -> None:
    voice_cache["alba"] = {"state": "mock"}
    voice_cache["bria"] = {"state": "mock"}

    response = await client.get("/health")

    body = response.json()
    assert body["voices_loaded"] == 2


@pytest.mark.asyncio
async def test_health_does_not_require_auth(client: httpx.AsyncClient, api_key: str) -> None:
    """Health endpoint should be accessible even with auth enabled."""
    response = await client.get("/health")

    assert response.status_code == 200
