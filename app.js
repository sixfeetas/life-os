/* ============================================================
   Life OS · 外壳
   三个 tab：记录 / 计划 / 自省
   ============================================================ */
(function (w) {

  const TABS = [
    {
      id: 'log', label: '记录',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>'
    },
    {
      id: 'plan', label: '计划',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>'
    },
    {
      id: 'insight', label: '自省',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3z"/><path d="M9.5 20.5h5"/></svg>'
    }
  ];

  let current = 'log';
  let toastTimer = null;

  /* ---------------- Toast ---------------- */
  function toast(msg, kind) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2200);
  }

  /* ---------------- 弹层 ---------------- */
  function sheet(html, opts) {
    opts = opts || {};
    const overlay = document.getElementById('overlay');
    const box = document.getElementById('sheetBox');
    box.className = 'sheet' + (opts.wide ? ' wide' : '');
    box.innerHTML = html;
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    if (opts.onMount) opts.onMount(box);
    return box;
  }

  function closeSheet() {
    const overlay = document.getElementById('overlay');
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
    document.getElementById('sheetBox').innerHTML = '';
  }

  /* ---------------- 渲染外壳 ---------------- */
  function renderNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = TABS.map(function (t) {
      return '<button data-tab="' + t.id + '" class="' + (t.id === current ? 'on' : '') + '">' +
        t.icon + '<span>' + t.label + '</span></button>';
    }).join('');
    nav.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { go(b.dataset.tab); };
    });
  }

  function renderLivePill() {
    const pill = document.getElementById('livePill');
    const st = Store.get();
    if (!st.running) {
      pill.classList.remove('show');
      return;
    }
    pill.classList.add('show');
    pill.innerHTML = '<span class="pulse"></span><span id="liveText">' +
      U.clock(Date.now() - st.running.start) + '</span>';
    pill.onclick = function () {
      go('log');
      const el = document.querySelector('.timer-card');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  }

  function tickPill() {
    const st = Store.get();
    if (!st.running) return;
    const t = document.getElementById('liveText');
    if (t) t.textContent = U.clock(Date.now() - st.running.start);
  }

  function renderView() {
    const root = document.getElementById('view');
    const mod = current === 'log' ? w.TabLog : current === 'plan' ? w.TabPlan : w.TabInsight;
    if (!mod || !mod.render) {
      root.innerHTML = '<div class="placeholder"><h3>加载中</h3></div>';
      return;
    }
    mod.render(root, {
      toast: toast,
      sheet: sheet,
      closeSheet: closeSheet,
      go: go
    });
  }

  function go(tab) {
    if (tab === current) return;
    current = tab;
    renderNav();
    renderView();
    w.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function rerender() {
    renderNav();
    renderView();
    renderLivePill();
  }

  /* 导入后重置各 tab 的内部视图状态（回到今天） */
  function tab_state_reset() {
    ['TabLog', 'TabPlan', 'TabInsight'].forEach(function (k) {
      if (w[k] && typeof w[k].reset === 'function') {
        try { w[k].reset(); } catch (e) { /* ignore */ }
      }
    });
  }

  /* ---------------- 存储警告 ----------------
     手机用 file:// 打开时 localStorage 常被禁用。
     这时功能全都能用，但关掉页面数据就没了——必须明说。 */
  function renderStorageWarn() {
    const el = document.getElementById('storageWarn');
    if (!el) return;
    const info = Store.storageInfo();

    if (info.persistent && !info.failed && !info.recovered) {
      el.style.display = 'none';
      return;
    }

    el.style.display = '';
    const title = info.failed
      ? '保存失败'
      : info.recovered
        ? '已恢复本机备份'
        : '数据不会保存';
    const detail = info.failed
      ? '浏览器没有写入成功，可能是空间已满或隐私模式。<b>请立刻导出备份。</b>'
      : info.recovered
        ? '主数据读取异常，已自动从最近一次本机快照恢复。<b>请重新导出一份备份。</b>'
        : '当前是用本机文件（file://）打开的，浏览器禁用了本地存储。' +
          '功能都能用，<b>但关掉页面数据就没了</b>。';

    el.innerHTML =
      '<b>' + title + '</b>' + detail +
      '<div class="sw-actions">' +
      '<button class="btn btn-sm btn-primary" id="swBackup">导出备份</button>' +
      (info.failed || info.recovered
        ? ''
        : '<button class="btn btn-sm btn-quiet" id="swTip">怎么永久保存</button>') +
      '</div>';

    const bk = document.getElementById('swBackup');
    if (bk) bk.onclick = function () {
      Store.exportAll();
      toast('已导出，保存好这个文件', 'ok');
    };
    const tip = document.getElementById('swTip');
    if (tip) tip.onclick = function () {
      App.sheet(
        '<div class="sheet-head"><div><h3>怎么让数据留下来</h3>' +
        '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
        '三种办法，从省事到彻底</div></div></div>' +
        '<div class="sheet-body">' +
        '<div class="field"><label>1 · 每次用完导出</label>' +
        '<div class="rate-note" style="margin-top:0">点上面的「导出备份」，会得到一个 JSON。' +
        '下次在新打开时用右上角 ↑ 导入回去。零成本，但得记得。</div></div>' +
        '<div class="field"><label>2 · 换一个能存数据的浏览器</label>' +
        '<div class="rate-note" style="margin-top:0">有些手机浏览器允许 file:// 页面使用本地存储，' +
        '比如 Firefox。换一个试试，能存就能一直用。</div></div>' +
        '<div class="field"><label>3 · 放到网上（推荐）</label>' +
        '<div class="rate-note" style="margin-top:0">把文件传到 GitHub Pages 之类的静态托管，' +
        '用网址打开。这样任何设备都能访问、数据正常保存、还能加到主屏幕当 App。</div></div>' +
        '</div>' +
        '<div class="sheet-foot"><button class="btn btn-primary" id="tipOk">知道了</button></div>',
        { onMount: function (b) { b.querySelector('#tipOk').onclick = function () { App.closeSheet(); }; } }
      );
    };
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    // 跨日：昨天的未闭合任务顺延到今天（幂等，只在有变化时写盘）
    Store.reconcileTasks();
    // 30 天无证据的观点 → 休眠（不让未落地的观点变成愧疚清单）
    Store.sweepInsights();

    renderStorageWarn();

    renderNav();
    renderView();
    renderLivePill();
    setInterval(tickPill, 1000);

    // 全局快捷键：S 开始 / 结束（焦点不在输入框时）
    document.addEventListener('keydown', function (e) {
      if (e.key !== 's' && e.key !== 'S') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.getElementById('overlay').classList.contains('show')) return;
      if (current !== 'log') return;
      if (w.TabLog && w.TabLog.hotkey) w.TabLog.hotkey();
    });

    // 弹层关闭
    document.getElementById('overlay').addEventListener('click', function (e) {
      if (e.target.id === 'overlay') {
        // 有未保存的编辑时也允许关闭（数据是即时的）
        closeSheet();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (document.getElementById('overlay').classList.contains('show')) closeSheet();
      }
    });

    // 数据变化 → 重绘当前视图
    Store.subscribe(function () {
      renderStorageWarn();
      renderLivePill();
      renderView();
    });

    // 每分钟：跨过逻辑日边界时自动切日 + 顺延未闭合任务
    // （reconcileTasks 有变化时会自己 emit，界面自动重绘）
    setInterval(function () {
      if (current === 'log' && w.TabLog && w.TabLog.onMinute) w.TabLog.onMinute();
      Store.reconcileTasks();
    }, 60000);

    // 顶栏导出 / 导入备份
    document.getElementById('backupBtn').onclick = function () {
      Store.exportAll();
      toast('全部数据已导出', 'ok');
    };

    const fileInput = document.getElementById('importFile');
    document.getElementById('importBtn').onclick = function () {
      fileInput.value = '';
      fileInput.click();
    };
    fileInput.onchange = function () {
      const f = this.files && this.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          if (!confirm('导入会覆盖这台设备上的全部数据，确定继续？')) return;
          Store.importAll(String(reader.result));
          tab_state_reset();
          rerender();
          toast('导入成功', 'ok');
        } catch (err) {
          toast('导入失败：' + (err.message || '文件格式不对'), 'warn');
        }
      };
      reader.readAsText(f);
    };

    // PWA：仅在 http(s) 下注册（file:// 不支持）
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      var hadController = !!navigator.serviceWorker.controller;
      var reloading = false;

      // 新版本接管后自动刷新一次（只在本来就有 SW 时，避免首次访问也刷新）
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadController || reloading) return;
        reloading = true;
        location.reload();
      });

      navigator.serviceWorker.register('./sw.js').then(function (reg) {
        // 每次打开都检查更新
        reg.update().catch(function () {});
        // 页面长时间开着也能拿到新版本
        setInterval(function () { reg.update().catch(function () {}); }, 10 * 60 * 1000);
      }).catch(function () {});
    }

    // 版本徽标：点一下强制清缓存重载（数据保留）
    var buildEl = document.getElementById('buildTag');
    if (buildEl) {
      buildEl.onclick = function () {
        if (!confirm('强制刷新：清除离线缓存并重新加载。\n\n记录数据存在 localStorage，不受影响。')) return;
        location.replace(location.pathname + '?reset=1');
      };
    }

    // 记录一下打开时间
    Store.update(function (s) { s.meta.lastOpenedAt = Date.now(); });
  }

  w.App = {
    toast: toast,
    sheet: sheet,
    closeSheet: closeSheet,
    go: go,
    rerender: rerender,
    current: function () { return current; }
  };

  /* 应急入口：?reset=1 清掉 Service Worker 与所有缓存后重载
     （用于"改了样式但页面没变"的情况） */
  function hardReset() {
    var done = function () {
      location.replace(location.pathname);
    };
    var jobs = [];
    if ('serviceWorker' in navigator) {
      jobs.push(
        navigator.serviceWorker.getRegistrations()
          .then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })
      );
    }
    if (window.caches && caches.keys) {
      jobs.push(
        caches.keys().then(function (ks) {
          return Promise.all(ks.map(function (k) { return caches.delete(k); }));
        })
      );
    }
    Promise.all(jobs).then(done, done);
  }

  if (/[?&]reset=1\b/.test(location.search)) {
    hardReset();
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
