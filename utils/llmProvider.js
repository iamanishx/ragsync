const { streamText } = require("ai");
const { createOpenAI } = require("@ai-sdk/openai");
const { createAnthropic } = require("@ai-sdk/anthropic");
const { createGoogleGenerativeAI } = require("@ai-sdk/google");
const { createGroq } = require("@ai-sdk/groq");
const Bottleneck = require('bottleneck');

const llmLimiter = new Bottleneck({
  maxConcurrent: parseInt(process.env.LLM_MAX_CONCURRENCY || '5', 10),
  minTime: parseInt(process.env.LLM_MIN_TIME_MS || '0', 10),
});

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

    const result = await streamText({
      model: client(model),
      messages,
      temperature,
      maxTokens,
    });

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
