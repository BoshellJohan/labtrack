import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Role } from '../../prisma/client';
import { RequestWithUser } from '../types/request-with-user';

export interface AuthenticatedUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<RequestWithUser>()
      .user as AuthenticatedUser,
);
