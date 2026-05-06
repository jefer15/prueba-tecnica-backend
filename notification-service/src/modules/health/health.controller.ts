import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    let database: 'connected' | 'disconnected' = 'connected'

    try {
      await this.prisma.$queryRaw`SELECT 1`
    } catch {
      database = 'disconnected'
    }

    const payload = {
      status: database === 'connected' ? 'ok' : 'error',
      service: 'notification-service',
      uptime: Math.floor(process.uptime()),
      database,
      timestamp: new Date().toISOString(),
    }

    if (database === 'disconnected') {
      throw new HttpException(payload, HttpStatus.SERVICE_UNAVAILABLE)
    }

    return payload
  }
}
