import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';
import { ObjectId } from 'mongodb';

@Injectable()
export class UsersService {
    constructor(@InjectRepository(User) private readonly userRepo:Repository<User>){}

    async checkCon():Promise<string>{
        const data = await this.userRepo.find();
        return "found the data";
    }

    //finding the user by id
    


async findById(id: string) {
  if (!id) return null;
  if (!ObjectId.isValid(id)) return null;
  const oid = new ObjectId(id);
  return this.userRepo.findOne({ where: { _id: oid } as any });
}





}
