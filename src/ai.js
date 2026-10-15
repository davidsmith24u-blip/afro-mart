// LLM access for the storefront assistant and the admin copywriter.
//
// The app keeps zero runtime dependencies: this talks to any OpenAI-compatible
// `/chat/completions` endpoint over the built-in `fetch`, or to Anthropic's
// `/v1/messages` when `AI_PROVIDER=anthropic`. When no key is configured the
// assistant falls back to deterministic catalogue matching (see assistant.js),
// so the feature degrades gracefully instead of breaking.
//
// Configuration (all optional):
//   AI_API_KEY     API key (also accepts OPENAI_API_KEY)
//   AI_BASE_URL    e.g. https://api.openai.com/v1, https://openrouter.ai/api/v1,
//                  http://localhost:11434/v1 (Ollama)
//   AI_MODEL       model id (defaults per provider)
//   AI_PROVIDER    "openai" (default) or "anthropic"
//   AI_TIMEOUT_MS  request timeout, default 20000

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-haiku-latest';

const fail = (status, message) => Object.assign(new Error(message), { status });

export function aiConfig() {
  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  const key = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';
  const base = (process.env.AI_BASE_URL
    || (provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')).replace(/\/+$/, '');
  const model = process.env.AI_MODEL
    || (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL);
  return {
    enabled: Boolean(key),
    provider,
    key,
    base,
    model,
    timeoutMs: Math.max(2000, Number(process.env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
  };
}

// Public, secret-free view of the configuration for /api/config.
export function aiStatus() {
  const { enabled, provider, model } = aiConfig();
  return { enabled, provider, model };
}

async function call(messages, { system = null, maxTokens = 700, temperature = 0.4 } = {}) {
  const cfg = aiConfig();
  if (!cfg.enabled) throw fail(503, 'The AI assistant is not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    let url;
    let headers;
    let body;
    if (cfg.provider === 'anthropic') {
      url = `${cfg.base}/v1/messages`;
      headers = { 'Content-Type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' };
      body = {
        model: cfg.model,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: messages.filter((m) => m.role !== 'system'),
      };
    } else {
      url = `${cfg.base}/chat/completions`;
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` };
      body = {
        model: cfg.model,
        max_tokens: maxTokens,
        temperature,
        messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      };
    }

    let response;
    try {
      response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw fail(504, 'The AI provider timed out');
      throw fail(502, 'Could not reach the AI provider');
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw fail(response.status === 429 ? 429 : 502,
        `AI provider error (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ''}`);
    }

    const data = await response.json();
    const text = cfg.provider === 'anthropic'
      ? (Array.isArray(data?.content) ? data.content.map((part) => part?.text || '').join('') : '')
      : (data?.choices?.[0]?.message?.content ?? '');
    if (!text.trim()) throw fail(502, 'The AI provider returned an empty response');
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

export function aiChat(messages, opts = {}) {
  return call(messages, opts);
}

// Very tolerant JSON extraction: models often wrap JSON in prose or code fences.
export function extractJson(text) {
  const raw = String(text ?? '').replace(/```(?:json)?/gi, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function aiJson(messages, opts = {}) {
  const text = await call(
    [...messages, { role: 'user', content: 'Reply with a single JSON object and nothing else — no prose, no code fences.' }],
    opts,
  );
  const parsed = extractJson(text);
  if (!parsed) throw fail(502, 'The AI provider returned malformed JSON');
  return parsed;
}
