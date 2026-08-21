import { User } from '@prisma/client';
import { UserDto } from '@labtrack/shared';

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
