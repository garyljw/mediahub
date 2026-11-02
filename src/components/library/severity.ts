// The order of activity severities. No runtime imports, so server merges and client components can both use it.
import type { ActivitySeverity } from "@/server/arr/activity";

/** Order of severities, least to most serious. */
export const SEVERITY_RANK: Record<ActivitySeverity, number> = { ok: 0, warning: 1, error: 2 };
