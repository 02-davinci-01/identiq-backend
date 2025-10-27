// src/modules/themes/themes.controller.ts
import {
  Controller,
  Get,
  Patch,
  Body,
  BadRequestException,
} from "@nestjs/common";
import { ThemeService } from "./themes.service";
import { CurrentUser } from "../common/decorator/current-user-decorator";
import { UpdateThemeDto } from "./dto/update-theme.dto";

@Controller("themes")
export class ThemesController {
  constructor(private readonly themesService: ThemeService) {}

  // GET /themes/me
  @Get("me")
  async getMyTheme(@CurrentUser() jwt) {
    const email = jwt?.email;
    if (!email) throw new BadRequestException("No email in token");
    const theme = await this.themesService.getByEmail(email);
    return theme;
  }

  // PATCH /themes
  @Patch()
  async updateMyTheme(@CurrentUser() jwt, @Body() dto: UpdateThemeDto) {
    const email = jwt?.email;
    if (!email) throw new BadRequestException("No email in token");
    return await this.themesService.updateByEmail(email, {
      themeId: dto.themeId,
      colorHex: dto.colorHex,
    });
  }
}
