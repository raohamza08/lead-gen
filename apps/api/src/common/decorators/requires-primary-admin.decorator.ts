import { SetMetadata } from "@nestjs/common";

export const REQUIRES_PRIMARY_ADMIN_KEY = "requiresPrimaryAdmin";

/** Attach to a controller/route: @RequiresPrimaryAdmin(). Enforced by
 *  PrimaryAdminGuard — gates System Logs and other admin-only surfaces to
 *  the org's single primary admin, distinct from the shared Role.ADMIN. */
export const RequiresPrimaryAdmin = () => SetMetadata(REQUIRES_PRIMARY_ADMIN_KEY, true);
