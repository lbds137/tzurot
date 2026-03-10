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
    record.chars = 42
    record.voice_id = "alba"

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


def test_root_logger_warning_produces_json(capfd: object) -> None:
    """Third-party loggers emitting WARNING+ should produce JSON via root handler."""
    # _setup_logging() was called at import time, so root logger already has our handler.
    # Use a unique logger name to simulate a third-party lib (e.g. NeMo, uvicorn).
    third_party = logging.getLogger("nemo_test_fake")
    third_party.warning("Model download slow", extra={"model": "parakeet"})

    # The root handler writes to stderr; capfd captures both stdout and stderr
    import sys
    sys.stderr.flush()

    # Verify the root logger has at least one handler with _JsonFormatter
    root = logging.getLogger()
    json_handlers = [
        h for h in root.handlers
        if isinstance(h.formatter, _JsonFormatter)
    ]
    assert len(json_handlers) > 0, "Root logger should have a _JsonFormatter handler"

    # Verify the handler produces valid JSON
    formatter = json_handlers[0].formatter
    assert formatter is not None
    record = logging.LogRecord(
        name="nemo_test_fake",
        level=logging.WARNING,
        pathname="test.py",
        lineno=1,
        msg="Model download slow",
        args=(),
        exc_info=None,
    )
    record.model = "parakeet"
    output = formatter.format(record)
    parsed = json.loads(output)
    assert parsed["level"] == "WARNING"
    assert parsed["msg"] == "Model download slow"
    assert parsed["model"] == "parakeet"


def test_voice_engine_logger_no_propagation() -> None:
    """voice-engine logger should not propagate to root (prevents double-logging)."""
    log = logging.getLogger("voice-engine")
    assert log.propagate is False
