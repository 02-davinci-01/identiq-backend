import {
  IsAlphanumeric,
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  MinLength,
} from "class-validator";

export class CompleteRegisterDTO {
  @Length(2, 128)
  @IsAlphanumeric()
  @IsNotEmpty()
  password: string;
}
