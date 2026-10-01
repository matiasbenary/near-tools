// Self-check for the action contract registry. Run: npm run check
// Values below were measured against the live RPCs on 2026-09-21.
import assert from 'node:assert/strict';
import {
  ActionContracts,
  ftTotalSupply,
  linkdropDeposit,
  nftMintDeposit,
  ONE_NEAR,
  toUnits,
  fromUnits,
} from '../src/lib/actions/contracts.ts';
import { describeError } from '../src/lib/errors.ts';
import { isAmount } from '../src/lib/near.ts';

// A minimal localStorage, so the key store can be checked outside a browser.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  },
  location: { origin: 'https://example.org' },
};
const { claimAborted, claimCost, claimGas, claimUrl, DEFAULT_CLAIM_GAS, loadDropKeys, saveDropKeys } =
  await import('../src/lib/actions/linkdrop-keys.ts');

const metadata = {
  spec: 'ft-1.0.0',
  name: 'Demo',
  symbol: 'DEMO',
  icon: '',
  decimals: 6,
} as const;
const args = { owner_id: 'alice.near', total_supply: '1000', metadata };

// Token accounts are derived, never typed — and account IDs are lowercase.
assert.equal(ActionContracts.mainnet.ft.accountFor('DEMO'), 'demo.tkn.near');
assert.equal(
  ActionContracts.testnet.ft.accountFor('DEMO'),
  'demo.token.primitives.testnet'
);

// The whole reason the registry exists: the two factories disagree.
const mainnetQuote = ActionContracts.mainnet.ft.quote(args, 'alice.near');
assert.equal(mainnetQuote.contractId, 'tkn.near');
assert.equal(mainnetQuote.method, 'get_required_deposit');
assert.deepEqual(mainnetQuote.args, { args, account_id: 'alice.near' });

const testnetQuote = ActionContracts.testnet.ft.quote(args, 'alice.testnet');
assert.equal(testnetQuote.method, 'get_required');
assert.deepEqual(testnetQuote.args, { args }); // no account_id — mainnet-only field

// Keypom: 0.0426 Ⓝ per link, plus the payout for NEAR drops only.
assert.equal(linkdropDeposit(1, 0n, true), 426n * 10n ** 20n);
assert.equal(linkdropDeposit(20, 0n, true), 852n * 10n ** 21n); // 0.852 Ⓝ
assert.equal(
  linkdropDeposit(20, ONE_NEAR / 2n, false),
  (426n * 10n ** 20n + ONE_NEAR / 2n) * 20n // 10.852 Ⓝ
);

// Supply conversion stays integral — 1000 tokens at 6 decimals.
assert.equal(ftTotalSupply('1000', 6), 1_000_000_000n);
assert.equal(ftTotalSupply('1', 24), ONE_NEAR);

// Mint deposit scales with the serialized args.
assert.equal(nftMintDeposit({}), 2n * 10n ** 19n * 4n); // "{}" is 2 bytes
assert.ok(nftMintDeposit({ title: 'a'.repeat(100) }) > nftMintDeposit({ title: 'a' }));

// Errors map to a human vocabulary; a cancellation must never read like a failure.
const cases: [string, string][] = [
  ['Error: User rejected the request', 'cancelled'],
  ['The account alice.near does not have enough balance', 'insufficient-balance'],
  ['Server responded 429 Too Many Requests', 'network-busy'],
  ['Exceeded 1 providers to execute request', 'network-busy'],
  ['Smart contract panicked: AccountAlreadyExists', 'rejected'],
  ['Exceeded the prepaid gas: NotEnoughAllowance', 'link-underfunded'],
  ['Smart contract panicked: Not enough gas attached. Required: 100', 'link-underfunded'],
  ['Smart contract panicked: Key does not exist', 'link-spent'],
  ['something nobody has seen before', 'unknown'],
];
for (const [input, expected] of cases) {
  assert.equal(describeError(new Error(input)).kind, expected, input);
}
// The raw string is kept for a Details disclosure, never shown as the message.
assert.notEqual(describeError(new Error('User rejected')).message, 'User rejected');
assert.equal(describeError(new Error('User rejected')).detail, 'User rejected');
assert.equal(describeError(new Error('boom\nstack line')).detail, 'boom');

// Unit conversion is string/BigInt only — the reference runs parseFloat here.
assert.equal(toUnits('1.5', 24), 15n * 10n ** 23n);
assert.equal(toUnits('0.0426', 24), 426n * 10n ** 20n);
assert.equal(toUnits('7', 6), 7_000_000n);
assert.equal(toUnits('1.23456789', 6), 1_234_567n); // truncates, never rounds up
assert.equal(fromUnits(15n * 10n ** 23n, 24), '1.5');
assert.equal(fromUnits(ONE_NEAR, 24), '1');
assert.equal(fromUnits(0n, 24), '0');

// A save replaces that drop's keys (ids restart after a redeploy) but never
// touches another drop's.
saveDropKeys('testnet', 'drop-a', [{ private: 'p1', public: 'k1' }]);
saveDropKeys('testnet', 'drop-a', [{ private: 'p2', public: 'k2' }]);
saveDropKeys('testnet', 'drop-b', [{ private: 'p3', public: 'k3' }]);
assert.deepEqual(loadDropKeys('testnet', 'drop-a').map((k) => k.public), ['k2']);
assert.deepEqual(loadDropKeys('testnet', 'drop-b').map((k) => k.public), ['k3']);
// Networks are separate namespaces — a mainnet key is not a testnet key.
assert.deepEqual(loadDropKeys('mainnet', 'drop-a'), []);
assert.equal(
  claimUrl('ed25519:a/b+c'),
  'https://example.org/claim/linkdrop/?id=ed25519%3Aa%2Fb%2Bc'
);

// Claim gas comes out of the key's own allowance. Testnet bills it at 1e9 per
// gas — 10x the quoted price — and mainnet at the quoted price. Receipts, ±1%.
const gasPrice = 100000000n;
const near = (a: bigint, b: bigint) => (a > b ? a - b : b - a) * 100n < b;
assert.ok(near(claimCost(44_000_000_000_000n, gasPrice, 'testnet'), 44918956452513800000000n));
assert.ok(near(claimCost(67493856367957n, gasPrice, 'testnet'), 68412812820470800000000n));
assert.ok(near(claimCost(DEFAULT_CLAIM_GAS, gasPrice, 'testnet'), 100918956452513800000000n));
// Keypom funds a 100 TGas drop with 2.0248e22 on either network.
const measuredAllowance = 20248156910387200000000n;
// The contract only accepts the exact gas the drop declares, so a key that
// cannot pay for it is unusable — attaching less aborts and burns allowance.
const gas = claimGas(measuredAllowance, gasPrice, DEFAULT_CLAIM_GAS, 'testnet');
assert.equal(gas, 0n);
// The same key claims fine on mainnet, where that 10x is not applied.
assert.equal(claimGas(measuredAllowance, gasPrice, DEFAULT_CLAIM_GAS, 'mainnet'), DEFAULT_CLAIM_GAS);
// Mainnet receipt EEVnnBHw…: 275 TGas signed by a key funded with 4.05e22.
assert.ok(claimCost(275_000_000_000_000n, gasPrice, 'mainnet') < 40496313820774400000000n);
// That abort is a *successful* transaction — only the log says nothing moved.
const abortLog = 'Prepaid GAS different than what is specified in the drop: 100000000000000';
assert.equal(claimAborted({ receipts_outcome: [{ outcome: { logs: [abortLog] } }] }), true);
assert.equal(claimAborted({ receipts_outcome: [{ outcome: { logs: ['passed local check'] } }] }), false);
assert.equal(claimAborted({}), false);
console.log('  claim gas on testnet for a 2.0248e22 allowance:', gas, '(0 = unusable)');

console.log('check-actions: all assertions passed');

// Inputs a number <input> lets through but the unit converters cannot take.
for (const bad of ['', '1e3', '-1', '1.', '.5', '1.1234567']) assert.equal(isAmount(bad, 6), false, bad);
for (const good of ['0', '1', '1.5', '1.123456']) assert.equal(isAmount(good, 6), true, good);
assert.equal(isAmount('1.5', 0), false);
