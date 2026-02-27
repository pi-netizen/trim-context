import { writeFile, copyFile, mkdir } from 'fs/promises';
import { join, basename, extname } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { summarize } from './llm.js';

const BACKUPS_DIR = join(homedir(), '.trim-context', 'backups');

// ── backup ─────────────────────────────────────────────────────────────────

/**
 * Copy `filePath` into ~/.trim-context/backups/ with a timestamp suffix.
 * Returns the destination path.
 */
async function backup(filePath) {
  await mkdir(BACKUPS_DIR, { recursive: true });

  const ext = extname(filePath);                         // ".jsonl"
  const stem = basename(filePath, ext);                  // "<uuid>"
  const ts = new Date().toISOString().replace(/[:.]/g, '-'); // safe filename
  const destName = `${stem}-${ts}${ext}`;
  const destPath = join(BACKUPS_DIR, destName);

  await copyFile(filePath, destPath);
  console.log(`[compaction] Backed up to ${destPath}`);
  return destPath;
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Rough character count of a Claude content-block array (used for token
 * estimation — not sent to the API).
 */
function charCount(content) {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  return content
    .filter((b) => b.type === 'text')
    .reduce((n, b) => n + (b.text?.length ?? 0), 0);
}

/**
 * Build a synthetic JSONL record that holds the compaction summary.
 * It is inserted as a 'user' message so Claude sees it as conversation
 * context on the next API call.
 */
function buildSummaryRecord(summaryText, sessionId, removedRange) {
  const { from, to, total } = removedRange;
  const header =
    `[TRIM-CONTEXT COMPACTION SUMMARY]\n` +
    `Messages ${from}–${to} of ${total} have been compacted into the summary below.\n\n`;

  return {
    type: 'user',
    userType: 'external',
    isSidechain: false,
    isSummary: true,          // custom flag — lets us skip re-compacting summaries
    sessionId,
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: header + summaryText,
        },
      ],
    },
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

// ── main export ────────────────────────────────────────────────────────────

/**
 * Compact a JSONL session file.
 *
 * @param {string}   filePath   Absolute path to the .jsonl file.
 * @param {object[]} allLines   Every parsed record in the file.
 * @param {object[]} messages   Only the user+assistant records (ordered).
 * @param {object}   config     CLI config (model, apiUrl, …).
 */
export async function compact(filePath, allLines, messages, config) {
  const fileName = basename(filePath);
  const total = messages.length;

  // ── 1. Backup ────────────────────────────────────────────────────────────
  await backup(filePath);

  // ── 2. Slice ─────────────────────────────────────────────────────────────
  //  Keep : messages[0]        — the opening user turn (often carries
  //                              system-level context or the original task)
  //  Summarise: messages[1 .. total-4]  (inclusive on both ends)
  //  Keep : messages[-3..]     — the three most-recent turns
  //
  //  Minimum safe size: threshold is set by the caller (default 20), so we
  //  always have enough headroom, but guard anyway.
  if (total < 5) {
    console.warn(`[compaction] ${fileName}: only ${total} messages — too few to compact safely, skipping.`);
    return;
  }

  const first        = messages[0];
  const toSummarise  = messages.slice(1, total - 3);   // indices 1 … total-4
  const last3        = messages.slice(-3);              // indices total-3 … total-1
  const sessionId    = first?.sessionId ?? '';

  console.log(
    `[compaction] ${fileName}: summarising ${toSummarise.length} messages ` +
    `(keeping first + last 3 of ${total})`
  );

  // ── 3. Summarise ─────────────────────────────────────────────────────────
  let summaryText;
  try {
    summaryText = await summarize(toSummarise, config);
    console.log(`[compaction] Summary generated (${summaryText.length} chars).`);
  } catch (err) {
    console.error(`[compaction] Ollama call failed: ${err.message}`);
    console.error('[compaction] Aborting — original file is untouched (backup kept).');
    return;
  }

  // ── 4. Rewrite ────────────────────────────────────────────────────────────
  //  Non-message lines (queue-operation, progress, file-history-snapshot, …)
  //  are preserved verbatim — they matter for Claude Code bookkeeping.
  //  New conversation order: first → summary → last 3
  const summaryRecord = buildSummaryRecord(summaryText, sessionId, {
    from: 2,              // 1-based: message 2 is index 1
    to: total - 3,        // 1-based: last summarised message
    total,
  });

  const metaLines      = allLines.filter((r) => r.type !== 'user' && r.type !== 'assistant');
  const newConversation = [first, summaryRecord, ...last3];
  const newAllLines    = [...metaLines, ...newConversation];

  const newContent = newAllLines.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(filePath, newContent, 'utf8');

  // ── Stats ─────────────────────────────────────────────────────────────────
  const savedMessages = toSummarise.length;
  const savedChars    = toSummarise.reduce(
    (n, r) => n + charCount(r.message?.content),
    0
  );
  const estimatedTokens = Math.round(savedChars / 4);

  console.log(`[compaction] ${fileName}: done.`);
  console.log(`             Messages before : ${total}`);
  console.log(`             Messages after  : ${newConversation.length}`);
  console.log(`             Removed         : ${savedMessages} messages (~${estimatedTokens} tokens freed)`);
}
