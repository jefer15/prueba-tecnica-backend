import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { PrismaModule } from './modules/prisma/prisma.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { HealthModule } from './modules/health/health.module'

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    PrismaModule,
    NotificationsModule,
    HealthModule,
  ],
})
export class AppModule {}