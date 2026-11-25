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

let AVAIL = {};
const leftOf = (p, size) => AVAIL[p.id] ? (Number(AVAIL[p.id][size]) || 0) : Infinity;
const outNow = p => !!p.soldOut || (!!AVAIL[p.id] && p.sizes.every(s => leftOf(p, s) <= 0));
function addToBag(id, size, qty = 1) {
  const it = bag.find(i => i.id === id && i.size === size), have = it ? it.qty : 0, left = leftOf(byId[id], size);
  if (have + qty > left) return left;
  if (it) it.qty += qty; else bag.push({ id, size, qty });
  saveBag(); renderBag();
  return true;
}

function orderText(items, extra) {
  const lines = items.map(i => '• ' + i.qty + 'x ' + byId[i.id].name + ' (tam. ' + i.size + ') — ' + brl.format(i.qty * byId[i.id].price));
  const sub = items.reduce((n, i) => n + i.qty * byId[i.id].price, 0);
  let t = 'Olá, Tati Loja! Gostaria de fazer este pedido:\n\n' + lines.join('\n') + '\n\nSubtotal: ' + brl.format(sub);
  if (extra) t += '\n' + extra;
  return t;
}

function checkoutText() {
  const mode = $('#fShip').value, retira = mode === 'retirada', combinar = mode === 'combinar', cep = $('#fCep').value.trim(), nome = $('#fName').value.trim();
  let extra = 'Entrega: ' + (retira ? 'Retirar na loja' : combinar ? 'Quero combinar a entrega com vocês' : 'Receber em casa' + (cep ? ' · CEP ' + cep : ''));
  if (nome) extra += '\nNome: ' + nome;
  extra += retira || combinar
    ? (combinar ? '\n\nPode me passar as opções de entrega, o valor do frete e o link do Mercado Pago para pagar?' : '\n\nPode me enviar o link do Mercado Pago para pagar?')
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
let quote = null, quoteKey = '', quoteSel = '';
function quoteKeyNow() {
  const cep = digits($('#fCep').value), uf = $('#fUf').value.trim().toUpperCase();
  if (cep.length !== 8 || uf.length !== 2 || !bag.length || $('#fShip').value !== 'entrega') return '';
  return cep + '|' + uf + '|' + bag.map(i => i.id + ':' + i.size + ':' + i.qty).join(',');
}
async function fetchQuote() {
  const key = quoteKeyNow();
  if (key === quoteKey) return;
  quoteKey = key; quote = key ? { loading: true } : null; quoteSel = '';
  if (!key) return renderFreteOpts();
  renderFreteOpts();
  try {
    const r = await fetch(PAY_URL + '/frete', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: bag.map(i => ({ id: i.id, size: i.size, qty: i.qty })), cep: digits($('#fCep').value), uf: $('#fUf').value.trim().toUpperCase() }) });
    const j = await r.json().catch(() => ({}));
    if (key !== quoteKey) return;
    quote = r.ok && j.opcoes ? { opcoes: j.opcoes } : { erro: j.error || 'Não consegui calcular o frete agora. Tente de novo.', bloqueia: r.status === 400 };
  } catch (_) { if (key !== quoteKey) return; quote = { erro: 'Sem conexão para calcular o frete. Tente de novo.' }; }
  if (quote.opcoes) quoteSel = quote.opcoes[0].id;
  renderFreteOpts(); updateCheckout();
}
function renderFreteOpts() {
  const box = $('#freteOpts'); box.innerHTML = '';
  const retira = $('#fShip').value !== 'entrega';
  box.hidden = retira || !quote || !!quote.loading || !!quote.erro || quote.opcoes.length < 2;
  if (box.hidden) return;
  quote.opcoes.forEach(o => {
    const l = document.createElement('label'); l.className = 'fopt';
    const r = document.createElement('input'); r.type = 'radio'; r.name = 'fservico'; r.value = o.id; r.checked = o.id === quoteSel;
    r.addEventListener('change', () => { quoteSel = o.id; updateCheckout(); });
    const t = document.createElement('span'); t.innerHTML = '<b></b><small></small>';
    t.querySelector('b').textContent = o.nome + ' · ' + (o.preco === 0 ? 'Grátis' : brl.format(o.preco));
    t.querySelector('small').textContent = o.prazo ? 'Chega em cerca de ' + o.prazo : '';
    l.append(r, t); box.appendChild(l);
  });
}
function freteInfo() {
  if ($('#fShip').value === 'retirada') return { ok: true, valor: 0, regiao: 'Retirar na loja' };
  if ($('#fShip').value === 'combinar') return { ok: true, valor: 0, regiao: 'A combinar' };
  const uf = $('#fUf').value.trim().toUpperCase();
  if (uf.length !== 2) return { ok: false, msg: 'informe o CEP' };
  if (quote && quote.loading) return { ok: false, msg: 'calculando…', espera: true };
  if (quote && quote.erro) return { ok: false, msg: quote.erro, bloqueia: !!quote.bloqueia };
  if (quote && quote.opcoes) { const o = quote.opcoes.find(x => x.id === quoteSel) || quote.opcoes[0]; return { ok: true, valor: o.preco, regiao: o.nome, prazo: o.prazo, servico: o.id }; }
  const reg = (FRETE.regioes || []).find(r => (r.ufs || []).map(x => String(x).toUpperCase()).includes(uf));
  if (!reg) return { ok: false, msg: 'não entregamos nesse estado', bloqueia: true };
  const gratis = !!FRETE.gratisAcima && bagTotal() >= Number(FRETE.gratisAcima);
  return { ok: true, valor: gratis ? 0 : Number(reg.preco) || 0, regiao: reg.nome, prazo: reg.prazo, gratis };
}
function updateCheckout() {
  const mode = $('#fShip').value, sub = bagTotal(), retira = mode === 'retirada', combinar = mode === 'combinar', empty = bag.length === 0;
  $('#cepBox').hidden = retira || combinar; $('#addrBox').hidden = !PAY_URL || retira || combinar;
  $('#payBtn').hidden = combinar; $('#freteRow').hidden = combinar; $('#bagFoot').classList.toggle('combinar', combinar);
  $('#subtotal').textContent = brl.format(sub);
  let total = sub, note = '';
  if (PAY_URL) {
    const f = freteInfo();
    $('#freteVal').textContent = f.ok ? (f.valor === 0 ? 'Grátis' : brl.format(f.valor)) + (f.regiao && !retira ? ' · ' + f.regiao : '') : f.msg;
    total = sub + (f.ok ? f.valor : 0);
    if (combinar) note = 'Vamos combinar a entrega, o frete e o pagamento pelo WhatsApp.';
    else if (retira) note = 'Retire na loja depois da confirmação do pagamento.';
    else if (f.ok && f.prazo) note = 'Prazo estimado: ' + f.prazo + '.';
    else if (FRETE.gratisAcima && sub < FRETE.gratisAcima) note = 'Frete grátis em compras acima de ' + brl.format(FRETE.gratisAcima) + '.';
  } else note = 'O frete é somado ao final, no WhatsApp. Lá você recebe o link do Mercado Pago com o valor total.';
  $('#totalVal').textContent = brl.format(total); $('#coNote').textContent = note;
  if (PAY_URL) fetchQuote();
  const co = $('#checkout');
  if (empty) { co.removeAttribute('href'); co.setAttribute('aria-disabled', 'true'); }
  else { co.href = waLink(checkoutText()); co.removeAttribute('aria-disabled'); }
}
if (FRETE.retirada === false) { const o = $('#fShip option[value="retirada"]'); if (o) o.remove(); }

$('#bagList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const idx = +b.closest('.line-item').dataset.idx, it = bag[idx], act = b.dataset.act;
  if (act === 'plus') { const left = leftOf(byId[it.id], it.size); if (it.qty + 1 > left) { $('#coErr').textContent = 'Só temos ' + left + (left === 1 ? ' unidade' : ' unidades') + ' desse tamanho.'; return; } it.qty += 1; }
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
  if (!PAY_URL || !bag.length || $('#fShip').value === 'combinar') return;
  const err = m => { $('#coErr').textContent = m; }; err('');
  const nome = $('#fName').value.trim(), tel = digits($('#fTel').value), mail = $('#fMail').value.trim();
  if (nome.length < 2) return err('Informe seu nome.');
  if (tel.length < 10) return err('Informe seu WhatsApp com DDD.');
  if (!/^\S+@\S+\.\S+$/.test(mail)) return err('Informe um e-mail válido.');
  let entrega = { tipo: 'retirada' };
  if ($('#fShip').value !== 'retirada') {
    entrega = { tipo: 'entrega', servico: quoteSel || undefined, cep: digits($('#fCep').value), rua: $('#fRua').value.trim(), numero: $('#fNum').value.trim(), compl: $('#fCompl').value.trim(), bairro: $('#fBairro').value.trim(), cidade: $('#fCidade').value.trim(), uf: $('#fUf').value.trim().toUpperCase() };
    if (entrega.cep.length !== 8) return err('Informe o CEP.');
    if (!entrega.rua || !entrega.numero || !entrega.bairro || !entrega.cidade || entrega.uf.length !== 2) return err('Complete o endereço de entrega.');
    const f = freteInfo();
    if (f.espera) return err('Aguarde o cálculo do frete.');
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
  $('#pNote').textContent = PAY_URL ? 'Pagamento seguro pelo Mercado Pago, com Pix ou cartão. O frete é calculado na sacola.' : 'Você confirma o frete e paga pelo Mercado Pago depois, direto no WhatsApp.';
  $('#pLeft').textContent = '';
  const box = $('#pSizes'); box.innerHTML = '';
  p.sizes.forEach(s => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'size'; b.textContent = s;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
    const left = leftOf(p, s);
    if (left <= 0) { b.disabled = true; b.classList.add('out'); b.title = 'Esgotado'; }
    b.addEventListener('click', () => {
      chosen = s; $('#pError').textContent = '';
      $('#pLeft').textContent = left <= 3 && left !== Infinity ? (left === 1 ? 'Última unidade deste tamanho.' : 'Últimas ' + left + ' unidades deste tamanho.') : '';
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
$('#pBuy').addEventListener('click', () => {
  if (outNow(current)) { $('#pError').textContent = 'Peça esgotada no momento. Chame no WhatsApp para saber da reposição.'; return; }
  if (!chosen) { $('#pError').textContent = 'Escolha um tamanho para continuar.'; return; }
  const r = addToBag(current.id, chosen);
  if (r !== true) { $('#pError').textContent = r > 0 ? 'Só temos ' + r + (r === 1 ? ' unidade' : ' unidades') + ' desse tamanho e já estão na sua sacola.' : 'Esse tamanho acabou.'; return; }
  hideLayer(); showLayer($('#bagLayer'), '.close');
});
$('#pAdd').addEventListener('click', () => {
  if (outNow(current)) { $('#pError').textContent = 'Peça esgotada no momento. Chame no WhatsApp para saber da reposição.'; return; }
  if (!chosen) { $('#pError').textContent = 'Escolha um tamanho para continuar.'; return; }
  const r = addToBag(current.id, chosen);
  if (r !== true) { $('#pError').textContent = r > 0 ? 'Só temos ' + r + (r === 1 ? ' unidade' : ' unidades') + ' desse tamanho e já estão na sua sacola.' : 'Esse tamanho acabou.'; return; }
  hideLayer(); toast('Adicionado à sacola');
});
$('#pWhats').addEventListener('click', e => {
  if ($('#pWhats').getAttribute('aria-disabled') === 'true') { e.preventDefault(); $('#pError').textContent = 'Escolha um tamanho para continuar.'; }
});

/* ============ VITRINE ============ */
let section = 'Todos', sub = 'Todos', sort = 'new';
const JEWEL_CATS = (DATA.settings && DATA.settings.semijoiasCats) || ['Brincos', 'Colares', 'Pulseiras', 'Anéis', SEMIJOIAS];
const isJewel = p => JEWEL_CATS.includes(p.cat);
const inSection = p => section === 'Todos' || (section === 'Roupas' ? !isJewel(p) : isJewel(p));
const inFilter = p => inSection(p) && (sub === 'Todos' || p.cat === sub);
function subCats() {
  const used = [...new Set(PRODUCTS.filter(inSection).map(p => p.cat))];
  if (section === 'Semijoias') return [...new Set([...JEWEL_CATS.filter(c => c !== SEMIJOIAS), ...used])];
  return used;
}
function setSection(s) { section = s; sub = 'Todos'; renderChips(); renderGrid(); }

function renderChips() {
  $('#secTitle').textContent = section === 'Roupas' ? 'Roupas' : section === 'Semijoias' ? 'Semijoias' : 'Catálogo';
  const box = $('#chips'); box.innerHTML = '';
  const mk = (label, val) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = label;
    b.setAttribute('aria-pressed', String(val === sub));
    b.addEventListener('click', () => { sub = val; renderChips(); renderGrid(); });
    box.appendChild(b);
  };
  mk('Ver tudo', 'Todos');
  if (section !== 'Todos') subCats().forEach(c => mk(c, c));
  const sw = $('#switch'); sw.innerHTML = '';
  const link = (label, target) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'switch-link'; b.textContent = label + ' \u2192';
    b.addEventListener('click', () => { setSection(target); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    sw.appendChild(b);
  };
  if (section === 'Roupas') link('Ver semijoias', 'Semijoias');
  else if (section === 'Semijoias') link('Ver roupas', 'Roupas');
  else { link('Ver roupas', 'Roupas'); link('Ver semijoias', 'Semijoias'); }
}
function renderGrid() {
  const grid = $('#grid'); grid.innerHTML = '';
  if (section === 'Semijoias' && !PRODUCTS.some(inFilter)) {
    $('#count').textContent = '';
    grid.innerHTML = '<div class="empty-card"><h3>Semijoias em breve por aqui</h3><p>Estamos preparando as fotos. Enquanto isso, chame no WhatsApp e mostramos as peças disponíveis na loja.</p><a class="btn" href="' +
      waLink('Olá, Tati Loja! Quero ver as semijoias disponíveis.') + '" target="_blank" rel="noopener">Ver semijoias no WhatsApp</a></div>';
    return;
  }
  let items = PRODUCTS.filter(inFilter);
  if (sort === 'asc') items = [...items].sort((a, b) => a.price - b.price);
  if (sort === 'desc') items = [...items].sort((a, b) => b.price - a.price);
  $('#count').textContent = items.length + (items.length === 1 ? ' peça' : ' peças');
  items.forEach(p => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'card';
    b.setAttribute('aria-label', p.name + ', ' + brl.format(p.price));
    b.innerHTML = '<span class="media"><img loading="lazy" alt="' + (p.alt || p.name) + '" src="' + p.imgs[0] + '" width="600" height="800"><span class="add">' + (outNow(p) ? 'Esgotado' : '<b>Compre já</b><span>Escolher tamanho</span>') + '</span>' + (outNow(p) ? '<span class="sold">Esgotado</span>' : '') + '</span>' +
      '<span class="info"><span class="cat">' + p.cat + '</span><span class="name">' + p.name + '</span><span class="price">' + priceHtml(p) + '</span></span>';
    b.addEventListener('click', () => openProduct(p.id));
    grid.appendChild(b);
  });
}
if (PAY_URL) fetch(PAY_URL + '/estoque').then(r => r.json()).then(j => { AVAIL = j.estoque || {}; renderGrid(); }).catch(() => {});
$('#sort').addEventListener('change', e => { sort = e.target.value; renderGrid(); });

/* ============ INÍCIO ============ */
$('#welcomeLogo').src = 'img/logo.jpg?v=1795631508';
const hello = waLink('Olá, Tati Loja! Vim pelo catálogo e gostaria de ajuda.');
$('#welcomeWhats').href = hello; $('#jewelWhats').href = waLink('Olá, Tati Loja! Quero ver as semijoias disponíveis.');
renderChips(); renderGrid(); renderBag();

/* ============ BOAS-VINDAS ============ */
const welcome = $('#welcome'), root = document.documentElement;
function showWelcome() {
  welcome.classList.remove('out'); welcome.hidden = false; root.classList.add('w-open');
  try { sessionStorage.removeItem('tatiloja.entrou'); } catch (e) {}
  window.scrollTo(0, 0);
}
function enter(f) {
  setSection(f);
  welcome.classList.add('out'); root.classList.remove('w-open');
  setTimeout(() => { welcome.hidden = true; }, 450);
  try { sessionStorage.setItem('tatiloja.entrou', '1'); } catch (e) {}
  $('#catalogo').scrollIntoView({ block: 'start' }); window.scrollTo(0, 0);
}
welcome.querySelectorAll('[data-enter]').forEach(b => b.addEventListener('click', () => enter(b.dataset.enter)));
document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', e => {
  e.preventDefault();
  if (el.dataset.go === 'home') showWelcome(); else { setSection(el.dataset.go); window.scrollTo({ top: 0, behavior: 'smooth' }); }
}));
let seen = false; try { seen = sessionStorage.getItem('tatiloja.entrou') === '1'; } catch (e) {}
if (seen || location.hash.length > 1) { welcome.hidden = true; } else { root.classList.add('w-open'); }
}
