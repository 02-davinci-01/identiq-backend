import {IsString,IsEmail,  MinLength} from "class-validator"

export class RegisterUserDTO{
    @IsString()
    @MinLength(2)//minimum length should be 2
    name:string

    @IsString()
    @IsEmail()
    email:string
}