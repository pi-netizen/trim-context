import chokidar from 'chokidar';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { compact } from './compaction.js';

// Prevent re-entrant processing of the same file.
const inFlight = new Set();

// ── file parsing ───────────────────────────────────────────────────────────

/**
 * Read a JSONL session file and return an array of parsed record objects.
 * Returns null on any read/parse error.
 *
 * Claude Code session files are JSON-Lines: each line is one JSON record,
 * e.g. { type: 'user', message: { role: 'user', content: [...] }, … }
 */
async function parseSessionFile(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  } catch (err) {
    console.error(
      `[watcher] Failed to read/parse ${basename(filePath)}: ${err.message}`
    );
    return null;
  }
}

/**
 * Extract conversation records from all JSONL lines.
 * Only 'user' and 'assistant' records contribute to Claude's context window;
 * other types (queue-operation, progress, file-history-snapshot) are metadata.
 */
function extractMessages(allLines) {
  return allLines.filter(
    (r) => r.type === 'user' || r.type === 'assistant'
  );
}

// ── token estimation ───────────────────────────────────────────────────────

/**
 * Rough character count across a content-block array.
 * Used only for dry-run estimates (~4 chars ≈ 1 token).
 */
function charCount(content) {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  return content
    .filter((b) => b.type === 'text')
    .reduce((n, b) => n + (b.text?.length ?? 0), 0);
}

// ── change handler ─────────────────────────────────────────────────────────

async function handleChange(filePath, config) {
  if (inFlight.has(filePath)) return;

  const allLines = await parseSessionFile(filePath);
  if (!allLines) return;

  const messages = extractMessages(allLines);
  const count = messages.length;

  if (count <= config.threshold) {
    console.log(
      `[watcher] ${basename(filePath)}: ${count} messages ` +
      `(threshold: ${config.threshold})`
    );
    return;
  }

  // ── dry-run ──────────────────────────────────────────────────────────────
  if (config.dryRun) {
    const wouldRemove  = messages.slice(1, count - 3);
    const keptCount    = count - wouldRemove.length;  // first + summary + last 3
    const savedChars   = wouldRemove.reduce(
      (n, r) => n + charCount(r.message?.content),
      0
    );
    const estTokens    = Math.round(savedChars / 4);

    console.log(`[dry-run] ${basename(filePath)}`);
    console.log(`          Messages now   : ${count}`);
    console.log(`          After compaction: ${keptCount} (first + summary + last 3)`);
    console.log(`          Would remove   : ${wouldRemove.length} messages`);
    console.log(`          ~${estTokens} tokens would be freed`);
    return;
  }

  // ── live compaction ───────────────────────────────────────────────────────
  console.log(
    `[watcher] ${basename(filePath)}: ${count} messages — threshold exceeded, compacting…`
  );

  inFlight.add(filePath);
  try {
    await compact(filePath, allLines, messages, config);
  } catch (err) {
    console.error(`[watcher] Unexpected error during compaction: ${err.message}`);
  } finally {
    inFlight.delete(filePath);
  }
}

// ── watcher setup ──────────────────────────────────────────────────────────

export function startWatcher(config) {
  const { sessionsDir } = config;

  // Watch all .jsonl files recursively — this covers both top-level session
  // files and subagent sessions under <session-id>/subagents/*.jsonl
  const watcher = chokidar.watch(`${sessionsDir}/**/*.jsonl`, {
    ignored: /(^|[/\\])\../,    // skip dot-files
    persistent: true,
    // Settle wait — JSONL files are appended line-by-line, so we wait for
    // the write stream to be quiet before triggering.
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
    ignoreInitial: false,
  });

  watcher
    .on('add', (path) => {
      console.log(`[watcher] Tracking: ${basename(path)}`);
      handleChange(path, config);
    })
    .on('change', (path) => {
      console.log(`[watcher] Changed : ${basename(path)}`);
      handleChange(path, config);
    })
    .on('unlink', (path) => {
      console.log(`[watcher] Deleted : ${basename(path)}`);
      inFlight.delete(path);
    })
    .on('error', (err) => {
      console.error(`[watcher] Error: ${err.message}`);
    })
    .on('ready', () => {
      console.log(`[watcher] Ready — watching ${sessionsDir}`);
    });

  const shutdown = async () => {
    console.log('\n[watcher] Shutting down…');
    await watcher.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return watcher;
}
