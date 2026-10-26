// Servidor de pagamento da Tati Loja (Cloudflare Worker).
//   POST /checkout  -> cria o pagamento no Mercado Pago (preços vêm do catálogo, nunca do navegador)
//   POST /webhook   -> aviso do Mercado Pago; confirma o pagamento na API e grava a venda em tldados/vendas.json

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; this.publicMessage = message; }
}
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

function corsHeaders(req, env) {
  const origin = req.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    return { 'access-control-allow-origin': origin, vary: 'origin', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
  }
  return {};
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/checkout' && req.method === 'POST') {
        if (req.headers.get('origin') && !cors['access-control-allow-origin']) throw new HttpError(403, 'Origem não permitida.');
        return json(await checkout(req, env, url), 200, cors);
      }
      if (url.pathname === '/webhook' && (req.method === 'POST' || req.method === 'GET')) return await webhook(req, env, url);
      if (url.pathname === '/') return json({ ok: true, service: 'tatiloja-api' }, 200, cors);
      return json({ error: 'Não encontrado.' }, 404, cors);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('erro', e && e.stack || e);
      return json({ error: e instanceof HttpError ? e.publicMessage : 'Erro interno. Tente novamente.' }, e instanceof HttpError ? e.status : 500, cors);
    }
  },
};

/* ---------------- util ---------------- */
const cents = n => Math.round(Number(n) * 100) / 100;
const digits = s => String(s == null ? '' : s).replace(/\D/g, '');
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, max);
const utf8ToB64 = str => { const b = new TextEncoder().encode(str); let s = ''; for (const c of b) s += String.fromCharCode(c); return btoa(s); };
const b64ToUtf8 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), c => c.charCodeAt(0)));
const saoPauloDate = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

async function loadCatalog(env) {
  const r = await fetch(env.SITE_URL + '/data/loja.json?t=' + Math.floor(Date.now() / 30000), { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new HttpError(502, 'Não consegui carregar o catálogo agora. Tente novamente.');
  return r.json();
}

/* ---------------- checkout ---------------- */
export function priceOrder(catalog, body) {
  const byId = new Map((catalog.products || []).map(p => [p.id, p]));
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length || rawItems.length > 30) throw new HttpError(400, 'Sua sacola está vazia.');
  const lines = rawItems.map(it => {
    const p = byId.get(String(it.id));
    if (!p || p.visible === false) throw new HttpError(400, 'Uma das peças não está mais disponível. Atualize a página.');
    if (p.soldOut) throw new HttpError(400, '"' + p.name + '" está esgotada.');
    const size = String(it.size || '');
    if (!(p.sizes || []).includes(size)) throw new HttpError(400, 'Escolha um tamanho válido para "' + p.name + '".');
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new HttpError(400, 'Quantidade inválida.');
    return { pid: p.id, name: p.name, size, qty, price: cents(p.price) };
  });
  const subtotal = cents(lines.reduce((n, l) => n + l.qty * l.price, 0));

  const c = body.cliente || {}, e = body.entrega || {};
  const cliente = { nome: clean(c.nome, 80), telefone: digits(c.telefone), email: clean(c.email, 120).toLowerCase() };
  if (cliente.nome.length < 2) throw new HttpError(400, 'Informe seu nome.');
  if (cliente.telefone.length < 10 || cliente.telefone.length > 13) throw new HttpError(400, 'Informe um telefone com DDD.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente.email)) throw new HttpError(400, 'Informe um e-mail válido.');

  const cfg = catalog.settings && catalog.settings.frete || {};
  let frete = 0, regiao = '', endereco = null, tipo = e.tipo === 'entrega' ? 'entrega' : 'retirada';
  if (tipo === 'retirada') {
    if (cfg.retirada === false) throw new HttpError(400, 'A retirada na loja não está disponível.');
    regiao = 'Retirar na loja';
  } else {
    endereco = { cep: digits(e.cep), rua: clean(e.rua, 120), numero: clean(e.numero, 20), compl: clean(e.compl, 60), bairro: clean(e.bairro, 80), cidade: clean(e.cidade, 80), uf: clean(e.uf, 2).toUpperCase() };
    if (endereco.cep.length !== 8 || !endereco.rua || !endereco.numero || !endereco.bairro || !endereco.cidade || !UFS.includes(endereco.uf)) throw new HttpError(400, 'Confira o endereço de entrega.');
    const reg = (cfg.regioes || []).find(r => (r.ufs || []).map(x => String(x).toUpperCase()).includes(endereco.uf));
    if (!reg) throw new HttpError(400, 'Ainda não entregamos nesse estado. Escolha retirar na loja ou chame no WhatsApp.');
    regiao = reg.nome;
    frete = cents(reg.preco);
    if (cfg.gratisAcima && subtotal >= Number(cfg.gratisAcima)) frete = 0;
  }
  return { lines, subtotal, frete, regiao, tipo, cliente, endereco, total: cents(subtotal + frete) };
}

async function checkout(req, env, url) {
  let body; try { body = await req.json(); } catch (_) { throw new HttpError(400, 'Pedido inválido.'); }
  if (!env.MP_ACCESS_TOKEN) throw new HttpError(503, 'Pagamento ainda não está ativo.');
  const catalog = await loadCatalog(env);
  const o = priceOrder(catalog, body);
  const orderId = 'P' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  const site = env.SITE_URL;
  const tel = o.cliente.telefone.replace(/^55(?=\d{10,11}$)/, '');
  const items = o.lines.map(l => ({ id: l.pid, title: (l.name + ' (tam. ' + l.size + ')').slice(0, 250), quantity: l.qty, unit_price: l.price, currency_id: 'BRL' }));
  if (o.frete > 0) items.push({ id: 'frete', title: ('Frete - ' + o.regiao).slice(0, 250), quantity: 1, unit_price: o.frete, currency_id: 'BRL' });
  const pref = {
    items,
    payer: { name: o.cliente.nome, email: o.cliente.email, phone: { area_code: tel.slice(0, 2), number: tel.slice(2) } },
    back_urls: { success: site + '/pedido.html', pending: site + '/pedido.html', failure: site + '/pedido.html' },
    auto_return: 'approved',
    external_reference: orderId,
    notification_url: url.origin + '/webhook',
    statement_descriptor: 'TATI LOJA',
    payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }], installments: Math.max(1, Math.min(12, parseInt(env.MAX_INSTALLMENTS, 10) || 6)) },
    metadata: { order_id: orderId, cliente: o.cliente, tipo: o.tipo, regiao: o.regiao, endereco: o.endereco, itens: o.lines, frete: o.frete, total: o.total },
  };
  const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.MP_ACCESS_TOKEN, 'content-type': 'application/json', 'x-idempotency-key': orderId },
    body: JSON.stringify(pref),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.init_point) {
    console.error('mercado pago recusou a preferência', r.status, JSON.stringify(data).slice(0, 500));
    throw new HttpError(502, 'Não consegui iniciar o pagamento agora. Tente de novo ou peça pelo WhatsApp.');
  }
  return { url: data.init_point, orderId, total: o.total };
}

/* ---------------- webhook ---------------- */
async function verifySignature(req, env, dataId) {
  const secret = env.MP_WEBHOOK_SECRET, sig = req.headers.get('x-signature'), rid = req.headers.get('x-request-id') || '';
  if (!secret || !sig) return false;
  const parts = Object.fromEntries(sig.split(',').map(s => s.trim().split('=').map(x => x.trim())).filter(a => a.length === 2));
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = 'id:' + id + ';request-id:' + rid + ';ts:' + parts.ts + ';';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest)));
  const hex = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== parts.v1.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

async function webhook(req, env, url) {
  let dataId = url.searchParams.get('data.id') || url.searchParams.get('id');
  let type = url.searchParams.get('type') || url.searchParams.get('topic');
  if (req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (body) { dataId = dataId || (body.data && body.data.id); type = type || body.type; }
  }
  if (type && type !== 'payment') return new Response('ignorado', { status: 200 });
  if (!dataId) return new Response('sem id', { status: 200 });
  dataId = String(dataId);

  const okSig = await verifySignature(req, env, dataId);
  if (!okSig) {
    console.warn('assinatura do aviso não confere (pagamento ' + dataId + ')');
    if (env.STRICT_SIGNATURE === '1') return new Response('assinatura inválida', { status: 401 });
  }
  // A fonte da verdade é a própria API do Mercado Pago, não o conteúdo do aviso.
  const r = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(dataId), { headers: { authorization: 'Bearer ' + env.MP_ACCESS_TOKEN } });
  if (r.status === 404) return new Response('pagamento desconhecido', { status: 200 });
  if (!r.ok) throw new Error('Mercado Pago respondeu ' + r.status);
  await recordPayment(await r.json(), env);
  return new Response('ok', { status: 200 });
}

const STATUS = { approved: 'pago', authorized: 'pendente', in_process: 'pendente', pending: 'pendente', in_mediation: 'pendente', cancelled: 'cancelado', refunded: 'cancelado', charged_back: 'cancelado', rejected: 'rejeitado' };
const PAY = { bank_transfer: 'Pix', credit_card: 'Cartão', debit_card: 'Cartão', prepaid_card: 'Cartão', account_money: 'Mercado Pago' };

export function buildSale(pay, existing) {
  const meta = pay.metadata || {};
  if (!meta.order_id || !Array.isArray(meta.itens)) return null; // pagamento que não veio deste site
  const st = STATUS[pay.status];
  if (!st) return null;
  if (!existing && st !== 'pago' && st !== 'pendente') return null;
  if (existing && existing.status === 'pago' && st === 'pendente') return existing; // aviso fora de ordem
  if (existing && st === 'rejeitado') return existing; // a cliente pode tentar de novo
  const status = st === 'rejeitado' ? 'cancelado' : st;
  const itens = meta.itens.map(i => ({ pid: i.pid, name: i.name, size: i.size, qty: i.qty, price: i.price }));
  const expected = cents(itens.reduce((n, i) => n + i.qty * i.price, 0) + (meta.frete || 0));
  const fees = (pay.fee_details || []).reduce((n, f) => n + (Number(f.amount) || 0), 0);
  const net = pay.transaction_details && pay.transaction_details.net_received_amount;
  const warn = Math.abs(cents(pay.transaction_amount) - expected) > 0.01 ? ' · ATENÇÃO: valor pago difere do pedido' : '';
  return {
    id: 'site-' + meta.order_id,
    date: saoPauloDate(status === 'pago' ? (pay.date_approved || pay.date_created) : pay.date_created),
    status, items: itens, discount: 0, frete: meta.frete || 0,
    pay: PAY[pay.payment_type_id] || 'Mercado Pago', canal: 'Site',
    cliente: meta.cliente && meta.cliente.nome || '',
    obs: 'Pedido ' + meta.order_id + ' · MP #' + pay.id + warn,
    origem: 'site', orderId: meta.order_id, mpId: pay.id,
    contato: meta.cliente ? { telefone: meta.cliente.telefone, email: meta.cliente.email } : null,
    entrega: { tipo: meta.tipo, regiao: meta.regiao, endereco: meta.endereco || null },
    taxa: cents(fees), liquido: net == null ? null : cents(net),
    parcelas: pay.installments || 1,
    ...(existing && existing.enviado ? { enviado: true } : {}),
  };
}

async function gh(env, path, opts = {}) {
  return fetch('https://api.github.com/repos/' + env.DATA_REPO + path, {
    ...opts,
    headers: { authorization: 'Bearer ' + env.GH_TOKEN, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'tatiloja-api', 'content-type': 'application/json' },
  });
}

async function recordPayment(pay, env) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const g = await gh(env, '/contents/vendas.json');
    let vendas = [], sha;
    if (g.ok) { const f = await g.json(); vendas = (JSON.parse(b64ToUtf8(f.content)).vendas) || []; sha = f.sha; }
    else if (g.status !== 404) throw new Error('GitHub (ler) respondeu ' + g.status);
    const id = 'site-' + (pay.metadata && pay.metadata.order_id);
    const idx = vendas.findIndex(v => v.id === id);
    const sale = buildSale(pay, idx >= 0 ? vendas[idx] : null);
    if (!sale || (idx >= 0 && JSON.stringify(sale) === JSON.stringify(vendas[idx]))) return;
    if (idx >= 0) vendas[idx] = sale; else vendas.push(sale);
    const put = await gh(env, '/contents/vendas.json', {
      method: 'PUT',
      body: JSON.stringify({ message: 'Pedido ' + sale.orderId + ': ' + sale.status, content: utf8ToB64(JSON.stringify({ v: 1, vendas }, null, 2) + '\n'), ...(sha ? { sha } : {}) }),
    });
    if (put.ok) return;
    if (put.status === 409 || put.status === 422) { await new Promise(r => setTimeout(r, 250 * (attempt + 1) + Math.random() * 250)); continue; }
    throw new Error('GitHub (gravar) respondeu ' + put.status);
  }
  throw new Error('Não consegui gravar a venda depois de várias tentativas');
}
