/* Vendas e dashboard. As vendas ficam num repositório PRIVADO (vendas.json), nunca no site público. */
const VREPO = 'JorgeTLJ/tldados', VPATH = 'vendas.json';
let vendas = [], vsha = '', vState = 'loading', period = '30d', saleEdit = null, vbusy = false;

const money = n => brl.format(n || 0);
const shortMoney = n => n >= 1000 ? 'R$ ' + (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',') + ' mil' : 'R$ ' + Math.round(n);
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => { const [y, m, d] = s.split('-'); return d + '/' + m + '/' + y; };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const num = v => { const n = parseMoney(v); return isNaN(n) ? 0 : n; };

/* ---------- Dados ---------- */
async function vload() {
  try {
    const f = await gh('/contents/' + VPATH, { repo: VREPO });
    const j = JSON.parse(fromB64(f.content)); vendas = j.vendas || []; vsha = f.sha; vState = 'ok';
  } catch (e) {
    if (e.status === 404) {
      try { await gh('', { repo: VREPO }); vendas = []; vsha = ''; vState = 'ok'; } catch (e2) { vState = 'setup'; }
    } else vState = (e.status === 401 || e.status === 403) ? 'setup' : 'error';
  }
}
async function vsave(msg) {
  const r = await put(VPATH, toB64(JSON.stringify({ v: 1, vendas }, null, 2) + '\n'), msg, vsha, VREPO);
  vsha = r.content.sha;
}
async function commitSales(mutate, msg) {
  vbusy = true; const before = JSON.stringify(vendas); mutate();
  try { await vsave(msg); vstatus('Salvo.', 'ok'); }
  catch (e) {
    vendas = JSON.parse(before);
    vstatus(e.status === 409 || e.status === 422 ? 'Os dados mudaram em outro aparelho. Recarregue a página e tente de novo.' : 'Não consegui salvar a venda (' + e.message + '). Tente de novo.', 'bad');
    return false;
  } finally { vbusy = false; renderVendas(); renderResumo(); }
  return true;
}
function vstatus(m, k) { const s = $('#vstatus'); s.textContent = m || ''; s.className = 'status' + (k ? ' ' + k : ''); }

/* ---------- Pedidos do site ---------- */
const cepFmt = c => String(c || '').replace(/^(\d{5})(\d{3})$/, '$1-$2');
const telFmt = t => { const d = String(t || '').replace(/^55(?=\d{10,11}$)/, ''); return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : d.length === 10 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6) : d; };
const enderecoTxt = e => e && e.endereco ? e.endereco.rua + ', ' + e.endereco.numero + (e.endereco.compl ? ' - ' + e.endereco.compl : '') + ' — ' + e.endereco.bairro + ', ' + e.endereco.cidade + '/' + e.endereco.uf + ' · CEP ' + cepFmt(e.endereco.cep) : '';
const paraEnviar = v => v.origem === 'site' && v.status === 'pago' && !v.enviado;

/* ---------- Cálculos ---------- */
const subtotal = v => v.items.reduce((n, i) => n + i.qty * i.price, 0);
const totalVenda = v => Math.max(0, subtotal(v) - (v.discount || 0)) + (v.frete || 0);
function range(p) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0); let a, b = new Date(hoje);
  if (p === '7d') a = new Date(hoje.getTime() - 6 * 864e5);
  else if (p === '30d') a = new Date(hoje.getTime() - 29 * 864e5);
  else if (p === 'mes') a = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  else if (p === 'ano') a = new Date(hoje.getFullYear(), 0, 1);
  else return null;
  const dias = Math.round((b - a) / 864e5) + 1;
  return { a, b, prevA: new Date(a.getTime() - dias * 864e5), prevB: new Date(a.getTime() - 864e5) };
}
const inRange = (v, a, b) => { const d = parseYmd(v.date); return d >= a && d <= b; };
function metrics(list) {
  const pagas = list.filter(v => v.status === 'pago');
  const fat = pagas.reduce((n, v) => n + totalVenda(v), 0);
  const pecas = pagas.reduce((n, v) => n + v.items.reduce((m, i) => m + i.qty, 0), 0);
  const pend = list.filter(v => v.status === 'pendente');
  return { pagas, fat, pecas, n: pagas.length, ticket: pagas.length ? fat / pagas.length : 0, pend, pendVal: pend.reduce((n, v) => n + totalVenda(v), 0) };
}
function agg(pagas, keyFn) {
  const m = new Map();
  pagas.forEach(v => {
    const sub = subtotal(v), f = sub > 0 ? 1 - (v.discount || 0) / sub : 1;
    v.items.forEach(i => { const [k, label] = keyFn(i, v); const o = m.get(k) || { label, qty: 0, rev: 0 }; o.qty += i.qty; o.rev += i.qty * i.price * Math.max(0, f); m.set(k, o); });
  });
  return [...m.values()].sort((a, b) => b.rev - a.rev);
}
const catOf = i => { const p = data.products.find(x => x.id === i.pid); return p ? p.cat : 'Outros'; };

/* ---------- Gráfico ---------- */
function barChart(points, label) {
  const W = 640, H = 210, L = 44, B = 26, T = 10, max = Math.max(...points.map(p => p.v), 1);
  const ih = H - B - T, iw = W - L - 6, bw = iw / points.length, step = Math.ceil(points.length / 8);
  let g = '';
  [0, .5, 1].forEach(f => { const y = T + ih * (1 - f); g += '<line class="grid" x1="' + L + '" x2="' + W + '" y1="' + y + '" y2="' + y + '"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + shortMoney(max * f).replace('R$ ', '') + '</text>'; });
  points.forEach((p, i) => {
    const h = Math.max(p.v > 0 ? 2 : 0, ih * p.v / max), x = L + i * bw + bw * .15;
    g += '<rect class="bar" x="' + x.toFixed(1) + '" y="' + (T + ih - h).toFixed(1) + '" width="' + (bw * .7).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"><title>' + esc(p.t + ': ' + money(p.v)) + '</title></rect>';
    if (i % step === 0) g += '<text x="' + (x + bw * .35).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(p.l) + '</text>';
  });
  return '<div class="chartwrap"><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">' + g + '</svg></div>';
}
function series(pagas, r) {
  const pts = [];
  if (r && (period === '7d' || period === '30d' || period === 'mes')) {
    for (let d = new Date(r.a); d <= r.b; d = new Date(d.getTime() + 864e5)) {
      const k = ymd(d); pts.push({ k, l: pad(d.getDate()) + '/' + pad(d.getMonth() + 1), t: fmtDate(k), v: 0 });
    }
    pagas.forEach(v => { const p = pts.find(x => x.k === v.date); if (p) p.v += totalVenda(v); });
    return pts;
  }
  const meses = new Map();
  pagas.forEach(v => { const k = v.date.slice(0, 7); meses.set(k, (meses.get(k) || 0) + totalVenda(v)); });
  let ini, fim = new Date();
  if (period === 'ano') ini = new Date(fim.getFullYear(), 0, 1);
  else { const ks = [...meses.keys()].sort(); ini = ks.length ? parseYmd(ks[0] + '-01') : new Date(fim.getFullYear(), fim.getMonth() - 5, 1); }
  for (let d = new Date(ini.getFullYear(), ini.getMonth(), 1); d <= fim; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const k = d.getFullYear() + '-' + pad(d.getMonth() + 1);
    pts.push({ k, l: MESES[d.getMonth()] + (period === 'tudo' ? '/' + String(d.getFullYear()).slice(2) : ''), t: MESES[d.getMonth()] + '/' + d.getFullYear(), v: meses.get(k) || 0 });
  }
  return pts;
}

/* ---------- Resumo ---------- */
const PERIODS = [['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Este mês'], ['ano', 'Este ano'], ['tudo', 'Tudo']];
function renderPeriods() {
  const box = $('#periodChips'); box.innerHTML = '';
  PERIODS.forEach(([k, l]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = l; b.setAttribute('aria-pressed', String(k === period));
    b.addEventListener('click', () => { period = k; renderPeriods(); renderResumo(); }); box.appendChild(b);
  });
}
const rankHtml = (rows, valFn, subFn, empty) => rows.length ? '<ul class="rank">' + rows.map(r => {
  const max = Math.max(...rows.map(x => x.rev), 1);
  return '<li><span class="n">' + esc(r.label) + '</span><span class="v">' + valFn(r) + '</span><span class="m"><i style="width:' + Math.max(3, r.rev / max * 100).toFixed(0) + '%"></i></span>' + (subFn ? '<span class="s">' + subFn(r) + '</span>' : '') + '</li>';
}).join('') + '</ul>' : '<p class="muted">' + empty + '</p>';
function delta(cur, prev) {
  if (!prev) return cur ? '<div class="d">sem período anterior para comparar</div>' : '';
  const p = (cur - prev) / prev * 100; return '<div class="d ' + (p >= 0 ? 'up' : 'down') + '">' + (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p).toFixed(0).replace('.', ',') + '% vs período anterior</div>';
}
function renderResumo() {
  const box = $('#resumoBody'); if (!box || !data) return;
  if (vState !== 'ok') { box.innerHTML = setupHtml(); return; }
  const r = range(period), all = vendas.filter(v => v.status !== 'cancelado' || false);
  const cur = r ? vendas.filter(v => inRange(v, r.a, r.b)) : vendas, M = metrics(cur);
  const P = r ? metrics(vendas.filter(v => inRange(v, r.prevA, r.prevB))) : null;
  if (!vendas.length) { box.innerHTML = '<div class="panel empty-state"><h2>Ainda não há vendas registradas</h2><p>Cada vez que a Tati fechar uma venda (WhatsApp, loja ou Instagram), registre aqui em poucos segundos. O resumo, os gráficos e os produtos mais vendidos aparecem sozinhos.</p><button class="btn" type="button" id="firstSale">+ Registrar a primeira venda</button></div>'; $('#firstSale').addEventListener('click', () => openSale(-1)); return; }
  const prods = agg(M.pagas, i => [i.pid || i.name, i.name]), cats = agg(M.pagas, i => { const c = catOf(i); return [c, c]; });
  const pays = new Map(), canais = new Map();
  M.pagas.forEach(v => { pays.set(v.pay, (pays.get(v.pay) || 0) + totalVenda(v)); canais.set(v.canal, (canais.get(v.canal) || 0) + totalVenda(v)); });
  const toRows = m => [...m].map(([label, rev]) => ({ label, rev, qty: 0 })).sort((a, b) => b.rev - a.rev);
  const vendidos = new Set(M.pagas.flatMap(v => v.items.map(i => i.pid)));
  const parados = data.products.filter(p => p.visible !== false && !p.soldOut && !vendidos.has(p.id));
  const pts = series(M.pagas, r), resumoGraf = 'Faturamento por ' + (pts.length && pts[0].k.length === 7 ? 'mês' : 'dia') + ': total ' + money(M.fat);
  const aEnviar = vendas.filter(paraEnviar);
  const doSite = M.pagas.filter(v => v.liquido != null), taxas = doSite.reduce((n, v) => n + (v.taxa || 0), 0), liq = doSite.reduce((n, v) => n + v.liquido, 0);
  const extraHtml =
    (aEnviar.length ? '<div class="callout" style="margin-bottom:16px"><strong>' + aEnviar.length + (aEnviar.length === 1 ? ' pedido pago para enviar ou entregar' : ' pedidos pagos para enviar ou entregar') + '</strong> · veja os endereços na aba Vendas.</div>' : '') +
    (doSite.length ? '<div class="panel"><h3>Pagamentos pelo site</h3><ul class="rank"><li><span class="n">Recebido (líquido)</span><span class="v">' + money(liq) + '</span></li><li><span class="n">Taxas do Mercado Pago</span><span class="v">' + money(taxas) + '</span></li></ul><p class="hint">Valores dos ' + doSite.length + (doSite.length === 1 ? ' pedido' : ' pedidos') + ' pagos pelo site no período.</p></div>' : '');
  box.innerHTML =
    '<div class="kpis">' +
      '<div class="kpi"><div class="k">Faturamento</div><div class="v">' + money(M.fat) + '</div>' + (P ? delta(M.fat, P.fat) : '') + '</div>' +
      '<div class="kpi"><div class="k">Vendas</div><div class="v">' + M.n + '</div>' + (P ? delta(M.n, P.n) : '') + '</div>' +
      '<div class="kpi"><div class="k">Peças vendidas</div><div class="v">' + M.pecas + '</div>' + (P ? delta(M.pecas, P.pecas) : '') + '</div>' +
      '<div class="kpi"><div class="k">Ticket médio</div><div class="v">' + money(M.ticket) + '</div>' + (P ? delta(M.ticket, P.ticket) : '') + '</div>' +
    '</div>' +
    (M.pend.length ? '<div class="callout" style="margin-bottom:16px"><strong>' + M.pend.length + (M.pend.length === 1 ? ' venda aguardando' : ' vendas aguardando') + ' pagamento</strong> · ' + money(M.pendVal) + ' ainda a receber. Veja na aba Vendas.</div>' : '') +
    extraHtml +
    '<div class="panel"><h3>' + (pts[0] && pts[0].k.length === 7 ? 'Faturamento por mês' : 'Faturamento por dia') + '</h3>' + (M.fat ? barChart(pts, resumoGraf) : '<p class="muted">Nenhuma venda paga neste período.</p>') + '</div>' +
    '<div class="cols">' +
      '<div class="panel"><h3>Mais vendidos</h3>' + rankHtml(prods.slice(0, 6), r => money(r.rev), r => r.qty + (r.qty === 1 ? ' peça' : ' peças'), 'Sem vendas no período.') + '</div>' +
      '<div class="panel"><h3>Por categoria</h3>' + rankHtml(cats, r => money(r.rev), r => r.qty + (r.qty === 1 ? ' peça' : ' peças'), 'Sem vendas no período.') + '</div>' +
      '<div class="panel"><h3>Forma de pagamento</h3>' + rankHtml(toRows(pays), r => money(r.rev), null, 'Sem vendas no período.') + '</div>' +
      '<div class="panel"><h3>Onde vendeu</h3>' + rankHtml(toRows(canais), r => money(r.rev), null, 'Sem vendas no período.') + '</div>' +
    '</div>' +
    '<div class="cols">' +
      '<div class="panel"><h3>Catálogo</h3><ul class="rank"><li><span class="n">Produtos no site</span><span class="v">' + data.products.filter(p => p.visible !== false).length + '</span></li><li><span class="n">Esgotados</span><span class="v">' + data.products.filter(p => p.soldOut).length + '</span></li><li><span class="n">Ocultos</span><span class="v">' + data.products.filter(p => p.visible === false).length + '</span></li></ul></div>' +
      '<div class="panel"><h3>Sem vendas no período</h3>' + (parados.length ? '<ul class="rank">' + parados.slice(0, 6).map(p => '<li><span class="n">' + esc(p.name) + '</span><span class="v">' + money(p.price) + '</span></li>').join('') + '</ul><p class="hint">Peças disponíveis que não saíram. Vale destacar ou fazer promoção.</p>' : '<p class="muted">Todas as peças disponíveis tiveram venda.</p>') + '</div>' +
    '</div>';
}

/* ---------- Lista de vendas ---------- */
let vf = { q: '', status: '', per: 'tudo' };
function setupHtml() {
  if (vState === 'loading') return '<p class="muted">Carregando vendas…</p>';
  if (vState === 'error') return '<div class="callout"><strong>Não consegui carregar as vendas.</strong> Atualize a página e tente de novo.</div>';
  return '<div class="callout"><h3>Falta criar o lugar das vendas (1 vez só)</h3>' +
    '<p>As vendas e os nomes dos clientes não podem ficar no repositório do site, que é público. Elas ficam num repositório <strong>privado</strong>, só seu:</p>' +
    '<ol><li>Abra <a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a>.</li>' +
    '<li>Nome: <b>tldados</b>. Marque <b>Private</b> e também <b>Add a README file</b>. Clique em <b>Create repository</b>.</li>' +
    '<li>Abra <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">seus tokens</a>, clique no token “Painel Tati Loja” → <b>Edit</b>.</li>' +
    '<li>Em <b>Repository access</b>, mantenha <b>Only select repositories</b> e adicione também <b>tldados</b>. Confira que <b>Contents</b> segue em <b>Read and write</b> e clique em <b>Update</b>.</li>' +
    '<li>Volte aqui e <button class="btn ghost sm" type="button" onclick="location.reload()">atualize a página</button>.</li></ol></div>';
}
function renderVendas() {
  const box = $('#vendasBody'); if (!box) return;
  if (vState !== 'ok') { box.innerHTML = setupHtml(); $('#saleAdd').disabled = $('#csvBtn').disabled = true; return; }
  $('#saleAdd').disabled = $('#csvBtn').disabled = false;
  const r = range(vf.per), q = vf.q.toLowerCase();
  const list = vendas.filter(v => (!vf.status || v.status === vf.status) && (!r || inRange(v, r.a, r.b)) &&
    (!q || (v.cliente || '').toLowerCase().includes(q) || v.items.some(i => i.name.toLowerCase().includes(q)))).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const f = '<div class="vfilters"><input id="fq" type="search" placeholder="Buscar cliente ou peça" value="' + esc(vf.q) + '" aria-label="Buscar">' +
    '<select id="fper" aria-label="Período">' + PERIODS.map(([k, l]) => '<option value="' + k + '"' + (vf.per === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
    '<select id="fst" aria-label="Situação"><option value="">Todas as situações</option><option value="pago"' + (vf.status === 'pago' ? ' selected' : '') + '>Pagas</option><option value="pendente"' + (vf.status === 'pendente' ? ' selected' : '') + '>Aguardando</option><option value="cancelado"' + (vf.status === 'cancelado' ? ' selected' : '') + '>Canceladas</option></select></div>';
  box.innerHTML = f + (list.length ? list.map(v => {
    const retira = v.entrega && v.entrega.tipo === 'retirada';
    const tag = (v.origem === 'site' ? '<span class="tag">Site</span>' : '') +
      (v.status === 'pendente' ? '<span class="tag warn">Aguardando pagamento</span>' : v.status === 'cancelado' ? '<span class="tag">Cancelada</span>' : paraEnviar(v) ? '<span class="tag warn">' + (retira ? 'Para retirar' : 'Para enviar') + '</span>' : v.origem === 'site' && v.status === 'pago' ? '<span class="tag">' + (retira ? 'Retirado' : 'Enviado') + '</span>' : '');
    const extra = v.origem === 'site' ? (v.contato ? '<div class="meta"><a href="https://wa.me/55' + esc(String(v.contato.telefone).replace(/^55(?=\d{10,11}$)/, '')) + '" target="_blank" rel="noopener">' + esc(telFmt(v.contato.telefone)) + '</a> · ' + esc(v.contato.email) + '</div>' : '') +
      (v.entrega ? '<div class="meta">' + (retira ? 'Retirar na loja' : 'Entregar: ' + esc(enderecoTxt(v.entrega)) + (v.entrega.regiao ? ' (' + esc(v.entrega.regiao) + ')' : '')) + '</div>' : '') +
      (v.liquido != null ? '<div class="meta">Taxa do Mercado Pago ' + money(v.taxa) + ' · você recebe ' + money(v.liquido) + (v.parcelas > 1 ? ' · ' + v.parcelas + 'x no cartão' : '') + '</div>' : '') : '';
    return '<article class="sale ' + v.status + '" data-id="' + esc(v.id) + '"><div class="top"><strong>' + fmtDate(v.date) + '</strong>' + (v.cliente ? '<span>' + esc(v.cliente) + '</span>' : '') + tag + '<span class="tot">' + money(totalVenda(v)) + '</span></div>' +
      '<div class="it">' + v.items.map(i => i.qty + 'x ' + esc(i.name) + (i.size ? ' (' + esc(i.size) + ')' : '')).join(' · ') + '</div>' +
      '<div class="meta">' + esc(v.pay) + ' · ' + esc(v.canal) + (v.discount ? ' · desconto ' + money(v.discount) : '') + (v.frete ? ' · frete ' + money(v.frete) : '') + (v.obs ? ' · ' + esc(v.obs) : '') + '</div>' + extra +
      '<div class="acts"><button type="button" data-a="edit">Editar</button>' + (v.origem === 'site' && v.status === 'pago' ? '<button type="button" data-a="sent">' + (v.enviado ? 'Desfazer ' + (retira ? 'retirada' : 'envio') : (retira ? 'Marcar como retirado' : 'Marcar como enviado')) + '</button>' : '') + (v.status === 'pendente' ? '<button type="button" data-a="paid">Marcar paga</button>' : '') + (v.status !== 'cancelado' ? '<button type="button" data-a="cancel">Cancelar venda</button>' : '') + '<button type="button" class="del" data-a="del">Excluir</button></div></article>';
  }).join('') : '<p class="muted">' + (vendas.length ? 'Nenhuma venda com esses filtros.' : 'Nenhuma venda registrada ainda. Clique em “Registrar venda”.') + '</p>');
  $('#fq').addEventListener('input', e => { vf.q = e.target.value; clearTimeout(renderVendas.t); renderVendas.t = setTimeout(() => { renderVendas(); const el = $('#fq'); el.focus(); el.setSelectionRange(99, 99); }, 250); });
  $('#fper').addEventListener('change', e => { vf.per = e.target.value; renderVendas(); });
  $('#fst').addEventListener('change', e => { vf.status = e.target.value; renderVendas(); });
  box.querySelectorAll('.sale').forEach(el => el.addEventListener('click', e => {
    const a = e.target.closest('button') && e.target.closest('button').dataset.a; if (!a) return;
    const i = vendas.findIndex(v => v.id === el.dataset.id), v = vendas[i];
    if (a === 'edit') return openSale(i);
    if (a === 'sent') return commitSales(() => { v.enviado = !v.enviado; }, 'Pedido: ' + (v.enviado ? 'desfaz' : 'marca') + ' envio');
    if (a === 'paid') return commitSales(() => { v.status = 'pago'; }, 'Venda: marcada como paga');
    if (a === 'cancel') { if (!confirm('Cancelar esta venda? Ela deixa de contar nos números.')) return; return commitSales(() => { v.status = 'cancelado'; }, 'Venda: cancelada'); }
    if (a === 'del') { if (!confirm('Excluir esta venda para sempre?')) return; return commitSales(() => { vendas.splice(i, 1); }, 'Venda: excluída'); }
  }));
}

/* ---------- Formulário de venda ---------- */
function itemRow(it = {}) {
  const row = document.createElement('div'); row.className = 'si';
  row.innerHTML = '<select class="pn" aria-label="Peça">' + data.products.map(p => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('') + '<option value="">Outra peça (digitar)</option></select>' +
    '<input class="sz" placeholder="Tamanho" aria-label="Tamanho" list="szl"><input class="qt" type="number" min="1" value="1" aria-label="Quantidade"><input class="pr" inputmode="decimal" placeholder="Preço" aria-label="Preço unitário"><button type="button" aria-label="Remover peça">×</button>';
  const sel = row.querySelector('.pn'), sz = row.querySelector('.sz'), pr = row.querySelector('.pr'), qt = row.querySelector('.qt');
  const custom = document.createElement('input'); custom.className = 'pn'; custom.placeholder = 'Nome da peça'; custom.hidden = true; custom.setAttribute('aria-label', 'Nome da peça'); sel.after(custom);
  const sync = () => { const p = data.products.find(x => x.id === sel.value); custom.hidden = !!p || sel.value !== ''; if (p && !it.keep) { pr.value = fmtMoney(p.price); } it.keep = false; };
  sel.addEventListener('change', () => { sync(); recalc(); });
  [sz, qt, pr, custom].forEach(e => e.addEventListener('input', recalc));
  row.querySelector('button').addEventListener('click', () => { if ($('#sItems').children.length > 1) { row.remove(); recalc(); } });
  if (it.pid !== undefined) { sel.value = data.products.some(p => p.id === it.pid) ? it.pid : ''; custom.value = it.name || ''; sz.value = it.size || ''; qt.value = it.qty; pr.value = fmtMoney(it.price); it.keep = true; }
  sync(); return row;
}
function readItems() {
  return [...$('#sItems').children].map(r => {
    const sel = r.querySelector('select'), p = data.products.find(x => x.id === sel.value);
    return { pid: p ? p.id : '', name: p ? p.name : r.querySelector('input.pn').value.trim(), size: r.querySelector('.sz').value.trim(), qty: Math.max(1, parseInt(r.querySelector('.qt').value, 10) || 1), price: num(r.querySelector('.pr').value) };
  });
}
function recalc() {
  const items = readItems(), v = { items, discount: num($('#sDisc').value), frete: num($('#sFrete').value) };
  $('#sTotal').textContent = 'Total: ' + money(totalVenda(v));
}
function openSale(i) {
  const v = i >= 0 ? vendas[i] : { date: ymd(new Date()), status: 'pago', items: [{}], pay: 'Pix', canal: 'WhatsApp' };
  saleEdit = i; $('#saleTitle').textContent = i >= 0 ? 'Editar venda' : 'Registrar venda';
  $('#sDate').value = v.date; $('#sStatus').value = v.status; $('#sDisc').value = fmtMoney(v.discount || ''); $('#sFrete').value = fmtMoney(v.frete || '');
  $('#sPay').value = v.pay; $('#sCanal').value = v.canal; $('#sCli').value = v.cliente || ''; $('#sObs').value = v.obs || ''; $('#saleErr').textContent = '';
  const box = $('#sItems'); box.innerHTML = ''; v.items.forEach(it => box.appendChild(itemRow(it.name !== undefined ? it : {})));
  let dl = document.getElementById('szl'); if (!dl) { dl = document.createElement('datalist'); dl.id = 'szl'; document.body.appendChild(dl); }
  dl.innerHTML = [...new Set(data.products.flatMap(p => p.sizes || []))].map(s => '<option value="' + esc(s) + '">').join('');
  recalc(); $('#saleLayer').hidden = false; document.documentElement.style.overflow = 'hidden';
}
function closeSale() { $('#saleLayer').hidden = true; document.documentElement.style.overflow = ''; saleEdit = null; }
$('#sAddItem').addEventListener('click', () => { $('#sItems').appendChild(itemRow({})); recalc(); });
['#sDisc', '#sFrete'].forEach(s => $(s).addEventListener('input', recalc));
document.addEventListener('click', e => { if (e.target.closest('[data-sclose]')) closeSale(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && saleEdit !== null && !$('#saleLayer').hidden) closeSale(); });
$('#saleAdd').addEventListener('click', () => openSale(-1));
$('#saleForm').addEventListener('submit', async e => {
  e.preventDefault();
  const items = readItems(), err = m => { $('#saleErr').textContent = m; };
  if (!$('#sDate').value) return err('Escolha a data da venda.');
  if (items.some(i => !i.name)) return err('Escreva o nome da peça.');
  if (items.some(i => !(i.price >= 0)) || items.every(i => i.price === 0)) return err('Informe o preço de cada peça.');
  const v = { id: saleEdit >= 0 ? vendas[saleEdit].id : 'v' + Date.now().toString(36), date: $('#sDate').value, status: $('#sStatus').value, items, discount: num($('#sDisc').value), frete: num($('#sFrete').value), pay: $('#sPay').value, canal: $('#sCanal').value, cliente: $('#sCli').value.trim(), obs: $('#sObs').value.trim() };
  const btn = $('#saleSave'); btn.disabled = true; vstatus('Salvando…');
  const ok = await commitSales(() => { if (saleEdit >= 0) vendas[saleEdit] = { ...vendas[saleEdit], ...v }; else vendas.push(v); }, 'Venda: ' + (saleEdit >= 0 ? 'edita' : 'registra') + ' ' + v.date);
  btn.disabled = false; if (ok) closeSale();
});

/* ---------- Planilha ---------- */
$('#csvBtn').addEventListener('click', () => {
  const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const rows = [['Data', 'Cliente', 'Peças', 'Qtd', 'Subtotal', 'Desconto', 'Frete', 'Total', 'Pagamento', 'Onde vendeu', 'Situação', 'Observação']];
  [...vendas].sort((a, b) => a.date.localeCompare(b.date)).forEach(v => rows.push([fmtDate(v.date), v.cliente, v.items.map(i => i.qty + 'x ' + i.name + (i.size ? ' (' + i.size + ')' : '')).join(' | '), v.items.reduce((n, i) => n + i.qty, 0), fmtMoney(subtotal(v)), fmtMoney(v.discount || 0), fmtMoney(v.frete || 0), fmtMoney(totalVenda(v)), v.pay, v.canal, v.status, v.obs]));
  const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vendas-tati-loja.csv'; document.body.appendChild(a); a.click(); a.remove();
});

/* ---------- Abas ---------- */
function showTab(t) {
  document.querySelectorAll('.tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  ['resumo', 'vendas', 'produtos'].forEach(k => { $('#tab' + k[0].toUpperCase() + k.slice(1)).hidden = k !== t; });
  try { history.replaceState(null, '', '#' + t); } catch (_) {}
  if (t === 'resumo') renderResumo(); if (t === 'vendas') renderVendas();
}
document.querySelectorAll('.tabs [role=tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
window.onCatalogChange = () => { renderResumo(); };
window.afterLogin = async () => {
  renderPeriods(); vState = 'loading'; renderResumo();
  const h = location.hash.slice(1); showTab(['resumo', 'vendas', 'produtos'].includes(h) ? h : 'resumo');
  await vload(); renderResumo(); renderVendas();
};

/* ---------- Atualização automática (novos pedidos aparecem sozinhos) ---------- */
async function vrefresh() {
  if (document.hidden || vState !== 'ok' || vbusy || !$('#saleLayer').hidden || document.activeElement === $('#fq')) return;
  try {
    const f = await gh('/contents/' + VPATH, { repo: VREPO });
    if (f.sha === vsha || vbusy) return;
    vendas = JSON.parse(fromB64(f.content)).vendas || []; vsha = f.sha; renderResumo(); renderVendas();
  } catch (_) {}
}
setInterval(vrefresh, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) vrefresh(); });
