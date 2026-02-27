import Anthropic from '@anthropic-ai/sdk';

/**
 * System prompt instructing Claude to produce a Technical State Summary.
 * Identical intent to the Ollama prompt — same output contract.
 */
const SYSTEM_PROMPT = `\
You are a technical assistant that compresses coding-session conversation histories.

Produce a concise "Technical State Summary" from the conversation you receive.
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
 * Format JSONL records into a single readable conversation transcript.
 *
 * We use a single user message rather than an alternating messages array to
 * avoid the API's strict user/assistant alternation constraint — the JSONL
 * records from Claude Code don't always alternate perfectly (tool progress
 * entries, partial assistant turns, etc.).
 */
function buildTranscript(records) {
  return records
    .filter((r) => r.message)
    .map((r) => {
      const label = r.message.role === 'assistant' ? 'Assistant' : 'User';
      const text = extractText(r.message.content);
      return text ? `[${label}]\n${text}` : null;
    })
    .filter(Boolean)
    .join('\n\n---\n\n');
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Send `records` (JSONL user/assistant entries) to the Anthropic API and
 * return the generated Technical State Summary string.
 *
 * @param {object[]} records  JSONL records to summarise.
 * @param {object}   config   CLI config — needs `model` and optionally `apiKey`.
 * @returns {Promise<string>} The raw summary text.
 */
export async function summarize(records, config) {
  // apiKey is optional — the SDK automatically reads ANTHROPIC_API_KEY from env.
  const client = new Anthropic(
    config.apiKey ? { apiKey: config.apiKey } : {}
  );

  const transcript = buildTranscript(records);

  if (!transcript.trim()) {
    throw new Error('No non-empty messages to summarise.');
  }

  console.log(
    `[anthropic] Summarising ${records.length} messages with ${config.model}`
  );

  let response;
  try {
    response = await client.messages.create({
      model: config.model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `Here is the conversation to summarise:\n\n${transcript}\n\n` +
            'Now write the Technical State Summary.',
        },
      ],
    });
  } catch (err) {
    // Provide an actionable error for the most common failure modes.
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error(
        'Anthropic authentication failed. Set the ANTHROPIC_API_KEY ' +
        'environment variable or pass --api-key.'
      );
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new Error(`Could not reach the Anthropic API: ${err.message}`);
    }
    throw err;
  }

  const summary = response.content.find((b) => b.type === 'text')?.text;

  if (!summary?.trim()) {
    throw new Error(
      `Unexpected Anthropic response shape: ${JSON.stringify(response.content)}`
    );
  }

  return summary.trim();
}
