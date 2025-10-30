// src/modules/themes/dto/create-custom-theme.dto.ts
import { IsOptional, IsString, Matches, Length } from "class-validator";

export class CreateCustomThemeDto {
  @IsString()
  @Length(1, 64)
  themeId: string;

  @IsString()
  @Length(1, 128)
  label: string;

  /**
   * hex - accept either `#RRGGBB` or `RRGGBB` (case-insensitive)
   */
  @IsString()
  @Matches(/^#?[0-9A-F]{6}$/i, {
    message: "hex must be a 6-digit hex string like #4287f5 or 4287f5",
  })
  hex!: string;
}
