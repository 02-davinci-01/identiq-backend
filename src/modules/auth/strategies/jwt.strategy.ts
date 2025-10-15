import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "../auth.service";

export interface JwtPayload {
  sub: string;
  email?: string;
  jid: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>("JWT_SECRET"),
      ignoreExpiration: false,
      passReqToCallback: false,
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload || !payload.sub || !payload.jid) {
      throw new UnauthorizedException("Invalid token payload");
    }

    const ok = await this.authService.isJidValid(payload.sub, payload.jid);
    if (!ok) throw new UnauthorizedException("Session invalidated");

    return { id: payload.sub, email: payload.email, jid: payload.jid };
  }
}
