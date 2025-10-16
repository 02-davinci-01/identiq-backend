// src/modules/auth/auth.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "../users/entities/user.entity";
import { Repository } from "typeorm";
import { randomBytes } from "crypto";
import * as bcrypt from "bcryptjs";
import { ConfigService } from "@nestjs/config";
import { BrevoService } from "src/infrastructure/integrations/brevo/brevo.service";
import { Auth } from "./entities/auth.entity";
import { JwtService } from "@nestjs/jwt";
import { v4 as uuidv4 } from "uuid";
import { ObjectId } from "mongodb";


@Injectable()
export class AuthService {
  private readonly TOKEN_EXPIRY_TIME = 1000 * 60 * 60; // 1 hour
  private readonly HASH_ROUNDS = 10;
  private readonly PASSWORD_HASH_ROUNDS = 12;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Auth) private readonly authRepo: Repository<Auth>,
    private readonly config: ConfigService,
    private readonly brevo: BrevoService,
    private readonly jwtService: JwtService,
  ) {}

  private genToken(len = 24) {
    return randomBytes(len).toString("hex");
  }

  // ------------------------
  // === YOUR ORIGINAL REGISTER FLOW (preserved exactly) ===
  // (sourced from your uploaded file)
  // ------------------------
  async register(dto: { name: string; email: string }) {
    const { name, email } = dto;
    if (!email) throw new BadRequestException("Email is required");

    let authUser = await this.authRepo.findOne({ where: { email } as any });

    // If already verified, nothing to do
    if (authUser && authUser.emailVerified) {
      return { message: "authUser is already present" };
    }

    // generate token (raw for authUser), store only the hash
    const rawToken = this.genToken(24);
    const tokenHash = await bcrypt.hash(rawToken, this.HASH_ROUNDS);
    const expiry = new Date(Date.now() + this.TOKEN_EXPIRY_TIME);

    if (!authUser) {
      authUser = this.authRepo.create({
        name,
        email,
        emailVerified: false,
        verifyEmailExpiry: expiry,
        verifyEmailTokenHash: tokenHash,
      });
    } else {
      authUser.name = name;
      authUser.verifyEmailTokenHash = tokenHash;
      authUser.verifyEmailExpiry = expiry;
    }

    await this.authRepo.save(authUser);

    // Build a friendly verify link for the HTML fallback (the Brevo service will also build one when using templates)
    const frontendURL =
      this.config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";
    const verifyLink = `${frontendURL.replace(/\/$/, "")}/auth/complete-register?token=${rawToken}`;

    const html = `
      <p>Hi ${name || "there"},</p>
      <p>Click to verify your email and set a password (link expires in 1 hour):</p>
      <p><a href="{{verifyLink}}">Complete registration</a></p>
      <p>If the link doesn't work, paste this URL in your browser:</p>
      <p>${verifyLink}</p>
    `;

    try {
      // Prefer template via env BREVO_VERIFICATION_TEMPLATE_ID; service will fallback to htmlContent if no template configured.
      await this.brevo.sendVerificationEmail(email, rawToken, {
        subject: "Complete your registration",
        extraParams: {
          token: rawToken,
          verifyLink,
          name,
          email,
          year: String(new Date().getFullYear()),
        },
      });
    } catch (err) {
      this.logger.error("Brevo send error", err as any);
      throw new BadRequestException("Failed to send verification email");
    }

    return { message: "email sent successfully", status: true };
  }

  async completeRegisterWithEmail(
    token: string,
    email: string,
    password: string,
  ) {
    if (!email || !token)
      throw new BadRequestException("Missing token or email");

    const authUser = await this.authRepo.findOne({ where: { email } as any });

    if (!authUser) throw new BadRequestException("Invalid token or email");
    if (!authUser.verifyEmailTokenHash || !authUser.verifyEmailExpiry)
      throw new BadRequestException(
        "No pending verification for this authUser",
      );
    if (authUser.verifyEmailExpiry < new Date())
      throw new BadRequestException("Verification token expired");

    const isValid = await bcrypt.compare(token, authUser.verifyEmailTokenHash);
    if (!isValid) throw new BadRequestException("Invalid token");

    // the authUser has been verified so we will add him in the user repo as well
    const userData = this.userRepo.create({
      name: authUser.name,
      email: authUser.email,
    });

    await this.userRepo.save(userData);

    authUser.passwordHash = await bcrypt.hash(
      password,
      this.PASSWORD_HASH_ROUNDS,
    );
    authUser.emailVerified = true;
    authUser.verifyEmailTokenHash = null;
    authUser.verifyEmailExpiry = null;

    await this.authRepo.save(authUser);

    return { ok: true };
  }
  // ------------------------
  // End preserved register flow. See original file. :contentReference[oaicite:3]{index=3}
  // ------------------------

  // ------------------------
  // Auth helpers used by strategies / controller
  // ------------------------

  /**
   * Validate credentials for LocalStrategy.
   * Returns Auth entity if valid, otherwise null.
   */
  async validateUser(email: string, password: string): Promise<Auth | null> {
    if (!email || !password) return null;

    const auth = await this.authRepo.findOne({ where: { email } as any });
    if (!auth) return null;

    const matches = await bcrypt.compare(
      password,
      (auth as any).passwordHash || "",
    );
    return matches ? auth : null;
  }

  /**
   * Login: create jid, persist to auth.jids, sign JWT
   */
  async login(authRow: any) {
    if (!authRow || !authRow._id)
      throw new BadRequestException("Invalid auth object");

    // reload to get latest jids (use ObjectId conversion if necessary)
    const dbAuth = await this.authRepo.findOne({
      where: { _id: (authRow as any)._id } as any,
    });
    if (!dbAuth) throw new NotFoundException("Auth record not found");

    dbAuth.jids = Array.isArray(dbAuth.jids) ? dbAuth.jids : [];

    // optional: enforce max sessions
    const MAX_SESSIONS = Number(this.config.get<number>("MAX_SESSIONS") || 10);
    if (dbAuth.jids.length >= MAX_SESSIONS) dbAuth.jids.shift();

    // create a new jid for this session
    const jid = uuidv4();
    dbAuth.jids.push(jid);
    await this.authRepo.save(dbAuth);

    const payload = {
      sub: dbAuth._id ? dbAuth._id.toString() : String((dbAuth as any).id),
      email: dbAuth.email,
      name: dbAuth.name,
      jid,
    };

    // normalize / cast expiresIn so TS accepts the call
    const rawExpires = this.config.get<string | number>("JWT_EXPIRES_IN");
    const expiresIn = rawExpires ?? "1h"; // fallback

    // sign access token (short-lived)
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: expiresIn as any,
    });

    // create refresh token (long-lived). We sign a token that contains sub and jid.
    // Refresh TTL: use REFRESH_TOKEN_TTL env var or default to 30d
    const rawRefreshTtl = this.config.get<string | number>("REFRESH_TOKEN_TTL");
    const refreshTtl = rawRefreshTtl ?? "30d";

    const refreshPayload = {
      sub: dbAuth._id ? dbAuth._id.toString() : String((dbAuth as any).id),
      jid, // include jid so we can validate session during refresh
    };

    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: refreshTtl as any,
    });

    // Optional: persist the refresh token in DB (or its hash) for revocation.
    // You already persist jids; if you want extra safety you can save hashed refresh tokens.
    // Example placeholder:
    // if (this.saveRefreshTokenForUser) await this.saveRefreshTokenForUser(dbAuth._id, refreshToken);

    return {
      accessToken,
      refreshToken,
      jid,
      expiresIn: expiresIn,
      // optionally return user info if you want the frontend to have it immediately
      user: {
        id: dbAuth._id ? dbAuth._id.toString() : (dbAuth as any).id,
        email: dbAuth.email,
        // add other public fields if desired (name, roles, etc.)
      },
    };
  }

  async refreshTokens(refreshToken: string) {
    if (!refreshToken)
      throw new UnauthorizedException("No refresh token provided");

    try {
      // verify the refresh token (will throw if invalid/expired)
      const payload: any = this.jwtService.verify(refreshToken);

      const userId = payload.sub;
      const jid = payload.jid;

      // fetch auth record and validate that jid is still present
      const dbAuth = await this.authRepo.findOne({
        where: { _id: userId } as any,
      });

      if (!dbAuth) throw new UnauthorizedException("Auth record not found");

      if (!Array.isArray(dbAuth.jids) || !dbAuth.jids.includes(jid)) {
        throw new UnauthorizedException("Session revoked or invalid");
      }

      // Build new access token payload (preserve jid)
      const accessPayload = {
        sub: dbAuth._id ? dbAuth._id.toString() : String((dbAuth as any).id),
        email: dbAuth.email,
        jid,
      };

      const accessExpiresRaw =
        this.config.get<string | number>("JWT_EXPIRES_IN") ?? "1h";
      const accessExpiresIn = accessExpiresRaw as any;

      const newAccessToken = this.jwtService.sign(accessPayload, {
        expiresIn: accessExpiresIn,
      });

      // Rotate refresh token (same jid kept here; if you prefer to rotate jid, generate new jid and update dbAuth.jids)
      const refreshTtlRaw =
        this.config.get<string | number>("REFRESH_TOKEN_TTL") ?? "30d";
      const refreshTtl = refreshTtlRaw as any;

      const newRefreshToken = this.jwtService.sign(
        {
          sub: dbAuth._id ? dbAuth._id.toString() : String((dbAuth as any).id),
          jid,
        },
        { expiresIn: refreshTtl },
      );

      // Optional: persist rotated refresh token or update dbAuth.jids if rotating jid.
      // (I left persistence of refresh tokens out so you can implement it as you prefer.)

      const user = {
        id: dbAuth._id ? dbAuth._id.toString() : (dbAuth as any).id,
        email: dbAuth.email,
      };

      // expiresIn in seconds — convert if your config provides a string TTL you want to expose
      const expiresIn =
        typeof accessExpiresIn === "number" ? accessExpiresIn : 60 * 60;

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        user,
        jid,
        expiresIn,
      };
    } catch (err) {
      // normalize errors into UnauthorizedException
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
  }

  /**
   * Logout: remove the jid
   */
  async logout(authIdStr: string, jid: string) {
    if (!authIdStr || !jid)
      throw new BadRequestException("Missing authId or jid");

    // Try to handle both string id and ObjectId if needed
    let query: any = { _id: authIdStr };
    // If stored _id is an ObjectId, TypeORM/Mongo driver will accept string as well.
    const auth = await this.authRepo.findOne({ where: query as any });
    if (!auth) throw new NotFoundException("Auth record not found");

    auth.jids = (auth.jids || []).filter((j: string) => j !== jid);
    await this.authRepo.save(auth);
    return { ok: true };
  }

  /**
   * isJidValid: used by JwtStrategy
   */
  async isJidValid(authIdStr: string, jid: string): Promise<boolean> {
    console.log(authIdStr,jid);
    if (!authIdStr || !jid) return false;

    const whereClause: any = ObjectId.isValid(authIdStr)
    ? { _id: new ObjectId(authIdStr) }
    : { _id: authIdStr };

    const auth = await this.authRepo.findOne({ where: whereClause});
    if (!auth) {
      console.log('auth not found');
      return false;}
    return Array.isArray(auth.jids) && auth.jids.includes(jid);
  }

  /**
   * Re-verify password helper for sensitive flows
   */
  async reverifyPassword(
    authIdStr: string,
    plainPassword: string,
  ): Promise<boolean> {
    const auth = await this.authRepo.findOne({
      where: { _id: authIdStr } as any,
    });
    if (!auth) throw new NotFoundException("Auth record not found");
    return bcrypt.compare(plainPassword, (auth as any).passwordHash || "");
  }
}
