import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { NotificationsService } from './notifications.service'

@Processor('transactions')
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name)

  constructor(private notificationsService: NotificationsService) {
    super()
  }

  async process(job: Job) {
    const { transactionId, merchantId, status } = job.data

    if (!transactionId || !merchantId || !status) {
      this.logger.warn(`Job ${job.id} con datos incompletos, ignorando: ${JSON.stringify(job.data)}`)
      return
    }

    try {
      await this.notificationsService.create({
        transactionId,
        merchantId,
        eventType: `transaction.${status}`,
        payload: job.data,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      this.logger.error(`Error procesando job ${job.id}: ${message}`, stack)
      throw error
    }
  }
}
