import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
import { Theme } from "./entities/theme.entity";
import { CreateCustomThemeDto } from "./dto/create-custom-theme.dto";
import { UpdateThemeDto } from "./dto/update-theme.dto";
import { User } from "../users/entities/user.entity";
import ntc from "ntcjs";

@Injectable()
export class ThemeService {
  private readonly logger = new Logger(ThemeService.name);

  constructor(
    @InjectRepository(Theme)
    private readonly themeRepo: Repository<Theme>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  private normalizeHex(hex: string): string | null {
    if (!hex) return null;
    const v = hex.trim().toUpperCase();
    const maybe = v.startsWith("#") ? v : `#${v}`;
    if (/^#([0-9A-F]{6})$/i.test(maybe)) return maybe.toUpperCase();
    return null;
  }

  // Normalize hex to #RRGGBB (uppercase) or null

  // Derive theme meta (themeId, label, colorHex) from a hex.
  deriveThemeMeta(hexInput: string) {
    const hex = this.normalizeHex(hexInput) ?? hexInput;
    let themeId: string;
    let label: string;

    try {
      // try to use ntcjs if installed
      // eslint-disable-next-line @typescript-eslint/no-var-requires

      if (ntc && typeof ntc.name === "function") {
        const res = ntc.name(hex);

        if (Array.isArray(res) && res.length > 0) {
          label = String(res[0] ?? hex).replace(/_/g, " ");
          themeId =
            String(label).toLowerCase().replace(/\s+/g, "-") ||
            hex.replace("#", "").toLowerCase();
          return { themeId, label, colorHex: hex.toUpperCase() };
        }
      }
    } catch (e) {
      this.logger.debug(
        "ntcjs not available or failed, using fallback deriveThemeMeta",
      );
    }

    const hexOnly = hex.replace("#", "").toLowerCase();
    label = `Hex${hexOnly.toUpperCase()}`;
    themeId = hexOnly;
    return { themeId, label, colorHex: hex.toUpperCase() };
  }

  // Get theme row for an email
  async getByEmail(email: string): Promise<Theme | null> {
    if (!email) return null;
    const lower = email.toLowerCase();
    const row = await this.themeRepo.findOne({ where: { email: lower } });
    return row ?? null;
  }

  // Create default (light) for an email if missing
  async createDefaultForEmail(email: string): Promise<Theme> {
    if (!email) throw new Error("email required");
    const lower = email.toLowerCase();
    const existing = await this.getByEmail(lower);
    if (existing) return existing;
    const row = this.themeRepo.create({
      email: lower,
      themeId: "light",
      label: "Light",
      colorHex: "#C96A2B",
      customThemes: [],
    } as Partial<Theme>);
    return this.themeRepo.save(row as Theme);
  }

  /**
   * Update user's canonical theme.
   * Accepts payload with colorHex (preferred) or themeId.
   * Resolves themeId+label on backend when colorHex provided.
   */
  async updateByEmail(
    email: string,
    payload: { themeId: string; label: string; colorHex: string },
  ): Promise<Theme> {
    if (!email) throw new Error("email required");
    const lower = email.toLowerCase();

    let row = await this.themeRepo.findOne({ where: { email: lower } });
    if (!row) {
      row = this.themeRepo.create({
        email: lower,
        customThemes: [],
      } as Partial<Theme>);
    }

    if (payload.colorHex) {
      const normalized = this.normalizeHex(payload.colorHex);
      if (!normalized) throw new Error("Invalid colorHex");

      row.colorHex = normalized;
      row.themeId = payload.themeId;
      row.label = payload.label;
    } else if (payload.themeId) {
      row.themeId = payload.themeId;
      const staticMap: Record<string, { colorHex: string; label: string }> = {
        light: { colorHex: "#C96A2B", label: "Light" },
        teal: { colorHex: "#2F6F66", label: "Teal" },
        dark: { colorHex: "#000000", label: "Dark" },
      };
      const stat = staticMap[payload.themeId];
      if (stat) {
        row.colorHex = stat.colorHex;
        row.label = stat.label;
      } else {
        row.label = row.label ?? payload.themeId;
      }
    }

    const userData = await this.userRepo.findOne({ where: { email: lower } });
    userData!.colorHex = row.colorHex;
    await this.userRepo.save(userData!);

    row.customThemes = row.customThemes ?? [];
    const saved = await this.themeRepo.save(row as Theme);
    return saved;
  }

  // Create custom theme (adds to user's customThemes list)
  async createCustomTheme(email: string, dto: CreateCustomThemeDto) {
    if (!email) throw new BadRequestException("email required");
    if (!dto || !dto.hex)
      throw new BadRequestException("hex required in payload");

    // normalize + validate hex
    const normalized = this.normalizeHex(dto.hex);
    if (!normalized) throw new BadRequestException("Invalid hex");

    const lower = email.toLowerCase();

    // --- Load or create theme row for user ---
    let row = await this.themeRepo.findOne({ where: { email: lower } });
    if (!row) {
      row = this.themeRepo.create({
        email: lower,
        customThemes: [],
      } as Partial<Theme>);
    }

    row.customThemes = row.customThemes ?? [];

    // --- STATIC THEME CHECK ---
    // NOTE: keep this list in sync with your frontend static themes or move this to config.
    // These are the frontend values used previously: teal, light, dark.
    const STATIC_HEXES = ["#2F6F66", "#C96A2B", "#000000"].map((h) =>
      h.toUpperCase(),
    );

    if (STATIC_HEXES.includes(normalized.toUpperCase())) {
      // If you prefer to throw, change to throw new BadRequestException(...)
      return {
        ok: false,
        message:
          "Hex matches a built-in/static theme. Choose a different color.",
        themeRow: row,
      };
    }

    // --- DUPLICATE CUSTOM CHECK (source-of-truth is hex) ---
    const exists = row.customThemes.find(
      (c: any) => String(c.hex).toUpperCase() === normalized.toUpperCase(),
    );
    if (exists) {
      return {
        ok: false,
        message: "You already have this theme.",
        item: exists,
        themeRow: row,
      };
    }

    // --- Build new item using frontend-provided themeId + label ---
    // If dto.themeId is missing, we default to label trimmed (frontend should normally provide themeId)
    const newThemeId = (dto.themeId ?? dto.label ?? "").toString().trim();
    const newLabel = (dto.label ?? dto.themeId ?? normalized).toString().trim();

    const newItem = {
      themeId: newThemeId || normalized, // fallback to normalized if nothing sensible provided
      label: newThemeId,
      hex: normalized,
      createdAt: new Date(),
    };

    // --- Update user's colorHex in userRepo (kept as-is per your request) ---
    // NOTE: this is the existing behavior; see recommendation below to make this safer/transactional.
    const userData = await this.userRepo.findOne({ where: { email: lower } });
    if (userData) {
      userData.colorHex = normalized;
      await this.userRepo.save(userData);
    }

    // Prepend new custom theme
    row.customThemes.unshift(newItem as any);

    // Save theme row
    row.label = newThemeId;
    const saved = await this.themeRepo.save(row as Theme);

    return { ok: true, item: newItem, themeRow: saved };
  }

  // helper: normalizeHex - your existing implementation assumed present

  // Remove custom theme
  async removeCustomTheme(email: string, hex: string) {
    if (!email) throw new Error("email required");
    const normalized = this.normalizeHex(hex);
    if (!normalized) throw new Error("Invalid hex");

    const lower = email.toLowerCase();
    const row = await this.themeRepo.findOne({ where: { email: lower } });
    if (!row) return { removed: false };

    row.customThemes = (row.customThemes || []).filter(
      (c: any) => String(c.hex).toUpperCase() !== normalized.toUpperCase(),
    );

    const userData = await this.userRepo.findOne({ where: { email: lower } });
    userData!.colorHex = "#C96A2B"; // reset to default on removal
    await this.userRepo.save(userData!);

    await this.themeRepo.save(row as Theme);
    return { removed: true };
  }

  // List custom themes for a user
  async getCustomThemes(email: string) {
    if (!email) throw new Error("email required");
    const row = await this.themeRepo.findOne({
      where: { email: email.toLowerCase() },
    });
    return row?.customThemes ?? [];
  }

  // Batch fetch rows by emails -> returns items in input order
  async fetchBatchByEmails(
    emails: string[],
  ): Promise<Array<{ email: string; theme: Theme | null }>> {
    const uniq = Array.from(
      new Set(
        (emails || []).filter(Boolean).map((e) => String(e).toLowerCase()),
      ),
    );
    if (uniq.length === 0) return [];
    const rows = await this.themeRepo.find({ where: { email: In(uniq) } });
    const map = new Map<string, Theme>();
    rows.forEach((r) => map.set(String(r.email).toLowerCase(), r));
    return uniq.map((em) => ({ email: em, theme: map.get(em) ?? null }));
  }

  // Distribution counts (label -> count)
  async getDistributionCounts(): Promise<Record<string, number>> {
    try {
      const qb = this.themeRepo
        .createQueryBuilder("t")
        .select("COALESCE(t.label, t.themeId, t.colorHex)", "label")
        .addSelect("COUNT(*)", "count")
        .groupBy("COALESCE(t.label, t.themeId, t.colorHex)");

      const raw = await qb.getRawMany();
      const out: Record<string, number> = {};
      for (const r of raw) {
        const label = String(r.label ?? "").trim() || "Unknown";
        out[label] = (out[label] ?? 0) + Number(r.count ?? 0);
      }
      return out;
    } catch (err) {
      this.logger.warn(
        "DB aggregation failed, falling back to in-memory aggregation",
      );
    }

    const all = await this.themeRepo.find();
    const map = new Map<string, number>();
    for (const r of all) {
      const key = (r.label ?? r.themeId ?? r.colorHex ?? "Unknown").toString();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const out: Record<string, number> = {};
    for (const [k, v] of map.entries()) out[k] = v;
    return out;
  }
}
