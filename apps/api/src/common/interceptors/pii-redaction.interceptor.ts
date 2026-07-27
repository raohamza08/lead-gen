import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { Role, JwtClaims } from "@leadgen/types";

const PII_FIELDS = ["email", "phone", "contactName"] as const;
const REDACTED = "•••• (redacted)";

/**
 * Strips PII fields server-side for the Viewer role (Part E4/G1) so protection
 * doesn't depend on the frontend choosing to hide it. Applied globally; a no-op
 * for every other role.
 */
@Injectable()
export class PiiRedactionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const user: JwtClaims | undefined = request.user;

    return next.handle().pipe(
      map((data) => {
        if (!user || user.role !== Role.VIEWER) {
          return data;
        }
        return redactDeep(data);
      }),
    );
  }
}

function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  if (value && typeof value === "object") {
    const clone: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const field of PII_FIELDS) {
      if (field in clone && clone[field]) {
        clone[field] = REDACTED;
      }
    }
    for (const key of Object.keys(clone)) {
      if (clone[key] && typeof clone[key] === "object") {
        clone[key] = redactDeep(clone[key]);
      }
    }
    return clone;
  }
  return value;
}
