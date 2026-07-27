import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Guards service-to-service endpoints called by the Python AI workers (e.g.
 * posting a verified lead, posting a Gemini-drafted email) — Part E4 calls for
 * signed HMAC/mTLS between internal services rather than reusing the user JWT
 * secret. This shared-secret check is the scaffold version of that; swap for
 * HMAC-per-request before handling real traffic.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers["x-internal-token"];
    const expected = this.config.get<string>("INTERNAL_SERVICE_TOKEN");
    if (!expected || token !== expected) {
      throw new UnauthorizedException("Invalid internal service token");
    }
    return true;
  }
}
