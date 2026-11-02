import { IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SaveSceneDto {
  @IsInt()
  @Min(1)
  revision: number;

  @IsString()
  @MaxLength(128)
  @IsOptional()
  name?: string;

  @IsObject()
  document: Record<string, unknown>;
}
