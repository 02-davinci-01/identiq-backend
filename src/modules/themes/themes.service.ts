// src/modules/themes/themes.service.ts
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Theme } from "./entities/theme.entity";
import { User } from "../users/entities/user.entity";

/**
 * Server-side canonical theme list.
 * Keep this in sync with the frontend THEMES constant.
 */
export const THEMES = [
  { id: "teal", label: "Teal", img: "/themeChange.webp", color: "#2f6f66" },
  { id: "light", label: "Light", img: "/themeChange.webp", color: "#c96a2b" }, // default
  { id: "dark", label: "Dark", img: "/themeChange.webp", color: "#000000" },
];

export const DEFAULT_THEME_ID = "light";
export const DEFAULT_THEME_COLOR = "#c96a2b";

@Injectable()
export class ThemeService {
  private readonly logger = new Logger(ThemeService.name);

  constructor(
    @InjectRepository(Theme)
    private readonly themeRepo: Repository<Theme>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** Return the server-side canonical themes (useful for clients) */
  getAvailableThemes() {
    return THEMES;
  }

  /**
   * Get the theme for an email. If not present, return default values (no DB write).
   * Returns an object shaped like the Theme entity (partial if not persisted).
   */
  async getByEmail(email: string) {
    if (!email) throw new BadRequestException("Email required");

    const theme = await this.themeRepo.findOne({ where: { email } });
    if (theme) return theme;

    const defaultTheme = THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
    return {
      email,
      themeId: defaultTheme.id,
      label: defaultTheme.label,
      img: defaultTheme.img,
      colorHex: defaultTheme.color,
    } as Partial<Theme>;
  }

  /**
   * Create or replace the default theme row for an email.
   * Updates user's colorHex as well if user exists.
   */
  async createDefaultForEmail(email: string) {
    if (!email) throw new BadRequestException("Email required");
    const defaultTheme = THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;

    try {
      const existingUser = await this.userRepo.findOne({ where: { email } });
      const existing = await this.themeRepo.findOne({ where: { email } });

      if (existing && existingUser) {
        existing.themeId = defaultTheme.id;
        existing.label = defaultTheme.label;
        existing.img = defaultTheme.img;
        existing.colorHex = defaultTheme.color;
        await this.themeRepo.save(existing);
        await this.userRepo.save(existingUser);
        this.logger.log(
          `Rewrote existing theme for ${email} -> ${defaultTheme.id}`,
        );
      } else {
        const created = this.themeRepo.create({
          email,
          themeId: defaultTheme.id,
          label: defaultTheme.label,
          img: defaultTheme.img,
          colorHex: defaultTheme.color,
        } as Theme);
        await this.themeRepo.save(created);
        this.logger.log(
          `Created default theme for ${email} -> ${defaultTheme.id}`,
        );
      }

      // Keep user.colorHex in sync
      const user = await this.userRepo.findOne({ where: { email } });
      if (user) {
        user.colorHex = defaultTheme.color;
        await this.userRepo.save(user);
      } else {
        this.logger.warn(`createDefaultForEmail: user not found for ${email}`);
      }

      return { ok: true };
    } catch (err) {
      this.logger.error(`createDefaultForEmail failed for ${email}`, err);
      throw err;
    }
  }

  /**
   * Update theme for the given email.
   * Accepts either themeId (one of canonical themes) or a custom colorHex.
   * Returns the updated theme summary.
   */
  async updateByEmail(
    email: string,
    payload: { themeId?: string; colorHex?: string },
  ) {
    if (!email) throw new BadRequestException("Email required");
    if (!payload?.themeId && !payload?.colorHex)
      throw new BadRequestException("Either themeId or colorHex required");

    // Determine resulting theme values
    const chosen = payload.themeId
      ? (THEMES.find((t) => t.id === payload.themeId) ?? null)
      : null;
    const resultingColor =
      payload.colorHex ?? chosen?.color ?? DEFAULT_THEME_COLOR;
    const resultingLabel = chosen?.label ?? "Custom";
    const resultingImg = chosen?.img ?? null;
    const resultingThemeId =
      chosen?.id ?? (payload.colorHex ? "custom" : DEFAULT_THEME_ID);

    try {
      const existing = await this.themeRepo.findOne({ where: { email } });
      const existingUser = await this.userRepo.findOne({ where: { email } });

      if (existing && existingUser) {
        existing.themeId = resultingThemeId;
        existing.label = resultingLabel;
        existing.img = resultingImg;
        existing.colorHex = resultingColor;
        existingUser.colorHex = resultingColor;
        await this.themeRepo.save(existing);
        await this.userRepo.save(existingUser);
        this.logger.log(`Updated theme for ${email} -> ${resultingThemeId}`);
      } else {
        const created = this.themeRepo.create({
          email,
          themeId: resultingThemeId,
          label: resultingLabel,
          img: resultingImg,
          colorHex: resultingColor,
        } as Theme);
        await this.themeRepo.save(created);
        this.logger.log(`Created theme for ${email} -> ${resultingThemeId}`);
      }

      // keep user.colorHex in sync
      const user = await this.userRepo.findOne({ where: { email } });
      if (user) {
        user.colorHex = resultingColor;
        await this.userRepo.save(user);
      } else {
        this.logger.warn(`updateByEmail: user not found for ${email}`);
      }

      return {
        ok: true,
        theme: {
          themeId: resultingThemeId,
          label: resultingLabel,
          img: resultingImg,
          colorHex: resultingColor,
        },
      };
    } catch (err) {
      this.logger.error(`updateByEmail failed for ${email}`, err);
      throw err;
    }
  }

  /** Helper: find themes by email (returns array - usually single element) */
  async findByEmail(email: string) {
    if (!email) throw new BadRequestException("Email required");
    return this.themeRepo.find({ where: { email } });
  }

  /** Delete themes by email (used during account deletion) */
  async deleteByEmail(email: string) {
    if (!email) throw new BadRequestException("Email required");
    try {
      const res = await this.themeRepo.delete({ email });
      const affected = res?.affected ?? undefined;
      this.logger.log(`Deleted theme rows for ${email} (affected=${affected})`);
      return { ok: true, deletedCount: affected };
    } catch (err) {
      this.logger.error(`deleteByEmail failed for ${email}`, err);
      throw err;
    }
  }
}
