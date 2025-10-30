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
import { MoreThan, Repository } from "typeorm";
import { randomBytes } from "crypto";
import * as bcrypt from "bcryptjs";
import { ConfigService } from "@nestjs/config";
import { BrevoService } from "../../infrastructure/integrations/brevo/brevo.service";
import { Auth } from "./entities/auth.entity";
import { JwtService } from "@nestjs/jwt";
import { v4 as uuidv4 } from "uuid";
import { ObjectId } from "mongodb";
import { DataSource } from "typeorm";
import { Theme } from "../themes/entities/theme.entity";
import { ThemeService } from "../themes/themes.service";
import type { SignOptions } from "jsonwebtoken";

import axios from "axios";

type PersistedAuth = Auth & { _id?: ObjectId | null; id?: string | null };

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

    let authUser = await this.authRepo.findOne({ where: { email } });

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
      this.logger.error("Brevo send error", err);
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

    const authUser = await this.authRepo.findOne({ where: { email } });

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

    const auth = await this.authRepo.findOne({ where: { email } });
    if (!auth) return null;

    const matches = await bcrypt.compare(password, auth.passwordHash || "");
    return matches ? auth : null;
  }

  /**
   * Login: create jid, persist to auth.jids, sign JWT
   */
  // inside AuthService

  // helper type: Auth may have a Mongo ObjectId (_id) or an SQL id (id: string)

  async login(authRow: Partial<Auth> | null): Promise<{
    accessToken: string;
    refreshToken: string;
    jid: string;
    expiresIn: string | number;
    user: { id: string; email?: string; name?: string };
  }> {
    if (!authRow || !(authRow as Partial<Auth>)._id) {
      // keep a small runtime defensive check because callers sometimes pass different shapes
      throw new BadRequestException("Invalid auth object");
    }

    // reload from DB to get the latest jids (ensure type is Repository<Auth>)
    const dbAuth = (await this.authRepo.findOne({
      where: {
        _id: (authRow as Partial<Auth>)._id,
      },
    })) as PersistedAuth | null;

    if (!dbAuth) throw new NotFoundException("Auth record not found");

    // normalize jids to an array
    dbAuth.jids = Array.isArray(dbAuth.jids) ? dbAuth.jids : [];

    // optional: enforce max sessions
    const maxSessionsRaw = this.config.get<string | number | undefined>(
      "MAX_SESSIONS",
    );
    const MAX_SESSIONS = Number(maxSessionsRaw ?? 10);
    if (!Number.isFinite(MAX_SESSIONS) || MAX_SESSIONS <= 0) {
      // fallback to sane default
      // eslint-disable-next-line no-param-reassign
      // (no-op, MAX_SESSIONS already defaulted)
    }
    if (dbAuth.jids.length >= MAX_SESSIONS) dbAuth.jids.shift();

    // create a new jid (session id) and persist
    const jid = uuidv4();
    dbAuth.jids.push(jid);
    await this.authRepo.save(dbAuth);

    // derive stable user id string (prefer _id, then id)
    const userId =
      dbAuth._id != null
        ? typeof dbAuth._id === "string"
          ? dbAuth._id
          : (dbAuth._id as ObjectId).toString()
        : String(dbAuth.id ?? "");

    const payload = {
      sub: userId,
      email: dbAuth.email,
      name: dbAuth.name,
      jid,
    };

    // get expiresIn from config; ConfigService.get is generic so we ask for string|number|undefined
    const rawExpires = this.config.get<string | number | undefined>(
      "JWT_EXPIRES_IN",
    );
    const expiresIn: string | number = rawExpires ?? "1h";

    const payloadObj = payload as Record<string, unknown>;

    // JwtService.sign accepts JwtSignOptions which types expiresIn as string|number
    const accessToken = this.jwtService.sign(payloadObj, {
      expiresIn: expiresIn as SignOptions["expiresIn"],
    });

    // refresh token TTL (string like '30d' or number seconds)
    const rawRefreshTtl = this.config.get<string | number | undefined>(
      "REFRESH_TOKEN_TTL",
    );
    const refreshTtl: string | number = rawRefreshTtl ?? "30d";

    const refreshPayload = {
      sub: userId,
      jid,
    };

    const refreshToken = this.jwtService.sign(
      refreshPayload as Record<string, unknown>,
      {
        expiresIn: refreshTtl as SignOptions["expiresIn"],
      },
    );

    // return typed shape
    return {
      accessToken,
      refreshToken,
      jid,
      expiresIn,
      user: {
        id: userId,
        email: dbAuth.email,
        name: dbAuth.name,
      },
    };
  }

  /**
   * Logout: remove the jid
   */
  async logout(authIdStr: string, jid: string) {
    if (!authIdStr || !jid)
      throw new BadRequestException("Missing authId or jid");

    // Try to handle both string id and ObjectId if needed
    let query: Object = { _id: authIdStr };
    // If stored _id is an ObjectId, TypeORM/Mongo driver will accept string as well.
    const auth = await this.authRepo.findOne({ where: query });
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

    //made it object

    const whereClause: Object = ObjectId.isValid(authIdStr)
      ? { _id: new ObjectId(authIdStr) }
      : { _id: authIdStr };

    const auth = await this.authRepo.findOne({ where: whereClause });
    if (!auth) {
      console.log("auth not found");
      return false;
    }
    return Array.isArray(auth.jids) && auth.jids.includes(jid);
  }

  /** Change name: update Auth.name and User.name (keeps both in sync) */
  async changeName(email: string, newName: string) {
    if (!email || !newName) throw new BadRequestException("Missing params");

    // update auth repo
    const auth = await this.authRepo.findOne({ where: { email } });
    if (!auth) throw new NotFoundException("Auth record not found");
    auth.name = newName;
    await this.authRepo.save(auth);

    // update user repo if exists
    const user = await this.userRepo.findOne({ where: { email } });
    if (user) {
      (user as User).name = newName;
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

    const auth = await this.authRepo.findOne({ where: { email } });
    if (!auth) throw new NotFoundException("Auth record not found");

    const isValid = await bcrypt.compare(oldPassword, auth.passwordHash!);

    if (!isValid) throw new ConflictException("Old password doesn't match");

    const hash = await bcrypt.hash(newPassword, this.PASSWORD_HASH_ROUNDS);
    auth.passwordHash = hash;
    await this.authRepo.save(auth);

    return { ok: true };
  }

  /** Delete account: remove auth, user and theme rows (transactional) */
  async deleteAccountByEmailTransactional(email: string) {
    if (!email) throw new BadRequestException("Missing email");

    return await this.dataSource.transaction(async (manager) => {
      // delete themes
      await manager.getRepository(Theme).delete({ email });
      // delete user
      await manager.getRepository(User).delete({ email });
      // delete auth
      await manager.getRepository(Auth).delete({ email });

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
      where: { email: normalizedCurrent },
    });
    if (!authUser) throw new NotFoundException("Auth record not found");

    // ensure no other account already uses the new email
    const already = await this.authRepo.findOne({
      where: { email: normalizedNew },
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
      this.logger.error("Brevo send error (initiateEmailChange)", err);
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
      where: { updEmail: normalizedEmail },
    });

    const oldEmail = authDoc?.email;
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

    // verify token (cheap check before starting txn)
    const matches = await bcrypt.compare(
      rawToken,
      authDoc.verifyEmailTokenHash,
    );
    if (!matches) throw new BadRequestException("Invalid token");

    try {
      // Run transaction and return the saved auth object at the end
      const savedAuth = await this.dataSource.transaction(async (manager) => {
        const authRepoTx = manager.getRepository(this.authRepo.target);
        // const userRepoTx = manager.getRepository(this.userRepo.target);
        // const themeRepoTx = manager.getRepository(this.themeRepo.target);

        // reload auth inside txn (TOCTOU prevention)
        const auth = await authRepoTx.findOne({
          where: { _id: authDoc._id },
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

        // find user and theme by old email
        let userDoc;
        let themeDoc;
        if (oldEmail) {
          userDoc = await this.userRepo.findOne({
            where: { email: String(oldEmail).trim().toLowerCase() },
          });

          themeDoc = await this.themeRepo.findOne({
            where: { email: String(oldEmail).trim().toLowerCase() },
          });
        }

        // update user and theme if present
        if (userDoc) {
          userDoc.email = normalizedEmail;
          await this.userRepo.save(userDoc);
        } else {
          this.logger.warn(
            `confirmEmailChange: user not found for oldEmail=${oldEmail}, authId=${(auth as any)._id}. Skipping user update.`,
          );
        }

        if (themeDoc) {
          themeDoc.email = normalizedEmail;
          await this.themeRepo.save(themeDoc);
        } else {
          this.logger.warn(
            `confirmEmailChange: theme not found for oldEmail=${oldEmail}, authId=${(auth as any)._id}. Skipping theme update.`,
          );
        }

        // mark email verified and clear token/updEmail fields
        auth.emailVerified = true;
        auth.email = normalizedEmail;
        auth.updEmail = null;
        auth.verifyEmailTokenHash = null;
        auth.verifyEmailExpiry = null;

        const saved = await authRepoTx.save(auth);
        // return the saved auth record from the transaction
        return saved;
      });

      // Now generate a fresh session JWT for the newly confirmed auth record
      // authService.login expects a Partial<Auth>-like object (the login implementation you showed)
      const { accessToken, refreshToken, jid, expiresIn, user } =
        await this.login(savedAuth as any);

      // Return tokens and user so controller returns them to the client
      return {
        accessToken,
        refreshToken,
        jid,
        expiresIn,
        user,
        message: "Email confirmed and signed in",
      };
    } catch (err) {
      this.logger.error("confirmEmailChange transaction failed", err);
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
    let authUser = await this.authRepo.findOne({
      where: { email: normalizedEmail },
    });

    // If no auth row exists, create a minimal auth record so we can attach the token
    if (!authUser) {
      authUser = this.authRepo.create({
        name: undefined,
        email: normalizedEmail,
        emailVerified: false,
      });
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
      this.logger?.error("Brevo send error (forgot password)", err);
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
    const authUser = await this.authRepo.findOne({
      where: { email: normalizedEmail },
    });
    if (!authUser) throw new NotFoundException("Invalid token or email");
    console.log("1st");

    const storedHash: string | null | undefined =
      authUser.resetPasswordTokenHash;
    const expiry: Date | string | null | undefined =
      authUser.resetPasswordExpiry;

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
    }
    authUser.resetPasswordTokenHash = null;
    authUser.resetPasswordExpiry = null;
    authUser.emailVerified = true;

    await this.authRepo.save(authUser);

    // synchronize with userRepo if present

    return { message: "password updated successfully", status: true };
  }
}
