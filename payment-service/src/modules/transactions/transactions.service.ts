import { Injectable, UnprocessableEntityException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { v4 as uuidv4 } from 'uuid';

const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002';

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['approved', 'rejected', 'failed'],
  approved: ['completed', 'failed'],
};

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

  private async generateReference() {
    const date = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const random = Math.random().toString(36).substring(2,8).toUpperCase();
    return `TXN-${date}-${random}`;
  }

  async create(dto: CreateTransactionDto) {
    // ensure merchant exists
    const merchant = await this.prisma.merchant.findUnique({ where: { id: dto.merchant_id } });
    if (!merchant) throw new NotFoundException('Merchant not found');

    // create unique reference, retry on conflict
    let reference = await this.generateReference();
    let attempts = 0;
    while (attempts < 5) {
      try {
        const tx = await this.prisma.transaction.create({
          data: {
            merchant_id: dto.merchant_id,
            amount: dto.amount as any,
            currency: dto.currency,
            type: dto.type,
            status: 'pending',
            reference,
            metadata: dto.metadata,
          },
        });
        return tx;
      } catch (err) {
        // collision on reference or other issue
        reference = await this.generateReference();
        attempts++;
      }
    }
    throw new UnprocessableEntityException('Could not generate unique reference');
  }

  async findAll(query: any) {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(100, parseInt(query.limit) || 20);
    const skip = (page - 1) * limit;
    const where: any = {};
    if (query.merchant_id) where.merchant_id = query.merchant_id;
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.date_from || query.date_to) where.created_at = {};
    if (query.date_from) where.created_at.gte = new Date(query.date_from);
    if (query.date_to) where.created_at.lte = new Date(query.date_to);

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({ where, skip, take: limit, orderBy: { created_at: 'desc' } }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOne(id: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id } });
    if (!tx) throw new NotFoundException('Transaction not found');
    return tx;
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    const tx = await this.prisma.transaction.findUnique({ where: { id } });
    if (!tx) throw new NotFoundException('Transaction not found');

    const allowed = VALID_TRANSITIONS[tx.status] || [];
    if (!allowed.includes(dto.status)) {
      throw new UnprocessableEntityException(`Transicion de estado invalida: no se puede cambiar de '${tx.status}' a '${dto.status}'`);
    }

    const updated = await this.prisma.transaction.update({ where: { id }, data: { status: dto.status } });

    // emit notification to notification-service (best-effort)
    try {
      const event = {
        transaction_id: updated.id,
        merchant_id: updated.merchant_id,
        event_type: `transaction.${updated.status}`,
        payload: updated,
      };
      // node 18+ has global fetch
      await fetch(`${NOTIFICATION_URL}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch (err) {
      console.warn('Failed to notify notification-service', err);
    }

    return updated;
  }
}
