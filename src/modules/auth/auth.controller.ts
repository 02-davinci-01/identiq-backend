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
  Patch,
  Delete,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthGuard } from "@nestjs/passport";
import type { Response } from "express";

// DTO imports (adjust paths)
import { RegisterUserDTO } from "./dto/register-user.dto";
import { CompleteRegisterDTO } from "./dto/complete-register.dto";
import { LoginDto } from "./dto/login.dto";
import { Public } from "../common/decorator/public.decorator";
import { CurrentUser } from "../common/decorator/current-user-decorator";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { ConfirmEmailChangeDto } from "./dto/confirm-email-change.dto";
import { ChangeNameDto } from "./dto/change-name.dto";
import { InitiateEmailChangeDto } from "./dto/initiate-email-change.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}


  @Public()
  @Post("register")
  async registerUser(@Body() dto: RegisterUserDTO) {
    return this.authService.register(dto);
  }


  @Public()
  @Post("complete-register")
  async complete(
    @Body() dto: CompleteRegisterDTO,
    @Query("token") token: string,
  ) {
    const { email, password } = dto;
    return this.authService.completeRegisterWithEmail(token, email, password);
  }

  @Public()
  @UseGuards(AuthGuard("local"))
  @Post("login")
  async login(@Req() req, @Res({ passthrough: true }) res: Response) {
    // console.log("Access Token: ", req.headers['Authorization'].split(' ')[1])
   
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

 
  @Post("me")
  me(@Req() req) {
    return req.user;
  }


 


  /**
   * PATCH /auth/name
   * Protected: uses token to find the user (email in token)
   */
  @Patch('name')
  // @UseGuards(JwtAuthGuard)  // not required if guard is global
  async changeName(@CurrentUser() jwt: any, @Body() dto: ChangeNameDto) {
    const email = jwt?.email;
    if (!email) throw new BadRequestException('No email in token');
    if (!dto?.name) throw new BadRequestException('Missing name');

    const res = await this.authService.changeName(email, dto.name);
    return { ok: true, name: res.name, email };
  }

  /**
   * PATCH /auth/password
   * Protected: accepts new password in body; updates auth repo
   */
  @Patch('password')
  // @UseGuards(JwtAuthGuard)
  async changePassword(@CurrentUser() jwt: any, @Body() dto: ChangePasswordDto) {
    const email = jwt?.email;
    if (!email) throw new BadRequestException('No email in token');
    if (!dto?.password) throw new BadRequestException('Missing password');

    await this.authService.changePassword(email, dto.password);
    return { ok: true, message: 'Password updated' };
  }

  /**
   * DELETE /auth (delete account)
   * Protected: deletes auth row and delegates removal of user & theme rows.
   */
  @HttpCode(200)
  @Delete()
  // @UseGuards(JwtAuthGuard)
  async deleteAccount(@CurrentUser() jwt: any) {
    const email = jwt?.email;
    if (!email) throw new BadRequestException('No email in token');

    await this.authService.deleteAccountByEmail(email);
    return { ok: true, message: 'Account deleted' };
  }

  /**
   * POST /auth/email  -> initiate change (sends verification to newEmail)
   * Protected: current token required so we can ensure the requester is owner
   */
  @Post('email')
  // @UseGuards(JwtAuthGuard)
  async initiateEmailChange(@CurrentUser() jwt: any, @Body() dto: InitiateEmailChangeDto) {
    const currentEmail = jwt?.email;
    if (!currentEmail) throw new BadRequestException('No email in token');
    if (!dto?.newEmail) throw new BadRequestException('Missing newEmail');

    const r = await this.authService.initiateEmailChange(currentEmail, dto.newEmail);
    return r;
  }

  /**
   * POST /auth/email/confirm?token=...
   * Complete the change: token in query, newEmail and optional password in body.
   * This endpoint performs updates to auth, user and theme repos transactionally.
   */
  @Post('email/confirm')
  // this route is intentionally public (confirmation link usually doesn't include a JWT).
  async confirmEmailChange(
    @Query('token') token: string,
    @Body() body: ConfirmEmailChangeDto,
  ) {
    if (!token) throw new BadRequestException('Missing token in query');
    if (!body?.email) throw new BadRequestException('Missing email in body');

    const result = await this.authService.completeEmailChangeTransactional(
      token,
      body.email,
      body.password,
    );

    return { stauts:true, message: 'Email updated', ...result };
  }
}


  

