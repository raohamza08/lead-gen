import { SetMetadata } from "@nestjs/common";

export const MODULE_ACCESS_KEY = "requiresModule";

export type AccessModule = "LEAD_GENERATION" | "EMAIL_HUB" | "SOCIAL_MEDIA";

/** Attach to a controller/route: @RequiresModule("EMAIL_HUB"). Enforced by ModuleAccessGuard. */
export const RequiresModule = (module: AccessModule) => SetMetadata(MODULE_ACCESS_KEY, module);
