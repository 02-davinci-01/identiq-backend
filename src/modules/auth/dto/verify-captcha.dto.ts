import { IsString } from "class-validator";

export class VerifyCaptchaDto {
  @IsString()
  token: string;

  @IsString()
  answer: string;
}
