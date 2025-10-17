import { Strategy } from "passport-local";
import { PassportStrategy } from "@nestjs/passport";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "../auth.service";
import { Auth } from "../entities/auth.entity";

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, "local") {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: "email", passwordField: "password" });
    console.log("Getting lucky tonight")
  }

  async validate(email: string, password: string): Promise<Partial<Auth>> {

    const auth = await this.authService.validateUser(email, password);
    if (!auth) throw new UnauthorizedException("Invalid credentials");

    const { passwordHash, verifyEmailTokenHash, verifyEmailExpiry, ...safe } =
      auth as any;
    return safe;
  }
}
