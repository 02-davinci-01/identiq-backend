import { Controller, Get } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "./entities/user.entity";
import { Repository } from "typeorm";
import { UsersService } from "./users.service";
import { CurrentUser } from "../common/decorator/current-user-decorator";
import { UserResponseDto } from "./dto/user-response-dto";
import { ObjectId } from 'mongodb';



@Controller("users")
export class UsersController {
  constructor(private readonly userService: UsersService) {}

  @Get("db")
  async getcon(): Promise<string> {
    const count = await this.userService.checkCon();
    return "we have found the db";
  }

  @Get('me')
  async getProfile(@CurrentUser() jwtPayloadOrUser: any) {
    // jwtPayloadOrUser may be either the JWT payload (sub/email/jid)
    // or a full user object depending on your JwtStrategy implementation.
    const possibleId = jwtPayloadOrUser?.sub ?? jwtPayloadOrUser?.id ?? jwtPayloadOrUser?._id;

    // Prefer fetching fresh user from DB (so we return canonical fields)
    const user = possibleId ? await this.userService.findById(possibleId) : jwtPayloadOrUser;
    console.log(user);

    if (!user) {
      // If jwtPayloadOrUser itself contains email + id, fallback to that
      const fallbackId = jwtPayloadOrUser?.id ?? jwtPayloadOrUser?._id ?? jwtPayloadOrUser?.sub;
      const fallbackEmail = jwtPayloadOrUser?.email;
      const fallbackName = jwtPayloadOrUser?.name;
      console.log(fallbackName)
      return new UserResponseDto({ id: fallbackId, email: fallbackEmail,name:fallbackName });
    }

    // Map DB user to response DTO (hide any sensitive fields)
    const id = user.id ?? user._id ?? user.sub;
    const email = user.email;
    const name = user.name;

    console.log(user);
    return new UserResponseDto({ id, email,name});
  }
}
