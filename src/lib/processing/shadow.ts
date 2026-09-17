import { ProcessingError } from "./contracts";

/** Phase 3A is read-only. Missing configuration defaults safe; opt-out is forbidden. */
export function assertShadowMode(env: Record<string, string | undefined> = process.env) {
  if ((env.SHADOW_MODE ?? "true") !== "true") throw new ProcessingError("SHADOW_MODE_REQUIRED");
}

export function assertApprovalMode(mode: string | null | undefined) {
  if (mode !== "REQUIRE_APPROVAL") throw new ProcessingError("REQUIRE_APPROVAL_REQUIRED");
}
