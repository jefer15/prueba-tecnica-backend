import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class SettlementsService {
  constructor(private prisma: PrismaService) {}

  async generate(merchant_id: string, period_start: Date, period_end: Date) {
    // Find eligible transactions
    const txs = await this.prisma.transaction.findMany({
      where: {
        merchant_id,
        status: 'approved',
        created_at: { gte: period_start, lte: period_end },
      },
    });

    if (!txs.length) throw new NotFoundException('No hay transacciones elegibles para liquidacion');

    // Check none of these already belong to a settlement
    const transactionIds = txs.map(t => t.id);
    const existing = await this.prisma.settlementTransaction.findMany({ where: { transaction_id: { in: transactionIds } } });
    if (existing.length) throw new BadRequestException('Una o mas transacciones ya pertenecen a una liquidacion');

    // Create settlement atomically
    const total = txs.reduce((s, t) => s + Number(t.amount), 0);

    const result = await this.prisma.$transaction(async (prisma) => {
      const settlement = await prisma.settlement.create({
        data: {
          merchant_id,
          total_amount: total as any,
          transaction_count: txs.length,
          status: 'pending',
          period_start,
          period_end,
        },
      });

      const pivotCreates = txs.map(t => ({ settlement_id: settlement.id, transaction_id: t.id }));
      for (const p of pivotCreates) {
        await prisma.settlementTransaction.create({ data: p });
      }

      return settlement;
    });

    return result;
  }

  async findOne(id: string) {
    const s = await this.prisma.settlement.findUnique({ where: { id }, include: { settlementTransactions: { include: { transaction: true } } } });
    if (!s) throw new NotFoundException('Settlement not found');
    return s;
  }
}
