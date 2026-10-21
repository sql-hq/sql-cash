---
name: null-payouts
description: Integrate the NULL TypeScript payout SDK into a browser application, including ENS destinations, encrypted preparation, authorization, local recovery, sponsored transport, claims, and withdrawals. Use for NULL integration and debugging, not unrelated Ethereum transfers.
---

# Integrate NULL payouts

Use the installed package's declarations as the API authority. This guide targets `@samarth208p/null-payouts@0.1.0-preview.2`, an MIT-licensed, unaudited testnet preview. Do not assume npm package versions are pool versions: the active reference pool is Sepolia v0.3 with chosen-amount withdrawals and private change. Use the published deployment manifest and all five matching artifacts; do not assume every host has upgraded.

## Start with the host application

Inspect its framework, wallet/auth flow, environment handling, storage and existing NULL integration. Keep its UI and authorization choices. Establish whether the user wants preparation only, a funded payout, recipient claims, or gas sponsorship. Installing this skill does not authorize transactions, deployments, account access or publishing.

Install the pinned preview with the host's package manager:

```sh
npm install @samarth208p/null-payouts@0.1.0-preview.2
```

The package ships ESM and TypeScript declarations. Preparation works in Node.js 22.16+. Default proving uses browser Workers; browser storage uses IndexedDB. In SSR frameworks instantiate the live client and access browser storage only on the client. In Vite use `worker: { format: 'es' }` and `build: { target: 'es2022' }`.

### Public imports

- Root: `resolvePayoutRecipients`, `preparePayout`, `PayoutDraft`.
- `/client`: `PayoutClient`, `NullLiveClient`, `createEncryptedCheckpointStore`, `SubmissionUncertainError`, and live-client types.
- `/jobs`: `resolvePayoutJobRecipients`, `PayoutJob`.
- `/withdrawals`: `planWithdrawal`, `WithdrawalJob`.
- `/sdk`: `createPrivacyProfile`, crypto, protocol, compilation and witness helpers.
- `/ens`: public payment-profile resolution and record helpers.
- `/wallet`: encrypted identity backup and recovery.
- `/cre`: `verifyCreResult`.
- `/prover` and `/prover/runtime`: worker interface and local proving runtime.

Prefix subpaths with `@samarth208p/null-payouts`. The source repository's private `@null-protocol/*` workspace packages are not separate npm installation requirements. There is no packaged React widget, hosted payout API, automatic name registration, or bundled Privy server service.

## Browser integration

Create a viem Sepolia public client for ENS and construct `NullLiveClient` from real `LiveClientOptions`: reviewed deployment manifest, public RPC URLs, optional Graph URL, artifact base URL, and `persistLocalSecret`. The persistence callback must durably encrypt/save its checkpoint; an empty callback is not a working recovery implementation. Circuit artifacts are hosted separately and verified against the manifest's hashes. Never invent pool addresses, manifests, private-note openings or successful transaction receipts.

Pair the live client with `new PayoutClient(live, ens)`. Keep the instance and its prepared operations alive for submission and reconciliation.

1. Resolve `{ reference, name, amount }` rows. Private references must be distinct. Amounts are positive decimal strings with at most six decimals; `amountAtomic` parameters use bigint token units.
2. Show the resolved ENS name, profile fingerprint and amount for payer confirmation, then call `preparePayout({ ens, context: live.context, recipients })`. It prepares encrypted data; no payment occurs.
3. Before distribution, explicitly register the organization policy and shield its funding through the treasury flow. Use recovered unspent treasury notes and the matching private policy opening.
4. Call `payouts.approve(draft, { treasuryNotes, authPolicy, authorize, compilation, ...progressOptions })`. The authorizer returns the expected compact signature of the exact raw digest. Do not substitute `personal_sign` or let a gas sponsor authorize a payout.
5. Save encrypted recovery, obtain broadcast consent within the user's authorized scope, then call `payouts.submit(operation, transport, callbacks)`. Record public transaction hashes and confirmation state.

ENS is required by the high-level payout API for every live recipient. It must resolve through the supported Sepolia ENSv2 resolver to a valid NULL profile. Raw wallet addresses, raw profiles, missing confirmation and changed destinations must not bypass the checks. The pool itself is identity-agnostic; do not claim ENS is verified by the circuit. Claims, recovery and withdrawals remain available after ENS expiry.

## Keys, recovery and network boundaries

Keep spending/viewing keys, passwords, policy openings, note openings, private references and compiled allocations local. Encrypt checkpoints at rest and provide export/recovery UI. Never serialize a complete draft/job to a server, log, analytics system or plaintext localStorage. `draft.publicBundle` is the public encrypted payload; the private `draft.creInput` also contains secret batch entropy and is an explicit private export.

Identity backup and funds checkpoints are different. Privy login does not recover NULL keys. Original recipient keys alone cannot reconstruct fresh private-change secrets from a partial withdrawal. Preserve updated encrypted recovery before broadcasting each such operation.

For gas use `{ mode: 'wallet', wallet }`, a configured relay, or `{ mode: 'sponsored', send }`. A sponsor receives only the typed public operation and returns its transaction hash. Its server must authenticate callers, validate chain/pool/method and cap budgets. It supplies gas, not USDC or owner approval. Initial funding-wallet token approval/deposit is not universal sponsored wallet execution. Put sponsor and organization credentials only on the server.

## Uncertain submissions and larger jobs

`SubmissionUncertainError`, a callback failure or a timeout can mean the transaction reached the network. Retain the operation/checkpoint and reconcile with the known hash when available. `not-observed` is not failure evidence. Never automatically resend or fall back to another transport while an outcome is unknown.

Payout jobs split larger lists into consecutive padded groups of up to eight. Every group needs fresh entropy, current spendable treasury notes, authorization and proof. Jobs can partially complete; persist confirmed receipts. They are in-memory orchestrators, not durable queues or all-or-nothing transactions. After reload recover encrypted checkpoints and chain history before constructing replacement operations.

## Recipients and withdrawals

Generate and back up local keys before the user explicitly publishes their public ENS profile. `live.discover({ keys })` scans allocations locally. `prepareClaim({ allocation })` prepares a claim; submitting creates a private note, not a public token withdrawal.

Use recovered unspent notes for `prepareWithdrawal` or `WithdrawalJob`. Require `acknowledgePublicWithdrawal: true` after showing the destination, amount and transaction count. v0.2 exits whole notes. Smaller exits require a v0.3 manifest with `security.partialWithdrawalsImplemented: true` and the matching contracts/artifacts. Multi-note withdrawals can produce multiple transfers and partially complete. Partial treasury refunds are unsupported.

## CRE and privacy claims

Choose `compilation: { mode: 'local' }` or supply the exact matching result with `{ mode: 'cre-local-simulation', result }`. This validates local simulation output against the draft; it is not remote TEE attestation. Never reuse batch entropy or outsource private compilation to an untrusted server.

Encrypted allocations and claim-source membership hide data from plaintext public inputs. They do not guarantee that outsiders cannot infer the payer or original payout amount. Funding wallets, deposits, transaction senders, withdrawals and timing remain observable. v0.2 full-note exits expose the note amount; v0.3 partial exits reduce direct amount matching but do not eliminate correlation. Do not promise anonymity, no trace, or an audit.

## Verify the integration

First typecheck and build the host with the installed package, including the actual worker/WASM output. Exercise preparation with real encryption, invalid/missing ENS, changed destinations, encrypted backup recovery, unknown-send reconciliation, and partial-completion UI as relevant. Separate fixture tests from live RPC, browser, proof and payment evidence. Do not send funds merely to demonstrate installation.

Use the [integration guide](https://github.com/Samarth208P/null/blob/main/docs/SDK_INTEGRATION.md) for exact host callbacks and [privacy boundaries](https://github.com/Samarth208P/null/blob/main/docs/PRIVACY_GUARANTEES.md) for release claims. The guide's source-workspace imports need the public subpaths listed above. Read the installed `.d.ts` files before adapting an example to another release.
