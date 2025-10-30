import {
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Logger,
  Delete,
  HttpCode,
  Body,
  BadRequestException,
  Query,
} from "@nestjs/common";
import { UsersService } from "./users.service";
import { CurrentUser } from "../common/decorator/current-user-decorator";
import { UserResponseDto } from "./dto/user-response-dto";
import { DeleteUserDto } from "./dto/delete-user.dto";
import { Public } from "../common/decorator/public.decorator";
import { User } from "./entities/user.entity";

@Controller("users")
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(private readonly userService: UsersService) {}

  @Get("db")
  async getcon(): Promise<string> {
    const count = await this.userService.checkCon();
    return "we have found the db";
  }

  ////////////////////
  //GET DATA OF LOGGED IN USER/////////
  //////////////////
  @Get("me")
  async getProfile(@CurrentUser() jwtPayloadOrUser) {
    try {
      // If the decorator forwards a full user object, use it;
      // otherwise prefer the email from the JWT payload and fetch canonical record.
      const emailFromPayload =
        jwtPayloadOrUser?.email ??
        jwtPayloadOrUser?.payload?.email ??
        jwtPayloadOrUser?.user?.email;

      if (!emailFromPayload) {
        // As a last resort, if the payload contains name+email, return them directly
        const fallbackEmail = jwtPayloadOrUser?.email ?? jwtPayloadOrUser?.sub;
        const fallbackName = jwtPayloadOrUser?.name;
        if (fallbackEmail || fallbackName) {
          return new UserResponseDto({
            id: fallbackEmail,
            email: fallbackEmail,
            name: fallbackName,
          });
        }
        this.logger.warn(
          "No email found in JWT payload forwarded to /users/me",
        );
        throw new NotFoundException("User email not provided in token");
      }

      const user = await this.userService.findByEmail(emailFromPayload);

      if (!user) {
        // no DB match — return the payload's name/email if available or 404
        const fallbackName = jwtPayloadOrUser?.name;
        if (fallbackName) {
          return new UserResponseDto({
            id: emailFromPayload,
            email: emailFromPayload,
            name: fallbackName,
          });
        }
        throw new NotFoundException("User not found");
      }

      // Map canonical DB record to response DTO (limit fields)
      const name = (user as User).name ?? null;
      const email = (user as User).email;
      const id = (user as any).id ?? (user as User)._id ?? null;

      return new UserResponseDto({ id, email, name });
    } catch (err) {
      this.logger.error("Failed to fetch profile for /users/me", err);
      // follow your project's error handling rules (Sentry etc). Return a generic server error.
      throw new InternalServerErrorException("Could not fetch user profile");
    }
  }

  ////////////////////
  //TOTAL COUNT OF USER/////////
  //////////////////

  @Public()
  @Get("count")
  async getCount() {
    const total = await this.userService.countUsers();
    return { count: total };
  }

  ////////////////////
  //ALL USERS FOR TABLE/////////
  //////////////////
  @Get()
  async getAll(
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    const offsetNum = offset ? parseInt(offset, 10) : undefined;

    const users = await this.userService.getAllUsers(limitNum, offsetNum);

    return users.map((u) => ({
      id: (u as User)._id ?? (u as User)._id ?? null,
      name: (u as User).name ?? "",
      email: (u as User).email ?? "",
      colorHex: (u as User).colorHex ?? "#c96a2b",
      createdAt: (u as User).createdAt ?? null,
    }));
  }

  ////////////////////
  //ALL USERS FOR THE EXPERIMENTAL PAGE////////
  //////////////////
  @Get("experimental")
  async getAllChance(
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    try {
      const randomChance = Math.random(); // 0..1

      // 50% probability to return empty array (simulate flaky infra)
      if (randomChance < 0.5) {
        console.log("[Experimental] Returning empty data for test scenario.");
        return [];
      }

      // parse pagination params (falls back to undefined -> service default)
      const parsedLimit = limit ? Number(limit) : undefined;
      const parsedOffset = offset ? Number(offset) : undefined;

      const users = await this.userService.getAllUsers(
        parsedLimit,
        parsedOffset,
      );

      // Normalize/shape for client
      return users.map((u) => ({
        id: (u as User)._id ?? (u as User)._id ?? null,
        name: (u as User).name ?? "",
        email: (u as User).email ?? "",
        colorHex: (u as User).colorHex ?? "#c96a2b",
        createdAt: (u as User).createdAt ?? null,
      }));
    } catch (error) {
      console.error(
        "[Experimental] Error fetching probabilistic users:",
        error,
      );
      throw new InternalServerErrorException("Failed to fetch user data.");
    }
  }

  ////////////////////
  //DELETE A USER/////////
  //////////////////
  @Delete()
  @HttpCode(200)
  async deleteUser(@Body() dto: DeleteUserDto) {
    if (!dto?.email) throw new BadRequestException("Email required");
    return await this.userService.deleteByEmail(dto.email);
  }
}
