import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
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
      return this.userRepo.findOne({ where: { _id: id } as any });
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
      return this.userRepo.findOne({ where: { email } as any });
    } catch (err) {
      this.logger.error(`Error querying user by email=${email}`, err as any);
      throw err;
    }
  }

  async countUsers(): Promise<number> {
    try {
      // TypeORM: count(); Mongoose would be this.userModel.countDocuments()
      return await this.userRepo.count();
    } catch (err) {
      this.logger.error('countUsers failed', err as any);
      throw err;
    }
  }
}
