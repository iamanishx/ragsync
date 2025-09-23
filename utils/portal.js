const express = require("express");
const { setCache } = require("../redis/redisUtils");
const { encryptIfPossible, maskKey } = require("./secrets");
const { verifySetupToken } = require("./setupLink");

const ALLOWED_PROVIDERS = new Set([
  "openrouter",
  "groq",
  "anthropic",
  "google",
  "openai",
]);

function startPortal() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => res.status(200).send("ok"));

  app.get("/setup", (req, res) => {
    try {
      const { token } = req.query;
      const payload = verifySetupToken(String(token || ""));
      const provider = payload.provider || "openrouter";
      const scopeText = payload.scope === "guild" ? "SERVER-WIDE" : "PERSONAL";
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Setup ${scopeText} Configuration</title>
<style>body{font-family:system-ui;margin:2rem;max-width:560px}label{display:block;margin:.5rem 0}.note{color:#666;font-size:.9rem}input,select{padding:.5rem;width:100%;max-width:100%}h2{color:#333}</style>
</head><body>
  <h2>Setup ${scopeText} AI Configuration</h2>
  <p class="note">For: <b>${payload.userId}</b>${
        payload.guildId !== "dm" ? ` in guild <b>${payload.guildId}</b>` : ""
      }</p>
  <form method="post" action="/setup">
    <input type="hidden" name="token" value="${String(token)}" />
    <label>AI Provider
      <select name="provider" id="provider" onchange="updateModels()">
        ${["openrouter", "groq", "anthropic", "google", "openai"]
          .map(
            (p) =>
              `<option value="${p}" ${
                p === provider ? "selected" : ""
              }>${p}</option>`
          )
          .join("")}
      </select>
    </label>
    <label>API Key
      <input name="apiKey" type="password" required placeholder="Paste your API key" />
    </label>
    <label>Default Model
      <select name="model" id="model" onchange="handleModelChange()">
        <option value="">Select from list...</option>
        <option value="deepseek/deepseek-r1-0528-qwen3-8b:free">DeepSeek R1 (Free)</option>
        <option value="llama-3.1-8b-instant">Llama 3.1 8B</option>
        <option value="claude-3-5-sonnet-latest">Claude 3.5 Sonnet</option>
        <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
        <option value="gpt-4o-mini">GPT-4o Mini</option>
        <option value="custom">Custom Model ID</option>
      </select>
    </label>
    <label id="customModelLabel" style="display:none;">Custom Model ID
      <input name="customModel" id="customModel" type="text" placeholder="e.g., gemini-2.5-pro, gpt-4o-2024-08-06" />
      <div class="note">Enter the exact model ID from your provider's documentation</div>
    </label>
    <button type="submit">Save Configuration</button>
    <p class="note">Provider, API key, and model will all be saved. Keys are encrypted if SECRETS_KEY is set.</p>
  </form>
  <script>
    const modelsByProvider = {
      openrouter: [
        {value: "deepseek/deepseek-r1-0528-qwen3-8b:free", text: "DeepSeek R1 (Free)"},
        {value: "google/gemma-2-9b-it:free", text: "Gemma 2 9B (Free)"},
        {value: "anthropic/claude-3-5-sonnet", text: "Claude 3.5 Sonnet"}
      ],
      groq: [
        {value: "llama-3.1-8b-instant", text: "Llama 3.1 8B Instant"},
        {value: "llama-3.1-70b-versatile", text: "Llama 3.1 70B Versatile"},
        {value: "mixtral-8x7b-32768", text: "Mixtral 8x7B"}
      ],
      anthropic: [
        {value: "claude-3-5-sonnet-latest", text: "Claude 3.5 Sonnet"},
        {value: "claude-3-5-haiku-latest", text: "Claude 3.5 Haiku"}
      ],
      google: [
        {value: "gemini-1.5-flash", text: "Gemini 1.5 Flash"},
        {value: "gemini-1.5-pro", text: "Gemini 1.5 Pro"}
      ],
      openai: [
        {value: "gpt-4o-mini", text: "GPT-4o Mini"},
        {value: "gpt-4o", text: "GPT-4o"},
        {value: "gpt-3.5-turbo", text: "GPT-3.5 Turbo"}
      ]
    };
    function updateModels() {
      const provider = document.getElementById('provider').value;
      const modelSelect = document.getElementById('model');
      modelSelect.innerHTML = '<option value="">Select from list...</option>';
      const models = modelsByProvider[provider] || [];
      models.forEach(m => {
        const option = document.createElement('option');
        option.value = m.value;
        option.textContent = m.text;
        modelSelect.appendChild(option);
      });
      // Add custom option
      const customOption = document.createElement('option');
      customOption.value = 'custom';
      customOption.textContent = 'Custom Model ID';
      modelSelect.appendChild(customOption);
      
      // Hide custom input initially
      document.getElementById('customModelLabel').style.display = 'none';
    }
    
    function handleModelChange() {
      const modelSelect = document.getElementById('model');
      const customLabel = document.getElementById('customModelLabel');
      const customInput = document.getElementById('customModel');
      
      if (modelSelect.value === 'custom') {
        customLabel.style.display = 'block';
        customInput.required = true;
      } else {
        customLabel.style.display = 'none';
        customInput.required = false;
        customInput.value = '';
      }
    }
    
    updateModels();
  </script>
</body></html>`;
      res.status(200).send(html);
    } catch (e) {
      res
        .status(400)
        .send("Invalid or expired link. Please request a new one.");
    }
  });

  app.post("/setup", async (req, res) => {
    try {
      const { token, provider, apiKey, model, customModel } = req.body || {};
      const payload = verifySetupToken(String(token || ""));
      const prov = String(provider || payload.provider || "").toLowerCase();
      if (!ALLOWED_PROVIDERS.has(prov)) throw new Error("Unsupported provider");
      if (typeof apiKey !== "string" || apiKey.length < 8)
        throw new Error("Invalid API key");
      
      let selectedModel = model;
      if (model === 'custom') {
        if (!customModel || typeof customModel !== "string" || customModel.trim().length < 3) {
          throw new Error("Custom model ID required and must be at least 3 characters");
        }
        selectedModel = customModel.trim();
      } else if (!model || model === '') {
        throw new Error("Model selection required");
      }

      const scope = payload.scope === "guild" ? "guild" : "user";
      const prefix =
        scope === "guild"
          ? `guild:${payload.guildId}`
          : `user:${payload.userId}`;

      const keyName = `${prefix}:${prov}_key`;
      const encryptedKey = encryptIfPossible(apiKey);
      await setCache(keyName, encryptedKey, 86400 * 30);

      await setCache(`${prefix}:selected_provider`, prov, 86400 * 30);
      await setCache(`${prefix}:selected_model`, selectedModel, 86400 * 30);

      const scopeText = scope === "guild" ? "server-wide" : "personal";
      res
        .status(200)
        .send(
          `  Saved ${scopeText} configuration:<br>Provider: ${prov}<br>Model: ${selectedModel}<br><br>You can close this window.`
        );
      console.log(
        `Saved ${scopeText} config for ${prefix}: provider=${prov}, model=${selectedModel}, key=${maskKey(
          apiKey
        )}`
      );
    } catch (e) {
      console.error("Portal setup error:", e.message);
      res.status(400).send("Failed to save configuration: " + e.message);
    }
  });

  const port = parseInt(process.env.PORTAL_PORT || "8787", 10);
  app.listen(port, () => console.log(`Setup portal listening on :${port}`));
}

module.exports = { startPortal };
