import { Body, Controller, Get, Post } from '@nestjs/common';
import { MerchantsService } from './merchants.service';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@Controller('merchants')
export class MerchantsController {
  constructor(private service: MerchantsService) {}

  @Post()
  async create(@Body() dto: CreateMerchantDto) {
    return this.service.create(dto);
  }

  @Get()
  async list() {
    return this.service.findAll();
  }
}
