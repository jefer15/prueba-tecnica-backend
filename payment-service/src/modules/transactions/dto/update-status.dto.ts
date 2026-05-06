import { IsEnum } from 'class-validator';
import { TransactionStatus } from '@prisma/client';

export class UpdateStatusDto {
  @IsEnum(TransactionStatus)
  status: TransactionStatus;
}
