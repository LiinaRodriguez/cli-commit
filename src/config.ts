import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_FALLBACK_MODEL = "claude-haiku-5-5";
export const DEFAULT_MAX_DIFF_CHARS = 10_000;

export const CONFIG_PATH = join(homedir(), ".smart-commit-config");

export interface Config {
  apiKey?: string;
  model: string;
  fallbackModel: string;
  maxDiffChars: number;
}

/** Shape of ~/.smart-commit-config (JSON). Every field is optional. */
interface FileConfig {
  apiKey?: string;
  model?: string;
  fallbackModel?: string;
  maxDiffChars?: number;
}

export async function readFileConfig(path = CONFIG_PATH): Promise<FileConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    return JSON.parse(raw) as FileConfig;
  } catch {
    throw new Error(`Could not parse ${path}: it must be valid JSON.`);
  }
}

export function resolveConfig(
  file: FileConfig,
  env: NodeJS.ProcessEnv,
  overrides: { model?: string; maxDiffChars?: number },
): Config {
  return {
    // The environment variable wins over the file so a one-off key is easy to use.
    apiKey: env.ANTHROPIC_API_KEY || file.apiKey,
    model: overrides.model ?? file.model ?? DEFAULT_MODEL,
    fallbackModel: file.fallbackModel ?? DEFAULT_FALLBACK_MODEL,
    maxDiffChars: overrides.maxDiffChars ?? file.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS,
  };
}
