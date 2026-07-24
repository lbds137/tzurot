# voice-engine — Python standards

Loaded only when working under `services/voice-engine/`. Python 3.11+ with
FastAPI; these patterns are enforced by `ruff`, `mypy --strict`, and `pytest`.

## Error Handling

```python
# ❌ WRONG — HTTPException gets caught by the generic handler
except Exception as e:
    raise HTTPException(...)

# ✅ CORRECT — re-raise HTTPException before the generic catch
except HTTPException:
    raise
except Exception:
    logger.error("Operation failed", exc_info=True)
    raise HTTPException(status_code=500, detail="Operation failed")
```

## Input Validation

| Check                     | Pattern                                                 |
| ------------------------- | ------------------------------------------------------- |
| File size                 | `len(await file.read()) > MAX_AUDIO_UPLOAD_BYTES` → 413 |
| Voice ID (path traversal) | `_VOICE_ID_RE.match(voice_id)` → 400                    |
| MIME type                 | `content_type not in _AUDIO_EXTENSIONS` → 400           |
| Text length               | `len(text) > MAX_TTS_TEXT_LENGTH` → 400                 |

## Temp File Cleanup

Always use `try/finally` for temp files — model errors must not leak files:

```python
ref_tmp_path = None
try:
    # ... write temp file, do inference ...
finally:
    if ref_tmp_path is not None and os.path.exists(ref_tmp_path):
        os.unlink(ref_tmp_path)
```

## Logging

Use stdlib `logging` with structured fields (not `print()`):

```python
logger.info("Transcribed audio", extra={"chars": len(text)})
logger.warning("Voice not found", extra={"voice_id": voice_id})
logger.error("Operation failed", exc_info=True)
```

## Type Hints

- All functions must have parameter and return type annotations
- Use `Any` for NeMo/PocketTTS objects (no type stubs) — justify with `# type: ignore[import-untyped]`
- Target: `mypy --strict` passes
