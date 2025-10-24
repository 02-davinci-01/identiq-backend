import { IsEmail, IsString } from "class-validator";

export class ConfirmEmailChangeDto {
  @IsString()
  token: string;

  @IsEmail()
  email: string;
}
