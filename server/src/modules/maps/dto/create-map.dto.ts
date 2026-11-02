import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
export class CreateMapDto {
  @IsString() @MaxLength(80) slug: string;
  @IsString() @MaxLength(160) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @IsIn(['campus-local']) coordinateSystem?: string;
  @IsOptional() @IsString() @IsIn(['pixel','meter','local-unit']) coordinateUnit?: string;
  @IsOptional() @IsNumber() @Min(0.001) canvasWidth?: number;
  @IsOptional() @IsNumber() @Min(0.001) canvasHeight?: number;
}