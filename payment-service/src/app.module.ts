import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { PrismaModule } from './prisma/prisma.module'
import { MerchantsModule } from './merchants/merchants.module'
import { TransactionsModule } from './transactions/transactions.module'
import { SettlementsModule } from './settlements/settlements.module'
import { HealthModule } from './health/health.module'

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    PrismaModule,
    MerchantsModule,
    TransactionsModule,
    SettlementsModule,
    HealthModule,
    HealthModule
  ],
})
export class AppModule {}