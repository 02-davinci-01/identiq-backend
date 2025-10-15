import {
  Body,
  Controller,
  Post,
  Query,
  UseGuards,
  Req,
  Headers,
  BadRequestException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthGuard } from "@nestjs/passport";

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

  @UseGuards(AuthGuard("local"))
  @Post("login")
  async login(@Req() req) {
    return this.authService.login(req.user);
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
