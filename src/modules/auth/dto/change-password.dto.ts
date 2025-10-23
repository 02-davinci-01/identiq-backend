export class ChangePasswordDto {
  oldPassword!: string;
  password!: string;
}

//old credential guard -- if the data entered is the same as the preivous data then no need to process this.
