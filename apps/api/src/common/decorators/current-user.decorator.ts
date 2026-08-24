import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Role } from '../../prisma/client';

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: Role;
  mustChangePassword: boolean;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest().user,
);
