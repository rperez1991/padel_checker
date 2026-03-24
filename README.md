# Padel Checker

Serverless function desplegada en Vercel que consulta la disponibilidad de pistas de pádel en [reservas.fundacioncrcantabria.es](https://reservas.fundacioncrcantabria.es).

## Qué hace

Revisa los próximos días de **lunes a jueves** dentro de la ventana de reservas (7 días desde hoy) y devuelve los huecos libres en:

- **18:30** — pistas 7, 8 y 9
- **19:00** — pistas 10, 11 y 12

## Uso

```
GET /api/check
```

Respuesta de ejemplo:

```json
{
  "consultado": "2026-03-24T15:42:00.000Z",
  "disponibles": [
    { "fecha": "2026-03-25", "hora": "18:30", "pista": 17 },
    { "fecha": "2026-03-27", "hora": "19:00", "pista": 21 }
  ],
  "total": 2
}
```

## Despliegue en Vercel

1. Conecta este repositorio en [vercel.com](https://vercel.com)
2. Añade las siguientes variables de entorno en **Settings → Environment Variables**:

| Variable | Descripción |
|---|---|
| `PADEL_LOGIN` | Usuario de la plataforma de reservas |
| `PADEL_PASSWD` | Contraseña de la plataforma de reservas |

## Desarrollo local

Clona el repo, crea un `.env.local` a partir de `.env.example` y usa la CLI de Vercel:

```bash
cp .env.example .env.local
# edita .env.local con tus credenciales
npx vercel dev
```
