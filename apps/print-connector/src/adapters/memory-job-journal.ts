import { copyJournalRecord } from "../domain/journal-record.ts";
import type { JobJournal, JournalRecord } from "../ports.ts";

export type MemoryJobJournal = JobJournal & {
  snapshot(): JournalRecord[];
  failNextWrites(count?: number): void;
};

export function createMemoryJobJournal(initial: readonly JournalRecord[] = []): MemoryJobJournal {
  let records = new Map<string, JournalRecord>();
  for (const record of initial) records.set(record.id, copyJournalRecord(record));
  let failWrites = 0;

  function consumeFailure(): void {
    if (failWrites <= 0) return;
    failWrites -= 1;
    throw new Error("journal_unavailable");
  }

  return {
    async load() {
      return [...records.values()].map((record) => copyJournalRecord(record));
    },
    async save(record) {
      consumeFailure();
      const next = copyJournalRecord(record);
      records.set(next.id, next);
    },
    async saveAll(nextRecords) {
      consumeFailure();
      const next = new Map<string, JournalRecord>();
      for (const record of nextRecords) next.set(record.id, copyJournalRecord(record));
      records = next;
    },
    snapshot() {
      return [...records.values()].map((record) => copyJournalRecord(record));
    },
    failNextWrites(count = 1) {
      failWrites += count;
    },
  };
}
