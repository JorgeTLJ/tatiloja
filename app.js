/* Tati Loja — catálogo. Os produtos e o WhatsApp ficam em data/loja.json. */
fetch('data/loja.json?v=' + Date.now()).then(r => r.json()).then(boot).catch(() => {
  document.getElementById('grid').innerHTML = '<p style="padding:24px">Não foi possível carregar o catálogo. Tente novamente em instantes.</p>';
});

function boot(DATA) {
const WHATSAPP = (DATA.settings.whatsapp || '').replace(/\D/g, '');
const PRODUCTS = DATA.products.filter(p => p.visible !== false);
const SEMIJOIAS = 'Semijoias';
// Pagamento direto: só liga quando data/loja.json tem settings.checkoutUrl (endereço do servidor de pagamento).
const PAY_URL = String(DATA.settings.checkoutUrl || '').replace(/\/+$/, '');
const FRETE = DATA.settings.frete || {};
if (PAY_URL) document.documentElement.classList.add('pay-on');
/* ============ UTILIDADES ============ */
const $ = (s, r = document) => r.querySelector(s);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const byId = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
const waBase = WHATSAPP ? 'https://wa.me/' + WHATSAPP : 'https://wa.me/';
const waLink = text => waBase + '?text=' + encodeURIComponent(text);
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ============ SACOLA ============ */
let bag = [];
try { bag = JSON.parse(localStorage.getItem('tatiloja.sacola') || '[]').filter(i => byId[i.id]); } catch (e) { bag = []; }
const saveBag = () => { try { localStorage.setItem('tatiloja.sacola', JSON.stringify(bag)); } catch (e) {} };
const bagCount = () => bag.reduce((n, i) => n + i.qty, 0);
const bagTotal = () => bag.reduce((n, i) => n + i.qty * byId[i.id].price, 0);

function addToBag(id, size, qty = 1) {
  const it = bag.find(i => i.id === id && i.size === size);
  if (it) it.qty += qty; else bag.push({ id, size, qty });
  saveBag(); renderBag();
}

function orderText(items, extra) {
  const lines = items.map(i => '• ' + i.qty + 'x ' + byId[i.id].name + ' (tam. ' + i.size + ') — ' + brl.format(i.qty * byId[i.id].price));
  const sub = items.reduce((n, i) => n + i.qty * byId[i.id].price, 0);
  let t = 'Olá, Tati Loja! Gostaria de fazer este pedido:\n\n' + lines.join('\n') + '\n\nSubtotal: ' + brl.format(sub);
  if (extra) t += '\n' + extra;
  return t;
}

function checkoutText() {
  const retira = $('#fShip').value === 'retirada', cep = $('#fCep').value.trim(), nome = $('#fName').value.trim();
  let extra = 'Entrega: ' + (retira ? 'Retirar na loja' : 'Receber em casa' + (cep ? ' · CEP ' + cep : ''));
  if (nome) extra += '\nNome: ' + nome;
  extra += retira
    ? '\n\nPode me enviar o link do Mercado Pago para pagar?'
    : '\n\nPode me enviar o valor do frete e o link do Mercado Pago para pagar?';
  return orderText(bag, extra);
}

function renderBag() {
  const n = bagCount();
  $('#bagCount').textContent = n;
  const list = $('#bagList');
  list.innerHTML = '';
  bag.forEach((i, idx) => {
    const p = byId[i.id];
    const li = document.createElement('li');
    li.className = 'line-item';
    li.innerHTML =
      '<img alt="" src="' + p.imgs[0] + '">' +
      '<div><div class="t">' + p.name + '</div><div class="s">Tamanho ' + i.size + ' · ' + brl.format(p.price) + '</div>' +
      '<div class="row"><div class="qty"><button type="button" data-act="minus" aria-label="Diminuir">−</button><span>' + i.qty +
      '</span><button type="button" data-act="plus" aria-label="Aumentar">+</button></div>' +
      '<span class="lp">' + brl.format(i.qty * p.price) + '</span></div>' +
      '<button type="button" class="linklike" data-act="remove">Remover</button></div>';
    li.dataset.idx = idx;
    list.appendChild(li);
  });
  const empty = n === 0;
  $('#bagEmpty').hidden = !empty; $('#bagFoot').hidden = empty; list.hidden = empty;
  updateCheckout();
}

/* ============ FRETE E TOTAL ============ */
const digits = v => String(v || '').replace(/\D/g, '');
function freteInfo() {
  if ($('#fShip').value === 'retirada') return { ok: true, valor: 0, regiao: 'Retirar na loja' };
  const uf = $('#fUf').value.trim().toUpperCase();
  if (uf.length !== 2) return { ok: false, msg: 'informe o CEP' };
  const reg = (FRETE.regioes || []).find(r => (r.ufs || []).map(x => String(x).toUpperCase()).includes(uf));
  if (!reg) return { ok: false, msg: 'não entregamos nesse estado', bloqueia: true };
  const gratis = !!FRETE.gratisAcima && bagTotal() >= Number(FRETE.gratisAcima);
  return { ok: true, valor: gratis ? 0 : Number(reg.preco) || 0, regiao: reg.nome, prazo: reg.prazo, gratis };
}
function updateCheckout() {
  const sub = bagTotal(), retira = $('#fShip').value === 'retirada', empty = bag.length === 0;
  $('#cepBox').hidden = retira; $('#addrBox').hidden = !PAY_URL || retira;
  $('#subtotal').textContent = brl.format(sub);
  let total = sub, note = '';
  if (PAY_URL) {
    const f = freteInfo();
    $('#freteVal').textContent = f.ok ? (f.valor === 0 ? 'Grátis' : brl.format(f.valor)) + (f.regiao && !retira ? ' · ' + f.regiao : '') : f.msg;
    total = sub + (f.ok ? f.valor : 0);
    if (retira) note = 'Retire na loja depois da confirmação do pagamento.';
    else if (f.ok && f.prazo) note = 'Prazo estimado: ' + f.prazo + '.';
    else if (FRETE.gratisAcima && sub < FRETE.gratisAcima) note = 'Frete grátis em compras acima de ' + brl.format(FRETE.gratisAcima) + '.';
  } else note = 'O frete é somado ao final, no WhatsApp. Lá você recebe o link do Mercado Pago com o valor total.';
  $('#totalVal').textContent = brl.format(total); $('#coNote').textContent = note;
  const co = $('#checkout');
  if (empty) { co.removeAttribute('href'); co.setAttribute('aria-disabled', 'true'); }
  else { co.href = waLink(checkoutText()); co.removeAttribute('aria-disabled'); }
}
if (FRETE.retirada === false) { const o = $('#fShip option[value="retirada"]'); if (o) o.remove(); }

$('#bagList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const idx = +b.closest('.line-item').dataset.idx, it = bag[idx], act = b.dataset.act;
  if (act === 'plus') it.qty += 1;
  if (act === 'minus') it.qty -= 1;
  if (act === 'remove' || it.qty <= 0) bag.splice(idx, 1);
  saveBag(); renderBag();
});
['input', 'change'].forEach(ev => {
  ['#fName', '#fShip', '#fCep', '#fTel', '#fMail', '#fRua', '#fNum', '#fCompl', '#fBairro', '#fCidade', '#fUf'].forEach(s => $(s).addEventListener(ev, () => { $('#coErr').textContent = ''; updateCheckout(); }));
});
let cepLast = '';
async function lookupCep(d) {
  if (!PAY_URL || d === cepLast) return; cepLast = d;
  const msg = $('#cepMsg'); msg.textContent = 'Buscando endereço…';
  try {
    const j = await (await fetch('https://viacep.com.br/ws/' + d + '/json/')).json();
    if (j.erro) { msg.textContent = 'CEP não encontrado. Preencha o endereço abaixo.'; return; }
    if (j.logradouro) $('#fRua').value = j.logradouro;
    if (j.bairro) $('#fBairro').value = j.bairro;
    $('#fCidade').value = j.localidade || ''; $('#fUf').value = j.uf || '';
    msg.textContent = ''; updateCheckout(); if (!$('#fNum').value) $('#fNum').focus();
  } catch (_) { msg.textContent = 'Não consegui buscar o CEP. Preencha o endereço abaixo.'; }
}
$('#fCep').addEventListener('input', e => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 8);
  e.target.value = d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
  if (d.length === 8) lookupCep(d); else cepLast = '';
});
$('#fUf').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase(); });
$('#bagFoot').addEventListener('submit', async e => {
  e.preventDefault();
  if (!PAY_URL || !bag.length) return;
  const err = m => { $('#coErr').textContent = m; }; err('');
  const nome = $('#fName').value.trim(), tel = digits($('#fTel').value), mail = $('#fMail').value.trim();
  if (nome.length < 2) return err('Informe seu nome.');
  if (tel.length < 10) return err('Informe seu WhatsApp com DDD.');
  if (!/^\S+@\S+\.\S+$/.test(mail)) return err('Informe um e-mail válido.');
  let entrega = { tipo: 'retirada' };
  if ($('#fShip').value !== 'retirada') {
    entrega = { tipo: 'entrega', cep: digits($('#fCep').value), rua: $('#fRua').value.trim(), numero: $('#fNum').value.trim(), compl: $('#fCompl').value.trim(), bairro: $('#fBairro').value.trim(), cidade: $('#fCidade').value.trim(), uf: $('#fUf').value.trim().toUpperCase() };
    if (entrega.cep.length !== 8) return err('Informe o CEP.');
    if (!entrega.rua || !entrega.numero || !entrega.bairro || !entrega.cidade || entrega.uf.length !== 2) return err('Complete o endereço de entrega.');
    const f = freteInfo();
    if (!f.ok) return err(f.bloqueia ? 'Ainda não entregamos nesse estado. Escolha retirar na loja ou chame no WhatsApp.' : 'Confira o endereço de entrega.');
  }
  const btn = $('#payBtn'); btn.disabled = true; btn.textContent = 'Abrindo o Mercado Pago…';
  try {
    const r = await fetch(PAY_URL + '/checkout', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: bag.map(i => ({ id: i.id, size: i.size, qty: i.qty })), cliente: { nome, telefone: tel, email: mail }, entrega }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) throw new Error(j.error || 'Não consegui iniciar o pagamento. Tente de novo ou peça pelo WhatsApp.');
    location.href = j.url;
  } catch (ex) {
    err(ex instanceof TypeError ? 'Sem conexão com o pagamento agora. Tente de novo ou peça pelo WhatsApp.' : ex.message);
    btn.disabled = false; btn.textContent = 'Pagar com Mercado Pago';
  }
});
window.addEventListener('pageshow', () => { const b = $('#payBtn'); b.disabled = false; b.textContent = 'Pagar com Mercado Pago'; });
$('#checkout').addEventListener('click', e => {
  if ($('#checkout').getAttribute('aria-disabled') === 'true') e.preventDefault();
});

/* ============ CAMADAS (produto e sacola) ============ */
let lastFocus = null, openLayer = null;
function showLayer(el, focusSel) {
  lastFocus = document.activeElement; openLayer = el; el.hidden = false;
  document.documentElement.style.overflow = 'hidden';
  const f = $(focusSel, el); if (f) f.focus();
}
function hideLayer() {
  if (!openLayer) return;
  openLayer.hidden = true; openLayer = null;
  document.documentElement.style.overflow = '';
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) hideLayer(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideLayer(); });
$('#bagBtn').addEventListener('click', () => showLayer($('#bagLayer'), '.close'));

function priceHtml(p) {
  return (p.oldPrice && p.oldPrice > p.price ? '<s class="old">' + brl.format(p.oldPrice) + '</s> ' : '') + brl.format(p.price);
}

/* ============ PRODUTO ============ */
let current = null, chosen = null;
function openProduct(id) {
  const p = byId[id]; current = p; chosen = null;
  $('#pImg').src = p.imgs[0]; $('#pImg').alt = (p.alt || p.name);
  $('#pCat').textContent = p.cat; $('#pTitle').textContent = p.name;
  $('#pPrice').innerHTML = priceHtml(p); $('#pDesc').textContent = p.desc;
  $('#pError').textContent = '';
  const box = $('#pSizes'); box.innerHTML = '';
  p.sizes.forEach(s => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'size'; b.textContent = s;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
    b.addEventListener('click', () => {
      chosen = s; $('#pError').textContent = '';
      box.querySelectorAll('.size').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      const w = $('#pWhats');
      w.href = waLink(orderText([{ id: p.id, size: s, qty: 1 }], 'Pode me enviar o valor do frete e o link do Mercado Pago para pagar?'));
      w.removeAttribute('aria-disabled');
    });
    box.appendChild(b);
  });
  const w = $('#pWhats'); w.removeAttribute('href'); w.setAttribute('aria-disabled', 'true');
  showLayer($('#productLayer'), '.size');
}
$('#pAdd').addEventListener('click', () => {
  if (current.soldOut) { $('#pError').textContent = 'Peça esgotada no momento. Chame no WhatsApp para saber da reposição.'; return; }
  if (!chosen) { $('#pError').textContent = 'Escolha um tamanho para continuar.'; return; }
  addToBag(current.id, chosen);
  hideLayer(); toast('Adicionado à sacola');
});
$('#pWhats').addEventListener('click', e => {
  if ($('#pWhats').getAttribute('aria-disabled') === 'true') { e.preventDefault(); $('#pError').textContent = 'Escolha um tamanho para continuar.'; }
});

/* ============ VITRINE ============ */
let filter = 'Todos', sort = 'new';
const cats = ['Todos', ...new Set([...PRODUCTS.map(p => p.cat).filter(c => c !== SEMIJOIAS), SEMIJOIAS])];

function renderChips() {
  const box = $('#chips'); box.innerHTML = '';
  cats.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = c;
    b.setAttribute('aria-pressed', String(c === filter));
    b.addEventListener('click', () => { filter = c; renderChips(); renderGrid(); });
    box.appendChild(b);
  });
}
function renderGrid() {
  const grid = $('#grid'); grid.innerHTML = '';
  if (filter === SEMIJOIAS && !PRODUCTS.some(p => p.cat === SEMIJOIAS)) {
    $('#count').textContent = '';
    grid.innerHTML = '<div class="empty-card"><h3>Semijoias em breve por aqui</h3><p>Estamos preparando as fotos. Enquanto isso, chame no WhatsApp e mostramos as peças disponíveis na loja.</p><a class="btn" href="' +
      waLink('Olá, Tati Loja! Quero ver as semijoias disponíveis.') + '" target="_blank" rel="noopener">Ver semijoias no WhatsApp</a></div>';
    return;
  }
  let items = PRODUCTS.filter(p => filter === 'Todos' || p.cat === filter);
  if (sort === 'asc') items = [...items].sort((a, b) => a.price - b.price);
  if (sort === 'desc') items = [...items].sort((a, b) => b.price - a.price);
  $('#count').textContent = items.length + (items.length === 1 ? ' peça' : ' peças');
  items.forEach(p => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'card';
    b.setAttribute('aria-label', p.name + ', ' + brl.format(p.price));
    b.innerHTML = '<span class="media"><img loading="lazy" alt="' + (p.alt || p.name) + '" src="' + p.imgs[0] + '" width="600" height="800"><span class="add">' + (p.soldOut ? 'Esgotado' : 'Escolher tamanho') + '</span>' + (p.soldOut ? '<span class="sold">Esgotado</span>' : '') + '</span>' +
      '<span class="info"><span class="cat">' + p.cat + '</span><span class="name">' + p.name + '</span><span class="price">' + priceHtml(p) + '</span></span>';
    b.addEventListener('click', () => openProduct(p.id));
    grid.appendChild(b);
  });
}
$('#sort').addEventListener('change', e => { sort = e.target.value; renderGrid(); });

/* ============ INÍCIO ============ */
$('#logoImg').src = 'img/logo.jpg';
const hello = waLink('Olá, Tati Loja! Vim pelo catálogo e gostaria de ajuda.');
$('#heroWhats').href = hello; $('#jewelWhats').href = waLink('Olá, Tati Loja! Quero ver as semijoias disponíveis.');
renderChips(); renderGrid(); renderBag();
}
