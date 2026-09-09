export {
  awaitAuthReady,
  createBetterAuth,
  createBetterAuthIdentityProvider,
  type AuthInstance,
  type BetterAuthOptions,
  type IdentityGateway,
} from "./adapters/better-auth-provider.ts";
export { createPostgresStaffDirectory } from "./adapters/postgres-directory.ts";
export {
  createLocalRecoveryOutbox,
  createOwnerRecoveryOutbox,
  createUnavailableRecoveryOutbox,
} from "./adapters/local-recovery-outbox.ts";
