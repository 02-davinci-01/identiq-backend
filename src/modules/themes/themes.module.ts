import { Module } from '@nestjs/common';
import { ThemesController } from './themes.controller';
import { ThemesService } from './themes.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Theme } from './entities/theme.entity';

@Module({
  imports:[TypeOrmModule.forFeature([Theme])],
  controllers: [ThemesController],
  providers: [ThemesService]
})
export class ThemesModule {}
