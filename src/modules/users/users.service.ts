import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';

@Injectable()
export class UsersService {
    constructor(@InjectRepository(User) private readonly userRepo:Repository<User>){}

    async checkCon():Promise<string>{
        const data = await this.userRepo.find();
        return "found the data";
    }


}
