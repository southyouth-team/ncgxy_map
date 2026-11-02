import { IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateFeatureDto {
  @IsInt()
  @Min(1)
  revision: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsObject()
  geometry?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;
}
