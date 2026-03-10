"""Shared fixtures for voice-engine tests.

Mocks NeMo ASR and Pocket TTS models so tests run without GPU/model files.
Heavy ML packages (librosa, nemo_toolkit, pocket_tts) are pre-mocked via
sys.modules so tests can run in CI without PyTorch or GPU drivers.
"""

from __future__ import annotations

import sys
from collections.abc import AsyncGenerator, Generator
from unittest.mock import MagicMock

import httpx
import pytest

# ---------------------------------------------------------------------------
# Pre-mock heavy ML modules BEFORE importing server.py (which imports them at
# top level). This lets tests run in CI with only numpy/scipy installed.
# ---------------------------------------------------------------------------
for _mod_name in (
    "librosa",
    "nemo",
    "nemo.collections",
    "nemo.collections.asr",
    "pocket_tts",
):
    if _mod_name not in sys.modules:
        sys.modules[_mod_name] = MagicMock()

from server import app, models, voice_cache  # noqa: E402 -- must import after sys.modules mocking above
from tests.helpers import FakeTranscription  # noqa: E402 -- must import after sys.modules mocking above


@pytest.fixture(autouse=True)
def _reset_state() -> Generator[None, None, None]:
    """Clear models and voice_cache before each test to prevent leaks."""
    models.clear()
    voice_cache.clear()
    yield
    models.clear()
    voice_cache.clear()


@pytest.fixture()
def mock_asr(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """Provide a mock ASR model and mock librosa to avoid real audio decoding."""
    import numpy as np

    import server

    asr = MagicMock()
    asr.transcribe.return_value = [FakeTranscription()]
    models["asr"] = asr
    # Mock librosa so tests don't depend on real audio decoding of synthetic bytes
    mock_librosa = MagicMock()
    mock_librosa.load.return_value = (np.zeros(16000, dtype=np.float32), 16000)
    mock_librosa.resample.side_effect = lambda audio, **_kw: audio
    monkeypatch.setattr(server, "librosa", mock_librosa)
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
async def client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """httpx async client wired to the FastAPI app (no real server)."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as c:
        yield c
