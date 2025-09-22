const { streamText } = require("ai");
const { createOpenAI } = require("@ai-sdk/openai");
const { createAnthropic } = require("@ai-sdk/anthropic");
const { createGoogleGenerativeAI } = require("@ai-sdk/google");
const { createGroq } = require("@ai-sdk/groq");
const Bottleneck = require('bottleneck');

// Global LLM concurrency limiter
const llmLimiter = new Bottleneck({
  maxConcurrent: parseInt(process.env.LLM_MAX_CONCURRENCY || '5', 10),
  minTime: parseInt(process.env.LLM_MIN_TIME_MS || '0', 10),
});

// Map provider -> client factory
function getClient(provider, options) {
  switch ((provider || "").toLowerCase()) {
    case "openrouter":
      return createOpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL || "https://openrouter.ai/api/v1",
        headers: {
          ...(options.headers || {}),
          "HTTP-Referer": options.referer || "https://discord.com",
          "X-Title": options.title || "Discord Bot",
        },
      });
    case "groq":
      return createOpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL || "https://api.groq.com/openai/v1",
      });
    case "openai":
      return createOpenAI({ apiKey: options.apiKey });
    case "anthropic":
      return createAnthropic({ apiKey: options.apiKey });
    case "google":
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: options.apiKey });
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

// messages: [{ role: 'system'|'user'|'assistant', content: string }]
// Returns: { text, raw }
async function chatWithProvider({
  provider,
  apiKey,
  model,
  messages,
  temperature = 0.7,
  maxTokens = 1000,
  headers = {},
  baseURL,
  referer,
  title,
}) {
  const job = async () => {
    const client = getClient(provider, {
      apiKey,
      baseURL,
      headers,
      referer,
      title,
    });

    // Vercel AI SDK format
    const result = await streamText({
      model: client(model),
      messages,
      temperature,
      maxTokens,
      // We disable streaming for Discord reply assembly; still use streamText as it normalizes outputs
    });

    // Accumulate streamed text safely
    let fullText = "";
    for await (const chunk of result.textStream) {
      if (typeof chunk === "string") fullText += chunk;
    }
    return { text: fullText.trim(), raw: null };
  };

  return llmLimiter.schedule(job);
}

module.exports = {
  chatWithProvider,
};
