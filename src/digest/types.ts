// Plan morning-digest § 1. The contract every part of § 2 starts against: the page, the JSON
// and the board all read a night through `readNight` and render `Night` as it comes.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, once parsed.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job in the night.
export type DigestRow = {
  job: string;
  // Owner on the job's last line. `null` stays `null`; views render it as `—`.
  owner: string | null;
  // Lines for this job, whatever their status.
  runs: number;
  // Lines for this job with status `retry`.
  retries: number;
  // Status on the job's last line.
  lastStatus: RunStatus;
  // The most recent `error` seen for this job, even if a later line was ok; `null` if none.
  lastError: string | null;
  // `at` of the job's first and last line, exactly as in the log (offset kept, never UTC).
  first: string;
  last: string;
};

export type Night = {
  night: string;
  // Sorted by job, so the page and the JSON share one order.
  rows: DigestRow[];
  // Lines per status, over the whole night. Bad lines are not in here.
  counts: Record<RunStatus, number>;
  // Lines that did not parse as a RunLine. Counted, never thrown.
  badLines: number;
};

// `null` when runs/<night>.jsonl does not exist, or `night` is not a YYYY-MM-DD date.
// An empty file is a Night with no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;
