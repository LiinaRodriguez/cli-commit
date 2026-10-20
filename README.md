# smart-commit

An AI Git commit assistant for the terminal. `smart-commit` reads your changes, asks Claude whether they form a coherent commit, suggests a [Conventional Commit](https://www.conventionalcommits.org/) message, and commits it after you accept, edit, or reject it.

```
$ smart-commit -a
Asking claude-sonnet-5-5 about feat/AUTH-123-jwt (~850 tokens of diff)...

✔ Ready to commit

Status:    JWT token generation and test coverage added.
Reasoning: The core function and its unit test are implemented cleanly without stray debug code.

Suggested commit message:
  feat: implement JWT token generation logic

  - Add token signing helper in jwt.ts
  - Include unit test assertions for token expiration

? Commit with this message? (Yenh)
```

When the diff isn't ready (debug statements left in, half-finished code, several unrelated changes mixed together), it says why, and the prompt defaults to **No**.

## Install

Requires Node.js 20+ and Git.

```sh
npm install
npm run build
npm link        # makes `smart-commit` available globally
```

## Setup

Provide an Anthropic API key, either as an environment variable:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

or in `~/.smart-commit-config` (JSON, every field optional):

```json
{
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-5-5",
  "fallbackModel": "claude-haiku-5-5",
  "maxDiffChars": 10000
}
```

`ANTHROPIC_API_KEY` takes precedence over `apiKey` in the file. The key never leaves your machine except in requests to the Anthropic API.

## Usage

```sh
smart-commit            # review staged changes (git diff --staged)
smart-commit -a         # review all changes, including untracked files, and stage them before committing
smart-commit -d         # dry run: print the evaluation only, no prompt and no Git changes
smart-commit -m claude-haiku-5-5   # use a different model
```

| Option | Description |
| --- | --- |
| `-a, --all` | Include unstaged and untracked changes, and run `git add --all` before committing. |
| `-m, --model <model-name>` | Claude model to use. Default `claude-sonnet-5-5`. |
| `-d, --dry-run` | Print the evaluation without prompting or running Git commands. |
| `--max-diff-chars <n>` | Truncate the diff sent to Claude after `n` characters. Default 10,000. |

At the prompt:

- **y**: commit with the suggested message.
- **e**: edit the title inline, and optionally the body in `$EDITOR`, then commit.
- **n**: exit without committing.

If the primary model is unavailable (not found, overloaded, rate limited, network error) or declines the request, `smart-commit` retries once with the fallback model and tells you.

## Development

```sh
npm run typecheck
npm test
npm run build
```

Source layout:

- `src/git.ts`: reads branch, status and diff; stages and commits.
- `src/ai.ts`: prompt, response schema, Claude call with structured JSON output and model fallback.
- `src/ui.ts`: terminal rendering and interactive prompts.
- `src/cli.ts`: flags, config loading and error messages.
