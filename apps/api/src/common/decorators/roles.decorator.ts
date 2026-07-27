import { SetMetadata } from "@nestjs/common";
import { Role } from "@leadgen/types";

export const ROLES_KEY = "roles";

/** Attach to a route: @Roles(Role.ADMIN, Role.MANAGER). Enforced by RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
