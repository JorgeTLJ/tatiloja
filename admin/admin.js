/* Painel da Tati Loja: edita data/loja.json e as fotos direto no repositório (API do GitHub). */
const REPO = 'JorgeTLJ/tatiloja', BRANCH = 'main', DATA_PATH = 'data/loja.json';
const $ = (s, r = document) => r.querySelector(s);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let token = '', data = null, sha = '', dirty = false, pending = {}; // pending: caminho -> dataURL
let editing = null; // {index|-1, draft}

try { token = localStorage.getItem('tatiloja.token') || ''; } catch (e) {}

/* ---------- GitHub ---------- */
async function gh(path, opts = {}) {
  const r = await fetch('https://api.github.com/repos/' + (opts.repo || REPO) + path, {
    method: opts.method, body: opts.body, cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) },
  });
  if (!r.ok) { const e = new Error('GitHub ' + r.status); e.status = r.status; try { e.body = await r.json(); } catch (_) {} throw e; }
  return r.json();
}
const toB64 = str => { const b = new TextEncoder().encode(str); let s = ''; b.forEach(c => s += String.fromCharCode(c)); return btoa(s); };
const fromB64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), c => c.charCodeAt(0)));
const put = (path, b64, message, shaOld, repo) => gh('/contents/' + path, {
  repo, method: 'PUT', body: JSON.stringify({ message, content: b64, ...(repo ? {} : { branch: BRANCH }), ...(shaOld ? { sha: shaOld } : {}) }),
});

async function load() {
  const f = await gh('/contents/' + DATA_PATH + '?ref=' + BRANCH);
  data = JSON.parse(fromB64(f.content)); sha = f.sha;
  data.settings = data.settings || {}; data.products = data.products || [];
}

/* ---------- Utilidades ---------- */
function status(msg, kind) { const s = $('#status'); s.textContent = msg || ''; s.className = 'status' + (kind ? ' ' + kind : ''); }
function setDirty(v) { dirty = v; $('#dirty').hidden = !v; $('#saveBtn').disabled = !v; }
const parseMoney = v => { v = String(v || '').trim().replace(/[R$\s]/g, ''); if (!v) return NaN; if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.'); return Number(v); };
const fmtMoney = n => (n || n === 0) ? String(n).replace('.', ',') : '';
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'produto';
const imgSrc = p => pending[p] || '../' + p;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function waDigits(v) { let d = String(v || '').replace(/\D/g, ''); if (d && d.length <= 11) d = '55' + d; return d; }
function waShow(v) { const d = String(v || ''); const m = d.replace(/^55/, ''); return m.length === 11 ? '(' + m.slice(0, 2) + ') ' + m.slice(2, 7) + '-' + m.slice(7) : m.length === 10 ? '(' + m.slice(0, 2) + ') ' + m.slice(2, 6) + '-' + m.slice(6) : d; }

/* ---------- Lista ---------- */
function render() {
  $('#sWa').value = waShow(data.settings.whatsapp); $('#sIg').value = data.settings.instagram || '';
  const ul = $('#list'); ul.innerHTML = '';
  $('#empty').hidden = data.products.length > 0;
  data.products.forEach((p, i) => {
    const li = document.createElement('li'); li.className = 'pi' + (p.visible === false ? ' off' : '');
    li.innerHTML = '<img alt="" src="' + esc(p.imgs && p.imgs[0] ? imgSrc(p.imgs[0]) : '') + '">' +
      '<div><div class="t">' + esc(p.name) + '</div><div class="m">' + esc(p.cat) + ' · ' + brl.format(p.price) + (p.sizes && p.sizes.length ? ' · ' + esc(p.sizes.join(', ')) : '') + '</div>' +
      '<div class="tags">' + (p.soldOut ? '<span class="tag">Esgotado</span>' : '') + (p.visible === false ? '<span class="tag">Oculto</span>' : '') + (p.mp ? '<span class="tag">Link MP</span>' : '') + '</div></div>' +
      '<div class="acts"><button type="button" data-a="edit">Editar</button><button type="button" data-a="vis">' + (p.visible === false ? 'Mostrar' : 'Ocultar') + '</button>' +
      '<button type="button" data-a="sold">' + (p.soldOut ? 'Marcar disponível' : 'Marcar esgotado') + '</button>' +
      '<span class="mv"><button type="button" data-a="up" aria-label="Subir"' + (i === 0 ? ' disabled' : '') + '>↑</button><button type="button" data-a="down" aria-label="Descer"' + (i === data.products.length - 1 ? ' disabled' : '') + '>↓</button></span>' +
      '<button type="button" class="del" data-a="del">Excluir</button></div>';
    li.addEventListener('click', e => {
      const a = e.target.closest('button') && e.target.closest('button').dataset.a; if (!a) return;
      if (a === 'edit') return openEditor(i);
      if (a === 'vis') p.visible = p.visible === false;
      if (a === 'sold') p.soldOut = !p.soldOut;
      if (a === 'up' && i > 0) [data.products[i - 1], data.products[i]] = [data.products[i], data.products[i - 1]];
      if (a === 'down' && i < data.products.length - 1) [data.products[i + 1], data.products[i]] = [data.products[i], data.products[i + 1]];
      if (a === 'del') { if (!confirm('Excluir "' + p.name + '"?')) return; data.products.splice(i, 1); }
      setDirty(true); render();
    });
    ul.appendChild(li);
  });
}
$('#sWa').addEventListener('input', e => { data.settings.whatsapp = waDigits(e.target.value); setDirty(true); });
$('#sIg').addEventListener('input', e => { data.settings.instagram = e.target.value.trim(); setDirty(true); });

/* ---------- Editor ---------- */
function openEditor(i) {
  const p = i >= 0 ? data.products[i] : { id: '', name: '', cat: '', price: null, oldPrice: null, sizes: [], desc: '', imgs: [], mp: '', soldOut: false, visible: true };
  editing = { i, d: JSON.parse(JSON.stringify(p)) };
  const d = editing.d;
  $('#edTitle').textContent = i >= 0 ? 'Editar produto' : 'Novo produto';
  $('#eName').value = d.name; $('#eCat').value = d.cat; $('#eSizes').value = (d.sizes || []).join(', ');
  $('#ePrice').value = fmtMoney(d.price); $('#eOld').value = fmtMoney(d.oldPrice); $('#eDesc').value = d.desc || ''; $('#eMp').value = d.mp || '';
  $('#eSold').checked = !!d.soldOut; $('#eVis').checked = d.visible !== false; $('#edErr').textContent = '';
  const cats = [...new Set(['Blusas', 'Saias', 'Vestidos', 'Calças', 'Acessórios', 'Sapatos', 'Semijoias', ...data.products.map(x => x.cat)])];
  $('#cats').innerHTML = cats.map(c => '<option value="' + esc(c) + '">').join('');
  renderPhotos(); $('#edLayer').hidden = false; document.documentElement.style.overflow = 'hidden'; $('#eName').focus();
}
function closeEditor() { $('#edLayer').hidden = true; document.documentElement.style.overflow = ''; editing = null; }
function renderPhotos() {
  const box = $('#photos'); box.innerHTML = '';
  editing.d.imgs.forEach((p, k) => {
    const w = document.createElement('div'); w.className = 'ph';
    w.innerHTML = '<img alt="Foto ' + (k + 1) + '" src="' + esc(imgSrc(p)) + '">' + (k === 0 ? '<span class="cover">Capa</span>' : '') + '<button type="button" aria-label="Remover foto ' + (k + 1) + '">×</button>';
    w.querySelector('button').addEventListener('click', () => { editing.d.imgs.splice(k, 1); renderPhotos(); });
    if (k > 0) { w.querySelector('img').title = 'Clique para tornar capa'; w.querySelector('img').style.cursor = 'pointer'; w.querySelector('img').addEventListener('click', () => { const [x] = editing.d.imgs.splice(k, 1); editing.d.imgs.unshift(x); renderPhotos(); }); }
    box.appendChild(w);
  });
  $('.addph').hidden = editing.d.imgs.length >= 4;
}
function resize(file) {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const m = 1200, k = Math.min(1, m / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.85));
    };
    im.onerror = () => { URL.revokeObjectURL(url); no(new Error('Imagem inválida')); }; im.src = url;
  });
}
$('#eFile').addEventListener('change', async e => {
  const base = slug($('#eName').value || 'produto');
  for (const f of [...e.target.files]) {
    if (editing.d.imgs.length >= 4) break;
    try { const url = await resize(f); const path = 'img/' + base + '-' + Date.now().toString(36) + editing.d.imgs.length + '.jpg'; pending[path] = url; editing.d.imgs.push(path); }
    catch (_) { $('#edErr').textContent = 'Não consegui ler uma das fotos.'; }
  }
  e.target.value = ''; renderPhotos();
});
$('#edForm').addEventListener('submit', e => {
  e.preventDefault(); const d = editing.d, err = m => { $('#edErr').textContent = m; };
  d.name = $('#eName').value.trim(); d.cat = $('#eCat').value.trim(); d.desc = $('#eDesc').value.trim(); d.mp = $('#eMp').value.trim();
  d.sizes = $('#eSizes').value.split(',').map(s => s.trim()).filter(Boolean);
  d.price = parseMoney($('#ePrice').value); const old = parseMoney($('#eOld').value); d.oldPrice = isNaN(old) ? null : old;
  d.soldOut = $('#eSold').checked; d.visible = $('#eVis').checked;
  if (!d.name) return err('Escreva o nome do produto.');
  if (!d.cat) return err('Escolha ou escreva a categoria.');
  if (isNaN(d.price) || d.price <= 0) return err('Informe o preço, por exemplo 59,90.');
  if (!d.imgs.length) return err('Adicione pelo menos uma foto.');
  if (!d.sizes.length) d.sizes = ['Único'];
  if (!d.alt) d.alt = d.name;
  if (editing.i >= 0) { d.id = d.id || slug(d.name); data.products[editing.i] = d; }
  else { let id = slug(d.name), n = 2; while (data.products.some(x => x.id === id)) id = slug(d.name) + '-' + n++; d.id = id; data.products.unshift(d); }
  closeEditor(); setDirty(true); render();
});
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeEditor(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && editing) closeEditor(); });
$('#addBtn').addEventListener('click', () => openEditor(-1));

/* ---------- Publicar ---------- */
$('#saveBtn').addEventListener('click', async () => {
  const btn = $('#saveBtn'); btn.disabled = true; status('Publicando…');
  try {
    const used = new Set(data.products.flatMap(p => p.imgs || []));
    for (const path of Object.keys(pending)) {
      if (!used.has(path)) { delete pending[path]; continue; }
      status('Enviando foto ' + path.split('/').pop() + '…');
      await put(path, pending[path].split(',')[1], 'Painel: foto ' + path.split('/').pop());
      delete pending[path];
    }
    status('Salvando produtos…');
    const body = { settings: data.settings, products: data.products };
    const r = await put(DATA_PATH, toB64(JSON.stringify(body, null, 2) + '\n'), 'Painel: atualiza produtos e dados da loja', sha);
    sha = r.content.sha; setDirty(false); render(); if (window.onCatalogChange) window.onCatalogChange();
    status('Publicado! O site atualiza em cerca de 1 minuto.', 'ok');
  } catch (err) {
    btn.disabled = false;
    status(err.status === 409 || err.status === 422 ? 'O catálogo mudou em outro lugar. Recarregue a página e refaça a alteração.' :
      err.status === 401 || err.status === 403 ? 'O token não tem permissão de escrita. Crie outro com "Contents: Read and write".' : 'Não consegui publicar (' + err.message + '). Tente de novo.', 'bad');
  }
});
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Entrada ---------- */
async function enter() {
  try { await load(); } catch (err) {
    token = ''; try { localStorage.removeItem('tatiloja.token'); } catch (_) {}
    $('#login').hidden = false; $('#app').hidden = true; $('#logout').hidden = true;
    $('#loginErr').textContent = err.status === 401 || err.status === 403 || err.status === 404 ? 'Token recusado. Confira se copiou inteiro e se ele tem acesso ao repositório tatiloja.' : 'Não consegui conectar ao GitHub. Tente de novo.';
    return;
  }
  $('#login').hidden = true; $('#app').hidden = false; $('#logout').hidden = false; $('#loginErr').textContent = ''; render();
  if (window.afterLogin) window.afterLogin();
}
$('#loginForm').addEventListener('submit', e => {
  e.preventDefault(); token = $('#tok').value.trim(); if (!token) return;
  try { localStorage.setItem('tatiloja.token', token); } catch (_) {}
  enter();
});
$('#logout').addEventListener('click', () => {
  if (dirty && !confirm('Há alterações não publicadas. Sair mesmo assim?')) return;
  try { localStorage.removeItem('tatiloja.token'); } catch (_) {}
  location.reload();
});
if (token) enter(); else $('#login').hidden = false;
