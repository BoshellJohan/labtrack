import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

const ALLOWED_PATHS = ['/auth/me', '/auth/password'];

@Injectable()
export class PasswordChangeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;

    if (!user?.mustChangePassword) {
      return true;
    }
    if (ALLOWED_PATHS.includes(request.path)) {
      return true;
    }
    throw new ForbiddenException('Password change required');
  }
}
