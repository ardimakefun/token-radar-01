/* Launch Radar — the page. Renders window.RADAR with no network: sort, filter, detail. */
(function () {
  var D = window.RADAR;
  if (!D) return;
  var watch = {};
  D.watchlist.forEach(function (s) { watch[s] = true; });
  var maxImplied = D.rows.length ? D.rows[0].implied_value_usd : 1;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e11 ? 0 : 2).replace(/\.00$/, '') + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n == null) return '—';
    var s = (n > 0 ? '+' : '') + n.toFixed(2) + '%';
    return '<span class="' + (n > 0 ? 'up' : n < 0 ? 'down' : '') + '">' + s + '</span>';
  }
  function ageFmt(days) {
    if (days == null) return '—';
    if (days < 90) return days + 'd';
    if (days < 730) return (days / 30.44).toFixed(0) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function chainsOf(r) { return r.chains && r.chains.length ? r.chains.join(', ') : '—'; }
  /** The table shows the first three chains; the detail view shows them all. */
  function chainsShort(r) {
    if (!r.chains || r.chains.length === 0) return '—';
    if (r.chains.length <= 3) return r.chains.join(', ');
    return r.chains.slice(0, 3).join(', ') + ' +' + (r.chains.length - 3) + ' more';
  }

  /* Header, stats, footer. */
  document.getElementById('top-meta').textContent =
    'Snapshot ' + D.as_of + ' · DefiLlama protocol index · model ' + D.model_version;
  document.getElementById('foot-date').textContent = D.as_of;
  document.getElementById('foot-model').textContent = D.model_version;
  var stats = document.getElementById('stats');
  stats.innerHTML =
    stat(D.watchlist_size + ' / ' + D.watchlist_size, 'Watchlist covered') +
    stat(D.board_size, 'Rows scored') +
    stat(D.early_size, 'Early rows below the floor') +
    stat(D.live_size, 'Live-token protocols set aside');
  function stat(b, label) { return '<div class="stat"><b>' + esc(b) + '</b><span>' + esc(label) + '</span></div>'; }

  /* Comparables table. */
  var multBody = document.querySelector('#multiples tbody');
  multBody.innerHTML = D.category_multiples.map(function (c) {
    return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.multiple.toFixed(3) + '×</td><td class="num">' + c.peers + '</td><td>' +
      (c.source === 'category' ? 'Own category' : 'Market-wide fallback') + '</td></tr>';
  }).join('') + '<tr><td><b>Market-wide</b></td><td class="num"><b>' + D.market_multiple.toFixed(3) + '×</b></td><td class="num">' + D.market_peers + '</td><td>All launched protocols</td></tr>';

  /* Filter selects. */
  function fillSelect(id, values) {
    var sel = document.getElementById(id);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
  }
  var cats = [], chains = [];
  D.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  fillSelect('cat', cats);
  fillSelect('chain', chains);

  /* State, sorting, filtering. */
  var state = { q: '', cat: '', chain: '', band: '', scope: 'all', view: 'pre', sort: 'implied', dir: -1, selected: null };
  var sortKey = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    growth: function (r) { return r.change_7d == null ? -9999 : r.change_7d; },
    age: function (r) { return r.age_days == null ? -1 : r.age_days; },
    multiple: function (r) { return r.model.category_multiple; },
    implied: function (r) { return r.implied_value_usd; }
  };
  function filtered() {
    var q = state.q.toLowerCase();
    return D.rows.filter(function (r) {
      if (state.detailOnly && r.slug !== state.selected) return false;
      if (state.scope === 'watch' && !watch[r.slug]) return false;
      if (state.scope === 'early' && watch[r.slug]) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.band === '100' && r.implied_value_usd < 100e6) return false;
      if (state.band === '10' && (r.implied_value_usd < 10e6 || r.implied_value_usd >= 100e6)) return false;
      if (state.band === '1' && r.implied_value_usd >= 10e6) return false;
      if (q && (r.name + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      var k = sortKey[state.sort];
      var av = k(a), bv = k(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function renderBoard() {
    var body = document.querySelector('#board tbody');
    if (state.view === 'live') {
      document.querySelector('.board-wrap').style.display = 'none';
      document.querySelector('.board-note').style.display = 'none';
      document.getElementById('live').scrollIntoView();
      var n = renderLive();
      document.getElementById('rowcount').textContent = n + (n === 1 ? ' live-token protocol' : ' live-token protocols') + (n < D.live_size ? ' (of ' + D.live_size + ')' : '');
      return;
    }
    document.querySelector('.board-wrap').style.display = '';
    document.querySelector('.board-note').style.display = '';
    var rows = filtered();
    document.getElementById('rowcount').textContent = rows.length + (rows.length === 1 ? ' row shown' : ' rows shown');
    body.innerHTML = rows.map(function (r) {
      var w = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><div class="pname">' + esc(r.name) + '</div><div class="psub">' + esc(r.category || 'Uncategorised') + ' on ' + esc(chainsShort(r)) + '</div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageFmt(r.age_days) + '</td>' +
        '<td class="num">' + r.model.category_multiple.toFixed(3) + '×</td>' +
        '<td class="num"><span class="bar"><i style="width:' + w + '%"></i></span>' + money(r.implied_value_usd) + '</td>' +
        '<td><span class="pill">records no token</span></td></tr>';
    }).join('');
    body.querySelectorAll('tr').forEach(function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug'), true); });
    });
    document.querySelectorAll('#board th.sortable').forEach(function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-sort') === state.sort);
    });
  }

  function renderLive() {
    var body = document.querySelector('#live-table tbody');
    var q = state.q.toLowerCase();
    var live = D.live.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    body.innerHTML = live.map(function (r) {
      return '<tr><td><div class="pname">' + esc(r.name) + '</div><div class="psub">' + esc(r.category || 'Uncategorised') + ' on ' + esc(chainsShort(r)) + '</div></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td></tr>';
    }).join('');
    return live.length;
  }

  function renderDetail() {
    var el = document.getElementById('detail');
    var r = null;
    if (state.selected) {
      for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === state.selected) { r = D.rows[i]; break; }
    }
    if (!r) { el.innerHTML = '<p class="detail-empty">Select a row to see its model breakdown and farm plan.</p>'; return; }
    var m = r.model;
    var multNote = m.multiple_source === 'category'
      ? 'median of ' + m.multiple_peers + ' launched peers in ' + (r.category || 'this category')
      : 'market-wide median — ' + (r.category || 'this category') + ' has fewer than ' + D.model.peer_min + ' launched peers';
    el.innerHTML = '<div class="detail-card">' +
      '<div class="detail-rank">Rank ' + r.rank + ' of ' + D.board_size + ' · ' + (watch[r.slug] ? 'on the watchlist' : 'early row, below the floor') + '</div>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="detail-sub">' + esc(r.category || 'Uncategorised') + ' on ' + esc(chainsOf(r)) + ' · <span class="pill">records no token</span></p>' +
      '<div class="detail-grid"><div><h3>Why this value</h3>' +
      '<table class="factors">' +
      '<tr><td>TVL</td><td>' + money(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Comparable multiple</td><td>' + m.category_multiple.toFixed(3) + '× <span class="fnote">' + esc(multNote) + '</span></td></tr>' +
      '<tr><td>Seven-day growth</td><td>' + pct(r.change_7d) + ' → ×' + m.growth_multiplier.toFixed(4) + '</td></tr>' +
      '<tr><td>Age with no token</td><td>' + ageFmt(r.age_days) + ' → ×' + m.tenure_multiplier.toFixed(4) + '</td></tr>' +
      '<tr class="total"><td>Implied value</td><td>' + money(r.implied_value_usd) + '</td></tr>' +
      '</table>' +
      '<p class="fnote" style="font-size:12.5px;color:var(--ink-faint)">Model ' + esc(D.model_version) + ': TVL × comparable multiple × growth multiplier × tenure multiplier. board.json carries this row as ' + money(r.implied_value_usd) + '. This is an estimate, not a price.</p>' +
      '</div><div><h3>Farm plan</h3><ol class="farm">' +
      r.farm_steps.map(function (s) {
        var parts = s.split(' Cost: ');
        var main = parts[0] || s;
        var meta = parts[1] ? 'Cost: ' + parts[1] : '';
        return '<li>' + esc(main) + (meta ? '<span class="meta">' + esc(meta) + '</span>' : '') + '</li>';
      }).join('') +
      '</ol></div></div></div>';
  }

  function select(slug, scroll) {
    state.selected = slug;
    renderBoard();
    renderDetail();
  }

  /* Controls. */
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('band').addEventListener('change', function (e) { state.band = e.target.value; renderBoard(); });
  document.getElementById('scope').addEventListener('change', function (e) { state.scope = e.target.value; renderBoard(); });
  document.getElementById('view').addEventListener('change', function (e) { state.view = e.target.value; renderBoard(); renderDetail(); });
  document.querySelectorAll('#board th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      renderBoard();
    });
  });

  /* A routed view hides the intro sections, so the view it names sits at the top
     of the page with no scrolling: the board, one protocol's detail, or a filter. */
  function applyHash() {
    var route = window.ROUTE || null;
    var params = new URLSearchParams(window.location.search || '');
    var view = (route && route.view) || params.get('view') || '';
    var h = window.location.hash || '';
    var m = h.match(/^#\/detail\/([A-Za-z0-9._-]+)/);
    var f = h.match(/^#\/filter\/(.+)/);
    if (view === 'detail' || m) {
      state.selected = (route && route.slug) || params.get('slug') || (m && m[1]) || '';
      state.detailOnly = true;
      document.body.classList.add('routed');
      renderBoard(); renderDetail();
      return;
    }
    if (view === 'filter' || f) {
      var cat = (route && route.cat) || params.get('cat') || (f ? decodeURIComponent(f[1]) : '');
      state.cat = cat;
      document.getElementById('cat').value = cat;
      document.body.classList.add('routed');
      renderBoard(); renderDetail();
      return;
    }
    renderBoard(); renderDetail();
    if (view === 'board' || h === '#/board') document.body.classList.add('routed');
  }
  window.addEventListener('hashchange', applyHash);
  renderLive();
  applyHash();
})();
