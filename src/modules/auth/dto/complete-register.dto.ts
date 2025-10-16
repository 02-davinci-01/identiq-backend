import {
  IsAlphanumeric,
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  MinLength,
} from "class-validator";

export class CompleteRegisterDTO {
  @IsString()
  @IsEmail()
  email: string;

  @Length(2, 128)
  @IsAlphanumeric()
  @IsNotEmpty()
  password: string;
}
