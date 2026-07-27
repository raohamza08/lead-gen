import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/** Validates the JWT and populates request.user with JwtClaims (Part E4). */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
