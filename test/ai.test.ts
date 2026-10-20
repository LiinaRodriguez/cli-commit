import { describe, expect, it } from "vitest";
import { buildPayload, EvaluationSchema, formatCommitMessage } from "../src/ai.js";
import { resolveConfig } from "../src/config.js";

describe("formatCommitMessage", () => {
  it("joins type, title and body", () => {
    expect(
      formatCommitMessage({ commit_type: "feat", commit_message: "add login", commit_body: "- Add form\n" }),
    ).toBe("feat: add login\n\n- Add form\n");
  });

  it("omits an empty body", () => {
    expect(formatCommitMessage({ commit_type: "fix", commit_message: "typo", commit_body: " " })).toBe("fix: typo\n");
  });
});

describe("buildPayload", () => {
  it("matches the spec's prompt shape and flags truncation", () => {
    const ctx = { branch: "feat/x", status: "M a.ts", diff: "d", diffLength: 50, truncated: true };
    expect(JSON.parse(buildPayload(ctx))).toEqual({
      branch: "feat/x",
      status: "M a.ts",
      diff: "d",
      diff_truncated: true,
      full_diff_chars: 50,
    });
  });
});

describe("EvaluationSchema", () => {
  it("accepts the spec's example response", () => {
    const example = {
      ready_for_commit: true,
      feature_status: "JWT token generation and test coverage added.",
      reasoning: "The core function and its unit test are implemented cleanly without stray debug code.",
      commit_type: "feat",
      commit_message: "implement JWT token generation logic",
      commit_body: "- Add token signing helper in jwt.ts\n- Include unit test assertions for token expiration",
    };
    expect(EvaluationSchema.parse(example)).toEqual(example);
  });
});

describe("resolveConfig", () => {
  it("prefers flags, then env, then the config file, then defaults", () => {
    const file = { apiKey: "file-key", model: "file-model", maxDiffChars: 500 };
    expect(resolveConfig(file, { ANTHROPIC_API_KEY: "env-key" }, { model: "flag-model" })).toEqual({
      apiKey: "env-key",
      model: "flag-model",
      fallbackModel: "claude-haiku-5-5",
      maxDiffChars: 500,
    });
    expect(resolveConfig({}, {}, {})).toEqual({
      apiKey: undefined,
      model: "claude-sonnet-5-5",
      fallbackModel: "claude-haiku-5-5",
      maxDiffChars: 10_000,
    });
  });
});
