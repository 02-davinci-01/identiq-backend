export class UserResponseDto {
  id: string;
  email: string;
  name:string

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
