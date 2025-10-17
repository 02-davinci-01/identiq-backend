import { Module } from '@nestjs/common';
import { ThemesController } from './themes.controller';
import { ThemeService } from './themes.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Theme } from './entities/theme.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports:[TypeOrmModule.forFeature([Theme,User])],
  controllers: [ThemesController],
  providers: [ThemeService],
  exports:[ThemeService]
})
export class ThemesModule {}
