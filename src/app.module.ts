import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UsersModule } from "./modules/users/users.module";
import { ThemesModule } from "./modules/themes/themes.module";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AuthModule } from "./modules/auth/auth.module";
import { BrevoModule } from "./infrastructure/integrations/brevo/brevo.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ".env" }),
    TypeOrmModule.forRoot({
      type: "mongodb",
      url: process.env.MONGO_URI || "mongodb://localhost:27017",
      synchronize: true,
      entities: [__dirname + "/**/*.entity.js"],
    }),
    UsersModule,
    ThemesModule,
    AuthModule,
    BrevoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
