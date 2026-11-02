import { IsOptional, IsString, MaxLength } from 'class-validator';
export class CreateCampusDto {
  @IsString() @MaxLength(80) slug: string;
  @IsString() @MaxLength(160) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
}