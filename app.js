(function () {
  "use strict";
  var C = window.APP_CONFIG;
  var app = document.getElementById("app");
  var db = null, state = { tab: "home", profile: null, email: "", holdings: [] };
  var timer = null;

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
  function clear() { if (timer) { clearInterval(timer); timer = null; } app.textContent = ""; }

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
        state.profile = pr; render();
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
    var tiles = el("div", { class: "tiles" }, ["道瓊斯", "標普 500", "納斯達克", "VIX 恐慌指數"].map(function (n) {
      return el("div", { class: "tile" }, [el("small", {}, n), el("div", { class: "muted" }, "—")]);
    }));
    main.append(el("div", { class: "card" }, [tiles, el("div", { class: "muted", style: "font-size:12px;margin-top:8px" }, "行情接入將在下一階段完成")]));

    var list = el("div", {});
    var card = el("div", { class: "card" }, [el("h3", {}, "我的持倉"), list]);
    main.append(card);
    function draw() {
      list.textContent = "";
      if (!state.holdings.length) list.append(el("p", { class: "muted" }, "還沒有持倉，下方新增第一筆。"));
      state.holdings.forEach(function (h) {
        list.append(el("div", { class: "row" }, [
          el("div", {}, [el("div", { class: "sym" }, h.symbol), el("div", { class: "muted", style: "font-size:12px" }, h.shares + " 股 · 成本 " + h.cost + " · " + h.buy_date)]),
          el("button", { class: "btn ghost small", onclick: function () { del(h.id); } }, "刪除")
        ]));
      });
    }
    function load() {
      db.from("holdings").select("*").order("created_at", { ascending: false }).then(function (r) { state.holdings = r.data || []; draw(); });
    }
    function del(id) { db.from("holdings").delete().eq("id", id).then(load); }
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
    load();
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
  }

  // ---------- 入口 ----------
  if (!window.supabase) { app.textContent = "載入失敗，請檢查網路後重新整理"; return; }
  db = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  boot();
})();
