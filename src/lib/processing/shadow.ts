import { ProcessingError } from "./contracts";

/** Phase 3A is read-only. Missing configuration defaults safe; opt-out is forbidden. */
export function assertShadowMode(env: Record<string, string | undefined> = process.env) {
  if ((env.SHADOW_MODE ?? "true") !== "true") throw new ProcessingError("SHADOW_MODE_REQUIRED");
}

/** Legacy DB safety invariant, not a selectable delivery mode. Both automatic
 * machine delivery and explicit human approval operate with REQUIRE_APPROVAL.
 * Only telegramAutoPolicy controls automatic delivery. */
export function assertApprovalMode(mode: string | null | undefined) {
  if (mode !== "REQUIRE_APPROVAL") throw new ProcessingError("REQUIRE_APPROVAL_REQUIRED");
}
