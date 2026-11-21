// Small shared helpers: user-facing errors, per-repo result tracking, tables.

// An error whose message is meant for the user as-is (no stack trace).
// `usage: true` makes the CLI print the command's usage after the message.
export class WorkbenchError extends Error {
  constructor(message, { usage = false } = {}) {
    super(message);
    this.name = "WorkbenchError";
    this.usage = usage;
  }
}

export function fail(message) {
  throw new WorkbenchError(message);
}

export function usageFail(message) {
  throw new WorkbenchError(message, { usage: true });
}

export function newResults() {
  return { ok: [], skipped: [], failed: [] };
}

// Runs fn for one item of a loop over repos/pods. A failure is reported and
// recorded, and the loop carries on; process.exitCode is set so the command
// still exits non-zero at the end.
export function attempt(results, label, fn, what = "failed") {
  try {
    fn();
    results.ok.push(label);
    return true;
  } catch (err) {
    console.error(`[${label}] ${what}: ${err.message}`);
    results.failed.push(label);
    process.exitCode = 1;
    return false;
  }
}

export function printSummary(results, skippedLabel = "skipped") {
  const { ok, skipped, failed } = results;
  console.log(
    `\ndone: ${ok.length} ok, ${skipped.length} ${skippedLabel}, ${failed.length} failed` +
      (skipped.length ? ` (${skippedLabel}: ${skipped.join(", ")})` : "") +
      (failed.length ? ` (failed: ${failed.join(", ")})` : "")
  );
}

export function printTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? String(c) : String(c).padEnd(widths[i])))
      .join("  ")
      .trimEnd();
  console.log(line(headers));
  for (const row of rows) console.log(line(row));
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
