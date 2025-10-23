// src/modules/auth/dto/reset-password.dto.ts
import {
  IsString,
  IsNotEmpty,
  MinLength,
  IsAlphanumeric,
} from "class-validator";

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @IsAlphanumeric()
  @MinLength(2)
  password!: string;
}
