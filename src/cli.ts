import Anthropic from "@anthropic-ai/sdk";
import { Command, InvalidArgumentError } from "commander";
import { ExitPromptError } from "@inquirer/core";
import { estimateTokens, evaluate, formatCommitMessage } from "./ai.js";
import { CONFIG_PATH, readFileConfig, resolveConfig } from "./config.js";
import { commit, ensureRepo, getContext, GitError, stageAll } from "./git.js";
import { askDecision, editMessage, log, renderEvaluation } from "./ui.js";

declare const __VERSION__: string;

interface Options {
  all?: boolean;
  model?: string;
  dryRun?: boolean;
  maxDiffChars?: number;
}

function parsePositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError("must be a positive integer.");
  return n;
}

async function run(opts: Options): Promise<number> {
  await ensureRepo();
  const config = resolveConfig(await readFileConfig(), process.env, {
    model: opts.model,
    maxDiffChars: opts.maxDiffChars,
  });

  if (!config.apiKey) {
    log.error(`No API key found. Set ANTHROPIC_API_KEY or add "apiKey" to ${CONFIG_PATH}.`);
    return 1;
  }

  const ctx = await getContext({ all: Boolean(opts.all), maxDiffChars: config.maxDiffChars });
  if (!ctx.diff.trim()) {
    if (opts.all) {
      log.warn("Nothing to commit: the working tree is clean.");
    } else {
      log.warn("No staged changes. Stage files with `git add`, or run with --all to include every change.");
    }
    return 1;
  }

  if (ctx.truncated) {
    log.warn(`Diff is ${ctx.diffLength} characters; sending the first ${config.maxDiffChars} (see --max-diff-chars).`);
  }
  log.info(`Asking ${config.model} about ${ctx.branch} (~${estimateTokens(ctx.diff)} tokens of diff)...`);

  const { evaluation } = await evaluate(ctx, {
    apiKey: config.apiKey,
    model: config.model,
    fallbackModel: config.fallbackModel,
    onFallback: (from, to, reason) => log.warn(`${from} failed (${reason}). Retrying with ${to}.`),
  });

  console.log(renderEvaluation(evaluation));

  if (opts.dryRun) return 0;

  let message = formatCommitMessage(evaluation);
  const decision = await askDecision(evaluation.ready_for_commit);
  if (decision === "no") {
    log.info("Aborted. Nothing was committed.");
    return 0;
  }
  if (decision === "edit") {
    message = await editMessage(evaluation);
  }

  if (opts.all) await stageAll();
  const output = await commit(message);
  log.success(output.split("\n")[0] ?? "Committed.");
  return 0;
}

function describeError(err: unknown): string {
  if (err instanceof GitError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API rejected the API key.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key does not have access to that model.";
  if (err instanceof Anthropic.NotFoundError) return "Model not found. Check the name passed to --model.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Try again shortly.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API. Check your network connection.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error (${err.status ?? "unknown"}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export async function main(argv = process.argv): Promise<void> {
  const program = new Command()
    .name("smart-commit")
    .description("Review your Git changes with Claude and commit with a Conventional Commit message.")
    .version(__VERSION__)
    .option("-a, --all", "include unstaged and untracked changes, and stage them all before committing")
    .option("-m, --model <model-name>", "Claude model to use (default: claude-sonnet-5-5)")
    .option("-d, --dry-run", "print the evaluation without prompting or running Git commands")
    .option("--max-diff-chars <n>", "truncate the diff sent to Claude after this many characters", parsePositiveInt)
    .action(async (opts: Options) => {
      try {
        process.exitCode = await run(opts);
      } catch (err) {
        if (err instanceof ExitPromptError) {
          log.info("Aborted. Nothing was committed.");
          process.exitCode = 130;
          return;
        }
        log.error(describeError(err));
        process.exitCode = 1;
      }
    });

  await program.parseAsync(argv);
}
