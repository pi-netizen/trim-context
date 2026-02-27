#!/usr/bin/env node
import { program } from 'commander';
import { startWatcher } from '../src/watcher.js';
import { homedir } from 'os';
import { join } from 'path';

// Claude Code stores sessions under ~/.claude/projects/ as .jsonl files.
// The legacy ~/.claude/sessions/ path does not exist by default.
const DEFAULT_SESSIONS_DIR = join(homedir(), '.claude', 'projects');
const DEFAULT_MESSAGE_THRESHOLD = 20;

program
  .name('trim-context')
  .description('Watches Claude session files and compacts them when they grow too long')
  .version('0.1.0')
  .option(
    '-d, --dir <path>',
    'Sessions directory to watch',
    DEFAULT_SESSIONS_DIR
  )
  .option(
    '-t, --threshold <number>',
    'Message count threshold to trigger compaction',
    String(DEFAULT_MESSAGE_THRESHOLD)
  )
  .option(
    '--dry-run',
    'Print what would be compacted without modifying any files',
    false
  )
  // ── Anthropic (default backend) ──────────────────────────────────────────
  .option(
    '--model <name>',
    'Model to use for summarisation (Anthropic or Ollama)',
    'claude-haiku-4-5'
  )
  .option(
    '--api-key <key>',
    'Anthropic API key (defaults to ANTHROPIC_API_KEY env var)'
  )
  // ── Ollama / OpenAI-compatible fallback ──────────────────────────────────
  .option(
    '--api-url <url>',
    'If set, use this OpenAI-compatible endpoint instead of the Anthropic API ' +
    '(e.g. http://localhost:11434 for Ollama). ' +
    'Remember to also set --model to your local model name (e.g. llama3.2).'
  )
  .parse(process.argv);

const opts = program.opts();

// If the user pointed at an Ollama server but didn't change the model,
// nudge the model default to llama3.2 so they don't accidentally send
// a request to Ollama asking for "claude-haiku-4-5".
const resolvedModel =
  opts.apiUrl && opts.model === 'claude-haiku-4-5' ? 'llama3.2' : opts.model;

const config = {
  sessionsDir: opts.dir,
  threshold: parseInt(opts.threshold, 10),
  dryRun: opts.dryRun,
  model: resolvedModel,
  // apiUrl is undefined when using the Anthropic SDK (the llm.js router uses
  // this to decide which backend to call).
  apiUrl: opts.apiUrl ?? null,
  // apiKey is optional — the Anthropic SDK reads ANTHROPIC_API_KEY from env.
  apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? null,
};

const backend = config.apiUrl
  ? `Ollama/OpenAI-compatible @ ${config.apiUrl}`
  : `Anthropic API (${config.model})`;

console.log('trim-context starting…');
console.log(`  Watching : ${config.sessionsDir}`);
console.log(`  Threshold: ${config.threshold} messages`);
console.log(`  Dry-run  : ${config.dryRun}`);
console.log(`  Backend  : ${backend}`);
if (!config.apiUrl && !config.apiKey) {
  console.warn(
    '  Warning  : ANTHROPIC_API_KEY is not set. ' +
    'Compaction will fail unless you pass --api-key.'
  );
}
console.log('');

startWatcher(config);
