import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './client';
import { Env } from '../config/env';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
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

  // Prisma 7's driver adapter owns the underlying pg Pool itself; nothing
  // closes it unless something calls $disconnect(). Without this hook,
  // app.close() (as every e2e suite's afterAll does) tore down the Nest
  // app but left each suite's pool open, which is why the e2e run printed
  // "Jest did not exit" — an open socket per suite kept the process alive.
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
