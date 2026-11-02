import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** PostgreSQL BIGINT 路径参数校验；保留字符串，避免 JavaScript number 精度损失。 */
@Injectable()
export class ParseBigIntIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new BadRequestException('ID 必须是正整数');
    }
    return value;
  }
}
