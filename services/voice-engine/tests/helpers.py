"""Shared test helpers for voice-engine tests."""

from __future__ import annotations


class FakeTranscription:
    """Mimics NeMo's transcription result (has .text attribute)."""

    def __init__(self, text: str = "Hello, this is a test transcription.") -> None:
        self.text = text
