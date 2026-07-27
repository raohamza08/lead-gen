import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { JwtClaims } from "@leadgen/types";

/** Use as @CurrentUser() user: JwtClaims in a controller method. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): JwtClaims => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
