"""Tests for structured JSON logging."""

from __future__ import annotations

import json
import logging

from server import _JsonFormatter


def test_json_formatter_produces_valid_json() -> None:
    formatter = _JsonFormatter()
    record = logging.LogRecord(
        name="voice-engine",
        level=logging.INFO,
        pathname="server.py",
        lineno=1,
        msg="Test message",
        args=(),
        exc_info=None,
    )

    output = formatter.format(record)
    parsed = json.loads(output)

    assert parsed["level"] == "INFO"
    assert parsed["msg"] == "Test message"
    assert parsed["logger"] == "voice-engine"


def test_json_formatter_includes_extra_fields() -> None:
    formatter = _JsonFormatter()
    record = logging.LogRecord(
        name="voice-engine",
        level=logging.INFO,
        pathname="server.py",
        lineno=1,
        msg="Transcribed audio",
        args=(),
        exc_info=None,
    )
    record.chars = 42  # type: ignore[attr-defined]
    record.voice_id = "alba"  # type: ignore[attr-defined]

    output = formatter.format(record)
    parsed = json.loads(output)

    assert parsed["chars"] == 42
    assert parsed["voice_id"] == "alba"


def test_json_formatter_excludes_standard_log_attrs() -> None:
    formatter = _JsonFormatter()
    record = logging.LogRecord(
        name="voice-engine",
        level=logging.INFO,
        pathname="server.py",
        lineno=1,
        msg="Test",
        args=(),
        exc_info=None,
    )

    output = formatter.format(record)
    parsed = json.loads(output)

    # Standard LogRecord attrs should NOT appear as extra fields
    assert "pathname" not in parsed
    assert "lineno" not in parsed
    assert "funcName" not in parsed
    assert "name" not in parsed
    assert "args" not in parsed
    assert "created" not in parsed
    assert "thread" not in parsed
    # Our explicit keys should always be present
    assert "level" in parsed
    assert "msg" in parsed
    assert "logger" in parsed
