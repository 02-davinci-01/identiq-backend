// src/modules/auth/auth.module.ts
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule, JwtModuleOptions } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";

import { Auth } from "./entities/auth.entity";
import { User } from "../users/entities/user.entity"; // keep if your register flow writes to users table
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { LocalStrategy } from "./strategies/local.strategy";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { Theme } from "../themes/entities/theme.entity";
import { ThemeService } from "../themes/themes.service";

////////////////////
//NORMALIZED TIME/////////
//////////////////
function getNormalizedExpiresIn(config: ConfigService): string {
  const raw = config.get<string | number | undefined>("JWT_EXPIRES_IN");
  if (raw === undefined || raw === null || raw === "") return "1h";
  if (typeof raw === "number") return String(raw);
  return String(raw);
}

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Auth, User, Theme]),

    PassportModule.register({ defaultStrategy: "jwt", session: false }),

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService): JwtModuleOptions => {
        const secret = cs.get<string | undefined>("JWT_SECRET");
        if (!secret) {
          throw new Error("JWT_SECRET is not defined in environment variables");
        }

        const expiresInNormalized = getNormalizedExpiresIn(cs);

        return {
          secret,
          signOptions: {
            expiresIn: expiresInNormalized as any,
          },
        } as JwtModuleOptions;
      },
    }),
  ],
  providers: [AuthService, LocalStrategy, JwtStrategy, ThemeService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
