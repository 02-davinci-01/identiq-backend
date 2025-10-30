// src/modules/themes/dto/update-theme.dto.ts
export class UpdateThemeDto {
  // Either user chooses theme by id:

  themeId: string;

  label: string;

  // Or they provide custom color hex override:
  colorHex: string;
}
