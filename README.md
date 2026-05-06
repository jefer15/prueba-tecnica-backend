# prueba-tecnica-backend

Sistema de gestión de pagos con arquitectura de microservicios.

## Stack

| Servicio             | Tecnología                   | Puerto |
|----------------------|------------------------------|--------|
| api-gateway          | Express + TypeScript         | 3000   |
| payment-service      | NestJS + Prisma + PostgreSQL | 3001   |
| notification-service | NestJS + Prisma + PostgreSQL | 3002   |
| postgres             | PostgreSQL 15                | 5432   |
| redis                | Redis 7                      | 6379   |

---

## Levantar el proyecto

```bash
cp .env.example .env
docker-compose up --build
```

Cuando los contenedores estén listos:
```
payment-service      | Payment service corriendo en puerto 3001
notification-service | Notification service corriendo en puerto 3002
api-gateway          | API Gateway corriendo en puerto 3000
```

---

## Variables de entorno

Los valores por defecto de `.env.example` funcionan sin modificar nada.

| Variable            | Default                     | Descripción              |
|---------------------|-----------------------------|--------------------------|
| `POSTGRES_USER`     | `pguser`                    | Usuario de PostgreSQL    |
| `POSTGRES_PASSWORD` | `pgpassword`                | Contraseña de PostgreSQL |
| `POSTGRES_DB`       | `payments_db`               | Nombre de la base datos  |
| `JWT_SECRET`        | `PRUEBA_TECNICA_SECRET_KEY` | Clave simétrica para JWT |

---

## Endpoints

### Autenticación

El api-gateway soporta dos modos:

```
x-api-key: <access_key del merchant>
Authorization: Bearer <JWT firmado con JWT_SECRET>
```

Sin credenciales → `401`. Más de 100 req/min → `429` con header `Retry-After`.

---

### Merchants — sin autenticación (directo al payment-service :3001)

| Método | Ruta             | Descripción           |
|--------|------------------|-----------------------|
| POST   | `/api/merchants` | Registrar un merchant |
| GET    | `/api/merchants` | Listar merchants      |

**Registrar:**
```bash
curl -X POST http://localhost:3001/api/merchants \
  -H "Content-Type: application/json" \
  -d '{"name": "Tienda Demo", "email": "demo@tienda.com"}'
```

```json
{
  "id":         "550e8400-e29b-41d4-a716-446655440000",
  "name":       "Tienda Demo",
  "email":      "demo@tienda.com",
  "access_key": "mk_3f9a1c2b4d5e6f7a8b9c0d1e2f3a4b5c",
  "status":     "active",
  "created_at": "2026-05-01T10:00:00.000Z",
  "updated_at": "2026-05-01T10:00:00.000Z"
}
```

> Guarda el `access_key` — es el `x-api-key` para todas las llamadas al gateway.

---

### Transactions — requieren `x-api-key` (vía api-gateway :3000)

| Método | Ruta                               | Descripción                         |
|--------|------------------------------------|-------------------------------------|
| POST   | `/api/v1/transactions`             | Crear transacción                   |
| GET    | `/api/v1/transactions`             | Listar (paginado + filtros)         |
| GET    | `/api/v1/transactions/:id`         | Detalle                             |
| PATCH  | `/api/v1/transactions/:id/status`  | Cambiar estado                      |

**Crear:**
```bash
curl -X POST http://localhost:3000/api/v1/transactions \
  -H "x-api-key: mk_3f9a1c..." \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "550e8400-e29b-41d4-a716-446655440000",
    "amount": 150.00,
    "currency": "COP",
    "type": "payin"
  }'
```

```json
{
  "id":          "uuid",
  "merchant_id": "uuid",
  "amount":      "150.00",
  "currency":    "COP",
  "type":        "payin",
  "status":      "pending",
  "reference":   "TXN-20260501-A3F8K2",
  "metadata":    null,
  "created_at":  "2026-05-01T10:00:00.000Z",
  "updated_at":  "2026-05-01T10:00:00.000Z"
}
```

**Listar con filtros:**
```bash
curl "http://localhost:3000/api/v1/transactions?status=approved&page=1&limit=20" \
  -H "x-api-key: mk_3f9a1c..."
```

| Param         | Default | Opciones                                              |
|---------------|---------|-------------------------------------------------------|
| `page`        | 1       | número                                                |
| `limit`       | 20      | número (máx 100)                                      |
| `status`      | —       | `pending` `approved` `rejected` `failed` `completed`  |
| `type`        | —       | `payin` `payout`                                      |
| `date_from`   | —       | ISO 8601                                              |
| `date_to`     | —       | ISO 8601                                              |
| `merchant_id` | —       | UUID                                                  |

```json
{
  "data": [...],
  "meta": { "total": 150, "page": 1, "limit": 20, "total_pages": 8 }
}
```

**Cambiar estado:**
```bash
curl -X PATCH http://localhost:3000/api/v1/transactions/{id}/status \
  -H "x-api-key: mk_3f9a1c..." \
  -H "Content-Type: application/json" \
  -d '{"status": "approved"}'
```

Transiciones válidas:
```
pending  ──▶  approved
pending  ──▶  rejected
pending  ──▶  failed
approved ──▶  completed
approved ──▶  failed
```

Transición inválida → `422`:
```json
{
  "statusCode": 422,
  "message":    "Transición de estado inválida: no se puede cambiar de 'rejected' a 'approved'",
  "error":      "Unprocessable Entity"
}
```

> Al aprobar/rechazar/completar una transacción, el payment-service emite un evento a Redis y el notification-service lo persiste automáticamente.

---

### Settlements — requieren `x-api-key` (vía api-gateway :3000)

| Método | Ruta                              | Descripción                      |
|--------|-----------------------------------|----------------------------------|
| POST   | `/api/v1/settlements/generate`    | Generar liquidación              |
| GET    | `/api/v1/settlements/:id`         | Detalle con transacciones        |

**Generar:**
```bash
curl -X POST http://localhost:3000/api/v1/settlements/generate \
  -H "x-api-key: mk_3f9a1c..." \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id":  "uuid-del-merchant",
    "period_start": "2026-01-01T00:00:00Z",
    "period_end":   "2026-12-31T23:59:59Z"
  }'
```

```json
{
  "id":                "uuid",
  "merchant_id":       "uuid",
  "total_amount":      "450.00",
  "transaction_count": 3,
  "status":            "pending",
  "period_start":      "2026-01-01T00:00:00.000Z",
  "period_end":        "2026-12-31T23:59:59.000Z",
  "created_at":        "2026-05-01T10:00:00.000Z"
}
```

Sin transacciones elegibles → `404`:
```json
{ "statusCode": 404, "message": "No hay transacciones elegibles para liquidacion" }
```

---

### Notifications — requieren `x-api-key` (vía api-gateway :3000)

| Método | Ruta                              | Descripción                         |
|--------|-----------------------------------|-------------------------------------|
| GET    | `/api/v1/notifications`           | Listar notificaciones de un merchant |
| GET    | `/api/v1/notifications/:id`       | Detalle de una notificación         |

```bash
curl "http://localhost:3000/api/v1/notifications?merchant_id={id}&page=1&limit=20" \
  -H "x-api-key: mk_3f9a1c..."
```

---

### Health checks

```bash
curl http://localhost:3000/health          # gateway (propio)
curl http://localhost:3000/api/v1/health   # gateway (agrega todos los servicios)
curl http://localhost:3001/api/health      # payment-service (verifica BD real)
curl http://localhost:3002/api/health      # notification-service
```

**`GET /api/v1/health`:**
```json
{
  "status":    "ok",
  "service":   "api-gateway",
  "uptime":    3600,
  "timestamp": "2026-05-01T10:00:00.000Z",
  "services": {
    "payment":      { "status": "ok", "service": "payment-service",      "database": "connected" },
    "notification": { "status": "ok", "service": "notification-service", "database": "connected" }
  }
}
```

---

## Flujo de prueba completo

```bash
# 1. Crear merchant (directo al payment-service, sin auth)
curl -X POST http://localhost:3001/api/merchants \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo","email":"demo@test.com"}'

# 2. Crear transacción (vía gateway)
curl -X POST http://localhost:3000/api/v1/transactions \
  -H "x-api-key: {access_key}" \
  -H "Content-Type: application/json" \
  -d '{"merchant_id":"{id}","amount":200,"currency":"COP","type":"payin"}'

# 3. Aprobar
curl -X PATCH http://localhost:3000/api/v1/transactions/{id}/status \
  -H "x-api-key: {access_key}" \
  -H "Content-Type: application/json" \
  -d '{"status":"approved"}'

# 4. Ver notificación generada por Redis
curl "http://localhost:3000/api/v1/notifications?merchant_id={id}" \
  -H "x-api-key: {access_key}"

# 5. Generar liquidación
curl -X POST http://localhost:3000/api/v1/settlements/generate \
  -H "x-api-key: {access_key}" \
  -H "Content-Type: application/json" \
  -d '{"merchant_id":"{id}","period_start":"2026-01-01T00:00:00Z","period_end":"2026-12-31T23:59:59Z"}'
```

---

## Decisiones de diseño

- **Redis para eventos:** el payment-service publica un evento en Redis al cambiar el estado de una transacción. El notification-service lo consume de forma asíncrona y persiste la notificación en su propia tabla en PostgreSQL. Esto desacopla los servicios sin bloquear la respuesta al cliente.
- **Circuit breaker propio:** implementado desde cero en el api-gateway con los 3 estados (CLOSED / OPEN / HALF_OPEN), sin librerías externas. 5 fallos consecutivos abren el circuito por 30 segundos.
- **Guard global con `@SkipAuth()`:** `AccessKeyGuard` registrado como `APP_GUARD` en NestJS. Las rutas públicas (merchants, health) usan el decorador `@SkipAuth()` para saltear la validación.
- **Rate limiter en memoria:** `Map` nativo con ventana deslizante de 60 segundos y cleanup automático cada 5 minutos vía `setInterval().unref()`.
- **Migraciones en startup:** el CMD de los Dockerfiles de payment-service y notification-service corre `prisma migrate deploy` antes de iniciar el servidor.