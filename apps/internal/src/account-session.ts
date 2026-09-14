export type AccountBroadcast = {
  eventId: string;
  generation: number;
  staffId: string | null;
};

const STORAGE_KEY = "bravos.account";
const CHANNEL_NAME = "bravos-account";

let generation = 0;
let currentStaffId: string | null | undefined;
let lastEventId: string | null = null;
let channel: BroadcastChannel | null = null;
let transportStarted = false;
const listeners = new Set<(payload: AccountBroadcast) => void>();

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") {
    return null;
  }
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

export function accountGeneration(): number {
  return generation;
}

function notify(payload: AccountBroadcast) {
  for (const listener of [...listeners]) {
    listener(payload);
  }
}

function applyLocal(staffId: string | null): AccountBroadcast {
  generation += 1;
  currentStaffId = staffId;
  lastEventId = crypto.randomUUID();
  return { eventId: lastEventId, generation, staffId };
}

function ingestRemote(payload: AccountBroadcast): AccountBroadcast | null {
  if (!payload || typeof payload.eventId !== "string") {
    return null;
  }
  if (payload.eventId === lastEventId) {
    return null;
  }
  lastEventId = payload.eventId;
  generation += 1;
  currentStaffId = payload.staffId;
  return { eventId: payload.eventId, generation, staffId: payload.staffId };
}

function ensureTransport() {
  if (transportStarted) {
    return;
  }
  transportStarted = true;
  window.addEventListener("bravos-account", (event) => {
    const detail = (event as CustomEvent<AccountBroadcast>).detail;
    if (!detail) {
      return;
    }
    if (detail.eventId === lastEventId) {
      return;
    }
    const next = ingestRemote(detail);
    if (next) {
      notify(next);
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) {
      return;
    }
    try {
      const next = ingestRemote(JSON.parse(event.newValue) as AccountBroadcast);
      if (next) {
        notify(next);
      }
    } catch {
      /* ignore */
    }
  });
  getChannel()?.addEventListener("message", (event: MessageEvent<AccountBroadcast>) => {
    if (!event.data) {
      return;
    }
    const next = ingestRemote(event.data);
    if (next) {
      notify(next);
    }
  });
}

export function publishAccount(staffId: string | null): { generation: number; revision: string } {
  ensureTransport();
  const payload = applyLocal(staffId);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
  getChannel()?.postMessage(payload);
  window.dispatchEvent(new CustomEvent("bravos-account", { detail: payload }));
  notify(payload);
  return { generation: payload.generation, revision: payload.eventId };
}

export function subscribeAccount(listener: (payload: AccountBroadcast) => void): () => void {
  ensureTransport();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
