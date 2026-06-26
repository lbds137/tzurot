"""Cross-language (Python <-> TypeScript) golden-fixture contract for the voice-engine JSON responses.

The committed fixtures under ``packages/test-utils/fixtures/contracts/voice-engine/`` are the
SHARED artifact: this PRODUCER test asserts each real endpoint's JSON output equals the fixture;
the TS CONSUMER test (``services/ai-worker/src/services/voice/VoiceEngineContract.consumer.contract.test.ts``)
validates the SAME fixtures against its Zod schemas. A Python field rename breaks the
fixture-equality assert HERE and (after regeneration) the TS Zod ``.parse`` THERE -- drift caught
on both sides, and both the ``voice-engine-test`` and ``component-tests`` CI jobs run on every PR.

Only JSON RESPONSE shapes are contracted: binary TTS (audio/wav) has no JSON to drift, and
multipart request bodies are validated loudly by FastAPI at the edge (422). The TS client consumes
``/v1/transcribe``, ``/health`` and ``/v1/voices``; ``/v1/voices/register`` returns JSON the client
ignores, so it is intentionally out of scope.

Set ``UPDATE_CONTRACT_FIXTURES=1`` to regenerate the fixtures from real output (the ``--update`` analog).

Future evolution: if voice-engine grows past ~5 JSON endpoints, migrate to FastAPI
``response_model`` -> committed ``openapi.json`` -> TS Zod codegen, retiring this manual pair.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import httpx

# Repo-relative path to the shared fixture dir, resolved from THIS file so it is
# cwd-independent (the voice-engine-test job runs `cd services/voice-engine`).
# parents: [0]=tests [1]=voice-engine [2]=services [3]=repo root.
_FIXTURE_DIR = (
    Path(__file__).resolve().parents[3] / "packages" / "test-utils" / "fixtures" / "contracts" / "voice-engine"
)


def _assert_or_update(name: str, actual: dict[str, Any]) -> None:
    """Assert ``actual`` equals the committed fixture, or rewrite it under UPDATE_CONTRACT_FIXTURES.

    Compares PARSED dicts (not raw bytes) so key order / whitespace never makes the contract brittle.
    """
    path = _FIXTURE_DIR / name
    if os.environ.get("UPDATE_CONTRACT_FIXTURES"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(actual, indent=2) + "\n")
        return
    if not path.exists():
        raise FileNotFoundError(
            f"{name} contract fixture missing — regenerate with "
            "UPDATE_CONTRACT_FIXTURES=1 pytest services/voice-engine/tests/test_contract.py"
        )
    expected = json.loads(path.read_text())
    assert actual == expected, f"{name} drifted from the committed fixture (regenerate with UPDATE_CONTRACT_FIXTURES=1)"


async def test_transcribe_response_contract(client: httpx.AsyncClient, mock_asr: MagicMock) -> None:
    response = await client.post(
        "/v1/transcribe",
        files={"file": ("contract.wav", b"\x00" * 64, "audio/wav")},
    )
    assert response.status_code == 200
    _assert_or_update("transcribe.json", response.json())


async def test_health_response_contract(client: httpx.AsyncClient, mock_asr: MagicMock, mock_tts: MagicMock) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    _assert_or_update("health.json", response.json())


async def test_voices_response_contract(client: httpx.AsyncClient) -> None:
    # Populate one voice so the fixture locks the per-item {id, type} shape, not just `[]`.
    from server import voice_cache

    voice_cache["contract-voice"] = MagicMock()  # list_voices reads keys only
    response = await client.get("/v1/voices")
    assert response.status_code == 200
    _assert_or_update("voices.json", response.json())
