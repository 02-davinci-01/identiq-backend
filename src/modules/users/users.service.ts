import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "./entities/user.entity";
import { Auth } from "../auth/entities/auth.entity";
import { Theme } from "../themes/entities/theme.entity";
import { DataSource } from "typeorm";
import { ObjectId } from "mongodb";

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Auth)
    private readonly authRepo: Repository<Auth>,
    @InjectRepository(Theme)
    private readonly themeRepo: Repository<Theme>,
    private readonly dataSource: DataSource,
  ) {}

  async checkCon(): Promise<string> {
    const data = await this.userRepo.find();
    return "found the data";
  }

  ////////////////////
  //FIND USER BY ID/////////
  //////////////////
  async findById(id: string) {
    if (!id) return null;

    try {
      return this.userRepo.findOne({ where: { _id: new ObjectId(id) } });
    } catch (err) {
      this.logger.warn(`findById failed for id=${id}: ${err?.message ?? err}`);
      return null;
    }
  }

  ////////////////////
  //FIND BY EMAIL/////////
  //////////////////
  async findByEmail(email: string) {
    if (!email) return null;
    try {
      return this.userRepo.findOne({ where: { email } });
    } catch (err) {
      this.logger.error(`Error querying user by email=${email}`, err);
      throw err;
    }
  }

  ////////////////////
  //COUNT USER SERVICE/////////
  //////////////////
  async countUsers(): Promise<number> {
    try {
      // TypeORM: count(); Mongoose would be this.userModel.countDocuments()
      return await this.userRepo.count();
    } catch (err) {
      this.logger.error("countUsers failed", err);
      throw err;
    }
  }

  ////////////////////
  //GET ALL USER SERVICE/////////
  //////////////////
  async getAllUsers(limit?: number, offset?: number) {
    try {
      // coerce and cap values
      const take = Math.min(1000, Math.max(1, Number(limit || 4))); // default 10, max safety cap
      const skip = Math.max(0, Number(offset || 0));

      // Use skip & take for pagination with TypeORM
      const users = await this.userRepo.find({
        select: [
          "id",
          "name",
          "email",
          "colorHex",
          "createdAt",
        ] as (keyof User)[],
        order: { createdAt: "DESC" },
        skip,
        take,
      });

      // return both data and metadata so client can know about total if needed
      return users;
    } catch (err) {
      this.logger.error("getAllUsers failed", err);
      throw new InternalServerErrorException("Failed to fetch users");
    }
  }

  ////////////////////
  //DELETE BY EMAIL/////////
  //////////////////
  async deleteByEmail(email: string) {
    if (!email) throw new BadRequestException("Email required");

    const driver = this.dataSource.options.type;

    try {
      await this.authRepo.delete({ email });
      await this.themeRepo.delete({ email });
      const res = await this.userRepo.delete({ email });
      return {
        ok: true,
        deletedCount: res?.affected ?? 0,
      };
    } catch (err) {
      this.logger.error("deleteByEmail failed", err);
      throw new InternalServerErrorException("Failed to delete user");
    }
  }
}
