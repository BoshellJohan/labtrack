import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  fullName?: string;

  @IsOptional()
  @IsIn(['ADMIN', 'USER'])
  role?: Role;
}
