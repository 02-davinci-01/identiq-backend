import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    // strategy should attach the JWT payload or DB user to req.user
    console.log(req.user);
    console.log(req);
    return req.user;
  },
);
