import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 仅用于本地开发联调；生产环境必须接入正式 JWT/Session。 */
@Injectable()
export class DevIdentityGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new UnauthorizedException('尚未配置生产环境身份认证');
    }
    const request = context.switchToHttp().getRequest();
    const userId = request.headers['x-dev-user-id'];
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new UnauthorizedException('开发环境请提供 X-Dev-User-Id 请求头');
    }
    request.user = { id: userId.trim() };
    return true;
  }
}