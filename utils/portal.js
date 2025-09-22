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
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Link API Key</title>
<style>body{font-family:system-ui;margin:2rem;max-width:560px}label{display:block;margin:.5rem 0}.note{color:#666;font-size:.9rem}input,select{padding:.5rem;width:100%;max-width:100%}</style>
</head><body>
  <h2>Securely link your API key</h2>
  <p class="note">For: <b>${payload.userId}</b>${
        payload.guildId !== "dm" ? ` in guild <b>${payload.guildId}</b>` : ""
      }</p>
  <form method="post" action="/setup">
    <input type="hidden" name="token" value="${String(token)}" />
    <label>Provider
      <select name="provider">
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
    <button type="submit">Save</button>
    <p class="note">We store the key encrypted if SECRETS_KEY is set. The link expires shortly.</p>
  </form>
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
      const { token, provider, apiKey } = req.body || {};
      const payload = verifySetupToken(String(token || ""));
      const prov = String(provider || payload.provider || "").toLowerCase();
      if (!ALLOWED_PROVIDERS.has(prov)) throw new Error("Unsupported provider");
      if (typeof apiKey !== "string" || apiKey.length < 8)
        throw new Error("Invalid API key");

      const keyName =
        payload.scope === "guild"
          ? `guild:${payload.guildId}:${prov}_key`
          : `user:${payload.userId}:${prov}_key`;

      const toStore = encryptIfPossible(apiKey);
      await setCache(keyName, toStore, 86400 * 30);

      res.status(200).send(`Saved key for ${prov}. You can close this window.`);
      console.log(`Saved ${prov} key for ${keyName} = ${maskKey(apiKey)}`);
    } catch (e) {
      console.error("Portal setup error:", e.message);
      res.status(400).send("Failed to save key: " + e.message);
    }
  });

  const port = parseInt(process.env.PORTAL_PORT || "8787", 10);
  app.listen(port, () => console.log(`Setup portal listening on :${port}`));
}

module.exports = { startPortal };
