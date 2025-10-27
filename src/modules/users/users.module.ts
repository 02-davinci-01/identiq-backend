import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Theme } from '../themes/entities/theme.entity';
import { Auth } from '../auth/entities/auth.entity';

@Module({
  imports:[TypeOrmModule.forFeature([User,Theme,Auth])],
  providers: [UsersService],
  controllers: [UsersController],
  
})
export class UsersModule {}
