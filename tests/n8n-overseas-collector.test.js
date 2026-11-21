import test from 'node:test';
import worker from '../src/index.js';
import assert from 'node:assert/strict';
import {
  overseasCollectorPeriod,
  findOverseasScheduledRun,
  overseasRunVerdict,
  handleN8nOverseasCheck
} from '../src/checks/router.js';

const period = '2026-11-23';
const now = Date.parse('2026-11-23T20:00:00+08:00');
const goodRun = {
  id: 123,
  event: 'schedule',
  head_branch: 'main',
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-11-22T19:30:00Z',
  html_url: 'https://github.com/gamehack/overseas-story-supabase/actions/runs/123'
};
const goodJob = { id: 456, name: 'pipeline', status: 'completed', conclusion: 'success' };
const env = () => ({
  OPS_SCHEDULER_TOKEN: 't'.repeat(48),
  GITHUB_READ_TOKEN: 'g'.repeat(40),
  FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/mock'
});
const request = token => new Request(
  'https://ingest.monitor.qjai.org/v1/checks/overseas_collector',
  { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {} }
);

test('period uses Asia/Shanghai calendar date', () => {
  assert.equal(overseasCollectorPeriod(now), period);
  // Sunday UTC 19:30 is Monday 03:30 in Beijing.
  assert.equal(overseasCollectorPeriod(Date.parse('2026-11-22T19:30:00Z')), period);
});

test('selects only the latest scheduled main-branch run created on the Beijing period date', () => {
  const earlier = { ...goodRun, id: 122, created_at: '2026-11-22T19:20:00Z' };
  const later = { ...goodRun, id: 124, created_at: '2026-11-22T19:40:00Z' };
  const runs = [
    { ...goodRun, id: 100, created_at: '2026-11-15T19:30:00Z' },
    { ...goodRun, event: 'push', id: 101 },
    { ...goodRun, head_branch: 'feature/test', id: 102 },
    earlier,
    later
  ];
  assert.equal(findOverseasScheduledRun(period, runs).id, 124);
});

test('missing scheduled run is not healthy', () => {
  assert.deepEqual(overseasRunVerdict(null, null), {
    ok: false, reason: 'SCHEDULED_RUN_MISSING'
  });
});

test('running or queued workflow is not healthy', () => {
  assert.equal(overseasRunVerdict({ ...goodRun, status: 'in_progress' }, null).reason,
    'RUN_NOT_COMPLETED');
  assert.equal(overseasRunVerdict({ ...goodRun, status: 'queued' }, null).reason,
    'RUN_NOT_COMPLETED');
});

test('failed, cancelled, or skipped workflow conclusion is not healthy', () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped']) {
    assert.equal(overseasRunVerdict({ ...goodRun, conclusion }, null).reason,
      'RUN_CONCLUSION_' + conclusion.toUpperCase());
  }
});

test('workflow success requires at least one job and every job completed successfully', () => {
  assert.equal(overseasRunVerdict(goodRun, []).reason, 'JOBS_MISSING');
  assert.equal(overseasRunVerdict(goodRun, [{ ...goodJob, status: 'in_progress' }]).reason,
    'JOB_NOT_SUCCESS');
  assert.equal(overseasRunVerdict(goodRun, [{ ...goodJob, conclusion: 'skipped' }]).reason,
    'JOB_NOT_SUCCESS');
  assert.equal(overseasRunVerdict(goodRun, [goodJob]).ok, true);
});

test('unauthorized request is rejected before any GitHub or Feishu call', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected external call'); };
  try {
    const response = await handleN8nOverseasCheck(request(null), env(), now);
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('successful weekly pipeline is silent and does not call Feishu', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/actions/workflows/weekly-pipeline.yml/runs?')) {
      return new Response(JSON.stringify({ workflow_runs: [goodRun] }), { status: 200 });
    }
    if (String(url).includes('/actions/runs/123/jobs?')) {
      return new Response(JSON.stringify({ jobs: [goodJob] }), { status: 200 });
    }
    throw new Error('unexpected external call: ' + url);
  };
  try {
    const response = await handleN8nOverseasCheck(
      request('t'.repeat(48)), env(), now
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result, 'success');
    assert.equal(body.period_key, period);
    assert.equal(body.run_id, 123);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('a skipped pipeline job sends one Feishu P0 alert', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('/actions/workflows/weekly-pipeline.yml/runs?')) {
      return new Response(JSON.stringify({ workflow_runs: [goodRun] }), { status: 200 });
    }
    if (String(url).includes('/actions/runs/123/jobs?')) {
      return new Response(JSON.stringify({ jobs: [{ ...goodJob, conclusion: 'skipped' }] }), { status: 200 });
    }
    if (String(url).includes('open.feishu.cn')) {
      const payload = JSON.parse(options.body);
      assert.match(payload.content.text, /overseas_collector/);
      assert.match(payload.content.text, /JOB_NOT_SUCCESS/);
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    }
    throw new Error('unexpected external call: ' + url);
  };
  try {
    const response = await handleN8nOverseasCheck(
      request('t'.repeat(48)), env(), now
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result, 'alerted');
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test('GitHub API failure alerts and Feishu delivery failure returns HTTP 502', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    if (String(url).includes('open.feishu.cn')) {
      return new Response(JSON.stringify({ code: 1, msg: 'rejected' }), { status: 200 });
    }
    return new Response(JSON.stringify({ message: 'rate limited' }), { status: 403 });
  };
  try {
    const response = await handleN8nOverseasCheck(
      request('t'.repeat(48)), env(), now
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).result, 'delivery_failed');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('Worker routes overseas checks before opening the Neon database', async () => {
  const original = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw new Error('unexpected external call'); };
  try {
    const response = await worker.fetch(
      request(null),
      { OPS_SCHEDULER_TOKEN: 't'.repeat(48) },
      { waitUntil() {} }
    );
    assert.equal(response.status, 401);
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
