/**
 * Read the routed model id off a LangChain response's `response_metadata`.
 *
 * The vision path invokes the model directly rather than through `LLMInvoker`,
 * so `extractAndPopulateOpenRouterReasoning` never runs on its responses and
 * `response_metadata.openrouter` is not populated there. `model_name` is
 * populated instead by @langchain/openai's chat-completions converter, which
 * assigns it from the raw payload's top-level `model` field
 * (`dist/converters/completions.js`, the non-streaming assistant branch).
 *
 * That distinction is what makes this worth reading: for a router alias such as
 * `openrouter/auto`, the model NAME we requested is the alias, while this field
 * carries the id the provider reports having served.
 *
 * Returns undefined whenever the field is absent or not a string — callers omit
 * the log field entirely rather than substituting a placeholder.
 */
export function readRoutedModel(metadata: Record<string, unknown> | undefined): string | undefined {
  const value = metadata?.model_name;
  return typeof value === 'string' ? value : undefined;
}
