// src/modules/themes/themes.service.ts
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import ntc from "ntcjs";

import { Theme } from "./entities/theme.entity";
import { User } from "../users/entities/user.entity";
import { CreateCustomThemeDto } from "./dto/create-custom-theme.dto";

export interface CustomThemeItem {
  themeId: string;
  label: string;
  hex: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Keep the canonical static theme hexes here so both updateByEmail
 * and the rest of the service use the exact same values.
 *
 * Use the same THEMES you provided on the frontend.
 */
const STATIC_THEMES: { [themeId: string]: string } = {
  teal: "#2F6F66",
  light: "#C96A2B",
  dark: "#000000",
};

@Injectable()
export class ThemeService {
  private readonly logger = new Logger(ThemeService.name);

  constructor(
    @InjectRepository(Theme)
    private readonly themeRepo: Repository<Theme>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // -------------------------
  // Helpers
  // -------------------------
  private normalizeHex(raw: string) {
    if (!raw) throw new BadRequestException("hex required");
    let h = raw.trim();
    if (!h.startsWith("#")) h = "#" + h;
    h = h.toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(h)) {
      throw new BadRequestException("hex must be a 6-digit hex like #4287F5");
    }
    return h;
  }

  private capitalizeFirst(value: string) {
    if (!value) return value;
    const lower = value.trim().toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  // -------------------------
  // Default creation
  // -------------------------
  async createDefaultForEmail(email: string): Promise<Theme> {
    if (!email) throw new BadRequestException("Email required");

    let existing = await this.themeRepo.findOne({ where: { email } });
    if (existing) return existing;

    const now = new Date();
    const newTheme = this.themeRepo.create({
      email,
      themeId: "light",
      label: "Light",
      colorHex: STATIC_THEMES.light,
      customThemes: [],
      createdAt: now,
      updatedAt: now,
    } as Partial<Theme>);

    const saved = await this.themeRepo.save(newTheme);
    this.logger.log(`Created default theme for ${email}`);
    return saved;
  }

  // -------------------------
  // Reads
  // -------------------------
  async getByEmail(email: string) {
    if (!email) throw new BadRequestException("Email required");
    const theme = await this.themeRepo.findOne({ where: { email } });
    if (theme) return theme;

    return {
      email,
      themeId: "light",
      label: "Light",
      colorHex: STATIC_THEMES.light,
      customThemes: [],
    } as Partial<Theme>;
  }

  async getCustomThemes(email: string) {
    if (!email) throw new BadRequestException("Email required");
    const row = await this.themeRepo.findOne({ where: { email } });
    return (row?.customThemes ?? []) as CustomThemeItem[];
  }

  // -------------------------
  // Update selected theme (persist selection)
  // - If themeId corresponds to a static theme, persist the canonical hex from STATIC_THEMES.
  // - If colorHex is provided, normalize and persist that.
  // - Create the row if missing.
  // -------------------------
  async updateByEmail(
    email: string,
    payload: { themeId?: string; colorHex?: string },
  ) {
    if (!email) throw new BadRequestException("No email in token");
    const { themeId, colorHex } = payload ?? {};

    if (!themeId && !colorHex) {
      throw new BadRequestException(
        "At least one of themeId or colorHex must be provided",
      );
    }

    let normalizedHex: string | undefined;
    if (typeof colorHex !== "undefined" && colorHex !== null) {
      normalizedHex = this.normalizeHex(colorHex);
    }

    // If themeId is one of the static themes, override normalizedHex with the canonical static hex.
    if (themeId && StaticThemeHas(themeId)) {
      normalizedHex = STATIC_THEMES[themeId];
    }

    let themeRow = await this.themeRepo.findOne({ where: { email } });
    const now = new Date();

    if (!themeRow) {
      themeRow = this.themeRepo.create({
        email,
        themeId: themeId || "light",
        label: themeId ? this.capitalizeFirst(themeId) : "Light",
        colorHex: normalizedHex || STATIC_THEMES.light,
        customThemes: [],
        createdAt: now,
        updatedAt: now,
      } as Partial<Theme>);
    } else {
      if (themeId) {
        themeRow.themeId = themeId;
        // ensure label matches themeId for static ones (keep human readable)
        themeRow.label = this.capitalizeFirst(themeId);
      }
      if (normalizedHex) {
        themeRow.colorHex = normalizedHex;
      }
      themeRow.updatedAt = now;
    }

    await this.themeRepo.save(themeRow);
    return themeRow;
  }

  // -------------------------
  // Create custom theme
  // -------------------------
  async createCustomTheme(email: string, dto: CreateCustomThemeDto) {
    if (!email) throw new BadRequestException("No email in token");

    const hex = this.normalizeHex(dto.hex);

    let themeRow = await this.themeRepo.findOne({ where: { email } });
    if (!themeRow) themeRow = await this.createDefaultForEmail(email);

    if (!Array.isArray(themeRow.customThemes)) themeRow.customThemes = [];

    const exists = themeRow.customThemes.find(
      (t: any) => (t.hex || "").toUpperCase() === hex,
    );
    if (exists) {
      throw new BadRequestException(
        "A custom theme with the same hex already exists",
      );
    }

    const source = dto.themeId?.trim() || "ntcjs";

    // Derive name from ntcjs; then normalize to "First-letter uppercase, rest lowercase"
    let derived = hex;
    try {
      const [, name] = ntc.name(hex);
      derived = name || hex;
    } catch (err) {
      this.logger.warn("ntcjs lookup failed", err);
      derived = hex;
    }

    const label = this.capitalizeFirst(derived);

    const now = new Date();
    const item: CustomThemeItem = {
      themeId: source,
      label,
      hex,
      createdAt: now,
      updatedAt: now,
    };

    themeRow.customThemes.push(item);
    await this.themeRepo.save(themeRow);

    return { item, themeRow };
  }

  // -------------------------
  // Remove custom theme
  // - If removed hex equals themeRow.colorHex, reset to 'light' and its canonical hex.
  // -------------------------
  async removeCustomTheme(email: string, hexOrId: string) {
    if (!email) throw new BadRequestException("No email in token");
    const normalized = this.normalizeHex(hexOrId);

    const themeRow = await this.themeRepo.findOne({ where: { email } });
    if (!themeRow) throw new NotFoundException("Theme row not found");

    if (!Array.isArray(themeRow.customThemes)) themeRow.customThemes = [];

    const idx = themeRow.customThemes.findIndex(
      (t: any) => (t.hex || "").toUpperCase() === normalized,
    );
    if (idx === -1) throw new NotFoundException("Custom theme not found");

    const removed = themeRow.customThemes.splice(idx, 1)[0];

    // If the removed hex equals the currently-selected colorHex, revert to light.
    if ((themeRow.colorHex || "").toUpperCase() === normalized) {
      themeRow.themeId = "light";
      themeRow.colorHex = STATIC_THEMES.light;
      themeRow.label = this.capitalizeFirst("light");
    }

    await this.themeRepo.save(themeRow);

    return removed;
  }
}

/** utility: check if a themeId corresponds to a static theme */
function StaticThemeHas(id?: string) {
  if (!id) return false;
  return Object.prototype.hasOwnProperty.call(STATIC_THEMES, id);
}
