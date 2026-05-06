# ARCHITECTURE.md

## Diagrama del sistema

```
                        ┌─────────────────────────────────────┐
                        │          api-gateway :3000           │
                        │  Express + TypeScript                │
                        │                                      │
                        │  ┌─────────────────────────────┐    │
     Cliente ──────────▶│  │ loggingMiddleware            │    │
                        │  │ rateLimitMiddleware (100/min) │    │
                        │  │ authMiddleware (JWT | apikey) │    │
                        │  │ proxyMiddleware               │    │
                        │  │   ├─ CircuitBreaker payment   │    │
                        │  │   └─ CircuitBreaker notif.    │    │
                        │  └─────────────────────────────┘    │
                        └──────────────┬──────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │ /api/v1/transactions   │ /api/v1/notifications  │
              │ /api/v1/settlements    │                        │
              ▼                        │                        │
┌─────────────────────────┐            ▼                        │
│   payment-service :3001  │  ┌─────────────────────────┐      │
│   NestJS + Prisma        │  │ notification-service:3002│      │
│                          │  │ NestJS + Prisma          │      │
│  modules/                │  │                          │      │
│  ├─ merchants (@public)  │  │ modules/                 │      │
│  ├─ transactions         │  │ ├─ notifications          │      │
│  ├─ settlements          │  │ └─ health                 │      │
│  └─ health               │  └──────────────────────────┘      │
└──────────┬───────────────┘           │                        │
           │                           │                        │
           │  publica evento           │  consume evento        │
           │  al cambiar status        │                        │
           ▼                           ▼                        │
     ┌──────────────┐          ┌──────────────┐                 │
     │  Redis :6379 │─────────▶│  Redis :6379 │◀────────────────┘
     └──────────────┘          └──────────────┘
           │                           │
           ▼                           ▼
     ┌──────────────────────────────────────┐
     │           PostgreSQL :5432           │
     │                                      │
     │  Schema payment-service:             │
     │  ├─ merchants                        │
     │  ├─ transactions                     │
     │  ├─ settlements                      │
     │  └─ settlement_transactions (pivot)  │
     │                                      │
     │  Schema notification-service:        │
     │  └─ notifications                    │
     └──────────────────────────────────────┘
```

## Circuit breaker — estados

```
         5 fallos
  CLOSED ──────────▶ OPEN
    ▲                  │
    │                  │ 30 segundos
    │                  ▼
    └──────────── HALF_OPEN
      prueba exitosa
```

| Estado    | Comportamiento                                              |
|-----------|-------------------------------------------------------------|
| CLOSED    | Requests pasan normalmente. Cuenta fallos consecutivos.     |
| OPEN      | Rechaza todo con 503. Espera 30s antes de probar de nuevo.  |
| HALF_OPEN | Permite una sola request de prueba. Si pasa → CLOSED.       |

El gateway tiene un circuit breaker independiente por servicio downstream (payment y notification).

## Estrategia de comunicación entre servicios

### payment-service → notification-service: Redis pub/sub

Al cambiar el estado de una transacción (`PATCH /transactions/:id/status`), el payment-service publica un evento en un canal de Redis. El notification-service tiene un subscriber activo que consume el evento y persiste la notificación en su propia tabla en PostgreSQL.

**Por qué Redis y no HTTP:**
- **Desacoplamiento real:** el payment-service no sabe si el notification-service está disponible. El evento queda en el canal y se procesa cuando el consumidor está listo.
- **No bloquea la respuesta:** la publicación en Redis es fire-and-forget. El cliente recibe la respuesta del PATCH sin esperar que la notificación se procese.
- **Sin dependencia circular:** si el notification-service cae, el payment-service sigue funcionando sin errores.

**Trade-offs:**
- Redis pub/sub no garantiza entrega si el subscriber está caído en el momento de la publicación (a diferencia de una queue persistente como BullMQ).
- Para garantía at-least-once en producción, se usaría BullMQ con Redis Streams.

### api-gateway → servicios: HTTP con circuit breaker

El gateway actúa como proxy transparente. Cada servicio downstream tiene su propio circuit breaker con 5 fallos de umbral y 30 segundos de recuperación.

**Por qué HTTP y no RPC/gRPC:**
- Simplicidad: los servicios ya exponen REST, no requieren contratos adicionales.
- El circuit breaker mitiga los efectos cascada de fallos en servicios downstream.

## Modelado de datos

### Por qué dos schemas de Prisma separados

El payment-service y el notification-service comparten la misma instancia de PostgreSQL pero cada uno gestiona sus propias tablas. Esto refleja la separación de responsabilidades: un servicio no puede escribir directamente en las tablas del otro.

### Decisión: Decimal vs Float para amounts

Se usó `Decimal(12,2)` para `amount` y `Decimal(14,2)` para `total_amount`. Los tipos Float en PostgreSQL tienen errores de precisión en operaciones financieras (ej: `0.1 + 0.2 = 0.30000000000000004`). Decimal garantiza precisión exacta.

### Índice compuesto en transactions

```sql
INDEX idx_transactions_merchant_status_date ON transactions(merchant_id, status, created_at)
```

El query más frecuente del sistema es "dame las transacciones aprobadas de un merchant en un rango de fechas" (usado en la generación de settlements). El índice compuesto cubre exactamente ese patrón.

## Propuesta de escalabilidad a 10.000 TPS

### Cuello de botella principal: PostgreSQL

A 10k TPS el cuello de botella es la base de datos. Estrategia:

1. **Connection pooling:** PgBouncer en modo transaction delante de PostgreSQL. Reduce las conexiones activas de cientos a decenas.
2. **Réplicas de lectura:** los queries de listado y filtrado van a réplicas. Solo escrituras van al primario.
3. **Particionado:** la tabla `transactions` se particiona por `created_at` (rango mensual). Las queries de settlements solo tocan la partición del período.
4. **Archivado:** datos con más de 12 meses se mueven a cold storage (S3 + Athena para consultas históricas).

### api-gateway: estado compartido

El rate limiter actual usa `Map` en memoria — no funciona con múltiples instancias. Migrar a Redis con `INCR` y `EXPIRE` para ventana deslizante compartida entre instancias.

### Notificaciones: BullMQ + Redis Streams

Reemplazar Redis pub/sub por BullMQ para:
- Persistencia de eventos (si el consumidor cae, los eventos no se pierden)
- Reintentos con backoff exponencial
- Dead-letter queue para eventos fallidos
- Múltiples workers en paralelo

### Infraestructura

```
Internet → ALB → api-gateway (N instancias, HPA en K8s)
                      │
         ┌────────────┴────────────┐
         ▼                         ▼
  payment-service            notification-service
  (N instancias)             (N workers BullMQ)
         │                         │
         └────────────┬────────────┘
                      ▼
              PgBouncer → PostgreSQL
              (primario + réplicas)
```