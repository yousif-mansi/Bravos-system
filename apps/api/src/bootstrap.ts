import type { IdentityServices } from "@bravos/identity";

export async function ensureOwner(services: IdentityServices, input: {
  loginName: string;
  displayName: string;
  password: string;
}) {
  return services.createStaffRecord(
    {
      loginName: input.loginName,
      displayName: input.displayName,
      password: input.password,
      role: "manager",
      grants: [],
    },
    { isOwner: true, role: "manager", actorStaffId: null },
  );
}
