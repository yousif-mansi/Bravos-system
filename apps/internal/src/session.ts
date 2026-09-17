import { publishAccount } from "./account-session.ts";
import { signOut } from "./api.ts";
import { pos } from "./pos.ts";

export function isNetworkFailure(error: unknown): boolean {
  return !(error instanceof Error && "status" in error);
}

export async function signOutPreservingSales(staffId: string | null): Promise<boolean> {
  const accepted = await invalidateOfflineSession(staffId);
  if (!accepted) return false;
  try {
    await signOut();
  } catch {
    /* explicit sign-out still blocks offline use */
  }
  return true;
}

export async function invalidateOfflineSession(staffId: string | null): Promise<boolean> {
  const expectedRevision = await pos.readSessionRevision();
  const revision = crypto.randomUUID();
  if (staffId) {
    const accepted = await pos.markSignedOut(staffId, { expectedRevision, revision });
    if (!accepted) {
      return false;
    }
  }
  publishAccount(null);
  return true;
}
