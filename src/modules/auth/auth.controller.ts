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
  Get,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthGuard } from "@nestjs/passport";
import type { Request, Response } from "express";

// DTO imports (adjust paths)
import { RegisterUserDTO } from "./dto/register-user.dto";
import { CompleteRegisterDTO } from "./dto/complete-register.dto";
import { LoginDto } from "./dto/login.dto";
import { Public } from "../common/decorator/public.decorator";
import { CurrentUser } from "../common/decorator/current-user-decorator";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { ConfirmEmailChangeDto } from "./dto/confirm-email-change.dto";
import { ChangeNameDto } from "./dto/change-name.dto";
import { RequestEmailChangeDto } from "./dto/initiate-email-change.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/register-password.dto";
import { VerifyCaptchaDto } from "./dto/verify-captcha.dto";
import { GetCaptchaResponseDto } from "./dto/get-captcha-response.dto";
import {
  timingEqual,
  base64urlEncode,
  base64urlDecode,
} from "../common/utils/captcha.util";

import * as svgCaptcha from "svg-captcha";
import * as crypto from "crypto";

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
    @Query("email") email: string,
    @Query("token") token: string,
  ) {
    const { password } = dto;

    console.log(email, token);
    return this.authService.completeRegisterWithEmail(token, email, password);
  }

  @Public()
  @UseGuards(AuthGuard("local"))
  @Post("login")
  async login(@Req() req, @Res({ passthrough: true }) res: Response) {
    // console.log("Access Token: ", req.headers['Authorization'].split(' ')[1])

    const { accessToken, jid, expiresIn, user } = await this.authService.login(
      req.user,
    );

    // set httpOnly refresh token cookie (long lived)

    // return access token and session id and optionally user info
    return {
      accessToken,
      jid,
      expiresIn,
      user: user ?? null,
      message: "Login successful",
    };
  }

  @Public()
  @Get("captcha")
  async getCaptchaHmac(): Promise<GetCaptchaResponseDto> {
    // generate captcha
    const captcha = svgCaptcha.create({
      size: 6,
      noise: 2,
      ignoreChars: "0oO1lI", // avoid ambiguous chars
      width: 160,
      height: 60,
      fontSize: 48,
    });

    // expiry in ms
    const ttlSeconds = Number(process.env.CAPTCHA_TTL_SECONDS || 120);
    const expires = Date.now() + ttlSeconds * 1000;

    // payload contains lowercase text + expiry
    const payload = JSON.stringify({
      text: captcha.text.toLowerCase(),
      exp: expires,
    });

    // signature (HMAC-SHA256) using SECRET
    const signature = crypto
      .createHmac("sha256", process.env.CAPTCHA_SECRET || "change-me-please")
      .update(payload)
      .digest("base64url");

    const token = base64urlEncode(Buffer.from(payload)) + "." + signature;

    return {
      svg: captcha.data,
      token,
      expiresIn: ttlSeconds,
    };
  }

  @Public()
  @Post("captcha/verify")
  async verifyCaptchaHmac(@Body() dto: VerifyCaptchaDto) {
    try {
      const { token, answer } = dto || {};
      if (!token || !answer)
        throw new BadRequestException("Missing token or answer");

      const parts = token.split(".");
      if (parts.length !== 2)
        throw new BadRequestException("Invalid token format");

      const [payloadB64, sig] = parts;
      const payloadBuf = base64urlDecode(payloadB64);
      const payloadStr = payloadBuf.toString("utf8");

      // verify signature
      const expectedSig = crypto
        .createHmac("sha256", process.env.CAPTCHA_SECRET || "change-me-please")
        .update(payloadStr)
        .digest("base64url");

      // constant-time compare signatures
      if (!timingEqual(sig, expectedSig)) {
        return { ok: false, reason: "invalid_signature" };
      }

      const data = JSON.parse(payloadStr);
      if (!data?.text || !data?.exp)
        return { ok: false, reason: "invalid_payload" };

      if (Date.now() > data.exp) return { ok: false, reason: "expired" };

      const normalized = (answer || "").toLowerCase();

      // quick length check before timing-safe compare
      if (normalized.length !== data.text.length) return { ok: false };

      // timing-safe compare
      const ok = timingEqual(Buffer.from(normalized), Buffer.from(data.text));
      return { ok };
    } catch (err) {
      // follow your project's error logging policy — e.g., log to Sentry in controller catch block
      // (Don't re-throw internal error details to client)
      // console.error(err);
      throw err;
    }
  }

  @Post("logout")
  async logout(
    @Req() req,
    @Headers("x-jid") jidHeader?: string,
    @Body() body?,
  ) {
    const user = req.user; // { id, email, jid }
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
  @Patch("name")
  // @UseGuards(JwtAuthGuard)  // not required if guard is global
  async changeName(@CurrentUser() jwt, @Body() dto: ChangeNameDto) {
    const email = jwt?.email;
    if (!email) throw new BadRequestException("No email in token");
    if (!dto?.name) throw new BadRequestException("Missing name");

    const res = await this.authService.changeName(email, dto.name);
    return { ok: true, name: res.name, email };
  }

  /**
   * PATCH /auth/password
   * Protected: accepts new password in body; updates auth repo
   */

  @Patch("password")
  // @UseGuards(JwtAuthGuard)
  async changePassword(@CurrentUser() jwt, @Body() dto: ChangePasswordDto) {
    const email = jwt?.email;
    if (!email) throw new BadRequestException("No email in token");
    if (!dto?.password) throw new BadRequestException("Missing password");

    const { oldPassword, password } = dto;

    await this.authService.changePassword(email, oldPassword, password);
    return { ok: true, message: "Password updated" };
  }

  /**
   * DELETE /auth (delete account)
   * Protected: deletes auth row and delegates removal of user & theme rows.
   */
  @HttpCode(200)
  @Delete()
  // @UseGuards(JwtAuthGuard)
  async deleteAccount(@CurrentUser() jwt) {
    const email = jwt?.email;
    if (!email) throw new BadRequestException("No email in token");

    await this.authService.deleteAccountByEmail(email);
    return { ok: true, message: "Account deleted" };
  }

  /**
   * POST /auth/email  -> initiate change (sends verification to newEmail)
   * Protected: current token required so we can ensure the requester is owner
   */

  @Post("request-email-change")
  async requestEmailChange(
    @CurrentUser() payload,
    @Body() body: RequestEmailChangeDto,
  ) {
    const currentEmail = payload?.email;
    return await this.authService.initiateEmailChange(
      currentEmail,
      body.newEmail,
    );
  }
  // @UseGuards(JwtAuthGuard)

  /**
   * POST /auth/email/confirm?token=...
   * Complete the change: token in query, newEmail and optional password in body.
   * This endpoint performs updates to auth, user and theme repos transactionally.
   */

  // this route is intentionally public (confirmation link usually doesn't include a JWT).
  @Public()
  @Get("confirm-email-change")
  async confirmEmailChangeGet(@Query() query: ConfirmEmailChangeDto) {
    // query.token and query.email come from the URL
    return await this.authService.confirmEmailChange(query.token, query.email);
  }

  @Public()
  @Post("forgot-password")
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    // service returns neutral response
    const res = await this.authService.initiatePasswordReset(dto.email);
    return {
      ok: true,
      message:
        res?.message ?? "If that email exists we have sent a reset link.",
    };
  }

  @Public()
  @Post("reset-password")
  async resetPassword(
    @Query("token") token: string | undefined,
    @Query("email") email: string | undefined,
    @Body() dto: ResetPasswordDto,
  ) {
    if (!token || !email) {
      return { ok: false, message: "Missing token or email in query" };
    }

    const res = await this.authService.completePasswordResetWithEmail(
      email,
      token,
      dto.password,
    );
    return { ok: true, message: res?.message ?? "Password updated" };
  }
}
