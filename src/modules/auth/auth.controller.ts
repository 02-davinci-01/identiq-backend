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

  ////////////////////
  //REGISTER/////////
  //////////////////
  @Public()
  @Post("register")
  async registerUser(@Body() dto: RegisterUserDTO) {
    return this.authService.register(dto);
  }

  ////////////////////
  //COMPLETE-REGISTER/////////
  //////////////////
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

  ////////////////////
  //LOGIN/////////
  //////////////////

  @Public()
  @UseGuards(AuthGuard("local"))
  @Post("login")
  async login(@Req() req, @Res({ passthrough: true }) res: Response) {
    const { accessToken, jid, expiresIn, user } = await this.authService.login(
      req.user,
    );

    return {
      accessToken,
      jid,
      expiresIn,
      user: user ?? null,
      message: "Login successful",
    };
  }

  ////////////////////
  //CAPTCHA/////////
  //////////////////

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
      charPreset: "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
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

  ////////////////////
  //CAPTCHA-VERIFY/////////
  //////////////////

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

      if (normalized.length !== data.text.length) return { ok: false };

      const ok = timingEqual(Buffer.from(normalized), Buffer.from(data.text));
      return { ok };
    } catch (err) {
      throw err;
    }
  }

  ////////////////////
  //LOGOUT/////////
  //////////////////

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

  ////////////////////
  //NAME CHANGE/////////
  //////////////////
  @Patch("name")
  async changeName(@CurrentUser() jwt, @Body() dto: ChangeNameDto) {
    const email = jwt?.email;
    if (!email) throw new BadRequestException("No email in token");
    if (!dto?.name) throw new BadRequestException("Missing name");

    const res = await this.authService.changeName(email, dto.name);
    return { ok: true, name: res.name, email };
  }

  ////////////////////
  //PASSWORD CHANGE/////////
  //////////////////
  @Patch("password")
  async changePassword(@CurrentUser() jwt, @Body() dto: ChangePasswordDto) {
    const email = jwt?.email;
    if (!email) throw new BadRequestException("No email in token");
    if (!dto?.password) throw new BadRequestException("Missing password");

    const { oldPassword, password } = dto;

    await this.authService.changePassword(email, oldPassword, password);
    return { ok: true, message: "Password updated" };
  }

  ////////////////////
  //DELETE/////////
  //////////////////
  @HttpCode(200)
  @Delete()
  async deleteAccount(@CurrentUser() jwt) {
    const email = jwt?.email;
    if (!email) throw new BadRequestException("No email in token");

    await this.authService.deleteAccountByEmail(email);
    return { ok: true, message: "Account deleted" };
  }

  ////////////////////
  //REQUEST-EMAIL/////////
  //////////////////
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

  ////////////////////
  //CONFIRM EMAIL CHANGE/////////
  //////////////////
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
