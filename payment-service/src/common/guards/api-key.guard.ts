import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common'
import { Merchant } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

interface CacheEntry {
  merchant: Merchant
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL = 60_000 // 1 minuto

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const apiKey = request.headers['x-api-key'] as string | undefined

    if (!apiKey) {
      throw new UnauthorizedException('API key requerida')
    }

    const cached = cache.get(apiKey)
    if (cached && cached.expiresAt > Date.now()) {
      request.merchant = cached.merchant
      return true
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { api_key: apiKey },
    })

    if (!merchant) {
      console.warn(`[auth] Intento con API key invalida: ${apiKey.slice(0, 8)}...`)
      throw new UnauthorizedException('API key invalida')
    }

    if (merchant.status === 'inactive') {
      throw new ForbiddenException('Merchant inactivo')
    }

    cache.set(apiKey, { merchant, expiresAt: Date.now() + CACHE_TTL })
    request.merchant = merchant
    return true
  }
}
