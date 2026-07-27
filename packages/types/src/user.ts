import { Role } from "./enums";

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface JwtClaims {
  sub: string;
  orgId: string;
  role: Role;
  email: string;
}
