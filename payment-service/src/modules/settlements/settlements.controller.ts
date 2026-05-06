import { Body, Controller, Get, Param, Post, BadRequestException, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IsISO8601, IsNotEmpty, IsUUID } from 'class-validator';
import { SettlementsService } from './settlements.service';

class GenerateDto {
  @IsUUID()
  @IsNotEmpty()
  merchant_id: string;

  @IsISO8601()
  @IsNotEmpty()
  period_start: string;

  @IsISO8601()
  @IsNotEmpty()
  period_end: string;
}

@Controller('settlements')
export class SettlementsController {
  constructor(private service: SettlementsService) {}

  @Post('generate')
  async generate(@Req() req: Request, @Body() body: GenerateDto) {
    console.log('[PaymentService][Settlements] incoming headers:', req.headers);
    console.log('[PaymentService][Settlements] incoming body:', body);
    const { merchant_id, period_start, period_end } = body || {} as GenerateDto;
    if (!merchant_id) throw new BadRequestException('merchant_id is required');
    if (!period_start || !period_end) throw new BadRequestException('period_start and period_end are required');
    const start = new Date(period_start);
    const end = new Date(period_end);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new BadRequestException('Invalid period_start or period_end date');
    return this.service.generate(merchant_id, start, end);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
