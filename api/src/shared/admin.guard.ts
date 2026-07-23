import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { gatewayConfig } from './config';

/**
 * AdminGuard — gates the account-management surface so only the AdminConsole
 * (holding the admin token) can read or control user account info.
 *
 * The console sends the token as `x-admin-token: <token>` or
 * `Authorization: Bearer <token>`, matched against `ADMIN_API_TOKEN`
 * (config.adminApiToken). This is deliberately simple, token-based backend
 * access — no user-facing auth — consistent with the existing worker/internal
 * token pattern. Rotate ADMIN_API_TOKEN in any real deployment.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = this.tokenFrom(request);
    const expected = gatewayConfig().adminApiToken;
    if (!expected) throw new UnauthorizedException('Admin access is not configured.');
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Valid admin token required for account access.');
    }
    return true;
  }

  private tokenFrom(request: any): string | null {
    const header = request?.headers || {};
    const direct = header['x-admin-token'];
    if (typeof direct === 'string' && direct) return direct;
    const auth = header['authorization'];
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    return null;
  }
}
