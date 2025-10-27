// src/modules/themes/themes.controller.ts
import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  BadRequestException,
  UseGuards,
  Logger,
} from "@nestjs/common";
import { ThemeService } from "./themes.service";
import { CurrentUser } from "../common/decorator/current-user-decorator";
import { UpdateThemeDto } from "./dto/update-theme.dto";
import { CreateCustomThemeDto } from "./dto/create-custom-theme.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth-guard";

@Controller("themes")
@UseGuards(JwtAuthGuard)
export class ThemesController {
  private readonly logger = new Logger(ThemesController.name);

  constructor(private readonly themesService: ThemeService) {}

  @Get("me")
  async getMyTheme(@CurrentUser() jwt) {
    try {
      const email = jwt?.email;
      if (!email) throw new BadRequestException("No email in token");
      const theme = await this.themesService.getByEmail(email);
      return theme;
    } catch (err) {
      this.logger.error("GET /themes/me failed", err);
      throw err;
    }
  }

  /**
   * Patch selected theme.
   * Accepts { themeId?: string, colorHex?: string }.
   * If themeId corresponds to a known static theme, server will persist canonical hex for that theme.
   */
  @Patch()
  async updateMyTheme(@CurrentUser() jwt, @Body() dto: UpdateThemeDto) {
    try {
      const email = jwt?.email;
      if (!email) throw new BadRequestException("No email in token");
      const updated = await this.themesService.updateByEmail(email, {
        themeId: dto.themeId,
        colorHex: dto.colorHex,
      });
      return { ok: true, theme: updated };
    } catch (err) {
      this.logger.error("PATCH /themes failed", err);
      throw err;
    }
  }

  /**
   * POST /themes/custom
   * Body: { hex: string, label?: string, themeId?: string }
   */
  @Post("custom")
  async createCustomTheme(
    @CurrentUser() jwt,
    @Body() dto: CreateCustomThemeDto,
  ) {
    try {
      const email = jwt?.email;
      if (!email) throw new BadRequestException("No email in token");
      const result = await this.themesService.createCustomTheme(email, dto);
      return { ok: true, item: result.item, themeRow: result.themeRow };
    } catch (err) {
      this.logger.error("POST /themes/custom failed", err);
      throw err;
    }
  }

  /**
   * DELETE /themes/custom/:hex
   */
  @Delete("custom/:hex")
  async deleteCustomTheme(@CurrentUser() jwt, @Param("hex") hex: string) {
    try {
      const email = jwt?.email;
      if (!email) throw new BadRequestException("No email in token");
      const removed = await this.themesService.removeCustomTheme(email, hex);
      return { ok: true, removed };
    } catch (err) {
      this.logger.error("DELETE /themes/custom/:hex failed", err);
      throw err;
    }
  }

  @Get("custom")
  async listCustomThemes(@CurrentUser() jwt) {
    try {
      const email = jwt?.email;
      if (!email) throw new BadRequestException("No email in token");
      const items = await this.themesService.getCustomThemes(email);
      return { ok: true, items };
    } catch (err) {
      this.logger.error("GET /themes/custom failed", err);
      throw err;
    }
  }
}
