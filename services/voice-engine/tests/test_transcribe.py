"""Tests for POST /v1/transcribe endpoint."""

from __future__ import annotations

import asyncio
from typing import Any, cast
from unittest.mock import MagicMock

import httpx
import pytest

import server


async def test_transcribe_returns_text(client: httpx.AsyncClient, mock_asr: MagicMock) -> None:
    fake_wav = b"RIFF" + b"\x00" * 100  # minimal fake audio bytes

    response = await client.post(
        "/v1/transcribe",
        files={"file": ("test.wav", fake_wav, "audio/wav")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "Hello, this is a test transcription."


async def test_transcribe_returns_503_when_model_not_loaded(client: httpx.AsyncClient) -> None:
    # No mock_asr fixture — models dict is empty
    response = await client.post(
        "/v1/transcribe",
        files={"file": ("test.wav", b"fake-audio", "audio/wav")},
    )

    assert response.status_code == 503
    assert "STT model not loaded" in response.json()["detail"]


async def test_transcribe_rejects_oversized_file(
    client: httpx.AsyncClient, mock_asr: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Patch to a tiny limit so we don't allocate 50MB in tests
    monkeypatch.setattr(server, "MAX_AUDIO_UPLOAD_BYTES", 100)
    oversized = b"\x00" * 101

    response = await client.post(
        "/v1/transcribe",
        files={"file": ("huge.wav", oversized, "audio/wav")},
    )

    assert response.status_code == 413
    assert "too large" in response.json()["detail"]


async def test_transcribe_requires_auth_when_key_set(
    client: httpx.AsyncClient, mock_asr: MagicMock, api_key: str
) -> None:
    response = await client.post(
        "/v1/transcribe",
        files={"file": ("test.wav", b"fake-audio", "audio/wav")},
    )

    assert response.status_code == 401


async def test_transcribe_accepts_bearer_token(client: httpx.AsyncClient, mock_asr: MagicMock, api_key: str) -> None:
    response = await client.post(
        "/v1/transcribe",
        files={"file": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
        headers={"Authorization": f"Bearer {api_key}"},
    )

    assert response.status_code == 200


async def test_transcribe_accepts_x_api_key_header(
    client: httpx.AsyncClient, mock_asr: MagicMock, api_key: str
) -> None:
    response = await client.post(
        "/v1/transcribe",
        files={"file": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
        headers={"X-API-Key": api_key},
    )

    assert response.status_code == 200


async def test_transcribe_returns_empty_string_for_silent_audio(client: httpx.AsyncClient, mock_asr: MagicMock) -> None:
    from tests.helpers import FakeTranscription

    mock_asr.transcribe.return_value = [FakeTranscription("")]

    response = await client.post(
        "/v1/transcribe",
        files={"file": ("silence.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json()["text"] == ""


async def test_transcribe_handles_model_error(client: httpx.AsyncClient, mock_asr: MagicMock) -> None:
    mock_asr.transcribe.side_effect = RuntimeError("Model inference failed")

    response = await client.post(
        "/v1/transcribe",
        files={"file": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 500
    assert "Transcription failed" in response.json()["detail"]


async def test_transcribe_serializes_concurrent_calls(client: httpx.AsyncClient, mock_asr: MagicMock) -> None:
    # NeMo's RNNT freeze/unfreeze state is shared per-model. Without the lock,
    # two concurrent transcribe calls overlap inside `.transcribe()` and the
    # second one's cleanup hook raises ValueError. The lock guarantees the
    # underlying call is invoked one-at-a-time even when callers race.
    from tests.helpers import FakeTranscription

    in_flight = 0
    max_in_flight = 0

    def tracking_transcribe(_audio: object) -> list[object]:
        nonlocal in_flight, max_in_flight
        in_flight += 1
        max_in_flight = max(max_in_flight, in_flight)
        try:
            return [FakeTranscription("ok")]
        finally:
            in_flight -= 1

    mock_asr.transcribe.side_effect = tracking_transcribe
    fake_wav = b"RIFF" + b"\x00" * 100

    responses = await asyncio.gather(
        *(client.post("/v1/transcribe", files={"file": ("t.wav", fake_wav, "audio/wav")}) for _ in range(4))
    )

    assert all(r.status_code == 200 for r in responses)
    assert max_in_flight == 1


# ---------------------------------------------------------------------------
# Long-audio chunking (endpoint-level)
# ---------------------------------------------------------------------------
def _set_audio_seconds(seconds: float) -> None:
    """Make the mocked librosa.load return `seconds` of 16kHz audio for the next call.

    `librosa` is an imported module on `server` (monkeypatched to a mock by the
    `mock_asr` fixture); mypy --strict won't allow `server.librosa` as a direct
    attribute (no-implicit-reexport), so reach it through an `Any` cast.
    """
    import numpy as np

    samples = int(seconds * server.STT_SAMPLE_RATE)
    cast(Any, server).librosa.load.return_value = (np.zeros(samples, dtype=np.float32), 16000)


async def test_transcribe_single_pass_below_threshold(
    client: httpx.AsyncClient, mock_asr: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(server, "STT_CHUNK_THRESHOLD_SEC", 120.0)
    _set_audio_seconds(60.0)  # 60s <= 120s threshold → exact single-pass path

    response = await client.post(
        "/v1/transcribe",
        files={"file": ("short.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 200
    assert mock_asr.transcribe.call_count == 1


async def test_transcribe_chunks_long_audio(
    client: httpx.AsyncClient, mock_asr: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.helpers import FakeTranscription

    # Small, deterministic windows so the assertion is decoupled from prod tuning.
    monkeypatch.setattr(server, "STT_CHUNK_THRESHOLD_SEC", 2.0)
    monkeypatch.setattr(server, "STT_CHUNK_WINDOW_SEC", 1.0)
    monkeypatch.setattr(server, "STT_CHUNK_OVERLAP_SEC", 0.0)
    _set_audio_seconds(5.0)  # 5s / 1s windows, no overlap → 5 windows
    mock_asr.transcribe.side_effect = [[FakeTranscription(f"word{i}")] for i in range(5)]

    response = await client.post(
        "/v1/transcribe",
        files={"file": ("long.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 200
    assert mock_asr.transcribe.call_count == 5
    # No overlap → plain space-join of the per-window texts.
    assert response.json()["text"] == "word0 word1 word2 word3 word4"


async def test_transcribe_rejects_too_long_audio(
    client: httpx.AsyncClient, mock_asr: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(server, "MAX_AUDIO_DURATION_SEC", 10.0)
    _set_audio_seconds(11.0)  # 11s > 10s cap

    response = await client.post(
        "/v1/transcribe",
        files={"file": ("toolong.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
    )

    assert response.status_code == 413
    assert "too long" in response.json()["detail"].lower()
    # Rejected BEFORE any inference — the whole point of the pre-decode cap.
    assert mock_asr.transcribe.call_count == 0


async def test_transcribe_serializes_concurrent_chunked_calls(
    client: httpx.AsyncClient, mock_asr: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Per-window lock acquisition must still guarantee one-at-a-time NeMo calls
    # even when multiple long (chunked) requests race.
    from tests.helpers import FakeTranscription

    monkeypatch.setattr(server, "STT_CHUNK_THRESHOLD_SEC", 1.0)
    monkeypatch.setattr(server, "STT_CHUNK_WINDOW_SEC", 1.0)
    monkeypatch.setattr(server, "STT_CHUNK_OVERLAP_SEC", 0.0)
    _set_audio_seconds(4.0)  # 4 windows per request

    in_flight = 0
    max_in_flight = 0

    def tracking_transcribe(_audio: object) -> list[object]:
        nonlocal in_flight, max_in_flight
        in_flight += 1
        max_in_flight = max(max_in_flight, in_flight)
        try:
            return [FakeTranscription("ok")]
        finally:
            in_flight -= 1

    mock_asr.transcribe.side_effect = tracking_transcribe
    fake_wav = b"RIFF" + b"\x00" * 100

    responses = await asyncio.gather(
        *(client.post("/v1/transcribe", files={"file": ("t.wav", fake_wav, "audio/wav")}) for _ in range(3))
    )

    assert all(r.status_code == 200 for r in responses)
    assert max_in_flight == 1


# ---------------------------------------------------------------------------
# Chunking helpers (pure functions — no model/fixtures)
# ---------------------------------------------------------------------------
def test_chunk_audio_array_even_windows() -> None:
    import numpy as np

    arr = np.zeros(5 * 16000, dtype=np.float32)
    chunks = server._chunk_audio_array(arr, 16000, 1.0, 0.0)
    assert len(chunks) == 5
    assert all(len(c) == 16000 for c in chunks)


def test_chunk_audio_array_clamps_last_window() -> None:
    import numpy as np

    arr = np.zeros(int(2.5 * 16000), dtype=np.float32)  # 2.5s
    chunks = server._chunk_audio_array(arr, 16000, 1.0, 0.0)
    assert len(chunks) == 3
    assert len(chunks[-1]) == int(0.5 * 16000)  # final partial window


def test_chunk_audio_array_overlap_advances() -> None:
    import numpy as np

    arr = np.zeros(5 * 16000, dtype=np.float32)
    chunks = server._chunk_audio_array(arr, 16000, 2.0, 1.0)  # 2s windows, 1s overlap → 1s step
    assert len(chunks) >= 3
    assert all(len(c) <= 2 * 16000 for c in chunks)


def test_chunk_audio_array_overlap_ge_window_terminates() -> None:
    import numpy as np

    # Misconfigured overlap >= window must NOT infinite-loop (step clamped to >= 1).
    arr = np.zeros(3 * 16000, dtype=np.float32)
    chunks = server._chunk_audio_array(arr, 16000, 1.0, 5.0)
    assert len(chunks) >= 1


def test_merge_overlap_dedups_seam() -> None:
    assert server._merge_overlap("the quick brown", "brown fox jumps") == "the quick brown fox jumps"


def test_merge_overlap_case_and_punctuation_insensitive() -> None:
    # "world." vs "World," normalize equal → overlap dropped, original casing kept.
    assert server._merge_overlap("hello world.", "World, again") == "hello world. again"


def test_merge_overlap_no_match_plain_join() -> None:
    assert server._merge_overlap("alpha beta", "gamma delta") == "alpha beta gamma delta"


def test_merge_overlap_fully_duplicate_right() -> None:
    # Entire right side duplicates the left seam → nothing survives, return left.
    assert server._merge_overlap("one two three", "two three") == "one two three"


def test_merge_overlap_standalone_punct_no_false_drop() -> None:
    # Standalone punctuation tokens normalize to "" and must NOT anchor an overlap.
    # No real words are shared here, so nothing is dropped (both dots survive).
    assert (
        server._merge_overlap("first window ends here .", ". second window begins")
        == "first window ends here . . second window begins"
    )


def test_merge_overlap_standalone_punct_keeps_right_word() -> None:
    # The empty-token false match used to drop right's leading "!"; it must survive.
    assert server._merge_overlap("we paused ?", "! brand new sentence") == "we paused ? ! brand new sentence"


def test_merge_overlap_dedups_through_leading_punct() -> None:
    # Real overlap is "sure"; right's leading "--" must not block the dedup, and the
    # "--" is dropped along with the duplicated "sure" (no "sure -- sure").
    assert server._merge_overlap("i think -- sure", "-- sure thing buddy") == "i think -- sure thing buddy"


def test_merge_overlap_dedups_multiword_overlap_with_interspersed_punct() -> None:
    # Overlap is "foo . bar" with punctuation INSIDE it. The match is on the content
    # tokens (foo, bar); the whole overlap region — punctuation included — is dropped.
    assert server._merge_overlap("alpha foo . bar", "foo . bar gamma") == "alpha foo . bar gamma"


def test_join_chunk_texts_skips_empty_windows() -> None:
    assert server._join_chunk_texts(["hello", "", "   ", "world"]) == "hello world"


def test_join_chunk_texts_empty_list() -> None:
    assert server._join_chunk_texts([]) == ""


def test_realtime_factor_zero_audio() -> None:
    assert server._realtime_factor(5.0, 0.0) == 0.0
    assert server._realtime_factor(30.0, 60.0) == 0.5
