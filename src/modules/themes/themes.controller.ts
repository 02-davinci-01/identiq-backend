import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { ThemeService } from "./themes.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth-guard";
import { CurrentUser } from "../common/decorator/current-user-decorator";
import { CreateCustomThemeDto } from "./dto/create-custom-theme.dto";
import { UpdateThemeDto } from "./dto/update-theme.dto";

@UseGuards(JwtAuthGuard)
@Controller("themes")
export class ThemesController {
  private readonly logger = new Logger(ThemesController.name);

  constructor(private readonly themeService: ThemeService) {}

  @Get("me")
  async getMyTheme(@CurrentUser() user: any) {
    const email = user?.email;
    if (!email) throw new BadRequestException("No email in token");
    let row = await this.themeService.getByEmail(email);
    if (!row) {
      row = await this.themeService.createDefaultForEmail(email);
    }
    return { ok: true, theme: row };
  }

  @Patch()
  async patchMyTheme(@CurrentUser() user: any, @Body() dto: UpdateThemeDto) {
    const email = user?.email;
    if (!email) throw new BadRequestException("No email in token");
    if (!dto.colorHex && !dto.themeId) {
      throw new BadRequestException("Either colorHex or themeId required");
    }
    const saved = await this.themeService.updateByEmail(email, {
      themeId: dto.themeId,
      label: dto.label,
      colorHex: dto.colorHex,
    });
    return { ok: true, theme: saved };
  }

  @Post("custom")
  async createCustom(
    @CurrentUser() user: any,
    @Body() dto: CreateCustomThemeDto,
  ) {
    const email = user?.email;
    if (!email) throw new BadRequestException("No email in token");
    const result = await this.themeService.createCustomTheme(email, dto);
    return { ok: true, item: result.item };
  }

  @Delete("custom/:hex")
  async deleteCustom(@CurrentUser() user: any, @Param("hex") hex: string) {
    const email = user?.email;
    if (!email) throw new BadRequestException("No email in token");
    const normalized = hex.startsWith("#") ? hex : `#${hex}`;
    const result = await this.themeService.removeCustomTheme(email, normalized);
    return { ok: true, removed: result.removed };
  }

  @Get("custom")
  async listCustom(@CurrentUser() user: any) {
    const email = user?.email;
    if (!email) throw new BadRequestException("No email in token");
    const items = await this.themeService.getCustomThemes(email);
    return { ok: true, items };
  }

  @Get("by-email")
  async byEmail(@Query("email") email?: string) {
    if (!email) throw new BadRequestException("email query required");
    const row = await this.themeService.getByEmail(email);
    return { ok: true, theme: row };
  }

  @Post("batch")
  async batch(@Body() body: { emails?: string[] }) {
    const emails = Array.isArray(body?.emails) ? body.emails.map(String) : [];
    if (emails.length === 0) return { ok: true, items: [] };
    const items = await this.themeService.fetchBatchByEmails(emails);
    return { ok: true, items };
  }

  @Get("distribution-counts")
  async distributionCounts() {
    try {
      // service returns: { ok: true, items: Array<{ label, count, colorHex }> }
      const svcRes = await this.themeService.getDistributionCounts();

      // defensive: ensure we have items array
      const items =
        svcRes && Array.isArray((svcRes as any).items)
          ? (svcRes as any).items
          : [];

      // build legacy counts map: label -> count
      const counts: Record<string, number> = {};
      for (const it of items) {
        const lbl = String(it.label ?? "Unknown");
        counts[lbl] = (counts[lbl] ?? 0) + Number(it.count ?? 0);
      }

      // Return both canonical and legacy shapes for maximum compatibility
      return { ok: true, items, counts };
    } catch (err) {
      this.logger.warn("distribution-counts failed: " + (err?.message ?? err));
      return { ok: false, items: [], counts: {} };
    }
  }
}
