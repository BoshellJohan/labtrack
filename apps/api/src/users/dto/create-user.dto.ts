import { IsIn, IsString, Matches, MinLength } from 'class-validator';
import { Role } from '../../prisma/client';

export class CreateUserDto {
  @IsString()
  @Matches(/^[a-z0-9._-]{3,32}$/, {
    message: 'username must be 3-32 lowercase characters',
  })
  username!: string;

  @IsString()
  @MinLength(3)
  fullName!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsIn(['ADMIN', 'USER'])
  role!: Role;
}
