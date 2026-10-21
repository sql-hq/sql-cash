# SQL Cash

Self-custody private USDC payments on Ethereum, powered by RAILGUN. Connect an Ethereum wallet with Reown, create or restore a private vault, keep an encrypted backup, and send or withdraw USDC.

Website: https://sql.cash  
GitHub: https://github.com/sql-hq  
X: https://x.com/SQL_Cash  
Support: [support@sql.cash](mailto:support@sql.cash)

## Run locally

Use Node.js 22 or newer and pnpm 11.11.0.

```sh
git clone https://github.com/sql-hq/sql-cash.git
cd sql-cash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev
```

Set your own server-side DRPC_RPC_URL and public VITE_REOWN_PROJECT_ID in .env. Register your own application origins with your wallet connection project. Open http://localhost:5173. Paid RPC credentials stay behind the read-only gateway; never put them in a VITE_ variable. Mainnet transactions are disabled in the example configuration until you explicitly set VITE_ENABLE_MAINNET_TRANSACTIONS=true.

## Production build

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

The server listens on PORT (3000 by default) and serves dist together with the restricted mainnet RPC gateway. Set VITE_SITE_URL before building for your own deployment. BASE_PATH can mount the application below a path prefix.

## Repository layout

- apps/web: the actual React application, wallet integration, vault flows and public assets.
- packages/railgun: the browser integration used by the app; sensitive operator tooling is not included.
- packages/*: application compatibility modules and shared types.
- scripts: production server, read-only RPC gateway and gateway tests.
- contracts/src: retained SQL/NULL Solidity reference source for the legacy Sepolia implementation. These are not the active Ethereum mainnet RAILGUN contracts.

## Mainnet evidence

Controlled real-USDC tests completed shielding, a private payment, normal withdrawal, return-to-origin and funded-backup recovery. Seven receipts succeeded, with 0.02 USDC deposited in total. This is not an independent audit or comprehensive real external-wallet browser acceptance. See [the evidence](https://github.com/sql-hq/sql-docs/tree/main/evidence) and SECURITY.md for scope. Retained legacy cryptographic/development dependencies have not been represented as fully remediated.

## Related repositories

- [SDK and installable release package](https://github.com/sql-hq/railgun-sdk)
- [Documentation and transaction evidence](https://github.com/sql-hq/sql-docs)
- [Project profile](https://github.com/sql-hq/sql-hq)

## Downloads and license

[Release v0.1.0](https://github.com/sql-hq/sql-cash/releases/tag/v0.1.0) includes a clean source package and checksums. It does not contain deployment credentials, a configured wallet-connection project, operator wallets, private backups, databases or the application's private working history. This is a source release, not an npm-registry publication.

MIT licensed. Original copyright notices are retained in LICENSE. Report vulnerabilities privately to support@sql.cash.
