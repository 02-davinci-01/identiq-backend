// delete-user.dto.ts
import { IsEmail, IsString } from 'class-validator';

export class DeleteUserDto {
  @IsEmail()
  email!: string;
}
