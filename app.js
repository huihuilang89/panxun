(function () {
  "use strict";
  var C = window.APP_CONFIG;
  var app = document.getElementById("app");
  var db = null, state = { tab: "home", profile: null, email: "", holdings: [], showKey: false, quotes: {}, series: {}, tdBusy: false, detail: "" };
  var timer = null, qtimer = null;

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "class") n.className = props[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), props[k]);
      else n.setAttribute(k, props[k]);
    });
    [].concat(kids == null ? [] : kids).forEach(function (c) { n.append(c); });
    return n;
  }
  function clear() { if (timer) { clearInterval(timer); timer = null; } if (qtimer) { clearInterval(qtimer); qtimer = null; } app.textContent = ""; }

  // ---------- 時間 ----------
  function fmt(tz, withDate) {
    var o = { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" };
    if (withDate) { o.year = "numeric"; o.month = "2-digit"; o.day = "2-digit"; o.weekday = "short"; }
    return new Intl.DateTimeFormat("zh-TW", o).format(new Date());
  }
  function marketStatus() {
    var p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date());
    var g = {}; p.forEach(function (x) { g[x.type] = x.value; });
    var m = (parseInt(g.hour, 10) % 24) * 60 + parseInt(g.minute, 10);
    var wk = ["Sat", "Sun"].indexOf(g.weekday) < 0;
    if (wk && m >= 570 && m < 960) return { t: "盤中（估算）", open: true };
    if (wk && m >= 240 && m < 570) return { t: "盤前（估算）", open: false };
    if (wk && m >= 960 && m < 1200) return { t: "盤後（估算）", open: false };
    return { t: "休市（估算）", open: false };
  }

  // ---------- 登入 ----------
  function showLogin(msg) {
    clear();
    var email = el("input", { type: "email", placeholder: "電子郵箱", autocomplete: "username" });
    var pw = el("input", { type: "password", placeholder: "密碼", autocomplete: "current-password" });
    var err = el("div", { class: "err" }, msg || "");
    var btn = el("button", { class: "btn", onclick: go }, "登入");
    function go() {
      err.textContent = ""; btn.disabled = true; btn.textContent = "登入中…";
      db.auth.signInWithPassword({ email: email.value.trim(), password: pw.value }).then(function (r) {
        if (r.error) { err.textContent = "登入失敗：郵箱或密碼不正確"; btn.disabled = false; btn.textContent = "登入"; return; }
        boot();
      });
    }
    pw.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    app.append(el("div", { class: "login" }, [
      el("h1", {}, "美股盤訊助手"),
      el("div", { class: "muted" }, "僅限受邀用戶使用，帳號由管理員開通"),
      el("div", { class: "card" }, [el("label", {}, "郵箱"), email, el("label", {}, "密碼"), pw, err, btn]),
      el("div", { class: "warn" }, "本工具僅提供資訊整理，不構成投資建議。行情資料有延遲，請勿作為即時下單依據。")
    ]));
  }

  // ---------- 啟動 ----------
  function boot() {
    db.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (!s) return showLogin();
      state.email = s.user.email;
      db.from("profiles").select("*").eq("id", s.user.id).single().then(function (p) {
        var pr = p.data;
        var expired = pr && pr.expires_at && new Date(pr.expires_at) < new Date();
        if (!pr || pr.status !== "active" || expired) {
          db.auth.signOut().then(function () { showLogin(expired ? "帳號授權已到期，請聯絡管理員" : "帳號尚未啟用，請聯絡管理員"); });
          return;
        }
        state.profile = pr;
        db.from("app_settings").select("value").eq("key", "show_key_setting").single().then(function (g) {
          var glob = g && g.data && g.data.value === true;
          state.showKey = pr.role === "admin" || (pr.show_key_setting === null || pr.show_key_setting === undefined ? glob : pr.show_key_setting === true);
          render();
        });
      });
    });
  }

  // ---------- 主畫面 ----------
  function render() {
    clear();
    var main = el("div", {});
    app.append(main);
    if (state.tab === "home") renderHome(main);
    else if (state.tab === "me") renderMe(main);
    else main.append(el("div", { class: "soon" }, [el("h3", {}, { watch: "自選股", radar: "雷達", market: "市場" }[state.tab]), el("p", {}, "這個頁面在後續階段開發")]));
    var tabs = [["home", "首頁"], ["watch", "自選股"], ["radar", "雷達"], ["market", "市場"], ["me", "我的"]];
    app.append(el("nav", {}, el("div", {}, tabs.map(function (t) {
      return el("button", { class: state.tab === t[0] ? "on" : "", onclick: function () { state.tab = t[0]; render(); } }, t[1]);
    }))));
  }

  // ---------- 行情 Key（只存在本機瀏覽器） ----------
  function getKey() { try { return localStorage.getItem("fh_key") || ""; } catch (e) { return ""; } }
  function setKey(v) { try { if (v) localStorage.setItem("fh_key", v); else localStorage.removeItem("fh_key"); } catch (e) {} }

  // ---------- Twelve Data（K 線）Key 與資料 ----------
  function getTd() { try { return localStorage.getItem("td_key") || ""; } catch (e) { return ""; } }
  function setTd(v) { try { if (v) localStorage.setItem("td_key", v); else localStorage.removeItem("td_key"); } catch (e) {} }
  function cacheGet(sym) { try { var o = JSON.parse(localStorage.getItem("td_" + sym) || "null"); if (o && Date.now() - o.t < 6 * 3600 * 1000) return o.v; } catch (e) {} return null; }
  function cachePut(sym, v) { try { localStorage.setItem("td_" + sym, JSON.stringify({ t: Date.now(), v: v })); } catch (e) {} }
  function fetchSeries(sym, key) {
    var url = "https://api.twelvedata.com/time_series?symbol=" + encodeURIComponent(sym) + "&interval=1day&outputsize=250&apikey=" + encodeURIComponent(key);
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || j.status === "error" || !j.values) { var e = new Error((j && j.message) || "empty"); e.code = j && j.code; throw e; }
      return j.values.slice().reverse().map(function (x) { return { d: x.datetime, o: +x.open, h: +x.high, l: +x.low, c: +x.close, v: +x.volume }; });
    });
  }
  var NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, parent) { var n = document.createElementNS(NS, tag); Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); if (parent) parent.appendChild(n); return n; }
  function candleSvg(vals, w, h) {
    var root = svg("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", height: h, preserveAspectRatio: "none" });
    if (!vals.length) return root;
    var hi = Math.max.apply(null, vals.map(function (x) { return x.h; })), lo = Math.min.apply(null, vals.map(function (x) { return x.l; }));
    var rng = hi - lo || 1, step = w / vals.length, bw = Math.max(1, step * 0.6);
    function y(p) { return 3 + (hi - p) / rng * (h - 6); }
    vals.forEach(function (x, i) {
      var cx = i * step + step / 2, up = x.c >= x.o, col = up ? "#5BC49A" : "#E7776B";
      svg("line", { x1: cx, x2: cx, y1: y(x.h), y2: y(x.l), stroke: col, "stroke-width": 1 }, root);
      svg("rect", { x: cx - bw / 2, width: bw, y: Math.min(y(x.o), y(x.c)), height: Math.max(1, Math.abs(y(x.o) - y(x.c))), fill: col }, root);
    });
    return root;
  }
  function lineSvg(pts, w, h) {
    var root = svg("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", height: h, preserveAspectRatio: "none" });
    var hi = Math.max.apply(null, pts), lo = Math.min.apply(null, pts), rng = hi - lo || 1;
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + (i / (pts.length - 1) * w).toFixed(1) + " " + (3 + (hi - p) / rng * (h - 6)).toFixed(1); }).join(" ");
    svg("path", { d: d, fill: "none", stroke: "#D8B26E", "stroke-width": 2, "vector-effect": "non-scaling-stroke" }, root);
    return root;
  }
  function curve(holdings, series) {
    var dates = {}, i;
    holdings.forEach(function (h) { (series[h.symbol] || []).forEach(function (x) { dates[x.d.slice(0, 10)] = 1; }); });
    var ds = Object.keys(dates).sort(), out = [], labels = [];
    ds.forEach(function (d) {
      var tot = 0, n = 0, ok = true;
      holdings.forEach(function (h) {
        if (h.buy_date > d) return;
        var s = series[h.symbol], c = null;
        if (s) for (i = 0; i < s.length; i++) if (s[i].d.slice(0, 10) === d) { c = s[i].c; break; }
        if (c === null) ok = false; else { tot += h.shares * c; n++; }
      });
      if (ok && n > 0) { out.push(tot); labels.push(d); }
    });
    return { pts: out, labels: labels };
  }
  var TILES = [["道瓊斯", "DIA", "ETF 代理"], ["標普 500", "SPY", "ETF 代理"], ["納斯達克 100", "QQQ", "ETF 代理"], ["波動率", "VIXY", "VIX 期貨 ETF"]];
  function fetchQuote(sym, key) {
    var url = "https://finnhub.io/api/v1/quote?symbol=" + encodeURIComponent(sym) + "&token=" + encodeURIComponent(key);
    return fetch(url).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error("key");
      if (r.status === 429) throw new Error("limit");
      if (!r.ok) throw new Error("http");
      return r.json();
    }).then(function (j) { if (!j || !(j.c > 0)) throw new Error("empty"); return j; });
  }
  // 沒有即時報價時，退而使用 K 線資料的最近收盤價
  function qget(sym) {
    var c = state.quotes[sym]; if (c && c.c) return c;
    var s = state.series[sym];
    if (s && s.length > 1) { var l = s[s.length - 1], p = s[s.length - 2]; return { c: l.c, dp: (l.c - p.c) / p.c * 100, fb: true, d: l.d.slice(0, 10) }; }
    return null;
  }
  function etStamp(sec) {
    if (!sec) return "時間不明";
    var p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(sec * 1000)), g = {};
    p.forEach(function (x) { g[x.type] = x.value; });
    return g.month + "/" + g.day + " " + (g.hour === "24" ? "00" : g.hour) + ":" + g.minute;
  }
  // 資料來源標示：避免把收盤價或延遲報價誤認為即時盤中資料
  function srcShort(c) { return c.fb ? "收盤價 " + c.d.slice(5).replace("-", "/") + "（非盤中）" : "報價 " + etStamp(c.t) + " ET（可能延遲）"; }
  function srcLong(c) { return c.fb ? srcShort(c) + " · 漲跌＝該日收盤對前一交易日收盤，非盤中漲跌" : srcShort(c) + " · 漲跌＝相對前一收盤"; }
  function money(x) { return (x < 0 ? "-" : "") + "$" + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(x) { return (x >= 0 ? "+" : "") + x.toFixed(2) + "%"; }
  function cls(x) { return x > 0 ? "up" : x < 0 ? "down" : "muted"; }

  function renderHome(main) {
    var etEl = el("b", {}), locEl = el("b", {}), st = el("span", { class: "badge" });
    function tick() {
      etEl.textContent = fmt("America/New_York", true);
      locEl.textContent = fmt(Intl.DateTimeFormat().resolvedOptions().timeZone, false);
      var s = marketStatus(); st.textContent = s.t; st.className = "badge" + (s.open ? " open" : "");
    }
    tick(); timer = setInterval(tick, 1000);
    main.append(el("div", { class: "card" }, [
      el("div", { class: "clock" }, [el("div", {}, ["美東時間 ET", etEl]), el("div", {}, ["本地時間", locEl])]),
      el("div", { style: "margin-top:8px" }, st)
    ]));
    main.append(el("div", { class: "warn" }, "⚠ 行情資料存在延遲（約 15 分鐘或更久），僅供參考，請勿作為即時下單依據。"));

    var sumBox = el("div", { class: "card" });
    var status = el("div", { class: "muted", style: "font-size:12px;margin-top:8px" });
    var tileEls = TILES.map(function (t) {
      var v = el("div", { class: "muted" }, "—"), tg = el("small", { style: "display:block;font-size:11px;margin-top:2px" });
      return { sym: t[1], v: v, tg: tg, box: el("div", { class: "tile", style: "cursor:pointer", onclick: function () { state.detail = state.detail === t[1] ? "" : t[1]; drawDetail(); } }, [el("small", {}, t[0] + "（" + t[1] + "）"), v, el("small", {}, t[2]), tg]) };
    });
    main.append(sumBox);
    var tdStatus = el("div", { class: "muted", style: "font-size:12px;margin-top:4px" });
    var detail = el("div", { class: "card" }); detail.hidden = true;
    main.append(el("div", { class: "card" }, [el("div", { class: "tiles" }, tileEls.map(function (t) { return t.box; })), status, tdStatus]));
    main.append(detail);

    var list = el("div", {});
    main.append(el("div", { class: "card" }, [el("h3", {}, "我的持倉"), list]));

    function draw() {
      var q = state.quotes, tv = 0, tc = 0, ok = 0, fbN = 0;
      list.textContent = "";
      if (!state.holdings.length) list.append(el("p", { class: "muted" }, "還沒有持倉，下方新增第一筆。"));
      state.holdings.forEach(function (h) {
        var cur = qget(h.symbol), right = [];
        var cost = h.shares * h.cost; tc += cost;
        if (cur && cur.c) {
          var val = h.shares * cur.c; tv += val; ok++; if (cur.fb) fbN++;
          var pl = val - cost, plp = cost > 0 ? pl / cost * 100 : 0;
          right.push(el("div", { class: "sym" }, money(cur.c)));
          right.push(el("div", { class: "muted", style: "font-size:11px" }, srcShort(cur)));
          right.push(el("div", { class: cls(pl), style: "font-size:12px" }, money(pl) + "（" + pct(plp) + "）"));
        } else right.push(el("div", { class: "muted" }, "—"));
        var rowEl = el("div", { class: "row" }, [
          el("div", {}, [el("div", { class: "sym" }, h.symbol), el("div", { class: "muted", style: "font-size:12px" }, h.shares + " 股 · 成本 " + h.cost + " · " + h.buy_date)]),
          el("div", { style: "text-align:right" }, right),
          el("div", { style: "display:flex;gap:6px;flex:none" }, [el("button", { class: "btn ghost small", onclick: function () { startEdit(h); } }, "編輯"), el("button", { class: "btn ghost small", onclick: function () { del(h.id); } }, "刪除")])
        ]);
        var sr = state.series[h.symbol];
        if (sr && sr.length) rowEl.append(el("div", { class: "chart" }, [candleSvg(sr.slice(-60), 340, 70), el("small", { class: "muted" }, "近 60 個交易日日 K")]));
        list.append(rowEl);
      });
      sumBox.textContent = "";
      if (state.holdings.length && ok === state.holdings.length) {
        var pl2 = tv - tc;
        sumBox.append(el("div", { class: "muted", style: "font-size:13px" }, "持倉總市值（" + (fbN === ok ? "全部為收盤價，非盤中" : fbN ? "部分為收盤價，其餘為可能延遲的報價" : "報價可能延遲，非即時") + "）"),
          el("div", { style: "font-size:26px;font-weight:600;font-variant-numeric:tabular-nums" }, money(tv)),
          el("div", { class: cls(pl2) }, "總損益 " + money(pl2) + "（" + pct(tc > 0 ? pl2 / tc * 100 : 0) + "）"));
      } else {
        sumBox.append(el("div", { class: "muted", style: "font-size:13px" }, "持倉總市值"), el("div", { style: "font-size:26px" }, "—"),
          el("div", { class: "muted", style: "font-size:12px" }, state.holdings.length ? "部分或全部報價尚未取得" : "新增持倉後顯示"));
      }
      var cv = curve(state.holdings, state.series);
      if (cv.pts.length > 1) sumBox.append(el("div", { class: "chart", style: "margin-top:10px" }, [lineSvg(cv.pts, 340, 80), el("small", { class: "muted" }, "持倉市值曲線（自買入日起，收盤價估算）")]));
      tileEls.forEach(function (t) {
        var c = qget(t.sym); t.v.textContent = ""; t.tg.textContent = c ? srcLong(c) : ""; t.tg.className = "muted";
        if (c && c.c) { t.v.className = ""; t.v.append(money(c.c) + " ", el("span", { class: cls(c.dp), style: "font-size:13px" }, pct(c.dp || 0))); }
        else { t.v.className = "muted"; t.v.textContent = "—"; }
      });
    }

    function refresh() {
      var key = getKey();
      if (!key) { status.textContent = state.showKey ? "尚未設定行情 Key：到「我的」頁貼上 Finnhub Key。" : "尚未設定行情 Key，請聯絡管理員。"; draw(); return; }
      var syms = {}; TILES.forEach(function (t) { syms[t[1]] = 1; }); state.holdings.forEach(function (h) { syms[h.symbol] = 1; });
      var names = Object.keys(syms).slice(0, 40), fails = 0, firstErr = "";
      status.textContent = "更新報價中…";
      Promise.all(names.map(function (s) {
        return fetchQuote(s, key).then(function (j) { state.quotes[s] = j; }).catch(function (e) { fails++; if (!firstErr) firstErr = e.message; });
      })).then(function () {
        var msg = { key: "Key 無效或此代碼不在免費方案內", limit: "請求太頻繁（免費額度每分鐘有限）", http: "行情服務暫時無法連線", empty: "查無報價（代碼錯誤或此標的不在免費方案內）" };
        status.textContent = fails ? ("有 " + fails + " 檔沒取得報價：" + (msg[firstErr] || "未知錯誤")) : ("報價已更新 " + fmt(Intl.DateTimeFormat().resolvedOptions().timeZone, false) + "（延遲報價）");
        draw();
      });
    }
    function drawDetail() {
      detail.textContent = "";
      var s = state.series[state.detail];
      if (!state.detail) { detail.hidden = true; return; }
      detail.hidden = false;
      var t = TILES.filter(function (x) { return x[1] === state.detail; })[0];
      detail.append(el("h3", {}, t[0] + "（" + t[1] + "）"));
      if (s && s.length) {
        var last = s[s.length - 1], r = s.slice(-60), vmax = Math.max.apply(null, r.map(function (x) { return x.v; }));
        detail.append(candleSvg(r, 340, 140), el("small", { class: "muted" }, "近 60 個交易日日 K · 最新收盤 " + money(last.c) + " · 區間高 " + money(Math.max.apply(null, r.map(function (x) { return x.h; }))) + " 低 " + money(Math.min.apply(null, r.map(function (x) { return x.l; })))));
      } else detail.append(el("p", { class: "muted" }, "尚無 K 線資料，請先在「我的」頁設定 Twelve Data Key。"));
      detail.append(el("p", { class: "muted", style: "font-size:12px" }, "此為 ETF 代理走勢，並非指數點數本身。"));
    }
    function loadSeries() {
      var key = getTd();
      if (!key) { tdStatus.textContent = state.showKey ? "尚未設定 Twelve Data Key（K 線）：到「我的」頁貼上。" : "尚未設定 K 線 Key，請聯絡管理員。"; return; }
      if (state.tdBusy) return;
      var syms = {}; state.holdings.forEach(function (h) { syms[h.symbol] = 1; }); ["SPY", "DIA", "QQQ"].forEach(function (x) { syms[x] = 1; });
      var todo = [];
      Object.keys(syms).forEach(function (x) { var c = cacheGet(x); if (c) state.series[x] = c; else if (!state.series[x]) todo.push(x); });
      draw(); drawDetail();
      if (!todo.length) { tdStatus.textContent = "K 線資料已載入（每檔每 6 小時更新一次）"; return; }
      state.tdBusy = true; var fails = 0, errMsg = "";
      (function next(i) {
        if (!document.body.contains(sumBox)) { state.tdBusy = false; return; }
        if (i >= todo.length) { state.tdBusy = false; tdStatus.textContent = fails ? ("有 " + fails + " 檔 K 線沒取得：" + errMsg) : "K 線資料已載入"; return; }
        tdStatus.textContent = "載入 K 線 " + (i + 1) + "/" + todo.length + "（免費版每分鐘限 8 次，會慢一點）";
        fetchSeries(todo[i], key).then(function (v) { state.series[todo[i]] = v; cachePut(todo[i], v); draw(); drawDetail(); })
          .catch(function (e) { fails++; errMsg = e.code === 401 || e.code === 403 ? "Key 無效或無權限" : e.code === 429 ? "額度用完，稍後再試" : (e.message || "連線失敗").slice(0, 80); if (e.code === 429) { todo.length = i + 1; } })
          .then(function () { setTimeout(function () { next(i + 1); }, 8000); });
      })(0);
    }
    function load() {
      db.from("holdings").select("*").order("created_at", { ascending: false }).then(function (r) { state.holdings = r.data || []; draw(); refresh(); loadSeries(); });
    }
    function del(id) { db.from("holdings").delete().eq("id", id).then(load); }
    qtimer = setInterval(function () { if (!document.hidden) refresh(); }, 60000);

    var sy = el("input", { placeholder: "代碼，如 AAPL", autocapitalize: "characters" });
    var sh = el("input", { type: "number", step: "any", placeholder: "股數", inputmode: "decimal" });
    var co = el("input", { type: "number", step: "any", placeholder: "每股成本（美元）", inputmode: "decimal" });
    var bd = el("input", { type: "date" });
    var editId = null;
    var formTitle = el("h3", {}, "新增持倉");
    var cancel = el("button", { class: "btn ghost", onclick: function () { resetForm(); } }, "取消修改"); cancel.hidden = true;
    function resetForm() { editId = null; sy.value = sh.value = co.value = bd.value = ""; formTitle.textContent = "新增持倉"; add.textContent = "新增持倉"; cancel.hidden = true; err.textContent = ""; }
    function startEdit(h) {
      editId = h.id; sy.value = h.symbol; sh.value = h.shares; co.value = h.cost; bd.value = h.buy_date;
      formTitle.textContent = "修改持倉"; add.textContent = "儲存修改"; cancel.hidden = false; err.textContent = "";
      formCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    var err = el("div", { class: "err" });
    var add = el("button", { class: "btn", onclick: function () {
      err.textContent = "";
      var s = sy.value.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)) { err.textContent = "股票代碼格式不正確"; return; }
      if (!(parseFloat(sh.value) > 0) || !(parseFloat(co.value) >= 0) || !bd.value) { err.textContent = "請填寫股數、成本和買入日期"; return; }
      var rec = { symbol: s, shares: parseFloat(sh.value), cost: parseFloat(co.value), buy_date: bd.value };
      var op = editId ? db.from("holdings").update(rec).eq("id", editId) : db.from("holdings").insert(rec);
      op.then(function (r) {
        if (r.error) { err.textContent = (editId ? "修改" : "新增") + "失敗，請稍後再試"; return; }
        resetForm(); load();
      });
    } }, "新增持倉");
    var formCard = el("div", { class: "card" }, [formTitle, sy, el("div", { class: "grid2" }, [sh, co]), el("label", {}, "買入日期"), bd, err, add, cancel]);
    main.append(formCard);
    draw(); load();
  }

  function renderMe(main) {
    var p = state.profile;
    main.append(el("div", { class: "card" }, [
      el("h3", {}, "我的帳號"),
      el("p", {}, state.email),
      el("p", { class: "muted" }, "身分：" + (p.role === "admin" ? "管理員" : "用戶")),
      el("p", { class: "muted" }, "授權到期：" + (p.expires_at ? new Date(p.expires_at).toLocaleDateString() : "無期限")),
      el("button", { class: "btn ghost", onclick: function () { db.auth.signOut().then(function () { state.profile = null; showLogin(); }); } }, "登出")
    ]));
    if (state.showKey) {
      var ki = el("input", { type: "password", placeholder: "貼上你的 Finnhub API Key", autocomplete: "off" });
      var msg = el("div", { class: "muted", style: "font-size:12px;margin-top:6px" }, getKey() ? "已設定（只存在這台裝置的瀏覽器，不會上傳）" : "尚未設定");
      main.append(el("div", { class: "card" }, [
        el("h3", {}, "行情 Key 設定"),
        el("p", { class: "muted", style: "font-size:13px" }, "到 finnhub.io 免費註冊，取得你自己的 API Key 後貼在這裡。換裝置或清除瀏覽器資料後需要重新貼。"),
        ki,
        el("button", { class: "btn", onclick: function () { var v = ki.value.trim(); if (v) { setKey(v); ki.value = ""; state.quotes = {}; msg.textContent = "已儲存"; } } }, "儲存 Key"),
        el("button", { class: "btn ghost", onclick: function () { setKey(""); state.quotes = {}; msg.textContent = "已清除"; } }, "清除 Key"),
        msg
      ]));
      var ti = el("input", { type: "password", placeholder: "貼上你的 Twelve Data API Key", autocomplete: "off" });
      var tmsg = el("div", { class: "muted", style: "font-size:12px;margin-top:6px" }, getTd() ? "已設定（只存在這台裝置的瀏覽器，不會上傳）" : "尚未設定");
      main.append(el("div", { class: "card" }, [
        el("h3", {}, "K 線 Key 設定（Twelve Data）"),
        el("p", { class: "muted", style: "font-size:13px" }, "到 twelvedata.com 免費註冊，取得你自己的 API Key 後貼在這裡，用來顯示 K 線和持倉曲線。這是跟上面行情 Key 不同的另一把 Key。"),
        ti,
        el("button", { class: "btn", onclick: function () { var v = ti.value.trim(); if (v) { setTd(v); ti.value = ""; state.series = {}; tmsg.textContent = "已儲存"; } } }, "儲存 Key"),
        el("button", { class: "btn ghost", onclick: function () { setTd(""); state.series = {}; tmsg.textContent = "已清除"; } }, "清除 Key"),
        tmsg
      ]));
    }
  }

  // ---------- 入口 ----------
  if (!window.supabase) { app.textContent = "載入失敗，請檢查網路後重新整理"; return; }
  db = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  boot();
})();
