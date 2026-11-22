'use strict';
const API = 'https://pokeapi.co/api/v2';
let maxId = 0;
let TYPES = [];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(4, '0');
const nice = s => s.split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const idOf = url => +url.match(/\/(\d+)\/?$/)[1];
const typeLabel = {};
const tl = t => typeLabel[t] || nice(t);
const badge = (t, extra = '') => `<span class="badge t-${t}">${tl(t)}${extra}</span>`;
const linkBadge = (k, t, extra = '') => `<button class="badge link t-${t}" data-k="${k}" data-t="${t}" title="${k === 't' ? 'Show Pokémon of type' : 'Show Pokémon weak to'} ${tl(t)}">${tl(t)}${extra}</button>`;

let bridge = null;
function initBridge() {
  return new Promise(res => {
    if (window.qt && window.QWebChannel) {
      new QWebChannel(qt.webChannelTransport, ch => { bridge = ch.objects.bridge; res(); });
    } else res();
  });
}
const bcall = (m, ...a) => new Promise(r => { if (!bridge) return r(null); try { bridge[m](...a, r); } catch { r(null); } });

const mem = new Map();
function cached(key, loader) {
  key = 'v4:' + key;
  if (mem.has(key)) return mem.get(key);
  const p = (async () => {
    const s = await bcall('cacheGet', key);
    if (s) { try { return JSON.parse(s); } catch {} }
    const v = await loader();
    bcall('cacheSet', key, JSON.stringify(v));
    return v;
  })();
  mem.set(key, p);
  p.catch(() => mem.delete(key));
  return p;
}
let active = 0;
const waiters = [];
async function gate(fn) {
  while (active >= 12) await new Promise(r => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}
async function getJSON(url, retries = 3) {
  for (let i = 0; ; i++) {
    try { const r = await gate(() => fetch(url)); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    catch (e) { if (i >= retries) throw e; await sleep(400 * (i + 1)); }
  }
}
async function pool(items, limit, fn, onProgress) {
  let i = 0, done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); onProgress && onProgress(++done, items.length); }
  });
  await Promise.all(workers);
}

const getPokemon = id => cached('p:' + id, async () => {
  const d = await getJSON(`${API}/pokemon/${id}`);
  return { id: d.id, name: d.name, height: d.height, weight: d.weight,
    types: d.types.map(t => t.type.name),
    abilities: d.abilities.map(a => ({ name: a.ability.name, hidden: a.is_hidden })),
    stats: d.stats.map(s => ({ name: s.stat.name, value: s.base_stat })),
    img: d.sprites.other?.['official-artwork']?.front_default || d.sprites.front_default };
});
const getSpecies = id => cached('s:' + id, async () => {
  const d = await getJSON(`${API}/pokemon-species/${id}`);
  const g = d.genera.find(x => x.language.name === 'en');
  return { genus: g ? g.genus.replace(/ Pokémon$/, '') : '—', genderRate: d.gender_rate,
    chain: d.evolution_chain.url,
    flavors: d.flavor_text_entries.filter(f => f.language.name === 'en').map(f => ({ v: f.version.name, t: f.flavor_text })) };
});
const getStatName = name => cached('st:' + name, async () => {
  const d = await getJSON(`${API}/stat/${name}`);
  return d.names.find(n => n.language.name === 'en')?.name || nice(name);
});
const getChain = url => cached('c:' + url, async () => (await getJSON(url)).chain);
const getAbilityInfo = name => cached('a:' + name, async () => {
  const d = await getJSON(`${API}/ability/${name}`);
  const e = d.effect_entries.find(x => x.language.name === 'en');
  return { effect: e ? e.short_effect : 'No description available.', ids: d.pokemon.map(p => idOf(p.pokemon.url)).filter(i => i <= maxId) };
});

let names = [];
const typesOf = {};
const chart = {};

async function loadIndex() {
  const [species, typeList] = await Promise.all([
    cached('species', async () => (await getJSON(`${API}/pokemon-species?limit=100000`)).results.map(r => [idOf(r.url), r.name])),
    cached('typelist', async () => (await getJSON(`${API}/type?limit=100000`)).results.map(r => r.name))
  ]);
  names = [];
  for (const [id, n] of species) names[id - 1] = n;
  maxId = names.length;
  const typeData = (await Promise.all(typeList.map(t => cached('t:' + t, async () => {
    const d = await getJSON(`${API}/type/${t}`), r = d.damage_relations;
    return { name: t, id: d.id, label: d.names.find(n => n.language.name === 'en')?.name || nice(t),
      pokemon: d.pokemon.map(p => [idOf(p.pokemon.url), p.slot]),
      double: r.double_damage_from.map(x => x.name), half: r.half_damage_from.map(x => x.name), none: r.no_damage_from.map(x => x.name) };
  })))).map(t => ({ ...t, pokemon: t.pokemon.filter(x => x[0] <= maxId) })).filter(t => t.pokemon.length).sort((a, b) => a.id - b.id);
  TYPES = typeData.map(t => t.name);
  typeData.forEach(t => { typeLabel[t.name] = t.label; });
  TYPES.forEach(a => { chart[a] = {}; });
  const tmp = {};
  for (const t of typeData) {
    for (const [id, slot] of t.pokemon) (tmp[id] ||= []).push([slot, t.name]);
    t.double.forEach(a => chart[a] && (chart[a][t.name] = 2));
    t.half.forEach(a => chart[a] && (chart[a][t.name] = .5));
    t.none.forEach(a => chart[a] && (chart[a][t.name] = 0));
  }
  for (const id in tmp) typesOf[id] = tmp[id].sort((a, b) => a[0] - b[0]).map(x => x[1]);
  const style = document.createElement('style');
  style.textContent = TYPES.map((t, i) => `.t-${t}{background:hsl(${Math.round(i * 137.508) % 360} 55% 46%)}`).join('\n');
  document.head.appendChild(style);
}

let scanPromise = null, onScan = null, statCeil = 1, cuts = null;
const sizes = new Map();
function scanAll() {
  scanPromise ||= (async () => {
    const all = Array.from({ length: maxId }, (_, i) => i + 1);
    await pool(all, 4, async id => {
      try {
        const p = await getPokemon(id);
        sizes.set(id, [p.height, p.weight]);
        statCeil = Math.max(statCeil, ...p.stats.map(s => s.value));
      } catch {}
    }, (d, n) => onScan && onScan(d, n));
    const cut = k => {
      const a = [...sizes.values()].map(v => v[k]).sort((x, y) => x - y);
      return [a[Math.floor(a.length / 3)], a[Math.floor(a.length * 2 / 3)]];
    };
    cuts = { h: cut(0), w: cut(1) };
  })();
  scanPromise.catch(() => { scanPromise = null; });
  return scanPromise;
}
const sizeCat = (v, c) => v <= c[0] ? 's' : v <= c[1] ? 'm' : 'l';
function fillSegs(root) {
  $$('.stat-col', root).forEach(c => {
    const n = Math.ceil(+c.dataset.v / statCeil * 15);
    $$('.seg', c).forEach((s, i) => s.classList.toggle('f', i < n));
  });
}
function weakness(types) {
  const res = {};
  for (const a of TYPES) { let m = 1; for (const d of types) m *= (chart[a][d] ?? 1); if (m > 1) res[a] = m; }
  return res;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}
function setInfo(html, busy = false, flash = true) {
  const b = $('#info-box'); b.innerHTML = html; b.classList.toggle('hidden', !html); b.classList.toggle('busy', busy);
  if (flash) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
}
const imgHtml = (id, big = false) => `<img data-id="${id}" alt="" ${big ? '' : 'loading="lazy"'}>`;
function hydrate(root) {
  $$('img[data-id]:not([data-h])', root).forEach(img => {
    img.dataset.h = 1;
    getPokemon(+img.dataset.id).then(p => {
      if (!p.img) return;
      img.onload = () => img.classList.add('ld');
      img.src = p.img;
    }).catch(() => {});
  });
}

const sel = { t: new Set(), w: new Set(), h: new Set(), wt: new Set() };
let filtered = [], rendered = 0, searchToken = 0, abilityListLoaded = false;
const PAGE = 24;

function buildAdvanced() {
  $('#r-hi').value = maxId;
  $('#type-list').innerHTML = TYPES.map((t, i) => `
    <div class="type-row" style="--i:${i}">
      <span class="badge t-${t}">${tl(t)}</span>
      <button class="tw" data-k="t" data-t="${t}" title="Has type ${tl(t)}">T</button>
      <button class="tw" data-k="w" data-t="${t}" title="Weak to ${tl(t)}">W</button>
    </div>`).join('');
  $('#type-list').addEventListener('click', e => {
    const b = e.target.closest('.tw'); if (!b) return;
    const set = sel[b.dataset.k], t = b.dataset.t;
    set.has(t) ? set.delete(t) : set.add(t);
    b.classList.toggle('on', set.has(t));
  });
  const sizeBtns = (box, set) => $(box).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const v = b.dataset.v; set.has(v) ? set.delete(v) : set.add(v);
    b.classList.toggle('on', set.has(v));
  });
  sizeBtns('#h-btns', sel.h); sizeBtns('#w-btns', sel.wt);

  $('#toggle-adv').addEventListener('click', () => setAdvanced(!$('#adv').classList.contains('open')));
  $('#btn-search').addEventListener('click', runSearch);
  $('#btn-q').addEventListener('click', runSearch);
  $('#btn-reset').addEventListener('click', resetFilters);
  $('#sort').addEventListener('change', runSearch);
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  let deb; $('#q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(runSearch, 350); });
  $('#btn-random').addEventListener('click', () => { location.hash = '#/pokemon/' + (1 + Math.floor(Math.random() * maxId)); });
}
async function loadAbilities() {
  if (abilityListLoaded) return; abilityListLoaded = true;
  try {
    const list = await cached('abilities', async () => (await getJSON(`${API}/ability?limit=100000`)).results.map(r => r.name));
    $('#ability').insertAdjacentHTML('beforeend', list.sort().map(n => `<option value="${n}">${nice(n)}</option>`).join(''));
  } catch { abilityListLoaded = false; toast('Could not load the ability list. Check your connection.'); }
}
function setAdvanced(open) {
  $('#adv').classList.toggle('open', open);
  $('#toggle-adv').classList.toggle('open', open);
  $('#toggle-text').textContent = open ? 'Hide Advanced Search' : 'Show Advanced Search';
  if (open) loadAbilities();
}
function clearFilters() {
  Object.values(sel).forEach(s => s.clear());
  $$('.tw.on, .size-btns .on').forEach(b => b.classList.remove('on'));
  $('#q').value = ''; $('#ability').value = ''; $('#r-lo').value = 1; $('#r-hi').value = maxId;
}
function resetFilters() { clearFilters(); runSearch(); }
function filterByType(kind, type) {
  clearFilters();
  sel[kind].add(type);
  $(`.tw[data-k="${kind}"][data-t="${type}"]`).classList.add('on');
  setAdvanced(true);
  homeScroll = 0;
  if (location.hash !== '#/') location.hash = '#/';
  runSearch();
}

async function runSearch() {
  const token = ++searchToken;
  const q = $('#q').value.trim().toLowerCase().replace(/\s+/g, '-');
  let lo = Math.max(1, +$('#r-lo').value || 1), hi = Math.min(maxId, +$('#r-hi').value || maxId);
  if (lo > hi) [lo, hi] = [hi, lo];

  let ids = [];
  for (let i = lo; i <= hi; i++) ids.push(i);
  if (q) ids = /^\d+$/.test(q) ? ids.filter(i => i === +q) : ids.filter(i => names[i - 1].includes(q));
  if (sel.t.size) ids = ids.filter(i => [...sel.t].every(t => typesOf[i]?.includes(t)));
  if (sel.w.size) ids = ids.filter(i => { const w = weakness(typesOf[i] || []); return [...sel.w].every(t => w[t]); });

  try {
    const ab = $('#ability').value;
    if (ab) {
      setInfo('Filtering by ability…', true, false);
      const info = await getAbilityInfo(ab); if (token !== searchToken) return;
      const set = new Set(info.ids); ids = ids.filter(i => set.has(i));
    }
    if (sel.h.size || sel.wt.size) {
      setInfo(`Measuring height &amp; weight…<div class="bar"><i id="bar"></i></div>`, true, false);
      onScan = (d, n) => { const b = $('#bar'); if (b) b.style.width = (d / n * 100) + '%'; };
      await scanAll();
      if (token !== searchToken) return;
      ids = ids.filter(id => {
        const s = sizes.get(id);
        if (!s) return false;
        const [h, w] = s;
        return (!sel.h.size || sel.h.has(sizeCat(h, cuts.h))) && (!sel.wt.size || sel.wt.has(sizeCat(w, cuts.w)));
      });
    }
  } catch (e) {
    if (e === 'cancel') return;
    toast('PokeAPI request failed. Check your connection and try again.'); return;
  }
  if (token !== searchToken) return;

  const s = $('#sort').value;
  if (s === 'desc') ids.sort((a, b) => b - a);
  else if (s === 'az') ids.sort((a, b) => names[a - 1].localeCompare(names[b - 1]));
  else if (s === 'za') ids.sort((a, b) => names[b - 1].localeCompare(names[a - 1]));
  filtered = ids; rendered = 0;
  $('#grid').innerHTML = '';
  $('#empty').classList.toggle('hidden', ids.length > 0);
  setInfo(ids.length === maxId ? '' : `Found <b>${ids.length}</b> Pokémon`, false);
  appendCards();
}
function appendCards() {
  if (rendered >= filtered.length) return;
  const slice = filtered.slice(rendered, rendered + PAGE);
  $('#grid').insertAdjacentHTML('beforeend', slice.map((id, i) => `
    <a class="card" href="#/pokemon/${id}" style="--d:${i * 30}ms">
      <div class="card-img">${imgHtml(id)}</div>
      <span class="num">#${pad(id)}</span>
      <h3>${esc(nice(names[id - 1]))}</h3>
      <div class="badges">${(typesOf[id] || []).map(t => badge(t)).join('')}</div>
    </a>`).join(''));
  rendered += slice.length;
  hydrate($('#grid'));
  requestAnimationFrame(rewatch);
}
let io = null;
function rewatch() { const s = $('#sentinel'); io.unobserve(s); io.observe(s); }
function setupInfiniteScroll() {
  io = new IntersectionObserver(es => { if (es[0].isIntersecting) appendCards(); }, { rootMargin: '500px' });
  io.observe($('#sentinel'));
}

let detailToken = 0;
const verColor = v => { let h = 0; for (const c of v) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 62% 52%)`; };
const cleanText = s => s.replace(/[\f\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();

function evoLabel(ds) {
  if (!ds || !ds.length) return '';
  const d = ds[0];
  if (d.min_level) return 'Lv. ' + d.min_level;
  if (d.item) return nice(d.item.name);
  if (d.known_move) return nice(d.known_move.name);
  if (d.min_happiness) return 'Friendship';
  return d.trigger ? nice(d.trigger.name) : '';
}
function evoHtml(node, cur, depth = 0) {
  const id = idOf(node.species.url);
  const me = `<a class="evo-node ${id === cur ? 'cur' : ''}" href="#/pokemon/${id}" style="--d:${depth * 180}ms">
      <div class="pic">${imgHtml(id, true)}</div>
      <b>${esc(nice(node.species.name))} <small>#${pad(id)}</small></b>
      <div class="badges">${(typesOf[id] || []).map(t => badge(t)).join('')}</div></a>`;
  const kids = node.evolves_to.map(k =>
    `<div class="evo-link"><div class="arrow"><i></i>${esc(evoLabel(k.evolution_details))}</div>${evoHtml(k, cur, depth + 1)}</div>`).join('');
  return `<div class="evo-branch">${me}${kids ? `<div class="evo-children">${kids}</div>` : ''}</div>`;
}

async function showDetail(id) {
  id = Math.min(maxId, Math.max(1, id));
  const token = ++detailToken;
  const view = $('#view-detail');
  view.innerHTML = `<div class="skel" style="height:34px;margin:18px auto;width:260px"></div>
    <div class="d-grid"><div class="skel" style="aspect-ratio:1"></div><div class="skel" style="height:360px"></div></div>`;
  switchView('detail');
  try {
    const [p, sp] = await Promise.all([getPokemon(id), getSpecies(id)]);
    const chainP = getChain(sp.chain);
    const statLabels = await Promise.all(p.stats.map(s => getStatName(s.name).catch(() => nice(s.name))));
    if (token !== detailToken) return;
    if (token !== detailToken) return;

    const prev = id === 1 ? maxId : id - 1, next = id === maxId ? 1 : id + 1;
    const ft = p.height / 10 / 0.3048, feet = Math.floor(ft), inch = Math.round((ft - feet) * 12);
    const kg = p.weight / 10, lbs = (kg * 2.20462).toFixed(1);
    const gender = sp.genderRate < 0 ? 'Genderless'
      : `<span class="gender"><span class="m" title="${(8 - sp.genderRate) / 8 * 100}% male">♂</span> <span class="f" title="${sp.genderRate / 8 * 100}% female">♀</span></span>`;
    const w = weakness(p.types);

    const seen = new Set(), vers = [];
    for (const f of [...sp.flavors].reverse()) if (!seen.has(f.v)) { seen.add(f.v); vers.push(f); }
    vers.reverse(); const showVers = vers.slice(-8).reverse();

    view.innerHTML = `
      <div class="pn-nav">
        <a class="prev" href="#/pokemon/${prev}">◀ <b>#${pad(prev)}</b> ${esc(nice(names[prev - 1]))}</a>
        <a class="next" href="#/pokemon/${next}">${esc(nice(names[next - 1]))} <b>#${pad(next)}</b> ▶</a>
      </div>
      <h1 class="d-title">${esc(nice(p.name))} <span>#${pad(p.id)}</span></h1>
      <div class="d-grid">
        <div class="d-left">
          <div class="d-img">${imgHtml(id, true)}</div>
          <div class="stats-box"><h4>Stats</h4><div class="stat-cols">
            ${p.stats.map(({ value: v }, i) => `<div class="stat-col" data-v="${v}"><div class="segs">${
              Array.from({ length: 15 }, (_, s) => `<i class="seg" style="--s:${s}"></i>`).join('')}</div>
              <span class="v">${v}</span><span class="l">${esc(statLabels[i])}</span></div>`).join('')}
          </div></div>
        </div>
        <div class="d-right">
          <p class="desc" id="desc">${showVers[0] ? esc(cleanText(showVers[0].t)) : ''}</p>
          <div class="versions"><span>Versions:</span>${showVers.map((v, i) =>
            `<button class="ver ${i ? '' : 'on'}" data-i="${i}" title="${esc(nice(v.v))}" style="background:${verColor(v.v)}"></button>`).join('')}</div>
          <dl class="info-blue">
            <div><dt>Height</dt><dd>${(p.height / 10).toFixed(1)} m (${feet}′${String(inch).padStart(2, '0')}″)</dd></div>
            <div><dt>Category</dt><dd>${esc(sp.genus)}</dd></div>
            <div><dt>Weight</dt><dd>${kg.toFixed(1)} kg (${lbs} lbs)</dd></div>
            <div><dt>Abilities</dt><dd>${p.abilities.map(a => `<span class="chip ${a.hidden ? 'hid' : ''}" data-a="${a.name}" title="Click for description${a.hidden ? ' (hidden ability)' : ''}">${esc(nice(a.name))}</span>`).join('')}</dd></div>
            <div><dt>Gender</dt><dd>${gender}</dd></div>
          </dl>
          <div class="sec-h">Type</div>
          <div class="badges">${p.types.map(t => linkBadge('t', t)).join('')}</div>
          <div class="sec-h">Weaknesses</div>
          <div class="badges">${Object.keys(w).map(t => linkBadge('w', t, w[t] === 4 ? '<sup>×4</sup>' : '')).join('') || '<span>None</span>'}</div>
        </div>
      </div>
      <section class="evo"><div><h2>Evolution</h2><div class="evo-tree" id="evo-tree"><div class="skel" style="width:300px;height:110px"></div></div></div></section>
      <a class="back" href="#/">← Back to list</a>`;
    view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
    statCeil = Math.max(statCeil, ...p.stats.map(s => s.value));
    hydrate(view);
    requestAnimationFrame(() => requestAnimationFrame(() => fillSegs(view)));
    scanPromise?.then(() => token === detailToken && fillSegs(view));

    $('.versions', view).addEventListener('click', e => {
      const b = e.target.closest('.ver'); if (!b) return;
      $$('.ver', view).forEach(x => x.classList.toggle('on', x === b));
      const d = $('#desc'); d.classList.add('swap');
      setTimeout(() => { d.textContent = cleanText(showVers[+b.dataset.i].t); d.classList.remove('swap'); }, 220);
    });
    $('.d-right', view).addEventListener('click', e => {
      const b = e.target.closest('.badge.link'); if (b) filterByType(b.dataset.k, b.dataset.t);
    });
    $('.info-blue', view).addEventListener('click', async e => {
      const c = e.target.closest('.chip'); if (!c) return;
      toast(`${c.textContent}: loading…`);
      try { const a = await getAbilityInfo(c.dataset.a); toast(`${c.textContent}: ${a.effect}`); } catch { toast('Could not load the ability description.'); }
    });

    const chain = await chainP; if (token !== detailToken) return;
    const tree = $('#evo-tree');
    tree.innerHTML = chain.evolves_to.length ? evoHtml(chain, id)
      : `<div class="evo-none">This Pokémon does not evolve.<br><br><div class="evo-tree">${evoHtml(chain, id)}</div></div>`;
    hydrate(tree);
  } catch (e) {
    console.log(e);
    if (token !== detailToken) return;
    view.innerHTML = `<div class="empty"><div class="ball small"></div><p>Could not load this Pokémon. Check your connection and reload.</p><a class="back" href="#/">← Back to list</a></div>`;
  }
}

let homeScroll = 0, current = 'home';
function switchView(name) {
  if (current === 'home') homeScroll = window.scrollY;
  const home = $('#view-home'), det = $('#view-detail');
  home.classList.toggle('hidden', name !== 'home'); det.classList.toggle('hidden', name !== 'detail');
  const v = name === 'home' ? home : det;
  v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
  window.scrollTo(0, name === 'home' ? homeScroll : 0);
  current = name;
}
function route() {
  const m = location.hash.match(/^#\/pokemon\/(\d+)/);
  m ? showDetail(+m[1]) : switchView('home');
}

(async function main() {
  await initBridge();
  setupInfiniteScroll();
  try {
    await loadIndex();
    buildAdvanced();
  } catch (e) {
    $('#loader-text').textContent = 'Could not reach PokeAPI. Check your connection and restart the app.';
    console.log(e); return;
  }
  await runSearch();
  window.addEventListener('hashchange', route);
  $('#loader').classList.add('done');
  route();
  scanAll().catch(() => {});
})();
