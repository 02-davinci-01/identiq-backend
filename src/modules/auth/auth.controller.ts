import {
  Body,
  Controller,
  Post,
  Query,
  UseGuards,
  Req,
  Headers,
  BadRequestException,
  UnauthorizedException,
  Res,
  HttpCode,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthGuard } from "@nestjs/passport";
import type { Response } from "express";

// DTO imports (adjust paths)
import { RegisterUserDTO } from "./dto/register-user.dto";
import { CompleteRegisterDTO } from "./dto/complete-register.dto";
import { LoginDto } from "./dto/login.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  async registerUser(@Body() dto: RegisterUserDTO) {
    return this.authService.register(dto);
  }

  @Post("complete-register")
  async complete(
    @Body() dto: CompleteRegisterDTO,
    @Query("token") token: string,
  ) {
    const { email, password } = dto;
    return this.authService.completeRegisterWithEmail(token, email, password);
  }

  @UseGuards(AuthGuard(["jwt", "local"]))
  @Post("login")
  async login(@Req() req, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, jid, expiresIn, user } =
      await this.authService.login(req.user);

    // set httpOnly refresh token cookie (long lived)
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      path: "/",
    };

    res.cookie("refresh_token", refreshToken, cookieOptions);

    // return access token and session id and optionally user info
    return {
      accessToken,
      jid,
      expiresIn,
      user: user ?? null,
      message: "Login successful",
    };
  }

  @Post("refresh")
  async refresh(@Res({ passthrough: true }) res: Response) {
    const refreshToken = res.req?.cookies?.["refresh_token"];
    if (!refreshToken)
      throw new UnauthorizedException("No refresh token provided");

    // delegate to service
    const result = await this.authService.refreshTokens(refreshToken);

    // set rotated refresh cookie
    res.cookie("refresh_token", result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 1000 * 60 * 60 * 24 * 30,
      path: "/",
    });

    return {
      accessToken: result.accessToken,
      user: result.user,
      expiresIn: result.expiresIn,
    };
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("logout")
  async logout(
    @Req() req,
    @Headers("x-jid") jidHeader?: string,
    @Body() body?: any,
  ) {
    const user = req.user as any; // { id, email, jid }
    const jid = jidHeader || body?.jid || user?.jid;

    if (!user || !user.id) throw new BadRequestException("Invalid user");

    if (!jid) throw new BadRequestException("jid required for logout");

    return this.authService.logout(user.id, jid);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("me")
  me(@Req() req) {
    return req.user;
  }
}
