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
    private readonly authRepo: Repository<User>,
    @InjectRepository(Theme)
    private readonly themeRepo: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async checkCon(): Promise<string> {
    const data = await this.userRepo.find();
    return "found the data";
  }

  /**
   * Find a user by Mongo ObjectId (keeps your existing implementation).
   * Returns null if id is falsy or not found.
   */
  async findById(id: string) {
    if (!id) return null;
    // keep your ObjectId-based lookup if needed elsewhere
    try {
      // If your User entity maps _id as ObjectId, adapt as needed.
      // Current repo.findOne usage from your uploaded file preserved.
      return this.userRepo.findOne({ where: { _id: new ObjectId(id) } });
    } catch (err) {
      this.logger.warn(`findById failed for id=${id}: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Find a user by email. Email is indexed/unique in most schemas so this is fast.
   * Returns the user entity or null.
   */
  async findByEmail(email: string) {
    if (!email) return null;
    try {
      // Use a minimal projection if you want to avoid sending sensitive fields.
      // TypeORM's select/projection usage differs by driver; here we fetch the entity and map.
      return this.userRepo.findOne({ where: { email } });
    } catch (err) {
      this.logger.error(`Error querying user by email=${email}`, err);
      throw err;
    }
  }

  async countUsers(): Promise<number> {
    try {
      // TypeORM: count(); Mongoose would be this.userModel.countDocuments()
      return await this.userRepo.count();
    } catch (err) {
      this.logger.error("countUsers failed", err);
      throw err;
    }
  }

  // async getAllUsers(limit?: number, offset?: number) { ... }

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

  /**
   * Delete user by email across Auth, User and Theme repos.
   * For SQL DBs we run a transaction to ensure atomicity.
   * For MongoDB we perform sequential deletes (replica-set session transaction not assumed).
   */
  async deleteByEmail(email: string) {
    if (!email) throw new BadRequestException("Email required");

    const driver = this.dataSource.options.type;

    // SQL-like databases: use transaction
    if (driver !== "mongodb") {
      return await this.dataSource.transaction(async (manager) => {
        // Use manager to perform deletes across repos atomically
        const userRepoTx = manager.getRepository(User);
        const authRepoTx = manager.getRepository(Auth);
        const themeRepoTx = manager.getRepository(Theme);

        // delete auth sessions/row(s) first (if you have a dedicated auth row)
        await authRepoTx.delete({ email });

        // delete theme row(s)
        await themeRepoTx.delete({ email });

        // delete user row
        const res = await userRepoTx.delete({ email });

        return { ok: true, deletedCount: res?.affected ?? 0 };
      });
    }

    // Mongo: sequential deletes (no transaction assumed)
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
