/** An `invoke`-shaped model mock: takes the message and options, returns the response message. */
export type InvokeShapedMock = (...args: unknown[]) => unknown;

/** The `LLMResult`-shaped envelope LangChain core's `invoke` unwraps. */
export interface GenerateResultEnvelope {
  generations: { text: string; message: unknown }[][];
}

/**
 * Adapt an `invoke`-shaped mock to the `generate` seam `invokeModelGuarded`
 * actually calls. `generate` forwards `(messages[0], options)` — exactly the
 * arguments `invoke` received — and wraps the resolved message in the
 * `LLMResult` shape core's `invoke` unwraps, so rejections still reject and
 * every assertion against the inner mock keeps its meaning.
 *
 * Returns a plain async function rather than a `vi.fn`, so this module needs no
 * vitest dependency in a package whose non-test sources are compiled to `dist`.
 * No call site asserts on the returned function's mock surface.
 */
export function generateFromInvokeMock(
  invokeMock: InvokeShapedMock
): (messages: unknown[], options?: unknown) => Promise<GenerateResultEnvelope> {
  return async (messages: unknown[], options?: unknown) => ({
    generations: [[{ text: '', message: await invokeMock(messages[0], options) }]],
  });
}
