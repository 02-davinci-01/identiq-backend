import {
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
  @IsNotEmpty()
  password: string;
}
