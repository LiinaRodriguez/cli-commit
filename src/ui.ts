import chalk from "chalk";
import { confirm, editor, expand, input } from "@inquirer/prompts";
import { formatCommitMessage, type Evaluation } from "./ai.js";

export type Decision = "yes" | "edit" | "no";

export const log = {
  info: (msg: string) => console.error(chalk.dim(msg)),
  warn: (msg: string) => console.error(chalk.yellow(`! ${msg}`)),
  error: (msg: string) => console.error(chalk.red(`✖ ${msg}`)),
  success: (msg: string) => console.error(chalk.green(`✔ ${msg}`)),
};

export function renderEvaluation(e: Evaluation): string {
  const verdict = e.ready_for_commit
    ? chalk.green.bold("✔ Ready to commit")
    : chalk.yellow.bold("⚠ Not ready to commit yet");
  const message = formatCommitMessage(e).trimEnd();
  const indented = message
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");

  return [
    "",
    verdict,
    "",
    `${chalk.bold("Status:")}    ${e.feature_status}`,
    `${chalk.bold("Reasoning:")} ${e.reasoning}`,
    "",
    chalk.bold("Suggested commit message:"),
    chalk.cyan(indented),
    "",
  ].join("\n");
}

export async function askDecision(ready: boolean): Promise<Decision> {
  return expand<Decision>({
    message: ready ? "Commit with this message?" : "Commit anyway?",
    // Default to "no" when the diff was judged not ready, so Enter is the safe choice.
    default: ready ? "y" : "n",
    choices: [
      { key: "y", name: "Yes, commit", value: "yes" },
      { key: "e", name: "Edit the message first", value: "edit" },
      { key: "n", name: "No, exit without committing", value: "no" },
    ],
  });
}

export async function editMessage(e: Evaluation): Promise<string> {
  const title = await input({
    message: "Commit title:",
    default: `${e.commit_type}: ${e.commit_message}`,
    prefill: "editable",
    required: true,
  });
  let body = e.commit_body.trim();
  if (await confirm({ message: "Edit the body in your editor?", default: false })) {
    body = (await editor({ message: "Commit body:", default: body, waitForUserInput: false })).trim();
  }
  return body ? `${title.trim()}\n\n${body}\n` : `${title.trim()}\n`;
}
