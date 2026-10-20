import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { GitContext } from "./git.js";

export const COMMIT_TYPES = ["feat", "fix", "refactor", "docs", "test", "chore"] as const;

export const EvaluationSchema = z.object({
  ready_for_commit: z.boolean(),
  feature_status: z.string(),
  reasoning: z.string(),
  commit_type: z.enum(COMMIT_TYPES),
  commit_message: z.string(),
  commit_body: z.string(),
});

export type Evaluation = z.infer<typeof EvaluationSchema>;

export class EvaluationError extends Error {}

const SYSTEM_PROMPT = `You review local Git changes before they are committed and write Conventional Commit messages.

You receive a JSON object with the current branch, \`git status --short\` output, and the diff that would be committed.

Decide whether the diff is ready to commit:
- ready_for_commit is true when the changes form one coherent, atomic unit of work.
- It is false when there is incomplete or syntactically broken code, leftover debug statements (console.log, print, debugger, commented-out experiments), TODO stubs that leave the feature unfinished, or several unrelated tasks mixed together. Say which in reasoning, and what to do next (finish, clean up, or split the commit).
- Untracked files in the status that are clearly part of the work but missing from the diff are worth mentioning.

Always produce a commit suggestion, even when the diff is not ready:
- feature_status: one sentence summarizing what the diff accomplishes.
- commit_type: the Conventional Commit type that fits best.
- commit_message: the summary line without the type prefix, imperative mood, lowercase start, no trailing period, at most 50 characters.
- commit_body: a short bulleted list ("- " per line) of the specific changes.

If the diff is marked as truncated, judge from what is visible and say so in reasoning. Write every field in English.`;

export function buildPayload(ctx: GitContext): string {
  return JSON.stringify(
    {
      branch: ctx.branch,
      status: ctx.status,
      diff: ctx.diff,
      ...(ctx.truncated ? { diff_truncated: true, full_diff_chars: ctx.diffLength } : {}),
    },
    null,
    2,
  );
}

/** Rough token estimate (about 4 characters per token) for display only. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function evaluateWith(client: Anthropic, model: string, payload: string): Promise<Evaluation> {
  const response = await client.messages.parse({
    model,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: payload }],
    output_config: {
      // Low effort keeps the round trip short; this is a quick review, not deep analysis.
      effort: "low",
      format: zodOutputFormat(EvaluationSchema),
    },
  });

  if (response.stop_reason === "refusal") {
    throw new EvaluationError(`${model} declined to evaluate this diff.`);
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new EvaluationError(`${model} returned an incomplete response.`);
  }
  return response.parsed_output;
}

/** Errors worth retrying on the fallback model: the primary is unavailable or declined. */
function shouldFallBack(err: unknown): boolean {
  return (
    err instanceof EvaluationError ||
    err instanceof Anthropic.NotFoundError ||
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError ||
    err instanceof Anthropic.APIConnectionError
  );
}

export interface EvaluateOptions {
  apiKey: string;
  model: string;
  fallbackModel?: string;
  onFallback?: (from: string, to: string, reason: string) => void;
}

export async function evaluate(
  ctx: GitContext,
  opts: EvaluateOptions,
): Promise<{ evaluation: Evaluation; model: string }> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const payload = buildPayload(ctx);

  try {
    return { evaluation: await evaluateWith(client, opts.model, payload), model: opts.model };
  } catch (err) {
    const fallback = opts.fallbackModel;
    if (!fallback || fallback === opts.model || !shouldFallBack(err)) throw err;
    opts.onFallback?.(opts.model, fallback, (err as Error).message);
    return { evaluation: await evaluateWith(client, fallback, payload), model: fallback };
  }
}

export function formatCommitMessage(e: Pick<Evaluation, "commit_type" | "commit_message" | "commit_body">): string {
  const title = `${e.commit_type}: ${e.commit_message.trim()}`;
  const body = e.commit_body.trim();
  return body ? `${title}\n\n${body}\n` : `${title}\n`;
}
