import {
  BadRequestException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginResponse, UserDto } from '@labtrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toUserDto } from '../common/mappers/user.mapper';
import { PasswordService } from './password.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });

    // Same exception for a missing user, a wrong password and a deactivated
    // account, so login never reveals which check failed.
    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!(await this.passwords.verify(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      role: user.role,
    });

    return { accessToken, user: toUserDto(user) };
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // The token is valid but its subject is gone: that is a session problem,
    // so it keeps the 401.
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // A wrong current password is a form error, not an invalid session. A 401
    // here would be read by the client interceptor as an expired token and
    // would log the user out on a typo, so it is a coded 400 instead.
    if (
      !(await this.passwords.verify(dto.currentPassword, user.passwordHash))
    ) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'INVALID_CURRENT_PASSWORD',
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.passwords.hash(dto.newPassword),
        mustChangePassword: false,
      },
    });
  }

  async findProfile(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return toUserDto(user);
  }
}
