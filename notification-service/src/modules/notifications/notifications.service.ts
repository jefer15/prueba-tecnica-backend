import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    transactionId: string
    merchantId: string
    eventType: string
    payload: object
  }) {
    return this.prisma.notification.create({
      data: {
        transactionId: data.transactionId,
        merchantId: data.merchantId,
        eventType: data.eventType,
        payload: data.payload,
        status: 'pending',
      },
    })
  }

  async findAll(merchantId: string, page = 1, limit = 20) {
    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { merchantId },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where: { merchantId } }),
    ])

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    }
  }

  async findOne(id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } })

    if (!notification) {
      throw new NotFoundException(`Notificacion con id ${id} no existe`)
    }

    return notification
  }
}
