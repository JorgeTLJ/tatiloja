import worker, { priceOrder, buildSale } from '../src/index.js';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

const catalog = { settings: { whatsapp: '5511999991234', frete: { retirada: true, gratisAcima: 300, regioes: [{ nome: 'São Paulo', ufs: ['SP'], preco: 18 }, { nome: 'Sul', ufs: ['PR', 'SC', 'RS'], preco: 28.5 }] } },
  products: [
    { id: 'saia', name: 'Saia Midi', price: 129.9, sizes: ['36', '38'], visible: true },
    { id: 'regata', name: 'Regata', price: 59.9, sizes: ['P', 'M'], visible: true },
    { id: 'esgot', name: 'Esgotada', price: 10, sizes: ['P'], soldOut: true },
  ] };
const env = { SITE_URL: 'https://site.test', ALLOWED_ORIGINS: 'https://site.test', DATA_REPO: 'o/d', MP_ACCESS_TOKEN: 'tok', MP_WEBHOOK_SECRET: 'sec', GH_TOKEN: 'gh', MAX_INSTALLMENTS: '6', STRICT_SIGNATURE: '0' };

// ---- fetch simulado ----
let store = null, sha = 0, mpPayments = {}, prefs = [], puts = 0, conflictOnce = false;
globalThis.fetch = async (u, o = {}) => {
  u = String(u); const R = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  if (u.startsWith('https://site.test/data/loja.json')) return R(catalog);
  if (u === 'https://api.mercadopago.com/checkout/preferences') { prefs.push(JSON.parse(o.body)); return R({ init_point: 'https://mp.test/pay/1' }, 201); }
  if (u.startsWith('https://api.mercadopago.com/v1/payments/')) { const p = mpPayments[u.split('/').pop()]; return p ? R(p) : R({ message: 'nf' }, 404); }
  if (u.includes('api.github.com/repos/o/d/contents/vendas.json')) {
    if (!o.method || o.method === 'GET') return store ? R({ content: Buffer.from(store).toString('base64'), sha: 's' + sha }) : R({}, 404);
    puts++; if (conflictOnce) { conflictOnce = false; return R({}, 409); }
    store = Buffer.from(JSON.parse(o.body).content, 'base64').toString(); sha++; return R({ content: { sha: 's' + sha } });
  }
  throw new Error('fetch inesperado ' + u);
};
const call = (path, init = {}) => worker.fetch(new Request('https://api.test' + path, init), env);
const post = (path, body, headers = {}) => call(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: 'https://site.test', ...headers } });
const sign = (id, rid = 'rq1', ts = '1700000000') => ({ 'x-request-id': rid, 'x-signature': 'ts=' + ts + ',v1=' + createHmac('sha256', 'sec').update('id:' + id + ';request-id:' + rid + ';ts:' + ts + ';').digest('hex') });

const base = { items: [{ id: 'saia', size: '38', qty: 2, price: 1 }, { id: 'regata', size: 'M', qty: 1 }], cliente: { nome: 'Ana Souza', telefone: '(11) 99999-1234', email: 'ANA@mail.com' },
  entrega: { tipo: 'entrega', cep: '04000-000', rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'São Paulo', uf: 'sp' } };

// 1. preços e frete vêm do catálogo
const small = { ...base, items: [{ id: 'saia', size: '38', qty: 1, price: 1 }, { id: 'regata', size: 'M', qty: 1 }] };
let r = await post('/checkout', small); let j = await r.json();
assert.equal(r.status, 200); assert.equal(j.url, 'https://mp.test/pay/1');
let pref = prefs[0];
assert.deepEqual(pref.items.map(i => [i.id, i.quantity, i.unit_price]), [['saia', 1, 129.9], ['regata', 1, 59.9], ['frete', 1, 18]]);
assert.equal(j.total, 207.8); assert.equal(pref.metadata.total, 207.8); assert.equal(pref.metadata.cliente.email, 'ana@mail.com');
assert.equal(pref.payer.phone.area_code, '11'); assert.equal(pref.payment_methods.installments, 6);
// frete grátis acima do mínimo (subtotal 319,70 >= 300)
r = await post('/checkout', base); j = await r.json(); pref = prefs[1];
assert.equal(pref.metadata.frete, 0); assert.equal(pref.items.some(i => i.id === 'frete'), false); assert.equal(j.total, 319.7);
console.log('ok 1 preços do catálogo, frete e frete grátis acima do mínimo');

// 2. validações
const bad = async (patch, status, rx) => { const b = JSON.parse(JSON.stringify(base)); patch(b); const rr = await post('/checkout', b); assert.equal(rr.status, status); assert.match((await rr.json()).error, rx); };
await bad(b => b.items[0].size = '99', 400, /tamanho/i);
await bad(b => b.items[0].id = 'xx', 400, /dispon/i);
await bad(b => b.items = [{ id: 'esgot', size: 'P', qty: 1 }], 400, /esgotada/);
await bad(b => b.items[0].qty = 0, 400, /Quantidade/);
await bad(b => b.entrega.uf = 'AM', 400, /Ainda não entregamos/);
await bad(b => b.entrega.cep = '123', 400, /endereço/);
await bad(b => b.cliente.email = 'x', 400, /e-mail/);
await bad(b => b.cliente.telefone = '12', 400, /telefone/);
let rr = await post('/checkout', base, { origin: 'https://evil.test' }); assert.equal(rr.status, 403);
console.log('ok 2 validações');

// 3. frete pago e retirada
let o = priceOrder(catalog, { ...base, items: [{ id: 'regata', size: 'P', qty: 1 }], entrega: { ...base.entrega, uf: 'PR' } }); assert.equal(o.frete, 28.5); assert.equal(o.total, 88.4);
o = priceOrder(catalog, { ...base, items: [{ id: 'regata', size: 'P', qty: 1 }], entrega: { tipo: 'retirada' } }); assert.equal(o.frete, 0); assert.equal(o.endereco, null);
console.log('ok 3 frete por região e retirada');

// 4. webhook
const meta = { order_id: 'PABC', cliente: { nome: 'Ana', telefone: '11999991234', email: 'a@a.com' }, tipo: 'entrega', regiao: 'São Paulo', endereco: { uf: 'SP' }, itens: [{ pid: 'saia', name: 'Saia Midi', size: '38', qty: 1, price: 129.9 }], frete: 18, total: 147.9 };
const pay = (id, status, extra = {}) => ({ id, status, metadata: meta, transaction_amount: 147.9, payment_type_id: 'bank_transfer', date_created: '2026-10-26T23:30:00.000-03:00', date_approved: '2026-10-27T01:10:00.000-03:00', fee_details: [{ amount: 1.46 }], transaction_details: { net_received_amount: 146.44 }, installments: 1, ...extra });
const hook = (id, extra = {}) => call('/webhook?data.id=' + id + '&type=payment', { method: 'POST', body: JSON.stringify({ type: 'payment', data: { id } }), headers: { ...sign(id), ...extra } });

mpPayments['111'] = pay(111, 'pending'); r = await hook('111'); assert.equal(r.status, 200);
let v = JSON.parse(store).vendas; assert.equal(v.length, 1); assert.equal(v[0].status, 'pendente'); assert.equal(v[0].id, 'site-PABC'); assert.equal(v[0].date, '2026-10-26');
mpPayments['111'] = pay(111, 'approved'); conflictOnce = true; r = await hook('111'); assert.equal(r.status, 200);
v = JSON.parse(store).vendas; assert.equal(v.length, 1); assert.equal(v[0].status, 'pago'); assert.equal(v[0].date, '2026-10-27'); assert.equal(v[0].pay, 'Pix'); assert.equal(v[0].taxa, 1.46); assert.equal(v[0].liquido, 146.44); assert.equal(v[0].canal, 'Site');
const before = puts; r = await hook('111'); assert.equal(puts, before, 'aviso repetido não regrava');
mpPayments['111'] = pay(111, 'pending'); r = await hook('111'); assert.equal(JSON.parse(store).vendas[0].status, 'pago', 'não volta de pago para pendente');
{ const d = JSON.parse(store); d.vendas[0].enviado = true; store = JSON.stringify(d); sha++; }
mpPayments['111'] = pay(111, 'refunded'); r = await hook('111'); assert.equal(JSON.parse(store).vendas[0].status, 'cancelado'); assert.equal(JSON.parse(store).vendas[0].enviado, true, 'preserva o envio marcado no painel');
console.log('ok 4 webhook: pendente -> pago, conflito, repetido, fora de ordem, estorno');

// 5. ignorados e segurança
mpPayments['222'] = { id: 222, status: 'approved', metadata: {}, transaction_amount: 5 }; await hook('222'); assert.equal(JSON.parse(store).vendas.length, 1);
mpPayments['333'] = pay(333, 'rejected', { metadata: { ...meta, order_id: 'PNEW' } }); await hook('333'); assert.equal(JSON.parse(store).vendas.length, 1, 'rejeitado sem pedido anterior não entra');
r = await call('/webhook?data.id=1&type=merchant_order', { method: 'POST', body: '{}' }); assert.equal(r.status, 200);
r = await call('/webhook?data.id=999&type=payment', { method: 'POST', body: '{}' }); assert.equal(r.status, 200, 'pagamento desconhecido não gera retry');
env.STRICT_SIGNATURE = '1'; r = await call('/webhook?data.id=111&type=payment', { method: 'POST', body: '{}', headers: { 'x-signature': 'ts=1,v1=00', 'x-request-id': 'x' } }); assert.equal(r.status, 401);
r = await hook('111'); assert.equal(r.status, 200, 'assinatura correta passa no modo estrito');
env.STRICT_SIGNATURE = '0';
r = await call('/checkout', { method: 'OPTIONS', headers: { origin: 'https://site.test' } }); assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), 'https://site.test');
console.log('ok 5 ignorados, assinatura estrita, CORS');
console.log('TUDO OK');
