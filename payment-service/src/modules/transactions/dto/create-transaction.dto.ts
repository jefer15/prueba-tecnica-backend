import { IsDecimal, IsEnum, IsNotEmpty, IsOptional, IsPositive, IsUUID, IsObject } from 'class-validator';
import { TransactionCurrency, TransactionType } from '@prisma/client';

export class CreateTransactionDto {
  @IsUUID()
  merchant_id: string;

  @IsPositive()
  amount: number;

  @IsEnum(TransactionCurrency)
  currency: TransactionCurrency;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
