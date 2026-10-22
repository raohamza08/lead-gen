import { BadRequestException, Injectable, Logger } from "@nestjs/common";

const AUTHORIZE_URL = "https://www.upwork.com/ab/account-security/oauth2/authorize";
const TOKEN_URL = "https://www.upwork.com/api/v3/oauth2/token";

export interface UpworkTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  scope?: string;
  tokenType?: string;
}

/**
 * Upwork's OAuth2 authorize/token endpoints — standard authorization-code
 * flow, documented at upwork.com/developer/documentation/oauth2 and stable
 * regardless of which data scopes a given app is ultimately approved for.
 * This is the one piece of the integration implemented for real (not a
 * stub): the endpoint URLs and the authorization_code/refresh_token grant
 * shapes are public, confirmed facts, unlike the actual data APIs (GraphQL,
 * schema not yet confirmed against our approved app) that the sibling
 * services in ./services/ deliberately stub out instead of guessing.
 */
@Injectable()
export class UpworkOAuthClient {
  private readonly logger = new Logger(UpworkOAuthClient.name);

  getAuthorizeUrl(clientId: string, state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchangeCodeForToken(clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<UpworkTokenResponse> {
    return this.requestToken({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });
  }

  async refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<UpworkTokenResponse> {
    return this.requestToken({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });
  }

  private async requestToken(body: Record<string, string>): Promise<UpworkTokenResponse> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.logger.warn(`Upwork token request failed (${res.status}): ${JSON.stringify(payload).slice(0, 300)}`);
      throw new BadRequestException(payload.error_description || payload.error || "Upwork rejected the token request.");
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresInSec: Number(payload.expires_in ?? 0),
      scope: payload.scope,
      tokenType: payload.token_type,
    };
  }
}
