# trim-context

A CLI tool that watches your Claude Code session files and automatically compacts them when they grow too long — freeing context window space without losing important history.

## How it works

Claude Code stores conversation history as JSONL files under `~/.claude/projects/`. As sessions grow, they consume more and more of your context window. `trim-context` watches those files and, when a session exceeds a message threshold, it:

1. **Backs up** the original file to `~/.trim-context/backups/`
2. **Summarises** the middle messages using Claude Haiku (or a local Ollama model)
3. **Rewrites** the file, keeping:
   - The first message (original task context)
   - A generated "Technical State Summary"
   - The last 3 messages (recent context)

## Requirements

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com) **or** a running [Ollama](https://ollama.ai) instance

## Installation

```bash
# Clone and install
git clone https://github.com/pi-netizen/trim-context.git
cd trim-context
npm install
npm link        # makes `trim-context` available globally
```

> **Permission error on `npm link`?** Fix it once:
> ```bash
> mkdir -p ~/.npm-global
> npm config set prefix '~/.npm-global'
> echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
> source ~/.zshrc
> ```

## Usage

```bash
# Dry run — see what would be compacted, no files changed
trim-context --dry-run

# Live compaction using Claude Haiku (default)
ANTHROPIC_API_KEY=sk-ant-... trim-context

# Live compaction using a local Ollama model
trim-context --api-url http://localhost:11434 --model llama3.2
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `-d, --dir <path>` | `~/.claude/projects` | Sessions directory to watch |
| `-t, --threshold <n>` | `20` | Message count that triggers compaction |
| `--dry-run` | `false` | Print stats without modifying any files |
| `--model <name>` | `claude-haiku-4-5` | Model for summarisation |
| `--api-key <key>` | `$ANTHROPIC_API_KEY` | Anthropic API key |
| `--api-url <url>` | _(Anthropic SDK)_ | OpenAI-compatible endpoint (e.g. Ollama) |

## Backends

### Anthropic (default)

Uses Claude Haiku — fast and cheap (~$0.001 per compaction).

```bash
export ANTHROPIC_API_KEY=sk-ant-...
trim-context
```

### Ollama / local LLM

Point at any OpenAI-compatible endpoint. The model default auto-switches to `llama3.2` when `--api-url` is set.

```bash
trim-context --api-url http://localhost:11434
# or explicitly:
trim-context --api-url http://localhost:11434 --model mistral
```

## Backups

Every file is backed up before modification:

```
~/.trim-context/backups/<session-id>-<timestamp>.jsonl
```

To restore a backup, copy it back over the original:

```bash
cp ~/.trim-context/backups/abc123-2026-01-01T12-00-00-000Z.jsonl \
   ~/.claude/projects/<project>/<session-id>.jsonl
```

## Run automatically

To have `trim-context` start with your system, add it as a macOS launch agent:

```bash
cat > ~/Library/LaunchAgents/com.trim-context.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.trim-context</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>trim-context</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ANTHROPIC_API_KEY</key>
    <string>sk-ant-YOUR_KEY_HERE</string>
    <key>PATH</key>
    <string>/usr/local/bin:/Users/YOUR_USERNAME/.npm-global/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/trim-context.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/trim-context.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.trim-context.plist
```

## License

MIT
