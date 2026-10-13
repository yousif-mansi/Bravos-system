import { accountGeneration, publishAccount } from "./account-session.ts";
import { signOut } from "./api.ts";
import { pos } from "./pos.ts";

export function isNetworkFailure(error: unknown): boolean {
  return !(error instanceof Error && "status" in error);
}

export async function signOutPreservingSales(staffId: string | null): Promise<boolean> {
  const signedOutGeneration = await invalidateCurrentOfflineSession(staffId);
  if (signedOutGeneration === null || accountGeneration() !== signedOutGeneration) return false;
  try {
    await signOut();
  } catch {
    /* explicit sign-out still blocks offline use */
  }
  return accountGeneration() === signedOutGeneration;
}

export async function invalidateOfflineSession(staffId: string | null): Promise<boolean> {
  const signedOutGeneration = await invalidateCurrentOfflineSession(staffId);
  return signedOutGeneration !== null && accountGeneration() === signedOutGeneration;
}

async function invalidateCurrentOfflineSession(staffId: string | null): Promise<number | null> {
  const epoch = accountGeneration();
  const stillCurrent = () => accountGeneration() === epoch;
  if (!staffId) {
    const current = await pos.loadSignedInWorkspace();
    if (!stillCurrent() || current) return null;
    return publishAccount(null).generation;
  }

  // A workspace refresh can advance the revision without changing the account.
  // Retry only while this logout still owns the same signed-in account.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const expectedRevision = await pos.readSessionRevision();
    if (!stillCurrent()) return null;
    const current = await pos.loadSignedInWorkspace();
    if (!stillCurrent() || current?.staff.id !== staffId) return null;
    const revision = crypto.randomUUID();
    const accepted = await pos.markSignedOut(staffId, { expectedRevision, revision });
    if (!stillCurrent()) return null;
    if (!accepted) continue;
    const writtenRevision = await pos.readSessionRevision();
    if (!stillCurrent() || writtenRevision !== revision) return null;
    return publishAccount(null).generation;
  }
  return null;
}
