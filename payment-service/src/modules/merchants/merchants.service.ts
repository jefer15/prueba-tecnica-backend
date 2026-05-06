import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class MerchantsService {
  constructor(private prisma: PrismaService) {}

  private generateApiKey() {
    return randomBytes(16).toString('hex');
  }

  async create(dto: CreateMerchantDto) {
    const api_key = this.generateApiKey();
    const merchant = await this.prisma.merchant.create({
      data: {
        name: dto.name,
        email: dto.email,
        api_key,
        status: dto.status || 'active',
      },
    });
    return merchant;
  }

  async findAll() {
    return this.prisma.merchant.findMany({ orderBy: { created_at: 'desc' } });
  }
}
