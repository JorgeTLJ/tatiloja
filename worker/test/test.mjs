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

// ---- cotação de frete (Melhor Envio simulado) ----
{
  const realFetch = globalThis.fetch; let meCalls = [], meMode = 'ok';
  globalThis.fetch = async (u, o = {}) => {
    if (String(u) === 'https://melhorenvio.com.br/api/v2/me/shipment/calculate') {
      meCalls.push({ h: o.headers, b: JSON.parse(o.body) });
      if (meMode === 'erro') return new Response('{"message":"x"}', { status: 500 });
      return new Response(JSON.stringify([
        { id: 1, name: 'PAC', price: '22.10', custom_price: '21.40', delivery_time: 6, custom_delivery_time: 6, company: { name: 'Correios' } },
        { id: 2, name: 'SEDEX', price: '40.00', custom_price: '38.50', delivery_time: 2, custom_delivery_time: 2, company: { name: 'Correios' } },
        { id: 3, name: '.Package', price: '15.00', custom_price: '15.00', delivery_time: 5, company: { name: 'Correios' } },
        { id: 4, name: '.Com', price: '0', error: 'Serviço indisponível', company: { name: 'Correios' } }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(u, o);
  };
  const envME = { ...env, ME_TOKEN: 'mt', ORIGIN_CEP: '04671-011', ME_CONTACT: 'dono@loja.test' };
  const callME = (p, b) => worker.fetch(new Request('https://api.test' + p, { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json', origin: 'https://site.test' } }), envME);
  const q = { items: [{ id: 'regata', size: 'M', qty: 2 }], cep: '01310-100', uf: 'SP' };
  let rs = await callME('/frete', q); let js = await rs.json();
  assert.equal(rs.status, 200); assert.equal(js.fonte, 'cotacao');
  assert.deepEqual(js.opcoes.map(o => [o.id, o.preco, o.prazo]), [['pac', 21.4, '7 dias úteis'], ['sedex', 38.5, '3 dias úteis']]);
  const sent = meCalls[0]; assert.equal(sent.b.from.postal_code, '04671011'); assert.equal(sent.b.to.postal_code, '01310100');
  assert.equal(sent.b.products[0].weight, 1); assert.equal(sent.b.products[0].height, 10); assert.equal(sent.b.products[0].insurance_value, 119.8);
  assert.match(sent.h['user-agent'], /dono@loja.test/); assert.equal(sent.h.authorization, 'Bearer mt');
  // checkout cobra o serviço escolhido, não o preço do navegador
  const ck = { items: [{ id: 'regata', size: 'M', qty: 1 }], cliente: base.cliente, entrega: { ...base.entrega, servico: 'sedex' } };
  prefs.length = 0; rs = await callME('/checkout', ck); js = await rs.json();
  assert.equal(rs.status, 200); assert.equal(prefs[0].items.find(i => i.id === 'frete').unit_price, 38.5); assert.equal(js.total, 98.4);
  rs = await callME('/checkout', { ...ck, entrega: { ...ck.entrega, servico: 'xx' } }); assert.equal(rs.status, 400);
  // erro do Melhor Envio: /frete cai na tabela; checkout com PAC/SEDEX recusa
  meMode = 'erro';
  rs = await callME('/frete', q); js = await rs.json(); assert.equal(js.fonte, 'tabela'); assert.deepEqual(js.opcoes.map(o => [o.id, o.preco]), [['tabela', 18]]);
  rs = await callME('/checkout', ck); assert.equal(rs.status, 502);
  rs = await callME('/checkout', { ...ck, entrega: { ...ck.entrega, servico: 'tabela' } }); assert.equal(rs.status, 200);
  // sem token: tabela, como antes
  rs = await post('/frete', q); js = await rs.json(); assert.equal(js.fonte, 'tabela');
  globalThis.fetch = realFetch;
  console.log('ok 4 cotação de frete: PAC/SEDEX, preço confirmado no servidor, plano B pela tabela');
}

// ---- estoque ----
{
  const { soldMap, availability } = await import('../src/index.js');
  const cat = { products: [{ id: 'a', sizes: ['P', 'M'], stock: { P: 3, M: 1 } }, { id: 'b', sizes: ['U'] }] };
  const sold = soldMap([
    { status: 'pago', items: [{ pid: 'a', size: 'p', qty: 1 }] },
    { status: 'pendente', items: [{ pid: 'a', size: 'P', qty: 1 }] },
    { status: 'cancelado', items: [{ pid: 'a', size: 'P', qty: 5 }] },
    { status: 'pago', items: [{ pid: 'a', size: 'M', qty: 1 }, { pid: 'b', size: 'U', qty: 9 }] }]);
  assert.deepEqual(availability(cat, sold), { a: { P: 1, M: 0 } });   // cancelada devolve; b sem controle fica de fora
  // checkout recusa acima do estoque e aceita dentro dele
  const saved = JSON.stringify(catalog.products); const savedStore = store; const savedSha = sha;
  catalog.products.find(p => p.id === 'regata').stock = { P: 2, M: 2 };
  store = JSON.stringify({ v: 1, vendas: [{ id: 'x1', status: 'pago', items: [{ pid: 'regata', size: 'M', qty: 1 }] }, { id: 'x2', status: 'cancelado', items: [{ pid: 'regata', size: 'M', qty: 9 }] }] });
  const ret = { items: [{ id: 'regata', size: 'M', qty: 1 }], cliente: base.cliente, entrega: { tipo: 'retirada' } };
  prefs.length = 0;
  let r4 = await post('/checkout', ret); assert.equal(r4.status, 200);                                   // resta 1 de M
  r4 = await post('/checkout', { ...ret, items: [{ id: 'regata', size: 'M', qty: 2 }] }); assert.equal(r4.status, 400);
  assert.match((await r4.json()).error, /Só restam 1 unidade/);
  store = JSON.stringify({ v: 1, vendas: [{ id: 'x1', status: 'pendente', items: [{ pid: 'regata', size: 'M', qty: 2 }] }] });
  r4 = await post('/checkout', ret); assert.equal(r4.status, 400); assert.match((await r4.json()).error, /acabou/);
  r4 = await post('/checkout', { ...ret, items: [{ id: 'regata', size: 'P', qty: 2 }] }); assert.equal(r4.status, 200);   // P intacto
  // rota pública de disponibilidade
  r4 = await call('/estoque', { headers: { origin: 'https://site.test' } }); const j4 = await r4.json();
  assert.equal(r4.status, 200); assert.deepEqual(j4.estoque, { regata: { P: 2, M: 0 } });
  assert.equal(r4.headers.get('access-control-allow-origin'), 'https://site.test');
  // GitHub fora do ar: vende sem limite, não trava
  const f0 = globalThis.fetch; globalThis.fetch = async (u, o) => String(u).includes('api.github.com') ? new Response('{}', { status: 500 }) : f0(u, o);
  r4 = await post('/checkout', { ...ret, items: [{ id: 'regata', size: 'M', qty: 3 }] }); assert.equal(r4.status, 200);
  globalThis.fetch = f0;
  catalog.products = JSON.parse(saved); store = savedStore; sha = savedSha;
  console.log('ok 5 estoque: vendas pagas/pendentes baixam, canceladas devolvem, checkout recusa excesso, rota /estoque, plano B');
}
