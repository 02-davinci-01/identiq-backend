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

/**
 * Helper: read JWT_EXPIRES_IN from config and normalize to a concrete runtime value.
 * We prefer returning a string (like "1h" or "3600s") since that's expressive,
 * but numeric seconds are supported too. This function guarantees a non-empty value.
 */
function getNormalizedExpiresIn(config: ConfigService): string {
  const raw = config.get<string | number | undefined>("JWT_EXPIRES_IN");
  if (raw === undefined || raw === null || raw === "") return "1h";
  // If it's a number (seconds), convert to string so it's unambiguous to downstream libs.
  if (typeof raw === "number") return String(raw);
  // it's a string (e.g., "1h", "15m", "3600"), so use as-is
  return String(raw);
}

@Module({
  imports: [
    ConfigModule, // ensure ConfigService is available
    // Register the DB entities used by AuthService and registration flow
    TypeOrmModule.forFeature([Auth, User]),
    // Passport defaults to 'jwt' strategy here
    PassportModule.register({ defaultStrategy: "jwt", session: false }),

    // JwtModule with async factory to read values from ConfigService
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService): JwtModuleOptions => {
        const secret = cs.get<string | undefined>("JWT_SECRET");
        if (!secret) {
          // If you want to fail early in dev when secret is missing, you could throw here.
          // For now we'll pass undefined which will cause runtime errors if secret is missing.
        }

        const expiresInNormalized = getNormalizedExpiresIn(cs);

        // NOTE: jwt signOptions typing is strict; casting expiresIn here is a minimal compromise
        // to satisfy TS while preserving the runtime semantics (string like '1h' or numeric string).
        return {
          secret,
          signOptions: {
            expiresIn: expiresInNormalized as any,
          },
        } as JwtModuleOptions;
      },
    }),
  ],
  providers: [AuthService, LocalStrategy, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
