This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Ambiente (ENV) para scripts

Todos os scripts em `scripts/` exigem a variável **ENV** para evitar mistura de ambientes (local vs CI vs prod).

- **ENV** deve ser um de: `local`, `ci`, `prod`.
- O loader carrega o arquivo correspondente:
  - `ENV=local` → `.env.local`
  - `ENV=ci` → `.env.ci.local`
  - `ENV=prod` → `.env.prod.local`

### Exemplos

```bash
# CI (base URL padrão https://ci.metalav.com.br)
ENV=ci node scripts/fake-gateway.mjs
ENV=ci node scripts/e2e-iot.mjs

# Local
ENV=local node scripts/db-snapshot.mjs
ENV=local node scripts/e2e-full.mjs

# fake-gateway com fixture explícito (usa seeds de scripts/fixtures.json)
ENV=ci node scripts/fake-gateway.mjs --fixture=ci
```

Se **ENV** não estiver definido, os scripts abortam com instrução. Crie `.env.ci.local` (e opcionalmente `.env.prod.local`) a partir de `.env.local` e ajuste valores por ambiente. Para o fake-gateway em CI, defina no `.env.ci.local` o secret do gateway, por exemplo: `IOT_HMAC_SECRET__GW_TESTE_001=...` (ou `IOT_HMAC_SECRET` global).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
