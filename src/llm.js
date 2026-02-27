/**
 * llm.js — routes summarisation requests to the right backend.
 *
 * Decision logic:
 *   config.apiUrl is set  →  OpenAI-compatible HTTP (Ollama, LM Studio, …)
 *   config.apiUrl is null →  Anthropic SDK  (default, uses claude-haiku-4-5)
 */

import { summarize as summarizeAnthropic } from './anthropic.js';
import { summarize as summarizeOllama } from './ollama.js';

/**
 * @param {object[]} records  JSONL user/assistant records to summarise.
 * @param {object}   config   Full CLI config object.
 * @returns {Promise<string>} Technical State Summary text.
 */
export async function summarize(records, config) {
  if (config.apiUrl) {
    return summarizeOllama(records, config);
  }
  return summarizeAnthropic(records, config);
}
