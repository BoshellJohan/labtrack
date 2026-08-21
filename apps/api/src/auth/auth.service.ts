import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginResponse } from '@labtrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toUserDto } from '../common/mappers/user.mapper';
import { PasswordService } from './password.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });

    // Se verifica el estado y la contraseña con el mismo error para no revelar
    // si el usuario existe ni si está desactivado.
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
}
