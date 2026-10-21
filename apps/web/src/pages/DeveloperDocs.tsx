import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Search } from 'lucide-react';
import { DeveloperCodeBlock as Code } from '../components/DeveloperCodeBlock';
import rawSkill from '../../../../skills/null-payouts/SKILL.md?raw';

// The skill file ships with the protocol's original package names; present it under the SQL brand.
const skillText = rawSkill
  .replace(/@samarth208p\/null-payouts/g, '@silentquery/payouts')
  .replace(/null-payouts/g, 'sql-payouts')
  .replace(/NullLiveClient/g, 'SqlLiveClient')
  .replace(/connectNull/g, 'connectSql')
  .replace(/\bNULL\b/g, 'SQL')
  .replace(/\bNull\b/g, 'SQL');
const skillUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(skillText)}`;
import './developer-docs.css';

import { repository } from '../components/site/SiteChrome';
const guides = [
  { id: 'quickstart', title: 'Browser quickstart', description: 'Install, configure Vite or SSR, and connect your app.', keywords: 'npm install react next vite setup browser' },
  { id: 'payouts', title: 'Send a payout', description: 'Resolve, prepare, authorize, submit and reconcile.', keywords: 'ens approve treasury funding batches csv timeout retry' },
  { id: 'recipients', title: 'Receive & recover', description: 'Local keys, encrypted backups, claims and withdrawals.', keywords: 'inbox wallet backup claim withdraw partial notes' },
  { id: 'sponsorship', title: 'Sponsor gas', description: 'Connect a backend that pays transaction fees.', keywords: 'server service backend relayer gas transport' },
  { id: 'api', title: 'API reference', description: 'Package entry points and host responsibilities.', keywords: 'typescript imports methods sdk reference callbacks' },
  { id: 'privacy', title: 'Privacy & deployment', description: 'What is hidden, what is observable, and what is live.', keywords: 'stealth amounts payer sepolia v2 v3 cre privy security' },
  { id: 'faq', title: 'Questions & answers', description: 'Common integration questions and failure recovery.', keywords: 'faq errors troubleshooting questions answers' },
  { id: 'ai', title: 'Build with AI', description: 'Give your coding assistant the SQL integration skill.', keywords: 'skill.md ai agents codex claude cursor download' },
];
const faq = [
  ['Do my users have to visit the SQL app?', 'No. Use the SDK in your own screens. The SQL web app is a reference integration. You provide authentication, wallet connection, authorization and encrypted recovery.'],
  ['Can I use it with React, Next.js or another framework?', 'Yes. The SDK is framework-independent ESM with TypeScript declarations. Preparation works in Node.js 22.16+. Instantiate the browser proof client and access IndexedDB only on the client in SSR apps. Verify your bundler emits the proof worker and WASM assets.'],
  ['Does preparing a payout send money?', 'No. Resolution and preparation create an encrypted draft. Funding, owner authorization, proof preparation, recovery backup and transaction submission are separate steps.'],
  ['Why does an ordinary .eth name fail?', 'The current high-level API requires a supported Sepolia ENSv2 resolver and a valid SQL payment-profile record. Owning a name on mainnet is not enough. Confirm the resolved destination before preparing the payout.'],
  ['Can I send to a wallet address instead?', 'New distributions in the high-level SDK require confirmed ENS names. A wallet address is used separately for public withdrawals. Name expiry does not prevent recovery, claims or withdrawals.'],
  ['What happens if a request times out?', 'Preserve the operation and encrypted checkpoint, then reconcile. A timeout or not-observed result does not prove failure. Do not resend or fall back to another wallet while the result is unknown.'],
  ['Can I pay more than eight people?', 'Yes. PayoutJob partitions a larger list into sequential batches of up to eight. Each batch has separate authorization, proof and receipt. Earlier batches can succeed while later ones stop. The job is not an atomic transaction or durable background queue.'],
  ['Can recipients withdraw only part of their funds?', 'Yes. The fresh Sepolia v0.3 pool supports any positive USDC amount up to the recovered balance, with six decimal places. The remainder stays private. Withdrawing across multiple notes can require several transfers.'],
  ['Will logging in restore a recipient’s money?', 'Authentication does not restore SQL keys. Keep an encrypted identity backup and encrypted funds checkpoints. Fresh private-change secrets need the updated checkpoint; original identity keys alone are insufficient.'],
  ['Does this hide who paid and how much?', 'The allocation amount and specific source distribution stay out of claim public inputs. Public deposits, withdrawals, transaction senders and timing can still reveal connections. Chosen-amount exits reduce direct amount matching, but the withdrawn amount and destination remain public. The current release cannot guarantee payer unlinkability or amount anonymity.'],
  ['Is sponsored gas free?', 'Someone pays: the connected wallet, your organization or your sponsor backend. Sponsorship does not fund the USDC payout or replace owner authorization. Initial funding-wallet approval and deposit remain separate.'],
  ['Is this ready for production or other chains?', 'This release is an unaudited testnet preview for the configured Sepolia deployment and local testing. No production security, anonymity, throughput or fee guarantee is claimed. CRE evidence is local simulation; the complete Privy owner-approved financial demonstration remains outstanding.'],
];
const factory = `import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import {
  SqlLiveClient, PayoutClient, type LiveClientOptions,
} from '@silentquery/payouts/client';

export function connectSql(options: LiveClientOptions, ensRpcUrl: string) {
  const ens = createPublicClient({
    chain: sepolia, transport: http(ensRpcUrl),
  });
  const live = new SqlLiveClient(options);
  return { ens, live, payouts: new PayoutClient(live, ens) };
}`;
const preparation = `import {
  resolvePayoutRecipients, preparePayout,
} from '@silentquery/payouts';

// ens and live come from your configured connectSql instance.
const recipients = await resolvePayoutRecipients(ens, [
  { reference: 'invoice-42', name: 'alice.eth', amount: '25' },
]);
// Show the resolved name, fingerprint and amount. Obtain confirmation.
const draft = await preparePayout({
  ens, context: live.context, recipients,
});
// Preparation only. No money has moved.
const encrypted = draft.publicBundle;`;
const approval = `// Host-provided values: recovered treasury notes, registered policy,
// owner-authorized raw-digest signer, connected wallet and progress UI.
const operation = await payouts.approve(draft, {
  treasuryNotes, authPolicy, authorize,
  compilation: { mode: 'local' },
  onProgress: showProgress,
});

// Save encrypted recovery and obtain broadcast consent first.
const result = await payouts.submit(operation,
  { mode: 'wallet', wallet },
  { onTransactionSubmitted: rememberTransaction },
);
// If submission is uncertain, retain operation and reconcile:
// await payouts.reconcile(operation, knownTransactionHash);`;
function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="docs-section"><h2>{title}</h2>{children}</section>; }
function GuideLink({ id, children }: { id: string; children: ReactNode }) { return <a className="developer-doc-link" href={`#/developers/${id}`}>{children}<ArrowRight size={15} /></a>; }

export function DeveloperDocs({ route }: { route: string }) {
  const guide = guides.find(item => item.id === route) ?? guides[0]!;
  const [query, setQuery] = useState('');
  const [faqQuery, setFaqQuery] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { document.title = `${guide.title} — SQL docs`; setQuery(''); heading.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [guide.id, guide.title]);
  const matches = guides.filter(item => `${item.title} ${item.description} ${item.keywords}`.toLowerCase().includes(query.trim().toLowerCase()));
  const questions = faq.filter(item => item.join(' ').toLowerCase().includes(faqQuery.trim().toLowerCase()));
  return <div className="docs-layout">
    <aside className="docs-sidebar" aria-label="Documentation navigation">
      <label className="docs-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Find a guide</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a guide…" /></label>
      <nav aria-label="Guides">{matches.map(item => <a key={item.id} href={`#/developers/${item.id}`} aria-current={guide.id === item.id ? 'page' : undefined}>{item.title}</a>)}</nav>
      {!matches.length && <p className="docs-empty" role="status">No guides match. <button onClick={() => setQuery('')}>Clear search</button></p>}
      <a className="docs-skill-link" href={skillUrl} download="SKILL.md">Download SKILL.md<ArrowDown size={15} /></a>
      <p className="docs-version">0.1.0-preview.2<br />MIT · Sepolia testnet</p>
    </aside>
    <main className="docs-article" id="developer-content" tabIndex={-1}>
      <h1 ref={heading} tabIndex={-1}>{guide.title}</h1><p className="docs-lead">{guide.description}</p>
      {guide.id === 'quickstart' && <>
        <Code title="Install the SDK" value="npm install @silentquery/payouts@preview" />
        <p>Embed SQL in the product your users already use. The package contains the internal SQL modules, compiled JavaScript and TypeScript declarations. It does not require the reference app.</p>
        <Section title="Set up your browser build"><p>Use Node.js 22.16+ for Node tooling. The default proof client needs browser Workers and IndexedDB. In Next.js or another SSR framework, create it in client code. For Vite:</p><Code title="vite.config.ts" value={`import { defineConfig } from 'vite';\n\nexport default defineConfig({\n  worker: { format: 'es' },\n  build: { target: 'es2022' },\n});`} /></Section>
        <Section title="Connect your application"><p>This factory accepts your real deployment and recovery configuration. Keep its returned instance for the lifetime of a payout.</p><Code title="sql-client.ts" value={factory} /><div className="docs-table-wrap" tabIndex={0} aria-label="Host configuration"><table><thead><tr><th>Host configuration</th><th>What to supply</th></tr></thead><tbody>{[
          ['manifest', 'Reviewed deployment manifest with pool, token, code hashes and matching circuit hashes.'], ['rpcUrls / graphUrl', 'Public RPC endpoints and an optional Graph indexer.'], ['artifactBaseUrl', 'Hosted circuit artifacts matching the manifest. Artifacts are not inside the npm package.'], ['persistLocalSecret', 'A callback that actually encrypts and durably saves every funds checkpoint.'],
        ].map(([key, value]) => <tr key={key}><td><code>{key}</code></td><td>{value}</td></tr>)}</tbody></table></div><p>Keep private keys, passwords and note openings in the browser. Authentication, recovery UI and owner authorization belong to your app.</p></Section>
        <GuideLink id="payouts">Next: prepare and send a payout</GuideLink>
      </>}
      {guide.id === 'payouts' && <>
        <Section title="Resolve, confirm, prepare"><p>Use a supported Sepolia ENSv2 name with an SQL public payment profile. The example name is illustrative. Amounts are positive decimal strings with up to six decimals; private references must be unique.</p><Code title="Prepare an encrypted draft" value={preparation} /><p>Destination checks run again around preparation, authorization and submission. If the destination changes, review it again. Do not bypass those checks with a raw wallet address.</p></Section>
        <Section title="Authorize and submit"><p>First register the organization policy and fund its treasury with explicit consent. Select real, unspent treasury notes and the matching policy opening. The code below is a host-integration fragment; its callbacks are supplied by your app.</p><Code title="Approval and wallet transport" value={approval} /><p>The authorizer signs the exact raw digest. A personal-message signature is not interchangeable. A confirmed result with <code>localRecoverySaved: false</code> means the payment succeeded but the local save failed; recover before proceeding.</p></Section>
        <Section title="Larger lists and unknown results"><p><code>PayoutJob</code> sends groups of up to eight recipients sequentially, with fresh entropy, proof and authorization per batch. Retain each confirmed receipt. A 20-person list normally uses three padded batches, not one atomic payment.</p><p>On a timeout, preserve the operation and reconcile. <code>not-observed</code> does not prove failure. Jobs cannot be restored by JSON after a reload; restore encrypted checkpoints and chain history first.</p></Section>
        <GuideLink id="sponsorship">Use a sponsor instead of wallet-paid gas</GuideLink>
      </>}
      {guide.id === 'recipients' && <>
        <Section title="Create and back up local keys"><Code title="Identity backup" value={`import { createPrivacyProfile } from '@silentquery/payouts/sdk';\nimport { encryptRecovery } from '@silentquery/payouts/wallet';\n\nconst { profile, keys } = createPrivacyProfile();\n// password comes from the recipient, not a hardcoded value.\nconst backup = await encryptRecovery(keys, password);\n// Save/export the encrypted backup before publishing profile to ENS.`} /><p>Publish only the public profile, after explicit confirmation, through the ENS record helpers. Name registration is separate. Login does not restore SQL keys.</p></Section>
        <Section title="Discover and claim"><Code title="Local recipient discovery" value={`const allocations = await live.discover({ keys });\n// The recipient selects an allocation in your UI.\nconst claim = await live.prepareClaim({ allocation });\n// Save encrypted recovery and obtain consent before submission.\nconst confirmed = await live.submit(claim, transport);`} /><p>A claim creates a private note inside the pool. It does not automatically transfer tokens to a public wallet.</p></Section>
        <Section title="Withdraw and preserve change"><p>Recover unspent notes and show the public exit address, amount and number of transactions before asking for consent. The active Sepolia v0.3 pool retains exact private change when a recipient withdraws less than a note’s value.</p><p>Identity backup and funds checkpoints serve different purposes. Fresh private-change secrets require the updated encrypted checkpoint; the original identity keys alone cannot recreate them. ENS expiry must not block recovery or withdrawals.</p></Section>
        <GuideLink id="privacy">Understand withdrawal privacy</GuideLink>
      </>}
      {guide.id === 'sponsorship' && <>
        <Section title="Keep keys local; pay gas on your server"><p>The sponsor callback receives the public proof operation and returns a transaction hash. Your app supplies the endpoint. SQL does not run a managed gas service.</p><Code title="Sponsor transport" value={`import type { BroadcastTransport } from '@silentquery/payouts/client';\n\nconst transport: BroadcastTransport = {\n  mode: 'sponsored',\n  send: async operation => {\n    const response = await fetch('/api/payout-sponsor', {\n      method: 'POST', credentials: 'same-origin',\n      headers: { 'content-type': 'application/json' },\n      body: JSON.stringify(operation),\n    });\n    if (!response.ok) throw new Error('Sponsor response unavailable');\n    return (await response.json()).transactionHash;\n  },\n};`} /></Section>
        <Section title="What the backend must enforce"><ul><li>Authenticate the caller and validate the allowed chain, pool and operation.</li><li>Check budgets, simulate the transaction, and retain its public hash.</li><li>Keep the gas wallet key and organization service credentials server-side.</li><li>Accept public proofs and encrypted envelopes, never private payroll or recovery data.</li></ul><p>A callback error can occur after broadcast. Reconcile before retrying; do not silently fall back to another transport. Sponsorship pays gas, not the USDC payout, and does not replace owner authorization.</p><p>Initial token approval and treasury deposit still require the funding wallet. The bundled relayer is source infrastructure to deploy and configure yourself.</p><a className="developer-doc-link" href={repository} target="_blank" rel="noopener noreferrer">Browse source repositories on GitHub<ArrowUpRight size={15} /></a></Section>
      </>}
      {guide.id === 'api' && <>
        <p>All imports below start with <code>@silentquery/payouts</code>. Use the installed declarations for exact argument and return types.</p>
        <div className="docs-table-wrap" tabIndex={0} aria-label="SDK entry points"><table><thead><tr><th>Import suffix</th><th>Primary exports</th><th>Use it for</th></tr></thead><tbody>{[
          ['(root)', 'resolvePayoutRecipients, preparePayout', 'ENS resolution and encrypted drafts'], ['/client', 'PayoutClient, SqlLiveClient, createEncryptedCheckpointStore', 'Proof operations, recovery and reconciliation'], ['/jobs', 'resolvePayoutJobRecipients, PayoutJob', 'Lists larger than one batch'], ['/withdrawals', 'planWithdrawal, WithdrawalJob', 'Plan an amount across recipient notes'], ['/sdk', 'createPrivacyProfile, compileDistribution', 'Crypto, protocol and witness helpers'], ['/ens', 'resolvePaymentName and record helpers', 'Public profiles and delegated record management'], ['/wallet', 'encryptRecovery, decryptRecovery', 'Local encrypted identity backup'], ['/cre', 'verifyCreResult', 'Exact local simulation-result matching'], ['/prover', 'proveInWorker', 'Local browser proof worker'], ['/prover/runtime', 'proveLocally', 'Host-managed worker integration'],
        ].map(([path, names, purpose]) => <tr key={path}><td><code>{path}</code></td><td><code>{names}</code></td><td>{purpose}</td></tr>)}</tbody></table></div>
        <Section title="Keep these values in your application"><p><code>PayoutDraft</code>, compiled allocations, policy openings and funds checkpoints contain secrets. They are not request bodies. Send only the designated public bundle or public operation to a service.</p><p>The private workspace package names in repository examples are not additional published dependencies. The Privy organization adapter remains a separate source integration with server-only credentials.</p></Section>
      </>}
      {guide.id === 'privacy' && <>
        <Section title="The goal: hide who paid whom, and how much"><p>SQL encrypts recipient allocations and uses a proof that hides a claim’s specific source distribution. A public ENS profile supplies receiving keys; it does not list that person’s private claims.</p><p><strong>The current release does not guarantee that observers cannot infer the payer or original payout amount.</strong> Deposits, public withdrawals, transaction senders and timing can connect activity. One depositor followed by a matching withdrawal is a particularly weak privacy situation.</p></Section>
        <div className="docs-table-wrap" tabIndex={0} aria-label="Release capabilities"><table><thead><tr><th>Capability</th><th>Current boundary</th></tr></thead><tbody><tr><td>Sepolia v0.3</td><td>Encrypted allocations, hidden claim-source membership, and chosen-amount exits with private change. The withdrawn amount is public; correlation is still possible.</td></tr><tr><td>CRE</td><td>Local CLI simulation and exact result matching. No remote enclave attestation.</td></tr><tr><td>Privy</td><td>Organization authorization integration; the complete owner-approved financial demonstration remains outstanding.</td></tr></tbody></table></div>
        <Section title="Treat deployment as a separate decision"><p>Installing npm does not deploy contracts. Connect to the published v0.3 manifest and its matching five circuit artifacts, or deploy and verify your own pool. The reference app uses one fresh Sepolia deployment.</p><a className="developer-doc-link" href={repository} target="_blank" rel="noopener noreferrer">Browse protocol documentation on GitHub<ArrowUpRight size={15} /></a></Section>
      </>}
      {guide.id === 'faq' && <><label className="docs-faq-search">Search questions<input type="search" value={faqQuery} onChange={event => setFaqQuery(event.target.value)} placeholder="Try “withdraw”, “ENS” or “timeout”" /></label><p role="status" className="docs-result-count">{questions.length} {questions.length === 1 ? 'answer' : 'answers'}</p><div className="docs-faq">{questions.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>{!questions.length && <p>No answers match that search. <button className="developer-doc-link" onClick={() => setFaqQuery('')}>Show all questions</button></p>}</>}
      {guide.id === 'ai' && <>
        <p>Give your coding assistant the same integration rules as your team. This self-contained skill covers the published imports, local custody, ENS checks, authorization, recovery, sponsorship and honest privacy claims.</p>
        <a className="button button-primary docs-download" href={skillUrl} download="SKILL.md">Download SKILL.md<ArrowDown size={16} /></a>
        <Section title="Add it to your project"><p>Save the file as <code>.agents/skills/sql-payouts/SKILL.md</code> for tools that discover project skills there. If your assistant uses another skill directory, use its supported location. You can also attach the file directly to the conversation.</p><Code title="Suggested integration request" value={`Use the sql-payouts skill to integrate SQL in this browser app.\nStart with preparation only. Inspect our wallet, auth and storage.\nUse @silentquery/payouts@0.1.0-preview.2.\nList missing deployment and recovery configuration before payment.\nVerify TypeScript, browser worker bundling and encrypted recovery.\nDo not submit transactions as part of the setup.`} /></Section>
        <Section title="What the skill prevents"><ul><li>Installing unpublished internal workspace packages.</li><li>Shipping private keys or compiled payroll to a backend.</li><li>Treating preparation, a timeout or a login as a completed payment.</li><li>Enabling partial withdrawals on the wrong pool.</li><li>Claiming stronger privacy than the deployment provides.</li></ul><p>The skill guides implementation. It cannot guarantee an error-free integration or authorize your assistant to spend funds.</p></Section>
        <details className="docs-skill-preview"><summary>Read the complete skill</summary><Code title="SKILL.md" value={skillText} /></details>
      </>}
      <footer className="docs-article-footer"><span>SQL SDK · Developer preview</span><a href={repository} target="_blank" rel="noopener noreferrer">GitHub repositories<ArrowUpRight size={14} /></a></footer>
    </main>
  </div>;
}
