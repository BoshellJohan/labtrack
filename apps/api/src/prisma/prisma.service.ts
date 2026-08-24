import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './client';
import { Env } from '../config/env';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  // Prisma 7 connects through a driver adapter rather than its own engine pool,
  // so the connection string is handed to node-postgres here. Taking it from
  // ConfigService rather than letting the driver read process.env keeps the
  // value the one parseEnv already validated, and makes the dependency visible
  // in the constructor.
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
}
