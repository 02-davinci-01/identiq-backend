import {IsOptional,IsString} from "class-validator"

export class UpdateUserThemeDTO{
    @IsOptional()
    @IsString()
    themeId?:string

    @IsOptional()
    @IsString()
    colorHex?:string
}