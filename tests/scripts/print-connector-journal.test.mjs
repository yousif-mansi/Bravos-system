import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryJobJournal } from "../../apps/print-connector/src/adapters/memory-job-journal.ts";
import { createWindowsJobJournal, jobJournalPath } from "../../apps/print-connector/src/adapters/windows-job-journal.ts";
import { JOB_METADATA_CAP, JOB_RETENTION_MS } from "../../packages/print-contracts/src/index.ts";
import {
  clock,
  injectedPort,
  jobId,
  labelJob,
  pairConnector,
  receiptJob,
  request,
  startConnector,
} from "./print-connector-harness.mjs";

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed_out");
}

function journalFiles() {
  const data = new Map();
  return {
    data,
    async read(file) {
      return data.has(file) ? Buffer.from(data.get(file)) : null;
    },
    async write(file, bytes) {
      data.set(file, Buffer.from(bytes));
    },
    async rename(from, to) {
      if (!data.has(from)) throw new Error("missing");
      data.set(to, data.get(from));
      data.delete(from);
    },
    async remove(file) {
      data.delete(file);
    },
  };
}

test("dedupe metadata is capped at 50000 records and kept for 30 days", () => {
  assert.equal(JOB_METADATA_CAP, 50_000);
  assert.equal(JOB_RETENTION_MS, 30 * 24 * 60 * 60 * 1000);
});

test("more than 200 deliberate jobs are accepted and a full recent history is not discarded", async (t) => {
  const calls = [];
  const { connector, token } = await (async () => {
    const started = await startConnector({
      printPort: injectedPort(async (dispatch) => {
        calls.push(dispatch.jobId);
        return { outcome: "submitted" };
      }),
    });
    t.after(() => started.close());
    const paired = await pairConnector(started);
    assert.equal(paired.status, 200);
    return { connector: started, token: paired.json.token };
  })();
  for (let index = 1; index <= 201; index += 1) {
    const response = await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(index)) });
    assert.equal(response.status, 202);
    await connector.waitUntilIdle();
  }
  assert.equal(calls.length, 201);

  const time = clock(10_000);
  const limitedCalls = [];
  const limited = await startConnector({
    now: time.now,
    metadataCap: 1,
    retentionMs: 60_000,
    printPort: injectedPort(async (dispatch) => {
      limitedCalls.push(dispatch.jobId);
      return { outcome: "submitted" };
    }),
  });
  t.after(() => limited.close());
  const limitedPair = await pairConnector(limited);
  const first = await request(limited, { method: "POST", path: "/jobs", token: limitedPair.json.token, body: labelJob(jobId(1)) });
  await limited.waitUntilIdle();
  assert.equal(first.status, 202);
  time.advance(1_000);
  const blocked = await request(limited, { method: "POST", path: "/jobs", token: limitedPair.json.token, body: labelJob(jobId(2)) });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error, "job_retention_full");
  const replay = await request(limited, { method: "POST", path: "/jobs", token: limitedPair.json.token, body: labelJob(jobId(1)) });
  assert.equal(replay.status, 202);
  assert.equal(replay.json.job.phase, "submitted");
  assert.deepEqual(limitedCalls, [jobId(1)]);
});

test("only terminal records outside retention are pruned", async (t) => {
  const time = clock(20_000);
  const calls = [];
  const connector = await startConnector({
    now: time.now,
    metadataCap: 1,
    retentionMs: 1_000,
    printPort: injectedPort(async (dispatch) => {
      calls.push(dispatch.jobId);
      return { outcome: "submitted" };
    }),
  });
  t.after(() => connector.close());
  const paired = await pairConnector(connector);
  await request(connector, { method: "POST", path: "/jobs", token: paired.json.token, body: labelJob(jobId(1)) });
  await connector.waitUntilIdle();
  time.advance(1_000);
  const next = await request(connector, { method: "POST", path: "/jobs", token: paired.json.token, body: labelJob(jobId(2)) });
  await connector.waitUntilIdle();
  assert.equal(next.status, 202);
  assert.deepEqual(calls, [jobId(1), jobId(2)]);
  const forgotten = await request(connector, { method: "GET", path: `/jobs/${jobId(1)}`, token: paired.json.token });
  assert.equal(forgotten.status, 404);
});

test("an outstanding id is not pruned to make room", async (t) => {
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const time = clock(30_000);
  const connector = await startConnector({
    now: time.now,
    metadataCap: 1,
    retentionMs: 1_000,
    printPort: injectedPort(async (dispatch) => {
      calls.push(dispatch.jobId);
      await gate;
      return { outcome: "submitted" };
    }),
  });
  t.after(async () => {
    release();
    await connector.close();
  });
  const paired = await pairConnector(connector);
  const first = await request(connector, { method: "POST", path: "/jobs", token: paired.json.token, body: labelJob(jobId(3)) });
  assert.equal(first.status, 202);
  await waitFor(() => calls.length === 1);
  time.advance(5_000);
  const second = await request(connector, { method: "POST", path: "/jobs", token: paired.json.token, body: labelJob(jobId(4)) });
  assert.equal(second.status, 429);
  assert.equal(second.json.error, "job_retention_full");
  assert.deepEqual(calls, [jobId(3)]);
});

test("journal storage failure before submit does not spool", async (t) => {
  const calls = [];
  const journal = createMemoryJobJournal();
  journal.failNextWrites(1);
  const connector = await startConnector({
    journal,
    printPort: injectedPort(async (dispatch) => {
      calls.push(dispatch.jobId);
      return { outcome: "submitted" };
    }),
  });
  t.after(() => connector.close());
  const paired = await pairConnector(connector);
  const response = await request(connector, { method: "POST", path: "/jobs", token: paired.json.token, body: labelJob(jobId(5), 1, "قميص") });
  assert.equal(response.status, 500);
  assert.equal(response.json.error, "journal_unavailable");
  assert.deepEqual(calls, []);
  assert.equal(journal.snapshot().length, 0);
  const missing = await request(connector, { method: "GET", path: `/jobs/${jobId(5)}`, token: paired.json.token });
  assert.equal(missing.status, 404);
});

test("a terminal journal error becomes unknown and is not retried", async (t) => {
  const calls = [];
  const inner = createMemoryJobJournal();
  let writes = 0;
  const journal = {
    load: () => inner.load(),
    async save(record) {
      writes += 1;
      if (writes === 3) throw new Error("journal_unavailable");
      await inner.save(record);
    },
    async saveAll(records) {
      writes += 1;
      await inner.saveAll(records);
    },
  };
  const connector = await startConnector({
    journal,
    printPort: injectedPort(async (dispatch) => {
      calls.push(dispatch.jobId);
      return { outcome: "submitted" };
    }),
  });
  t.after(() => connector.close());
  const paired = await pairConnector(connector);
  const posted = await request(connector, { method: "POST", path: "/jobs", token: paired.json.token, body: labelJob(jobId(6)) });
  assert.equal(posted.status, 202);
  await connector.waitUntilIdle();
  const fetched = await request(connector, { method: "GET", path: `/jobs/${jobId(6)}`, token: paired.json.token });
  assert.equal(fetched.json.job.phase, "unknown");
  assert.equal(fetched.json.job.failureCode, "submission_uncertain");
  const replay = await request(connector, { method: "POST", path: "/jobs", token: paired.json.token, body: labelJob(jobId(6)) });
  assert.equal(replay.status, 202);
  assert.equal(replay.json.job.phase, "unknown");
  assert.deepEqual(calls, [jobId(6)]);
  assert.equal(inner.snapshot()[0].phase, "unknown");
});

test("a restarted journal returns the saved submitted or unknown state and does not replay", async (t) => {
  const calls = [];
  const journal = createMemoryJobJournal();
  const first = await startConnector({
    journal,
    printPort: injectedPort(async (dispatch) => {
      calls.push(dispatch.jobId);
      if (dispatch.jobId === jobId(8)) throw new Error("port_down");
      return { outcome: "submitted" };
    }),
  });
  t.after(() => first.close());
  const paired = await pairConnector(first);
  const submittedBody = labelJob(jobId(7), 1, "قميص");
  const unknownBody = labelJob(jobId(8), 1, "قميص");
  assert.equal((await request(first, { method: "POST", path: "/jobs", token: paired.json.token, body: submittedBody })).status, 202);
  await first.waitUntilIdle();
  assert.equal((await request(first, { method: "POST", path: "/jobs", token: paired.json.token, body: unknownBody })).status, 202);
  await first.waitUntilIdle();
  const saved = journal.snapshot();
  const submitted = saved.find((record) => record.id === jobId(7));
  const unknown = saved.find((record) => record.id === jobId(8));
  assert.equal(submitted.phase, "submitted");
  assert.equal(unknown.phase, "unknown");

  const secondCalls = [];
  const second = await startConnector({
    journal: createMemoryJobJournal(saved),
    printPort: injectedPort(async (dispatch) => {
      secondCalls.push(dispatch.jobId);
      return { outcome: "submitted" };
    }),
  });
  t.after(() => second.close());
  const again = await pairConnector(second);
  const sameSubmitted = await request(second, { method: "POST", path: "/jobs", token: again.json.token, body: submittedBody });
  const sameUnknown = await request(second, { method: "POST", path: "/jobs", token: again.json.token, body: unknownBody });
  assert.equal(sameSubmitted.status, 202);
  assert.equal(sameSubmitted.json.job.phase, "submitted");
  assert.equal(sameUnknown.status, 202);
  assert.equal(sameUnknown.json.job.phase, "unknown");
  const altered = await request(second, {
    method: "POST",
    path: "/jobs",
    token: again.json.token,
    body: labelJob(jobId(7), 1, "اسم آخر"),
  });
  assert.equal(altered.status, 409);
  assert.equal(altered.json.error, "job_conflict");
  assert.deepEqual(secondCalls, []);

  const submitting = saved.map((record) => record.id === jobId(7)
    ? { ...record, phase: "submitting", failureCode: null }
    : record);
  const recoveredCalls = [];
  const recovered = await startConnector({
    journal: createMemoryJobJournal(submitting),
    printPort: injectedPort(async (dispatch) => {
      recoveredCalls.push(dispatch.jobId);
      return { outcome: "submitted" };
    }),
  });
  t.after(() => recovered.close());
  const recoveredPair = await pairConnector(recovered);
  const recoveredJob = await request(recovered, { method: "POST", path: "/jobs", token: recoveredPair.json.token, body: submittedBody });
  assert.equal(recoveredJob.status, 202);
  assert.equal(recoveredJob.json.job.phase, "unknown");
  assert.equal(recoveredJob.json.job.failureCode, "submission_uncertain");
  assert.deepEqual(recoveredCalls, []);
  assert.deepEqual(calls, [jobId(7), jobId(8)]);
});

test("restart keeps the hash, drops the payload, and does not replay a submitting job", async (t) => {
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const files = journalFiles();
  const root = "C:\\Users\\Yousif Mansi\\AppData\\Local";
  const path = jobJournalPath(root);
  assert.equal(path, "C:\\Users\\Yousif Mansi\\AppData\\Local\\Bravos\\print-connector\\job-journal.json");
  assert.throws(() => jobJournalPath("C:\\Users\\Yousif Mansi\\..\\Windows"), /refusing_blob_path/);
  const firstCalls = [];
  const first = await startConnector({
    journal: createWindowsJobJournal({ platform: "win32", localAppData: root, files }),
    printPort: injectedPort(async (dispatch) => {
      firstCalls.push(dispatch.jobId);
      await gate;
      return { outcome: "submitted" };
    }),
  });
  t.after(async () => {
    release();
    await first.close();
  });
  const paired = await pairConnector(first);
  const body = receiptJob(jobId(7), "أحمد");
  const posted = await request(first, { method: "POST", path: "/jobs", token: paired.json.token, body });
  assert.equal(posted.status, 202);
  await waitFor(() => files.data.has(path) && files.data.get(path).toString("utf8").includes("\"submitting\""));
  const onDisk = files.data.get(path).toString("utf8");
  assert.equal(onDisk.includes("أحمد"), false);
  assert.equal(onDisk.includes("قميص"), false);
  assert.equal(onDisk.includes("SHIRT-1"), false);
  assert.equal(onDisk.includes(paired.json.token), false);
  assert.equal(onDisk.includes("payload"), false);
  const stored = JSON.parse(onDisk);
  assert.deepEqual(Object.keys(stored.records[0]), ["id", "hash", "kind", "phase", "failureCode", "createdAt", "updatedAt"]);
  const cleared = await request(first, { method: "POST", path: "/unpair", token: paired.json.token });
  assert.equal(cleared.status, 200);
  assert.equal(files.data.get(path).toString("utf8").includes(jobId(7)), true);

  const copy = journalFiles();
  copy.data.set(path, Buffer.from(files.data.get(path)));
  const secondCalls = [];
  const second = await startConnector({
    journal: createWindowsJobJournal({ platform: "win32", localAppData: root, files: copy }),
    printPort: injectedPort(async (dispatch) => {
      secondCalls.push(dispatch.jobId);
      return { outcome: "submitted" };
    }),
  });
  t.after(() => second.close());
  const again = await pairConnector(second);
  const replay = await request(second, { method: "POST", path: "/jobs", token: again.json.token, body });
  assert.equal(replay.status, 202);
  assert.equal(replay.json.job.phase, "unknown");
  assert.equal(replay.json.job.failureCode, "submission_uncertain");
  const conflict = await request(second, {
    method: "POST",
    path: "/jobs",
    token: again.json.token,
    body: receiptJob(jobId(7), "اسم آخر"),
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error, "job_conflict");
  assert.deepEqual(secondCalls, []);
  assert.equal(second.holdsDocument(jobId(7)), false);
  const text = copy.data.get(path).toString("utf8");
  assert.equal(text.includes("أحمد"), false);
  assert.equal(text.includes("submitting"), false);
  assert.deepEqual(firstCalls, [jobId(7)]);
});
