import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// Fixtures live in a temp dir written by this file. runs/ is never touched.
let runsDir: string;

const lines = (...rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-'));

  // 3 jobs: one ok with an owner, one fail, one with 3 retries and owner null.
  // File order differs from the sorted order on purpose.
  writeFileSync(
    join(runsDir, '2026-01-01.jsonl'),
    lines(
      { at: '2026-01-01T01:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'ana' },
      { at: '2026-01-01T02:00:00+01:00', job: 'notes/backup', status: 'fail', owner: 'ben', error: 'disk full' },
      { at: '2026-01-01T03:00:00+01:00', job: 'digest/render', status: 'retry', owner: null },
      { at: '2026-01-01T04:00:00+01:00', job: 'digest/render', status: 'retry', owner: null },
      { at: '2026-01-01T05:00:00+01:00', job: 'digest/render', status: 'retry', owner: null },
    ),
  );

  // Empty file: a night that exists and ran nothing.
  writeFileSync(join(runsDir, '2026-01-02.jsonl'), '');

  // One good line, one cut-off line.
  writeFileSync(
    join(runsDir, '2026-01-03.jsonl'),
    lines({ at: '2026-01-03T01:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'ana' }) +
      '{"at":"2026-01-03T02:00:00+01:00","job":"notes/ba',
  );
  // 2026-01-09 is deliberately absent.
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

const app = () =>
  createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });

// The whole <tr> that holds a job's name in the HTML.
function rowHtml(html: string, job: string): string {
  const at = html.indexOf(`>${job}<`);
  if (at < 0) return '';
  const start = html.lastIndexOf('<tr', at);
  const end = html.indexOf('</tr>', at);
  return html.slice(start, end);
}

describe('GET /digest/:night (HTML)', () => {
  it('renders 200 and lists each job of the night', async () => {
    const res = await app().request('/digest/2026-01-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('lane/sync');
    expect(html).toContain('notes/backup');
    expect(html).toContain('digest/render');
  });

  it('marks a row warn when it failed or retried 3 or more times', async () => {
    const html = await (await app().request('/digest/2026-01-01')).text();
    expect(rowHtml(html, 'notes/backup')).toContain('class="warn"');
    expect(rowHtml(html, 'digest/render')).toContain('class="warn"');
    expect(rowHtml(html, 'lane/sync')).not.toContain('class="warn"');
  });

  it('renders a null owner as the dash', async () => {
    const html = await (await app().request('/digest/2026-01-01')).text();
    expect(rowHtml(html, 'digest/render')).toContain('—');
    expect(rowHtml(html, 'lane/sync')).toContain('ana');
  });

  it('says "nothing ran" for an empty night', async () => {
    const res = await app().request('/digest/2026-01-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('renders 200 with "did not parse" for a night with a bad line', async () => {
    const res = await app().request('/digest/2026-01-03');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('did not parse');
    expect(html).toContain('lane/sync');
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app().request('/digest/2026-01-09');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/digest/:night (JSON)', () => {
  it('answers 200 with the Night shape', async () => {
    const res = await app().request('/api/digest/2026-01-01');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: '2026-01-01',
      rows: [
        {
          job: 'digest/render',
          owner: null,
          runs: 3,
          retries: 3,
          lastStatus: 'retry',
          lastError: null,
          first: '2026-01-01T03:00:00+01:00',
          last: '2026-01-01T05:00:00+01:00',
        },
        {
          job: 'lane/sync',
          owner: 'ana',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          first: '2026-01-01T01:00:00+01:00',
          last: '2026-01-01T01:00:00+01:00',
        },
        {
          job: 'notes/backup',
          owner: 'ben',
          runs: 1,
          retries: 0,
          lastStatus: 'fail',
          lastError: 'disk full',
          first: '2026-01-01T02:00:00+01:00',
          last: '2026-01-01T02:00:00+01:00',
        },
      ],
      counts: { ok: 1, retry: 3, fail: 1 },
      badLines: 0,
    });
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app().request('/api/digest/2026-01-09');
    expect(res.status).toBe(404);
  });

  it('gives an empty night no rows and no bad lines', async () => {
    const res = await app().request('/api/digest/2026-01-02');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: '2026-01-02',
      rows: [],
      counts: { ok: 0, retry: 0, fail: 0 },
      badLines: 0,
    });
  });

  it('counts the bad line and keeps the good rows', async () => {
    const res = await app().request('/api/digest/2026-01-03');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.badLines).toBe(1);
    expect(body.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(body.rows).toEqual([
      {
        job: 'lane/sync',
        owner: 'ana',
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        first: '2026-01-03T01:00:00+01:00',
        last: '2026-01-03T01:00:00+01:00',
      },
    ]);
  });

  it('lists jobs in the same order as the HTML page', async () => {
    const jsonRes = await app().request('/api/digest/2026-01-01');
    expect(jsonRes.status).toBe(200);
    const json = await jsonRes.json();
    const htmlRes = await app().request('/digest/2026-01-01');
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    const jobs: string[] = json.rows.map((r: { job: string }) => r.job);
    const positions = jobs.map((job) => html.indexOf(`>${job}<`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
