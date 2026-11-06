import { IsInt, IsObject, Min } from 'class-validator';

export class SaveRpgMapDto {
  @IsInt()
  @Min(0)
  revision: number;

  @IsObject()
  document: Record<string, unknown>;
}
