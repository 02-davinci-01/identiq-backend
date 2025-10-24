// src/modules/auth/auth.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "../users/entities/user.entity";
import { Any, MoreThan, Repository } from "typeorm";
import { randomBytes } from "crypto";
import * as bcrypt from "bcryptjs";
import { ConfigService } from "@nestjs/config";
import { BrevoService } from "src/infrastructure/integrations/brevo/brevo.service";
import { Auth } from "./entities/auth.entity";
import { JwtService } from "@nestjs/jwt";
import { v4 as uuidv4 } from "uuid";
import { ObjectId } from "mongodb";
import { DataSource } from "typeorm";
import { Theme } from "../themes/entities/theme.entity";
import { ThemeService } from "../themes/themes.service";
import axios from "axios";

@Injectable()
export class AuthService {
  private readonly TOKEN_EXPIRY_TIME = 1000 * 60 * 60; // 1 hour
  private readonly HASH_ROUNDS = 10;
  private readonly PASSWORD_HASH_ROUNDS = 12;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Auth) private readonly authRepo: Repository<Auth>,
    @InjectRepository(Theme) private readonly themeRepo: Repository<Auth>,
    private readonly config: ConfigService,
    private readonly brevo: BrevoService,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    private readonly themeService: ThemeService,
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
      authUser.name;
      authUser.verifyEmailTokenHash = tokenHash;
      authUser.verifyEmailExpiry = expiry;
    }

    await this.authRepo.save(authUser);

    // Build a friendly verify link for the HTML fallback (the Brevo service will also build one when using templates)
    const frontendURL =
      this.config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";
    const verifyLink = `${frontendURL.replace(/\/$/, "")}/auth/complete-register?token=${rawToken}&email=${email}`;
    console.log(verifyLink);

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

    try {
      await this.themeService.createDefaultForEmail(authUser.email);
    } catch (err) {
      // if theme creation fails, log but do not block registration (optional)
      this.logger.error("Failed to initialize default theme for user", err);
    }

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
    if (!authIdStr || !jid) return false;

    const whereClause: any = ObjectId.isValid(authIdStr)
      ? { _id: new ObjectId(authIdStr) }
      : { _id: authIdStr };

    const auth = await this.authRepo.findOne({ where: whereClause });
    if (!auth) {
      console.log("auth not found");
      return false;
    }
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

  /** Change name: update Auth.name and User.name (keeps both in sync) */
  async changeName(email: string, newName: string) {
    if (!email || !newName) throw new BadRequestException("Missing params");

    // update auth repo
    const auth = await this.authRepo.findOne({ where: { email } as any });
    if (!auth) throw new NotFoundException("Auth record not found");
    (auth as any).name = newName;
    await this.authRepo.save(auth);

    // update user repo if exists
    const user = await this.userRepo.findOne({ where: { email } as any });
    if (user) {
      (user as any).name = newName;
      await this.userRepo.save(user);
    }

    // return canonical newName
    return { name: newName };
  }

  /** Change password: update auth password hash */
  async changePassword(
    email: string,
    oldPassword: string,
    newPassword: string,
  ) {
    if (!email || !newPassword) throw new BadRequestException("Missing params");

    const auth = await this.authRepo.findOne({ where: { email } as any });
    if (!auth) throw new NotFoundException("Auth record not found");

    const isValid = await bcrypt.compare(oldPassword, auth.passwordHash!);

    if (!isValid) throw new ConflictException("Old password doesn't match");

    const hash = await bcrypt.hash(newPassword, this.PASSWORD_HASH_ROUNDS);
    (auth as any).passwordHash = hash;
    await this.authRepo.save(auth);

    return { ok: true };
  }

  /** Delete account: remove auth, user and theme rows (transactional) */
  async deleteAccountByEmailTransactional(email: string) {
    if (!email) throw new BadRequestException("Missing email");

    return await this.dataSource.transaction(async (manager) => {
      // delete themes
      await manager.getRepository(Theme).delete({ email } as any);
      // delete user
      await manager.getRepository(User).delete({ email } as any);
      // delete auth
      await manager.getRepository(Auth).delete({ email } as any);

      // optionally: invalidate sessions / jids etc.
      return { ok: true };
    });
  }

  /** Convenience wrapper used by controller */
  async deleteAccountByEmail(email: string) {
    return this.deleteAccountByEmailTransactional(email);
  }

  /**
   * Initiate email change:
   * - set pendingNewEmail, pendingEmailTokenHash, pendingEmailExpiry on Auth
   * - send verification email to newEmail (use your existing brevo/email util)
   */

  /**
   * Initiate email change:
   * - sets pendingNewEmail, pendingEmailTokenHash, pendingEmailExpiry on Auth
   * - sends verification email to newEmail using Brevo helper (same signature as register)
   */
  // inside AuthService

  /**
   * Initiates an email change.
   * - Reuses verifyEmailTokenHash & verifyEmailExpiry fields (no new schema fields).
   * - Raw token format: "<newEmail>::<randomHex>"
   * - Sends verification email to newEmail via Brevo (same signature as register).
   */
  async initiateEmailChange(currentEmail: string, newEmail: string) {
    if (!currentEmail)
      throw new BadRequestException("Missing authenticated email");
    if (!newEmail) throw new BadRequestException("New email is required");

    const normalizedCurrent = String(currentEmail).trim().toLowerCase();
    const normalizedNew = String(newEmail).trim().toLowerCase();

    if (normalizedCurrent === normalizedNew) {
      throw new BadRequestException("New email is same as current email");
    }

    // find auth record for current user
    const authUser = await this.authRepo.findOne({
      where: { email: normalizedCurrent } as any,
    });
    if (!authUser) throw new NotFoundException("Auth record not found");

    // ensure no other account already uses the new email
    const already = await this.authRepo.findOne({
      where: { email: normalizedNew } as any,
    });
    if (already) throw new ConflictException("Requested email already in use");

    // authUser.email = newEmail;
    authUser.updEmail = newEmail;

    // build raw token that *includes* the new email (so we don't need a pendingEmail field)
    const randomPart = this.genToken(24); // you already have genToken from register
    const rawToken = `${randomPart}`;

    // hash the raw token exactly like your register flow (bcrypt)
    const tokenHash = await bcrypt.hash(rawToken, this.HASH_ROUNDS);
    const expiry = new Date(Date.now() + this.TOKEN_EXPIRY_TIME);

    // persist hash + expiry into the verify fields you already have
    authUser.verifyEmailTokenHash = tokenHash;
    authUser.verifyEmailExpiry = expiry;

    // Mark emailVerified false temporarily (per your described flow)
    authUser.emailVerified = false;

    await this.authRepo.save(authUser);

    // build frontend verification link (same as register)
    const frontendURL = (
      this.config.get<string>("FRONTEND_URL") ?? "http://localhost:3000"
    ).replace(/\/$/, "");
    const verifyLink = `${frontendURL}/email-verification?token=${rawToken}&email=${encodeURIComponent(normalizedNew)}`;

    // send the verification email using your Brevo helper (signature matches register)
    try {
      await this.brevo.sendVerificationEmail(normalizedNew, rawToken, {
        subject: "Confirm your new email address",
        extraParams: {
          token: rawToken,
          verifyLink,
          email: normalizedNew,
          year: String(new Date().getFullYear()),
        },
      });
    } catch (err) {
      this.logger.error("Brevo send error (initiateEmailChange)", err as any);
      // rollback token fields on failure so nothing is left hanging
      authUser.verifyEmailTokenHash = null;
      authUser.verifyEmailExpiry = null;
      await this.authRepo.save(authUser);
      throw new BadRequestException("Failed to send verification email");
    }

    return { message: "verification email sent", status: true };
  }

  /**
   * Complete email change (transactional update across Auth, User, Theme)
   * - token: raw token from query (string)
   * - newEmail: the email being confirmed
   * - password?: optional new password to set on auth
   */
  /**
   * Complete email change (transactional update across Auth, User, Theme)
   * - token: raw token from query
   * - newEmail: the email being confirmed (body)
   * - password?: optional new password to set on auth
   *
   * This uses DataSource.transaction (keeps TypeORM transaction pattern you already have).
   */
  // inside AuthService

  /**
   * Confirm email change.
   * - rawToken: the token provided in the verification link (contains newEmail::random)
   * - email: the newEmail (frontend passes it back)
   *
   * Process:
   *  - find candidate auth documents with non-expired verifyEmailExpiry
   *  - bcrypt.compare rawToken against each candidate.verifyEmailTokenHash
   *  - when a match is found, extract embedded newEmail from token and validate it equals `email` param
   *  - then in a transaction update auth.email, set emailVerified = true, clear verify fields,
   *    and update user + theme collections to keep consistency.
   */
  async confirmEmailChange(rawToken: string, email: string) {
    if (!rawToken || !email)
      throw new BadRequestException("Missing token or email");

    const normalizedEmail = String(email).trim().toLowerCase();

    // find the auth row by the new email supplied in query
    const authDoc = await this.authRepo.findOne({
      where: { updEmail: normalizedEmail } as any,
    });
    if (!authDoc) {
      throw new BadRequestException("No pending verification for this email");
    }

    if (!authDoc.verifyEmailTokenHash || !authDoc.verifyEmailExpiry) {
      throw new BadRequestException(
        "No verification token present for this email",
      );
    }

    if (new Date(authDoc.verifyEmailExpiry) < new Date()) {
      throw new BadRequestException("Token expired");
    }

    // verify token
    const matches = await bcrypt.compare(
      rawToken,
      authDoc.verifyEmailTokenHash,
    );
    if (!matches) throw new BadRequestException("Invalid token");

    // Transactional update — keep it focused on Auth (you said you'll add user-repo changes)
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const authRepoTx = manager.getRepository(this.authRepo.target);

        // reload under transaction
        const auth = await authRepoTx.findOne({
          where: { id: (authDoc as any).id } as any,
        });
        if (!auth) throw new BadRequestException("Auth record disappeared");

        // double-check expiry & hash inside txn
        if (
          !auth.verifyEmailExpiry ||
          new Date(auth.verifyEmailExpiry) < new Date()
        ) {
          throw new BadRequestException("Token expired");
        }
        const okInside = await bcrypt.compare(
          rawToken,
          auth.verifyEmailTokenHash || "",
        );
        if (!okInside) throw new BadRequestException("Invalid token");

        // NOTE: auth.email is the new email in this flow (we found by new email)
        // Mark verified and clear verify fields
        //consistency
        const userDoc = await this.userRepo.findOne({
          where: { email: normalizedEmail } as any,
        });

        const themeDoc = await this.themeRepo.findOne({
          where: { email: normalizedEmail } as any,
        });

        userDoc!.email = normalizedEmail;
        themeDoc!.email = normalizedEmail;
        this.themeRepo.save(themeDoc!);
        this.userRepo.save(userDoc!);

        auth.emailVerified = true;
        auth.email = normalizedEmail;
        auth.updEmail = "";

        auth.verifyEmailTokenHash = null;
        auth.verifyEmailExpiry = null;

        await authRepoTx.save(auth);

        // === PLACEHOLDER ===
        // If you need to update User and Theme tables/collections, add those updates here
        // using userRepoTx and themeRepoTx fetched from manager.getRepository(...)
        // Example:
        // const userRepoTx = manager.getRepository(User);
        // const themeRepoTx = manager.getRepository(Theme);
        // -- your user updates (you requested you'll add them) --
        // -- theme updates if required --

        return { success: true };
      });

      return result;
    } catch (err) {
      this.logger.error("confirmEmailChange transaction failed", err as any);
      throw new InternalServerErrorException("Failed to confirm email change");
    }
  }

  /////////////////////////////FORGOT PASSWORD/////////////////////////////////////////////////
  // inside AuthService class
  // inside AuthService class — replace existing initiatePasswordReset with this
  async initiatePasswordReset(email: string) {
    if (!email) throw new BadRequestException("Email is required");

    const normalizedEmail = String(email).trim().toLowerCase();

    // find existing auth row (may return null)
    let authUser: any = await this.authRepo.findOne({
      where: { email: normalizedEmail } as any,
    });

    // If no auth row exists, create a minimal auth record so we can attach the token
    if (!authUser) {
      authUser = this.authRepo.create({
        name: undefined,
        email: normalizedEmail,
        emailVerified: false,
      } as any);
    }

    // generate raw token and its hash (same as register)
    const rawToken = this.genToken(24);
    const tokenHash = await bcrypt.hash(rawToken, this.HASH_ROUNDS);
    const expiry = new Date(Date.now() + this.TOKEN_EXPIRY_TIME);

    // persist hash + expiry (we ensured authUser is a real entity above)
    authUser.resetPasswordTokenHash = tokenHash;
    authUser.resetPasswordExpiry = expiry;

    // save (authUser is guaranteed non-null here)
    await this.authRepo.save(authUser);

    // Build friendly reset link that includes token & email in query (same pattern as register)
    const frontendURL =
      this.config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";
    const verifyLink = `${frontendURL.replace(/\/$/, "")}/auth/forgot-password?token=${encodeURIComponent(
      rawToken,
    )}&email=${encodeURIComponent(normalizedEmail)}`;

    // extraParams shaped exactly like register (so your Brevo template can reuse)
    const extraParams = {
      token: rawToken,
      verifyLink,
      name: authUser.name ?? "",
      email: normalizedEmail,
      year: String(new Date().getFullYear()),
      templateId: "3",
    };

    try {
      // Use new brevo helper that targets the forgot-password template env var
      await this.brevo.sendForgotPasswordEmail(normalizedEmail, rawToken, {
        subject: "Reset your password",
        extraParams,
      });
    } catch (err) {
      this.logger?.error("Brevo send error (forgot password)", err as any);
      // match registration behaviour: throw friendly error (or you can return neutral)
      throw new BadRequestException("Failed to send password reset email");
    }

    return { message: "email sent successfully", status: true };
  }

  /**
   * Complete password reset (verify token + email then set new password)
   * - email & rawToken are provided by query in the frontend link and passed into controller
   * - we compare rawToken to the stored hash using bcrypt.compare
   * - on success we hash new password (same HASH_ROUNDS) and persist to auth row (and user row if needed)
   * - clear the resetPasswordTokenHash & resetPasswordExpiry fields
   */
  // inside AuthService class
  async completePasswordResetWithEmail(
    email: string,
    rawToken: string,
    newPassword: string,
  ) {
    if (!email) throw new BadRequestException("Email is required");
    if (!rawToken) throw new BadRequestException("Token is required");
    if (!newPassword) throw new BadRequestException("Password is required");

    const normalizedEmail = String(email).trim().toLowerCase();
    console.log(email);

    // find auth row by email
    const authUser: any = await this.authRepo.findOne({
      where: { email: normalizedEmail } as any,
    });
    if (!authUser) throw new NotFoundException("Invalid token or email");
    console.log("1st");

    const storedHash: string | undefined = authUser.resetPasswordTokenHash;
    const expiry: Date | string | undefined = authUser.resetPasswordExpiry;

    if (!storedHash || !expiry) {
      throw new BadRequestException("Invalid token or email");
    }

    // check expiry
    const now = new Date();
    if (new Date(expiry) < now) {
      throw new BadRequestException("Token expired");
    }

    // verify the token using bcrypt.compare (we stored only the hash)
    console.log("invalid here");
    const match = await bcrypt.compare(rawToken, storedHash);
    if (!match) throw new BadRequestException("Invalid token");

    // hash the new password (same hashing as register)
    const newPasswordHash = await bcrypt.hash(newPassword, this.HASH_ROUNDS);

    // update authUser password and clear token fields
    if (typeof authUser.passwordHash !== "undefined") {
      authUser.passwordHash = newPasswordHash;
    } else {
      authUser.password = newPasswordHash; // fallback if your entity uses 'password'
    }
    authUser.resetPasswordTokenHash = null;
    authUser.resetPasswordExpiry = null;
    authUser.emailVerified = true;

    await this.authRepo.save(authUser);

    // synchronize with userRepo if present
    if (this.userRepo) {
      try {
        const user: any = await this.userRepo.findOne({
          where: { email: normalizedEmail } as any,
        });
        if (user) {
          if (typeof user.passwordHash !== "undefined")
            user.passwordHash = newPasswordHash;
          else user.password = newPasswordHash;
          user.emailVerified = true;
          await this.userRepo.save(user);
        }
      } catch (err) {
        // log but don't fail — primary auth repo updated successfully
        this.logger?.error("Failed to sync password to userRepo", err as any);
      }
    }

    return { message: "password updated successfully", status: true };
  }
}
