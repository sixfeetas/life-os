/* ============================================================
   Life OS · Tab 2：计划
   核心不是"写待办"，而是 计划 vs 实际 的差值。

   摩擦规则（关键设计）：
   - 完成 + 用时不超预估 50%  → 点一下就好，零摩擦
   - 完成 + 超时 ≥50%        → 问一句"为什么超时"（真有信息的地方）
   - 没做成                   → 必须选原因 + 写一句差在哪
   理由：偏差大的地方才是学习发生的地方；全部强制 = 全都不填。
   ============================================================ */
(function (w) {

  let ticker = null;
  let showAdd = false;
  let showClosed = false;
  let backups = {};

  const state = () => Store.get();
  const todayKey = () => Store.todayKey();
  const OVER_THRESHOLD = 1.5;   // 超出预估 50% 才追问

  const OVER_CHIPS = ['低估了工作量', '被打断', '查资料花时间', '走了弯路', '环境/工具问题'];

  function fmtMin(min) {
    min = min || 0;
    if (min <= 0) return '0分';
    if (min < 1) return '<1分';        // 避免出现「0.25分」这种脏数据
    min = Math.round(min);
    if (min < 60) return min + '分';
    const h = Math.floor(min / 60), m = min % 60;
    return m ? h + 'h' + m + 'm' : h + 'h';
  }

  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }

  /* ================= 渲染 ================= */
  function render(root, ctx) {
    stopTicker();

    const s = state();
    if (!backups.root) backups = { root: root, ctx: ctx };
    else { backups.root = root; backups.ctx = ctx; }

    const dayKey = todayKey();
    const tasks = Store.tasksOfDay(dayKey);
    const open = tasks.filter(function (t) { return t.status === 'open'; });
    const done = tasks.filter(function (t) { return t.status === 'done'; });
    const missed = tasks.filter(function (t) { return t.status === 'missed'; });
    const counted = tasks.filter(function (t) { return t.status !== 'dropped'; });

    const estTotal = U.sum(counted, function (t) { return t.estMin; });
    const actTotalMs = U.sum(counted, function (t) { return Store.taskActualMs(t.id); });
    const actTotal = actTotalMs / 60000;

    const drafts = s.drafts.filter(function (d) { return !d.consumed; });
    const running = s.running;

    const html = [];

    /* 头部 */
    html.push(
      '<div class="page-head"><div class="date">计划' +
      '<span class="weekday">' + U.weekday(dayKey) + '</span></div></div>'
    );

    /* 概览 */
    html.push('<div class="card">');
    if (!counted.length) {
      html.push(
        '<div class="plan-bar">' +
        '<div class="pb"><span class="v blue">0</span><span class="k">今日任务</span></div>' +
        '<div class="pb"><span class="v">—</span><span class="k">预估总时长</span></div>' +
        '</div>' +
        '<div class="empty"><div class="big">□</div>' +
        '今天还没有任务。<br>写下一件事，和"什么算完成"。' +
        '<br><button class="empty-add" id="emptyAdd">+ 加第一个任务</button>' +
        '</div>'
      );
    } else {
      html.push(
        '<div class="plan-bar">' +
        '<div class="pb"><span class="v blue">' + done.length + '/' + counted.length + '</span>' +
        '<span class="k">已完成</span></div>' +
        '<div class="pb"><span class="v">' + fmtMin(estTotal) + '</span><span class="k">预估</span></div>' +
        '<div class="pb"><span class="v ' + (actTotal > estTotal * OVER_THRESHOLD ? 'pink' : 'green') + '">' +
        (actTotal > 0 ? fmtMin(actTotal) : '—') + '</span><span class="k">实际</span></div>' +
        '</div>'
      );

      /* 预估 vs 实际 双条 */
      if (actTotal > 0) {
        const maxV = Math.max(estTotal, actTotal, 1);
        const pctE = Math.max(3, estTotal / maxV * 100);
        const pctA = Math.max(3, actTotal / maxV * 100);
        const overPct = estTotal > 0 ? Math.round((actTotal / estTotal - 1) * 100) : 0;
        html.push(
          '<div class="vs-bar">' +
          '<div class="vs-row"><span class="lbl">预估</span>' +
          '<span class="track"><span class="fill" style="width:' + pctE + '%;background:var(--ctp-blue)"></span></span>' +
          '<span class="num">' + fmtMin(estTotal) + '</span></div>' +
          '<div class="vs-row"><span class="lbl">实际</span>' +
          '<span class="track"><span class="fill" style="width:' + pctA + '%;background:' +
          (overPct >= 50 ? 'var(--ctp-peach)' : 'var(--ctp-green)') + '"></span></span>' +
          '<span class="num">' + fmtMin(actTotal) + '</span></div>' +
          '</div>' +
          '<div class="delta-note">' +
          (overPct > 0 ? '今天整体比预估多花 <b style="color:var(--ctp-peach)">' + overPct + '%</b>'
            : overPct < 0 ? '今天比预估省了 <b style="color:var(--ctp-green)">' + Math.abs(overPct) + '%</b>'
              : '和预估持平') +
          '（只统计挂了计时器的任务）</div>'
        );
      }
    }
    html.push('</div>');

    /* 加任务 */
    html.push(
      '<div class="card">' +
      '<div class="card-title">今日任务' +
      (counted.length ? '<span class="rt">' + (counted.length - done.length - missed.length) + ' 项待办</span>' : '') +
      '</div>'
    );

    if (!showAdd) {
      html.push('<button class="btn btn-ghost btn-sm" id="toggleAdd">+ 加一个任务</button>');
    } else {
      html.push(
        '<div class="add-form show" id="addForm">' +
        '<input class="title-input" id="afTitle" maxlength="60" placeholder="今天要做什么？">' +
        '<input class="title-input" id="afDone" style="margin-top:9px" maxlength="80" ' +
        'placeholder="什么算完成？（一句话，防止做了一点就算做了）">' +
        '<div class="row2">' +
        '<input class="title-input" id="afEst" type="number" min="5" step="5" value="20" placeholder="预估分钟">' +
        '<input class="title-input" id="afTrigger" maxlength="40" placeholder="什么时候开始（可选）">' +
        '</div>' +
        '<div class="tc-actions" style="margin-top:11px">' +
        '<button class="btn btn-primary btn-sm" id="afSubmit">加入今日</button>' +
        '<button class="btn btn-quiet btn-sm" id="afCancel">取消</button>' +
        '</div></div>'
      );
    }

    /* 草稿（记录 → 计划 的接缝） */
    if (drafts.length) {
      html.push('<div style="margin-top:14px">');
      html.push('<div class="card-title" style="margin-bottom:9px">从「记录」转来的草稿' +
        '<span class="rt">' + drafts.length + ' 条</span></div>');
      drafts.forEach(function (d) {
        const from = d.dayKey || '';
        html.push(
          '<div class="draft" data-draft="' + d.id + '">' +
          '<div class="dtxt">' + U.esc(d.text) +
          '<div class="dfrom">来自 ' + from + (d.fromSessionId ? ' 的一条记录' : '') + '</div></div>' +
          '<button class="da" data-adopt="' + d.id + '">采纳</button>' +
          '<button class="dx" data-drop="' + d.id + '" title="忽略">×</button>' +
          '</div>'
        );
      });
      html.push('</div>');
    }

    /* 待办列表 */
    if (open.length) {
      html.push('<div style="margin-top:14px">');
      open.forEach(function (t) { html.push(openTaskHTML(t, running)); });
      html.push('</div>');
    }

    /* 已完成 / 没做成 */
    const closed = done.concat(missed);
    if (closed.length) {
      html.push('<div class="closed-wrap">');
      html.push('<button class="closed-toggle" id="toggleClosed">' +
        (showClosed ? '▾' : '▸') + ' 已收盘 ' + closed.length + ' 项' +
        '（完成 ' + done.length + ' · 没做成 ' + missed.length + '）</button>');
      if (showClosed) {
        closed.forEach(function (t) { html.push(closedTaskHTML(t)); });
      }
      html.push('</div>');
    }

    html.push('</div>');   /* /card */

    /* 差值复盘 */
    html.push(deltaCardHTML());

    root.innerHTML = html.join('');
    bind(root, ctx, dayKey);
    startTicker(running, ctx);
  }

  /* ---------- 待办行 ---------- */
  function openTaskHTML(t, running) {
    const isLive = running && running.taskId === t.id;
    const actualMs = Store.taskActualMs(t.id);
    const actualMin = actualMs / 60000;

    const sub = [];
    if (t.doneRule) sub.push('<div class="task-sub rule">完成标准：' + U.esc(t.doneRule) + '</div>');
    else sub.push('<div class="task-sub muted">还没写完成标准（点编辑补上）</div>');

    const metaBits = [];
    if (t.trigger) metaBits.push(U.esc(t.trigger) + ' 开始');
    if (actualMin > 0) metaBits.push('已记 ' + fmtMin(actualMin));
    if (t.deferCount > 0) metaBits.push('已顺延 ' + t.deferCount + ' 次');
    if (metaBits.length) {
      sub.push('<div class="task-sub' + (t.deferCount >= 3 ? ' warn' : '') + '">' +
        metaBits.join(' · ') + '</div>');
    }

    let zombie = '';
    if (t.deferCount >= 3) {
      zombie =
        '<div class="zombie">这条已经顺延 ' + t.deferCount + ' 次了。' +
        '它大概率不会自己发生——要么拆小，要么删掉。' +
        '<div class="z-actions">' +
        '<button class="ta" data-act="edit" data-id="' + t.id + '">拆小/改小</button>' +
        '<button class="ta" data-act="drop" data-id="' + t.id + '">删掉</button>' +
        '</div></div>';
    }

    const playBtn = isLive
      ? '<button class="ta live" data-act="live" data-id="' + t.id + '">⏱ <span data-live="' + t.id + '">00:00</span></button>'
      : '<button class="ta play" data-act="timer" data-id="' + t.id + '">▶ 开始计时</button>';

    return (
      '<div class="task' + (isLive ? ' running-task' : '') + '" data-task="' + t.id + '">' +
      '<button class="tick" data-act="complete" data-id="' + t.id + '" title="完成"></button>' +
      '<div class="task-body">' +
      '<div class="task-line">' +
      '<span class="task-title">' + U.esc(t.title || '（未命名任务）') + '</span>' +
      '<span class="task-est">' + fmtMin(t.estMin) + '</span>' +
      '</div>' +
      sub.join('') +
      '<div class="task-actions">' +
      playBtn +
      '<button class="ta bad" data-act="fail" data-id="' + t.id + '">没做成</button>' +
      '<button class="ta" data-act="edit" data-id="' + t.id + '">编辑</button>' +
      '</div>' +
      zombie +
      '</div></div>'
    );
  }

  /* ---------- 已收盘行 ---------- */
  function closedTaskHTML(t) {
    const actualMs = Store.taskActualMs(t.id);
    const actualMin = actualMs / 60000;
    const isDone = t.status === 'done';
    const ratio = (actualMin > 0 && t.estMin > 0) ? actualMin / t.estMin : null;
    const over = ratio !== null && ratio >= OVER_THRESHOLD;

    let estTxt = fmtMin(t.estMin);
    if (actualMin > 0) {
      estTxt = fmtMin(t.estMin) + ' → ' + fmtMin(actualMin);
    }

    const lines = [];
    if (isDone) {
      if (ratio !== null) {
        const pct = Math.round((ratio - 1) * 100);
        if (over) lines.push('<div class="task-sub warn">超时 ' + pct + '%</div>');
        else if (pct < -30) lines.push('<div class="task-sub muted">比预估快 ' + Math.abs(pct) + '%</div>');
      } else {
        lines.push('<div class="task-sub muted">没计时，没有误差数据</div>');
      }
      if (t.delta) lines.push('<div class="task-sub">为什么：' + U.esc(t.delta) + '</div>');
    } else {
      const r = D.REASONS.find(function (x) { return x.id === t.reason; });
      lines.push('<div class="task-sub bad">没做成' + (r ? ' · ' + r.label : '') + '</div>');
      if (t.delta) lines.push('<div class="task-sub">差在哪：' + U.esc(t.delta) + '</div>');
    }

    return (
      '<div class="task ' + (isDone ? 'done' : 'missed') + '" data-task="' + t.id + '">' +
      '<button class="tick" data-act="reopen" data-id="' + t.id + '" title="重新打开">' +
      (isDone ? '✓' : '×') + '</button>' +
      '<div class="task-body">' +
      '<div class="task-line">' +
      '<span class="task-title">' + U.esc(t.title || '（未命名任务）') + '</span>' +
      '<span class="task-est ' + (over ? 'over' : (actualMin > 0 ? 'ok' : '')) + '">' + estTxt + '</span>' +
      '</div>' +
      lines.join('') +
      '</div></div>'
    );
  }

  /* ---------- 差值复盘 ---------- */
  function deltaCardHTML() {
    const all = state().tasks;
    const weekAgo = Date.now() - 7 * 86400000;
    const recentDone = all.filter(function (t) {
      return t.status === 'done' && t.closedAt && t.closedAt >= weekAgo;
    });
    const timed = recentDone
      .map(function (t) { return { t: t, min: Store.taskActualMs(t.id) / 60000 }; })
      .filter(function (x) { return x.min > 0 && x.t.estMin > 0; });

    const recentMissed = all.filter(function (t) {
      return t.status === 'missed' && t.closedAt && t.closedAt >= weekAgo;
    });

    const html = [];
    html.push('<div class="card"><div class="card-title">本周差值 · 你的估时准不准</div>');

    if (timed.length < 3) {
      html.push(
        '<div class="empty" style="padding:20px 12px">' +
        '样本不足（最近 7 天只有 <b>' + timed.length + '</b> 条带计时的完成记录）。<br>' +
        '少于 3 条不下结论——这是规矩，免得被两个数据点骗了。<br>' +
        '<span style="color:var(--faint)">用法：任务上点「▶ 开始计时」，关任务时误差就自动有了。</span>' +
        '</div>'
      );
    } else {
      const ratios = timed.map(function (x) { return x.min / x.t.estMin; });
      const avgRatio = U.sum(ratios) / ratios.length;
      const overCount = ratios.filter(function (r) { return r >= OVER_THRESHOLD; }).length;
      const fastCount = ratios.filter(function (r) { return r <= 0.7; }).length;
      const biasPct = Math.round((avgRatio - 1) * 100);

      html.push(
        '<div class="plan-bar" style="margin-bottom:14px">' +
        '<div class="pb"><span class="v ' + (biasPct > 20 ? 'pink' : 'green') + '">' +
        (biasPct >= 0 ? '+' : '') + biasPct + '%</span><span class="k">平均偏差</span></div>' +
        '<div class="pb"><span class="v">' + timed.length + '</span><span class="k">样本</span></div>' +
        '<div class="pb"><span class="v pink">' + overCount + '</span><span class="k">超时≥50%</span></div>' +
        '</div>'
      );

      html.push('<div class="delta-note" style="margin-top:0;margin-bottom:12px">' +
        (biasPct > 20
          ? '你系统性地<b style="color:var(--ctp-peach)">低估</b>了用时。下次估时，把心里的数字 × ' +
            (avgRatio).toFixed(1) + '。<br>这不叫"不够努力"，叫估时偏差，可以练。'
          : biasPct < -20
            ? '你系统性地<b style="color:var(--ctp-green)">高估</b>了用时，说明任务排得偏保守，可以加重。'
            : '你的估时相当准。保持这个颗粒度。') +
        (fastCount > timed.length / 2 ? '<br>但有一半以上任务远快于预估，检查一下是不是"完成标准"定得太松。' : '') +
        '</div>');

      /* 未完成原因分布 */
      if (recentMissed.length) {
        const dist = {};
        recentMissed.forEach(function (t) {
          const k = t.reason || 'unknown';
          dist[k] = (dist[k] || 0) + 1;
        });
        const rows = Object.keys(dist)
          .map(function (k) {
            const r = D.REASONS.find(function (x) { return x.id === k; });
            return { label: r ? r.label : '未标注', n: dist[k] };
          })
          .sort(function (a, b) { return b.n - a.n; });
        const maxN = rows[0].n;

        html.push('<div class="card-title" style="margin-top:6px">没做成的原因</div>');
        rows.forEach(function (r) {
          html.push(
            '<div class="delta-stat">' +
            '<span class="nm">' + r.label + '</span>' +
            '<span class="track"><span class="fill" style="width:' +
            Math.max(8, r.n / maxN * 100) + '%"></span></span>' +
            '<span class="ct">' + r.n + '</span></div>'
          );
        });

        const top = rows[0].label;
        const advice = {
          '没时间': '「没时间」通常是「没优先级」。要么删掉一些任务，要么把它排进日程。',
          '比想象难': '任务太大。拆成能在 20 分钟内做完的第一步。',
          '不想做': '这条任务和你的目标没有真实连接。问一句：不做会怎样？不会怎样就删掉。',
          '被打断': '改环境，不是改意志力。关通知、换地方、换个时段。',
          '计划本身错了': '你的估时或排法有问题。这正是差值数据的价值。',
          '未标注': '有些任务没标原因，补上才能看出模式。'
        }[top] || '';
        if (advice) {
          html.push('<div class="delta-note" style="color:var(--ctp-dim,var(--dim))">' +
            '最常出现的是 <b style="color:var(--ctp-pink)">' + top + '</b>。' + advice + '</div>');
        }
      }
    }

    html.push('</div>');
    return html.join('');
  }

  /* ---------- 绑定 ---------- */
  function bind(root, ctx, dayKey) {
    const on = function (id, ev, fn) {
      const el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };

    on('toggleAdd', 'click', function () {
      showAdd = true;
      render(root, ctx);
      const el = document.getElementById('afTitle');
      if (el) el.focus();
    });

    on('emptyAdd', 'click', function () {
      showAdd = true;
      render(root, ctx);
      const el = document.getElementById('afTitle');
      if (el) el.focus();
    });

    on('afCancel', 'click', function () {
      showAdd = false;
      render(root, ctx);
    });

    on('afSubmit', 'click', submitAdd.bind(null, ctx));

    /* 回车提交 */
    const tEl = document.getElementById('afTitle');
    if (tEl) {
      tEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitAdd(ctx);
      });
    }
    const dEl = document.getElementById('afDone');
    if (dEl) {
      dEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitAdd(ctx);
      });
    }

    on('toggleClosed', 'click', function () {
      showClosed = !showClosed;
      render(root, ctx);
    });

    /* 任务操作 */
    root.querySelectorAll('[data-act]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        const act = el.dataset.act;
        const id = el.dataset.id;
        if (!id) return;

        if (act === 'complete') completeTask(id, ctx);
        else if (act === 'fail') openFailSheet(id, ctx);
        else if (act === 'edit') openEditSheet(id, ctx);
        else if (act === 'reopen') reopenTask(id, ctx);
        else if (act === 'drop') dropTask(id, ctx);
        else if (act === 'timer') startTaskTimer(id, ctx);
        else if (act === 'live') ctx.go('log');
      });
    });

    /* 草稿 */
    root.querySelectorAll('[data-adopt]').forEach(function (el) {
      el.addEventListener('click', function () { adoptDraft(el.dataset.adopt, ctx); });
    });
    root.querySelectorAll('[data-drop]').forEach(function (el) {
      el.addEventListener('click', function () { dropDraft(el.dataset.drop, ctx); });
    });
  }

  /* ---------- 动作 ---------- */
  function submitAdd(ctx) {
    const title = (document.getElementById('afTitle').value || '').trim();
    if (!title) {
      ctx.toast('先写下要做什么', 'warn');
      return;
    }
    const doneRule = (document.getElementById('afDone').value || '').trim();
    const est = parseInt(document.getElementById('afEst').value, 10);
    const trigger = (document.getElementById('afTrigger').value || '').trim();

    Store.addTask({
      title: title,
      doneRule: doneRule,
      estMin: (isNaN(est) || est < 1) ? 20 : est,
      trigger: trigger
    });

    showAdd = false;
    ctx.toast(doneRule ? '已加入今日' : '已加入 · 建议补上"什么算完成"', doneRule ? 'ok' : 'warn');
  }

  function completeTask(id, ctx) {
    const t = Store.getTask(id);
    if (!t) return;

    const actualMin = Store.taskActualMs(id) / 60000;
    const over = actualMin > 0 && t.estMin > 0 && (actualMin / t.estMin) >= OVER_THRESHOLD;

    if (!over) {
      Store.updateTask(id, { status: 'done', closedAt: Date.now(), delta: '' });
      if (actualMin === 0) {
        ctx.toast('已完成 · 下次用计时器才有误差数据', 'warn');
      } else {
        ctx.toast('已完成 · ' + fmtMin(actualMin), 'ok');
      }
      return;
    }

    /* 超时 → 追问一句 */
    openWhySheet(id, ctx, actualMin);
  }

  function openWhySheet(id, ctx, actualMin) {
    const t = Store.getTask(id);
    if (!t) return;
    const pct = Math.round((actualMin / t.estMin - 1) * 100);

    const html =
      '<div class="sheet-head">' +
      '<div><h3>超时了 ' + pct + '%</h3>' +
      '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
      '预估 ' + fmtMin(t.estMin) + ' · 实际 ' + fmtMin(actualMin) + '</div></div>' +
      '<div class="dur">' + fmtMin(actualMin) + '</div>' +
      '</div>' +
      '<div class="sheet-body">' +
      '<div class="field"><label>为什么超时 <span class="opt">这是最值钱的一句</span></label>' +
      '<div class="tag-grid" id="wChips">' +
      OVER_CHIPS.map(function (c) {
        return '<button class="tag-chip" data-c="' + U.esc(c) + '" style="--tagc:var(--ctp-peach)">' + c + '</button>';
      }).join('') +
      '</div>' +
      '<textarea id="wText" placeholder="具体点：卡在哪一步？下次怎么估？"></textarea>' +
      '</div></div>' +
      '<div class="sheet-foot">' +
      '<button class="btn btn-quiet" id="wSkip">跳过</button>' +
      '<button class="btn btn-primary" id="wSave">完成并记下</button>' +
      '</div>';

    ctx.sheet(html, {
      onMount: function (box) {
        const ta = box.querySelector('#wText');
        box.querySelectorAll('#wChips .tag-chip').forEach(function (b) {
          b.onclick = function () {
            const v = b.dataset.c;
            if (ta.value.trim()) {
              if (ta.value.indexOf(v) === -1) ta.value = ta.value.trim() + '；' + v;
            } else {
              ta.value = v;
            }
            b.classList.toggle('on');
            ta.focus();
          };
        });

        box.querySelector('#wSave').onclick = function () {
          Store.updateTask(id, {
            status: 'done',
            closedAt: Date.now(),
            delta: ta.value.trim()
          });
          ctx.closeSheet();
          ctx.toast('已记下这次的差值', 'ok');
        };

        box.querySelector('#wSkip').onclick = function () {
          Store.updateTask(id, { status: 'done', closedAt: Date.now(), delta: '' });
          ctx.closeSheet();
          ctx.toast('已完成（这次没记原因）');
        };

        ta.focus();
      }
    });
  }

  function openFailSheet(id, ctx) {
    const t = Store.getTask(id);
    if (!t) return;
    let reason = '';

    const html =
      '<div class="sheet-head">' +
      '<div><h3>没做成</h3>' +
      '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
      U.esc(t.title) + ' · 预估 ' + fmtMin(t.estMin) + '</div></div>' +
      '</div>' +
      '<div class="sheet-body">' +
      '<div class="field"><label>为什么 <span class="opt">选一个，这是唯一能看出模式的字段</span></label>' +
      '<div class="tag-grid" id="fChips">' +
      D.REASONS.map(function (r) {
        return '<button class="tag-chip" data-r="' + r.id + '" style="--tagc:var(--ctp-pink)">' + r.label + '</button>';
      }).join('') +
      '</div></div>' +
      '<div class="field"><label>差在哪 <span class="opt">具体一点</span></label>' +
      '<textarea id="fText" placeholder="例如：晚上八点开始就做不进去，需要换到早上"></textarea>' +
      '</div>' +
      '<div class="delta-note" style="margin-top:0">' +
      '顺延不是失败。它只是说明这条任务现在的形态不合适——拆小、换时间、或者删掉。' +
      '</div>' +
      '</div>' +
      '<div class="sheet-foot">' +
      '<button class="btn btn-quiet" id="fCancel">取消</button>' +
      '<button class="btn btn-primary" id="fSave">记下</button>' +
      '</div>';

    ctx.sheet(html, {
      onMount: function (box) {
        const ta = box.querySelector('#fText');
        box.querySelectorAll('#fChips .tag-chip').forEach(function (b) {
          b.onclick = function () {
            reason = b.dataset.r;
            box.querySelectorAll('#fChips .tag-chip').forEach(function (x) {
              x.classList.toggle('on', x.dataset.r === reason);
            });
          };
        });

        box.querySelector('#fCancel').onclick = function () { ctx.closeSheet(); };

        box.querySelector('#fSave').onclick = function () {
          if (!reason) {
            ctx.toast('选一个原因', 'warn');
            return;
          }
          Store.updateTask(id, {
            status: 'missed',
            closedAt: Date.now(),
            reason: reason,
            delta: ta.value.trim()
          });
          ctx.closeSheet();
          ctx.toast('记下了 · 不算失败', 'ok');
        };
      }
    });
  }

  function openEditSheet(id, ctx) {
    const t = Store.getTask(id);
    if (!t) return;

    const html =
      '<div class="sheet-head"><div><h3>编辑任务</h3>' +
      '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
      '改小它，比重新发誓有用</div></div></div>' +
      '<div class="sheet-body">' +
      '<div class="field"><label>要做什么</label>' +
      '<input type="text" id="eTitle" maxlength="60" value="' + U.esc(t.title) + '"></div>' +
      '<div class="field"><label>什么算完成</label>' +
      '<input type="text" id="eDone" maxlength="80" placeholder="一句话" value="' + U.esc(t.doneRule) + '"></div>' +
      '<div class="field"><label>预估耗时（分钟）</label>' +
      '<input type="number" id="eEst" min="5" step="5" value="' + t.estMin + '"></div>' +
      '<div class="field"><label>什么时候开始 <span class="opt">可选</span></label>' +
      '<input type="text" id="eTrigger" maxlength="40" placeholder="例如：早饭后 / 21:00" value="' + U.esc(t.trigger) + '"></div>' +
      '</div>' +
      '<div class="sheet-foot">' +
      '<button class="btn btn-danger" id="eDel">删除</button>' +
      '<button class="btn btn-primary" id="eSave">保存</button>' +
      '</div>';

    ctx.sheet(html, {
      onMount: function (box) {
        box.querySelector('#eSave').onclick = function () {
          const title = box.querySelector('#eTitle').value.trim();
          if (!title) { ctx.toast('标题不能空', 'warn'); return; }
          const est = parseInt(box.querySelector('#eEst').value, 10);
          Store.updateTask(id, {
            title: title,
            doneRule: box.querySelector('#eDone').value.trim(),
            estMin: (isNaN(est) || est < 1) ? 20 : est,
            trigger: box.querySelector('#eTrigger').value.trim()
          });
          ctx.closeSheet();
          ctx.toast('已保存', 'ok');
        };
        box.querySelector('#eDel').onclick = function () {
          if (!confirm('删除这条任务？关联的计时记录会保留。')) return;
          Store.removeTask(id);
          ctx.closeSheet();
          ctx.toast('已删除');
        };
      }
    });
  }

  function reopenTask(id, ctx) {
    Store.updateTask(id, {
      status: 'open',
      closedAt: null,
      reason: '',
      delta: '',
      dayKey: todayKey()
    });
    ctx.toast('已重新打开');
  }

  function dropTask(id, ctx) {
    if (!confirm('删掉这条任务？\n\n关联的计时记录会保留在记录页。')) return;
    Store.removeTask(id);
    ctx.toast('已删除');
  }

  function startTaskTimer(id, ctx) {
    const s = Store.get();
    if (s.running) {
      ctx.toast('已有计时在跑，先去「记录」结束它', 'warn');
      return;
    }
    const t = Store.getTask(id);
    if (!t) return;
    Store.startTimer('study', t.title, id);
    ctx.toast('开始计时 · ' + t.title, 'ok');
    ctx.rerender();
  }

  function adoptDraft(draftId, ctx) {
    const s = Store.get();
    const d = s.drafts.find(function (x) { return x.id === draftId; });
    if (!d) return;
    const t = Store.addTask({
      title: d.text,
      estMin: 20,
      fromDraftId: d.id
    });
    Store.update(function (st) {
      const dd = st.drafts.find(function (x) { return x.id === draftId; });
      if (dd) dd.consumed = true;
    });
    ctx.toast('已加入今日 · 记得补上完成标准和预估', 'ok');
    openEditSheet(t.id, ctx);
  }

  function dropDraft(draftId, ctx) {
    Store.update(function (st) {
      const d = st.drafts.find(function (x) { return x.id === draftId; });
      if (d) d.consumed = true;
    });
    ctx.toast('已忽略这条草稿');
  }

  /* ---------- 秒表 ---------- */
  function startTicker(running, ctx) {
    stopTicker();
    if (!running || !running.taskId) return;
    const paint = function () {
      const el = document.querySelector('[data-live="' + running.taskId + '"]');
      if (!el) return;
      el.textContent = U.clock(Date.now() - running.start);
    };
    paint();
    ticker = setInterval(paint, 1000);
  }

  w.TabPlan = {
    render: render,
    reset: function () {
      stopTicker();
      showAdd = false;
      showClosed = false;
      backups = {};
    }
  };
})(window);
