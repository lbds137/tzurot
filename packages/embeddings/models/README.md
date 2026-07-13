# Vendored embedding model

`Xenova/bge-small-en-v1.5` — the ONNX export of
[BAAI/bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5)
(MIT license), quantized (`model_quantized.onnx`, served under the
`dtype: 'q8'` pipeline option).

**Why it's committed**: anonymous HuggingFace downloads are unreliable from
datacenter IPs (CI runners, Railway) — a platform-wide `AccessDenied` on HF's
legacy `resolve/` path broke CI and made every service boot a gamble. The
worker (`packages/embeddings/src/embeddingWorker.ts`) loads this directory
local-first via `env.localModelPath`; remote download remains the fallback
only when this directory is absent.

**Integrity**: `onnx/model_quantized.onnx` sha256
`6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4`.
The whole tree is marked `-text` in `.gitattributes` so checkouts stay
byte-identical to the upstream blobs regardless of platform line-ending
config. Don't reformat or "fix" these files (prettier excludes them via
`.prettierignore`).

The model is version-pinned and effectively immutable; if the pinned model
ever changes, replace the entire directory and update the sha above plus the
`MODEL_DEFAULTS.EMBEDDING` constant in common-types.
