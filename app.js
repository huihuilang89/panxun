(function () {
  "use strict";
  var C = window.APP_CONFIG;
  var app = document.getElementById("app");
  var db = null, state = { tab: "home", profile: null, email: "", holdings: [], showKey: false, quotes: {} };
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
      var v = el("div", { class: "muted" }, "—");
      return { sym: t[1], v: v, box: el("div", { class: "tile" }, [el("small", {}, t[0] + "（" + t[1] + "）"), v, el("small", {}, t[2])]) };
    });
    main.append(sumBox);
    main.append(el("div", { class: "card" }, [el("div", { class: "tiles" }, tileEls.map(function (t) { return t.box; })), status]));

    var list = el("div", {});
    main.append(el("div", { class: "card" }, [el("h3", {}, "我的持倉"), list]));

    function draw() {
      var q = state.quotes, tv = 0, tc = 0, ok = 0;
      list.textContent = "";
      if (!state.holdings.length) list.append(el("p", { class: "muted" }, "還沒有持倉，下方新增第一筆。"));
      state.holdings.forEach(function (h) {
        var cur = q[h.symbol], right = [];
        var cost = h.shares * h.cost; tc += cost;
        if (cur && cur.c) {
          var val = h.shares * cur.c; tv += val; ok++;
          var pl = val - cost, plp = cost > 0 ? pl / cost * 100 : 0;
          right.push(el("div", { class: "sym" }, money(cur.c)));
          right.push(el("div", { class: cls(pl), style: "font-size:12px" }, money(pl) + "（" + pct(plp) + "）"));
        } else right.push(el("div", { class: "muted" }, "—"));
        list.append(el("div", { class: "row" }, [
          el("div", {}, [el("div", { class: "sym" }, h.symbol), el("div", { class: "muted", style: "font-size:12px" }, h.shares + " 股 · 成本 " + h.cost + " · " + h.buy_date)]),
          el("div", { style: "text-align:right" }, right),
          el("button", { class: "btn ghost small", onclick: function () { del(h.id); } }, "刪除")
        ]));
      });
      sumBox.textContent = "";
      if (state.holdings.length && ok === state.holdings.length) {
        var pl2 = tv - tc;
        sumBox.append(el("div", { class: "muted", style: "font-size:13px" }, "持倉總市值（延遲報價）"),
          el("div", { style: "font-size:26px;font-weight:600;font-variant-numeric:tabular-nums" }, money(tv)),
          el("div", { class: cls(pl2) }, "總損益 " + money(pl2) + "（" + pct(tc > 0 ? pl2 / tc * 100 : 0) + "）"));
      } else {
        sumBox.append(el("div", { class: "muted", style: "font-size:13px" }, "持倉總市值"), el("div", { style: "font-size:26px" }, "—"),
          el("div", { class: "muted", style: "font-size:12px" }, state.holdings.length ? "部分或全部報價尚未取得" : "新增持倉後顯示"));
      }
      tileEls.forEach(function (t) {
        var c = q[t.sym]; t.v.textContent = "";
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
    function load() {
      db.from("holdings").select("*").order("created_at", { ascending: false }).then(function (r) { state.holdings = r.data || []; draw(); refresh(); });
    }
    function del(id) { db.from("holdings").delete().eq("id", id).then(load); }
    qtimer = setInterval(function () { if (!document.hidden) refresh(); }, 60000);

    var sy = el("input", { placeholder: "代碼，如 AAPL", autocapitalize: "characters" });
    var sh = el("input", { type: "number", step: "any", placeholder: "股數", inputmode: "decimal" });
    var co = el("input", { type: "number", step: "any", placeholder: "每股成本（美元）", inputmode: "decimal" });
    var bd = el("input", { type: "date" });
    var err = el("div", { class: "err" });
    var add = el("button", { class: "btn", onclick: function () {
      err.textContent = "";
      var s = sy.value.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)) { err.textContent = "股票代碼格式不正確"; return; }
      if (!(parseFloat(sh.value) > 0) || !(parseFloat(co.value) >= 0) || !bd.value) { err.textContent = "請填寫股數、成本和買入日期"; return; }
      db.from("holdings").insert({ symbol: s, shares: parseFloat(sh.value), cost: parseFloat(co.value), buy_date: bd.value }).then(function (r) {
        if (r.error) { err.textContent = "新增失敗，請稍後再試"; return; }
        sy.value = sh.value = co.value = bd.value = ""; load();
      });
    } }, "新增持倉");
    main.append(el("div", { class: "card" }, [el("h3", {}, "新增持倉"), sy, el("div", { class: "grid2" }, [sh, co]), el("label", {}, "買入日期"), bd, err, add]));
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
    }
  }

  // ---------- 入口 ----------
  if (!window.supabase) { app.textContent = "載入失敗，請檢查網路後重新整理"; return; }
  db = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  boot();
})();
