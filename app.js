/* Tati Loja — catálogo. Os produtos e o WhatsApp ficam em data/loja.json. */
fetch('data/loja.json?v=' + Date.now()).then(r => r.json()).then(boot).catch(() => {
  document.getElementById('grid').innerHTML = '<p style="padding:24px">Não foi possível carregar o catálogo. Tente novamente em instantes.</p>';
});

function boot(DATA) {
const WHATSAPP = (DATA.settings.whatsapp || '').replace(/\D/g, '');
const PRODUCTS = DATA.products.filter(p => p.visible !== false);
const SEMIJOIAS = 'Semijoias';
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
  const ship = $('#fShip').value, cep = $('#fCep').value.trim(), nome = $('#fName').value.trim();
  let extra = 'Entrega: ' + ship + (ship !== 'Retirar na loja' && cep ? ' · CEP ' + cep : '');
  if (nome) extra += '\nNome: ' + nome;
  extra += ship === 'Retirar na loja'
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
  $('#subtotal').textContent = brl.format(bagTotal());
  const co = $('#checkout');
  if (empty) { co.removeAttribute('href'); co.setAttribute('aria-disabled', 'true'); }
  else { co.href = waLink(checkoutText()); co.removeAttribute('aria-disabled'); }
}

$('#bagList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const idx = +b.closest('.line-item').dataset.idx, it = bag[idx], act = b.dataset.act;
  if (act === 'plus') it.qty += 1;
  if (act === 'minus') it.qty -= 1;
  if (act === 'remove' || it.qty <= 0) bag.splice(idx, 1);
  saveBag(); renderBag();
});
['input', 'change'].forEach(ev => {
  ['#fName', '#fShip', '#fCep'].forEach(s => $(s).addEventListener(ev, () => {
    $('#cepBox').hidden = $('#fShip').value === 'Retirar na loja';
    renderBag();
  }));
});
$('#fCep').addEventListener('input', e => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 8);
  e.target.value = d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
});
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
