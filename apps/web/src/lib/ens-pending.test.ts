import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePendingNameUpdate } from './ens-pending';
const address = '0x1111111111111111111111111111111111111111';
const valid = { version: 1, hash: `0x${'11'.repeat(32)}`, data: '0x12345678', name: 'ALICE.ETH', resolver: address, account: address, kind: 'profile', fingerprint: `0x${'22'.repeat(32)}` };
test('pending ENS updates reject truncated and malformed storage instead of requesting another transaction', () => {
  for (const raw of [null, '', '{', 'null', '{}', 'x'.repeat(5000), JSON.stringify({...valid,hash:'0x12'}), JSON.stringify({...valid,name:'http://alice.eth'}), JSON.stringify({...valid,kind:'sendTransaction'}), JSON.stringify({...valid,resolver:'bad'}), JSON.stringify({...valid,data:'0x1'})]) assert.equal(parsePendingNameUpdate(raw), undefined);
});
test('pending ENS updates restore only public receipt fields and require an editor for access changes', () => {
  const result = parsePendingNameUpdate(JSON.stringify({...valid,privateKey:'discard-me',authenticated:true}));
  assert.ok(result); assert.equal(result.name,'alice.eth'); assert.equal('privateKey' in result,false); assert.equal('authenticated' in result,false);
  assert.equal(parsePendingNameUpdate(JSON.stringify({...valid,kind:'grant'})),undefined);
  assert.equal(parsePendingNameUpdate(JSON.stringify({...valid,kind:'revoke',editor:address}))?.editor,address);
});
