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

@Controller("users")
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(private readonly userService: UsersService) {}

  @Get("db")
  async getcon(): Promise<string> {
    const count = await this.userService.checkCon();
    return "we have found the db";
  }

  /**
   * GET /users/me
   * - Accepts the value injected by @CurrentUser() (your Jwt guard/strategy should attach the JWT payload)
   * - Prefers searching the DB by email for canonical user data
   * - Returns { name, email } (wrapped by UserResponseDto)
   */
  @Get("me")
  async getProfile(@CurrentUser() jwtPayloadOrUser: any) {
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
      const name = (user as any).name ?? (user as any).displayName ?? null;
      const email = (user as any).email;
      const id = (user as any).id ?? (user as any)._id ?? null;

      return new UserResponseDto({ id, email, name });
    } catch (err) {
      this.logger.error("Failed to fetch profile for /users/me", err as any);
      // follow your project's error handling rules (Sentry etc). Return a generic server error.
      throw new InternalServerErrorException("Could not fetch user profile");
    }
  }

  @Get("count")
  async getCount() {
    const total = await this.userService.countUsers();
    return { count: total };
  }

  // Example using NestJS controller method
  @Get()
  async getAll(
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    const offsetNum = offset ? parseInt(offset, 10) : undefined;

    const users = await this.userService.getAllUsers(limitNum, offsetNum);

    return users.map((u) => ({
      id: (u as any).id ?? (u as any)._id ?? null,
      name: (u as any).name ?? "",
      email: (u as any).email ?? "",
      colorHex: (u as any).colorHex ?? "#c96a2b",
      createdAt: (u as any).createdAt ?? null,
    }));
  }

  @Get("experimental")
  async getAllChance() {
    const users = await this.userService.getAllUsers();
    // Normalize/shape if needed for client
    return users.map((u) => ({
      id: (u as any).id ?? (u as any)._id ?? null,
      name: (u as any).name ?? "",
      email: (u as any).email ?? "",
      colorHex: (u as any).colorHex ?? "#c96a2b",
      createdAt: (u as any).createdAt ?? null,
    }));
  }

  // Delete a user by email provided in body (admin operation)

  @Delete()
  @HttpCode(200)
  async deleteUser(@Body() dto: DeleteUserDto) {
    if (!dto?.email) throw new BadRequestException("Email required");
    return await this.userService.deleteByEmail(dto.email);
  }
}
