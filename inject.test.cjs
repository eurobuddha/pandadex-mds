/* A stranger's coin at the public PandaPools sentinel with a ";" (or a smuggled parameter) in a state port: through the
   REAL service's pool scan (PandaPool.scan via PDService.cmd) nothing of it reaches the node and the beacon is skipped.
   The stand-in node splits commands exactly like the real one (node-standin.cjs). Run: node --test inject.test.cjs */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { standin } = require('./node-standin.cjs');
const root = process.env.PD_ROOT || __dirname;
const hex = n => '0x' + n.toString(16).toUpperCase().padStart(64, '0');
const MXUSD = '0x7D39745FBD29049BE29850B55A18BF550E4D442F930F86266E34193D89042A90', SENTINEL = '0x50414E4441504F4F4C53', ATTACKER = hex(666);
const SEND = 'send amount:1000 address:' + ATTACKER + ' tokenid:0x00';
const beacon = (oadr, opk, kmin) => ({ coinid: hex(9), address: SENTINEL, amount: '0.000000001', tokenid: '0x00', created: '100', state: { 2: MXUSD, 3: oadr, 4: opk, 5: kmin } });
const POISON = [beacon(hex(2), '[x;' + SEND + ';]', '50'), beacon(hex(2) + ';' + SEND, hex(1), '50'), beacon(hex(2), hex(1), '50;' + SEND),
  beacon(hex(2), hex(1) + ' ' + SEND, '50'), beacon(hex(2), hex(1), '50 ' + SEND), beacon(hex(2) + '\n' + SEND, hex(1), '50')];
function boot() {
  const n = standin((p, v) => v === 'runscript' ? { status: true, response: { parseok: true, script: { address: hex(77) } } }
    : v === 'coins' && p.includes('address:' + SENTINEL) ? { status: true, response: POISON.concat([beacon(hex(2), hex(1), '50')]) } : { status: true, response: [] });
  const logs = [], sb = { Object, Array, Function, String, Number, Boolean, Date, Math, JSON, RegExp, Error, TypeError, isNaN, isFinite, parseInt, parseFloat,
    MDS: { init() {}, load() {}, log: m => logs.push(m), notify() {}, sql(q, cb) { if (cb) cb({ status: true, rows: [] }); }, comms: { solo(m, cb) { if (cb) cb(); } }, net: { GET(u, cb) { if (cb) cb({ status: false }); } }, cmd: n.cmd } };
  sb.PoolInputClaims = { check(i, c, cb) { cb(true); }, post(i, h, cb) { cb(true); }, release(i, h, cb) { if (cb) cb(true); } };
  vm.createContext(sb);
  ['safety.js', 'decimal.js', 'covenant.js', 'funding.js', 'signlock.js', 'book.js', 'pool.js', 'composite.js', 'txn.js', 'tape.js', 'maker.js', 'price.js', 'verifier.js', 'pending.js', 'stats.js', 'split.js', 'chain.js', 'history.js', 'service.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f }));
  return { n, sb, logs };
}
test('service pool scan: poisoned sentinel beacons never reach the node, the honest pool still derives', () => {
  const { n, sb } = boot(), asked = []; let pools = null;
  vm.runInContext('PandaPool', sb).scan((c, cb) => { asked.push(c); return sb.PDService.cmd(c, cb); }, (e, p) => { pools = p; });
  assert.deepEqual(n.sends(), []);
  assert(!asked.concat(n.texts).some(t => /[;\r\n]/.test(t) || t.includes(ATTACKER) || t.includes('amount:1000')), 'stranger text was asked of the node: ' + JSON.stringify(asked));
  assert.equal(asked.filter(t => t.startsWith('runscript')).length, 1, 'only the honest beacon is derived');
});
test('PDService.cmd, the one command wrapper: ";", CR, LF and NUL refused, logged, never sent', () => {
  const { n, sb, logs } = boot();
  for (const q of ['runscript script:"RETURN TRUE;' + SEND + '"', 'coins\n' + SEND, 'block\r', 'block\u0000']) { let r; sb.PDService.cmd(q, v => { r = v; }); assert.equal(r.status, false); }
  assert.deepEqual(n.ran, []); assert.equal(logs.filter(l => l.startsWith('SECURITY')).length, 4);
});
test('pool parameters: strict 32-byte hex and a plain positive decimal', () => {
  const P = boot().sb.PandaPool.validParams;
  assert(P(hex(1), hex(2), MXUSD, '50')); assert(P(hex(1), hex(2), MXUSD, '0.5'));
  for (const b of [[hex(1) + ';', hex(2), MXUSD, '50'], ['0x01', hex(2), MXUSD, '50'], [hex(1), hex(2), MXUSD, '0'], [hex(1), hex(2), MXUSD, '5e2'], [hex(1), hex(2), MXUSD, '1'.repeat(81)], [hex(1), hex(2) + ' x', MXUSD, '50']])
    assert.equal(P(...b), false, JSON.stringify(b));
});
