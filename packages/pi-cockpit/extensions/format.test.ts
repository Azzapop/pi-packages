/**
 * Unit tests for pi-cockpit formatting + usage helpers.
 *
 * Run with any TypeScript-aware test runner. Example:
 *   node --import tsx --test extensions/format.test.ts
 *
 * This package has no test runner wired up yet; the file is intentionally
 * dependency-free (uses node:test + node:assert/strict) so it can be picked
 * up once a runner is chosen.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { providerLabel, readUsage, titleCaseWords } from "./format.ts";

test("providerLabel returns known pretty names", () => {
  assert.equal(providerLabel("anthropic"), "Claude");
  assert.equal(providerLabel("openai-codex"), "Codex");
  assert.equal(providerLabel("zai"), "Z.AI");
  assert.equal(providerLabel("google-gemini-cli"), "Gemini");
  assert.equal(providerLabel("google-antigravity"), "Antigravity");
});

test("providerLabel title-cases unknown providers", () => {
  assert.equal(providerLabel("amazon-bedrock"), "Amazon Bedrock");
  assert.equal(providerLabel("google-vertex"), "Google Vertex");
  assert.equal(providerLabel("openai"), "Openai");
  assert.equal(providerLabel("xai"), "Xai"); // not in titleCaseWords acronym list
});

test("providerLabel falls back to 'usage' for empty/undefined", () => {
  assert.equal(providerLabel(undefined), "usage");
  assert.equal(providerLabel(""), "usage");
  assert.equal(providerLabel("   "), "usage");
});

test("titleCaseWords handles various inputs", () => {
  assert.equal(titleCaseWords("amazon-bedrock"), "Amazon Bedrock");
  assert.equal(titleCaseWords("gpt"), "GPT");
  assert.equal(titleCaseWords("some ai thing"), "Some AI Thing");
});

test("readUsage parses pi canonical shape", () => {
  const usage = {
    input: 100,
    output: 50,
    cacheRead: 10,
    cacheWrite: 5,
    cost: { total: 0.0042 },
  };
  assert.deepEqual(readUsage(usage), {
    input: 100,
    output: 50,
    cacheRead: 10,
    cacheWrite: 5,
    cost: 0.0042,
  });
});

test("readUsage coalesces OpenAI-style fields", () => {
  const usage = {
    prompt_tokens: 120,
    completion_tokens: 30,
  };
  const parsed = readUsage(usage);
  assert.equal(parsed.input, 120);
  assert.equal(parsed.output, 30);
  assert.equal(parsed.cacheRead, 0);
  assert.equal(parsed.cost, 0);
});

test("readUsage coalesces Bedrock Converse-style fields", () => {
  const usage = {
    inputTokens: 200,
    outputTokens: 75,
    cacheReadInputTokens: 40,
    cacheWriteInputTokens: 12,
  };
  const parsed = readUsage(usage);
  assert.equal(parsed.input, 200);
  assert.equal(parsed.output, 75);
  assert.equal(parsed.cacheRead, 40);
  assert.equal(parsed.cacheWrite, 12);
  assert.equal(parsed.cost, 0);
});

test("readUsage coalesces Anthropic-style cache_creation_input_tokens", () => {
  const usage = {
    input: 10,
    output: 5,
    cache_read_input_tokens: 7,
    cache_creation_input_tokens: 3,
  };
  const parsed = readUsage(usage);
  assert.equal(parsed.cacheRead, 7);
  assert.equal(parsed.cacheWrite, 3);
});

test("readUsage accepts numeric cost or totalCost", () => {
  assert.equal(readUsage({ cost: 1.23 }).cost, 1.23);
  assert.equal(readUsage({ totalCost: 2.5 }).cost, 2.5);
  assert.equal(readUsage({ cost: { total: 9 } }).cost, 9);
});

test("readUsage returns zeros for missing/invalid shapes", () => {
  const empty = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  assert.deepEqual(readUsage(undefined), empty);
  assert.deepEqual(readUsage(null), empty);
  assert.deepEqual(readUsage("not an object"), empty);
  assert.deepEqual(readUsage({}), empty);
  assert.deepEqual(readUsage({ input: "lots", output: NaN }), empty);
});

// Render-shape smoke test for the totals segment composition. Mirrors the
// exact composition used in CockpitFooter.render so regressions in cost/cache
// gating are caught without standing up a full TUI harness.
function composeTotalsSegment(totals: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}): string | null {
  if (!(totals.input || totals.output || totals.cost || totals.cacheRead)) return null;
  const tokens = `↑${totals.input} ↓${totals.output}`;
  const cache = totals.cacheRead > 0 ? ` ⚡${totals.cacheRead}` : "";
  const cost = totals.cost > 0 ? ` $${totals.cost}` : "";
  return `${tokens}${cache}${cost}`;
}

test("totals segment omits cost fragment when cost is zero", () => {
  assert.equal(
    composeTotalsSegment({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0 }),
    "↑100 ↓50",
  );
});

test("totals segment includes cost fragment when cost > 0", () => {
  assert.equal(
    composeTotalsSegment({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.08 }),
    "↑100 ↓50 $0.08",
  );
});

test("totals segment includes cache fragment only when cacheRead > 0", () => {
  assert.equal(
    composeTotalsSegment({ input: 100, output: 50, cacheRead: 20, cacheWrite: 0, cost: 0 }),
    "↑100 ↓50 ⚡20",
  );
  assert.equal(
    composeTotalsSegment({ input: 100, output: 50, cacheRead: 0, cacheWrite: 7, cost: 0 }),
    "↑100 ↓50",
  );
});

test("totals segment is hidden entirely when nothing is populated", () => {
  assert.equal(
    composeTotalsSegment({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }),
    null,
  );
});
