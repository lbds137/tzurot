"""Tests for the FastAPI lifespan startup hook.

Verifies model loading wires up with the expected arguments. Heavy ML models
are mocked at sys.modules level via conftest, so this test exercises the
real lifespan contract without loading real weights.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, call

import pytest
from nemo.collections.asr import models as nemo_asr_models
from pocket_tts import TTSModel

import server


@pytest.mark.asyncio
async def test_lifespan_loads_tts_with_english_language(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lifespan must call TTSModel.load_model with language='english'.

    Pinning the language argument explicitly is load-bearing — pocket-tts 2.0+
    defaults to english_2026-04, but a future package version could rotate the
    default and silently shift our voice quality.
    """
    # Mock TTSModel.load_model so we can capture the call arguments.
    # MagicMock keyword captures live in `mock.call_args.kwargs`.
    tts_load_mock = MagicMock(name="TTSModel.load_model")
    fake_tts_instance: Any = MagicMock(name="TTSModel")
    fake_tts_instance.sample_rate = 24000
    tts_load_mock.return_value = fake_tts_instance

    monkeypatch.setattr(TTSModel, "load_model", tts_load_mock)

    # Mock ASRModel.from_pretrained too so lifespan doesn't try to download
    fake_asr: Any = MagicMock(name="ASRModel")
    monkeypatch.setattr(nemo_asr_models.ASRModel, "from_pretrained", MagicMock(return_value=fake_asr))

    # Drive lifespan through startup
    async with server.lifespan(server.app):
        assert "tts" in server.models
        assert "asr" in server.models

    # Lifespan shutdown clears the model registry — guards against a regression
    # if `models.clear()` is ever removed from the cleanup block.
    assert not server.models, "lifespan shutdown should clear models dict"

    # Assert the language pin. Using `call(language=...)` (not `kwargs.get(...)`)
    # so a future edit that switches to a positional arg `load_model("english")`
    # would also fail — kwargs path would be empty in that case and silently pass.
    assert tts_load_mock.call_count == 1, "TTSModel.load_model should be called exactly once"
    assert tts_load_mock.call_args == call(language="english")
