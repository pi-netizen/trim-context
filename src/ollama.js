/**
 * ollama.js — thin HTTP client for Ollama's OpenAI-compatible chat endpoint.
 *
 * Ollama exposes: POST <apiUrl>/v1/chat/completions
 * This is identical to the OpenAI API shape, so any OpenAI-compatible
 * local inference server (LM Studio, llama.cpp, etc.) will work too.
 */

const SYSTEM_PROMPT = `\
You are a technical assistant that compresses coding-session conversation histories.

Produce a concise "Technical State Summary" from the messages you receive.
Your summary must capture:
  • The problem or feature being worked on
  • Key architectural / design decisions made
  • Current state of relevant files, functions, and variables
  • Tool calls and their outcomes where they affect the current state
  • Any blockers, open questions, or explicitly stated next steps

Rules:
  - Be specific: include file paths, function names, error messages, and values
  - Write in clear technical prose (no bullet-point lists unless truly needed)
  - Do NOT repeat yourself or add filler text
  - Do NOT start with "Here is a summary…" — go straight into the content`;

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Extract plain text from a Claude content-block array (or bare string).
 */
function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
}

/**
 * Convert JSONL conversation records into OpenAI-compatible message objects.
 * Skips records whose content is empty after extraction.
 */
function toOpenAIMessages(records) {
  return records
    .map((rec) => ({
      role: rec.message?.role ?? 'user',
      content: extractText(rec.message?.content),
    }))
    .filter((m) => m.content.length > 0);
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Send `records` (JSONL user/assistant entries) to the Ollama API and return
 * the generated Technical State Summary string.
 *
 * @param {object[]} records  JSONL records to summarise.
 * @param {object}   config   CLI config — needs `model` and `apiUrl`.
 * @returns {Promise<string>} The raw summary text.
 */
export async function summarize(records, config) {
  const { model, apiUrl } = config;
  const endpoint = `${apiUrl.replace(/\/$/, '')}/v1/chat/completions`;

  const chatMessages = toOpenAIMessages(records);

  if (chatMessages.length === 0) {
    throw new Error('No non-empty messages to summarise.');
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...chatMessages,
      {
        role: 'user',
        content:
          'Now write the Technical State Summary for the conversation above. ' +
          'Be thorough but concise.',
      },
    ],
    stream: false,
    temperature: 0.2,
  };

  console.log(
    `[ollama] Sending ${chatMessages.length} messages to ${model} @ ${endpoint}`
  );

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Could not reach Ollama at ${endpoint}. Is it running? (${err.message})`
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama API returned ${response.status}: ${text}`);
  }

  const data = await response.json();
  const summary = data.choices?.[0]?.message?.content;

  if (typeof summary !== 'string' || summary.trim().length === 0) {
    throw new Error(
      `Unexpected Ollama response shape: ${JSON.stringify(data)}`
    );
  }

  return summary.trim();
}
