"""Shared fixtures for voice-engine tests.

Mocks NeMo ASR and Pocket TTS models so tests run without GPU/model files.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest

from server import app, models, voice_cache


class _FakeTranscription:
    """Mimics NeMo's transcription result (has .text attribute)."""

    def __init__(self, text: str = "Hello, this is a test transcription.") -> None:
        self.text = text


@pytest.fixture(autouse=True)
def _reset_state() -> Any:
    """Clear models and voice_cache before each test to prevent leaks."""
    models.clear()
    voice_cache.clear()
    yield
    models.clear()
    voice_cache.clear()


@pytest.fixture()
def mock_asr() -> MagicMock:
    """Provide a mock ASR model that returns a canned transcription."""
    asr = MagicMock()
    asr.transcribe.return_value = [_FakeTranscription()]
    models["asr"] = asr
    return asr


@pytest.fixture()
def mock_tts() -> MagicMock:
    """Provide a mock TTS model with sample_rate and audio generation."""
    import numpy as np

    tts = MagicMock()
    tts.sample_rate = 22050
    # generate_audio returns a tensor-like object with .numpy() method
    fake_audio = MagicMock()
    fake_audio.numpy.return_value = np.zeros(22050, dtype=np.float32)
    tts.generate_audio.return_value = fake_audio
    # get_state_for_audio_prompt returns an opaque voice state
    tts.get_state_for_audio_prompt.return_value = {"state": "mock"}
    models["tts"] = tts
    return tts


@pytest.fixture()
def api_key(monkeypatch: pytest.MonkeyPatch) -> str:
    """Set VOICE_ENGINE_API_KEY and patch the middleware's cached value."""
    import server

    key = "test-api-key-12345"
    monkeypatch.setattr(server, "_API_KEY", key)
    return key


@pytest.fixture()
def client() -> httpx.AsyncClient:
    """httpx async client wired to the FastAPI app (no real server)."""
    transport = httpx.ASGITransport(app=app)  # type: ignore[arg-type]
    return httpx.AsyncClient(transport=transport, base_url="http://testserver")
