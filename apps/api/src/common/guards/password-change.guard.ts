import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { RequestWithUser } from '../types/request-with-user';

const ALLOWED_PATHS = ['/auth/me', '/auth/password'];

@Injectable()
export class PasswordChangeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user?.mustChangePassword) {
      return true;
    }
    if (ALLOWED_PATHS.includes(request.path)) {
      return true;
    }
    throw new ForbiddenException('Password change required');
  }
}
