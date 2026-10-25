/* ============================================================
   Life OS · Tab 1：记录
   - 一键计时（数据持久化，刷新不丢）
   - 停止 → 最小结算表单（时长自动）
   - 「接下来我打算做」→ 任务草稿（接缝到 Tab 2）
   - 1 分钟版：坏日子也能守住
   ============================================================ */
(function (w) {

  let tab = {
    dayKey: null,
    followToday: true,
    selTag: 'study',
    tickId: null
  };

  const state = () => Store.get();
  const todayKey = () => U.dayKey(Date.now(), state().meta.dayStartHour);

  /* ---------------- 小工具 ---------------- */
  function tagChip(t, on, small) {
    return '<button class="tag-chip' + (on ? ' on' : '') + (small ? ' sm' : '') +
      '" data-tag="' + t.id + '" style="--tagc:' + t.color + '">' +
      '<span class="td" style="background:' + t.color + '"></span>' + t.label + '</button>';
  }

  function moodRow(cur) {
    return D.MOODS.map(function (m) {
      return '<button class="mood-btn' + (cur === m.v ? ' on' : '') +
        '" data-mood="' + m.v + '" style="--moodc:' + m.color + '" title="' + m.label + '">' +
        '<span class="e">' + m.emoji + '</span><span class="t">' + m.label + '</span></button>';
    }).join('');
  }

  function stopTick() {
    if (tab.tickId) { clearInterval(tab.tickId); tab.tickId = null; }
  }

  function startTick() {
    stopTick();
    if (!state().running) return;
    tab.tickId = setInterval(function () {
      const el = document.getElementById('elapsed');
      const r = state().running;
      if (!el || !r) { stopTick(); return; }
      el.textContent = U.clock(Date.now() - r.start);
    }, 1000);
  }

  /* ---------------- 主渲染 ---------------- */
  function render(root, ctx) {
    const s = state();
    if (!tab.dayKey) tab.dayKey = todayKey();
    if (tab.followToday) tab.dayKey = todayKey();
    if (tab.dayKey > todayKey()) tab.dayKey = todayKey();

    const dayKey = tab.dayKey;
    const st = Store.statsOfDay(dayKey);
    const isToday = dayKey === todayKey();
    const running = s.running;

    const html = [];

    /* 备份提醒：第一条记录之后就提醒，超过 7 天再提醒 */
    const needsBackup = s.sessions.length > 0 && (
      !s.meta.lastBackupAt ||
      (Date.now() - s.meta.lastBackupAt) > 7 * 86400000
    );
    if (needsBackup && !tab.backupDismissed) {
      html.push(
        '<div class="banner">' +
        '<span>数据只存在这台设备的浏览器里，建议现在导出一份备份。</span>' +
        '<div class="b-actions">' +
        '<button class="btn btn-sm btn-primary" id="bannerBackup">导出备份</button>' +
        '<button class="btn btn-sm btn-quiet" id="bannerLater">稍后</button>' +
        '</div></div>'
      );
    }

    /* 日期头 */
    html.push(
      '<div class="page-head">' +
      '<div class="date">' + U.dateTitle(dayKey, s.meta.dayStartHour) +
      '<span class="datenum">' + dayKey.replace(/-/g, '.') + '</span>' +
      '<span class="weekday">' + U.weekday(dayKey) + '</span></div>' +
      '<div class="day-nav">' +
      '<button id="prevDay" title="前一天">‹</button>' +
      (isToday ? '' : '<button class="today-btn" id="todayBtn">回到今天</button>') +
      '<button id="nextDay" title="后一天"' + (isToday ? ' disabled style="opacity:.3"' : '') + '>›</button>' +
      '</div></div>'
    );

    /* 今日概览 */
    html.push('<div class="card summary">');
    if (st.count === 0) {
      html.push(
        '<div class="summary-stats">' +
        '<div class="sstat"><span class="v accent">0 分</span><span class="k">总时长</span></div>' +
        '<div class="sstat"><span class="v">0</span><span class="k">记录条数</span></div>' +
        '<div class="sstat"><span class="v">—</span><span class="k">平均情绪</span></div>' +
        '</div>'
      );
    } else {
      const avgM = st.avgMood;
      const moodObj = avgM ? D.mood(Math.round(avgM)) : null;
      const rtPct = Math.round((st.realtimeRate || 0) * 100);
      html.push(
        '<div class="summary-stats">' +
        '<div class="sstat"><span class="v accent">' + U.dur(st.total) + '</span><span class="k">总时长</span></div>' +
        '<div class="sstat"><span class="v">' + st.count + '</span><span class="k">记录条数</span></div>' +
        '<div class="sstat"><span class="v"' +
        (avgM ? ' style="color:' + (avgM < 3 ? 'var(--red)' : 'var(--text)') + '"' : '') + '>' +
        (moodObj ? moodObj.emoji + ' ' + avgM.toFixed(1) : '—') + '</span><span class="k">平均情绪</span></div>' +
        '<div class="sstat"><span class="v blue">' + rtPct + '%</span><span class="k">实时率</span></div>' +
        '<span class="streak-dot' + (st.checked ? '' : ' off') + '">' +
        (st.checked ? '✓ 今日已打卡' : '· 未打卡') + '</span>' +
        '</div>'
      );

      /* 标签堆叠条 */
      const segs = Object.keys(st.byTag)
        .map(function (k) { return { tag: D.tag(k), ms: st.byTag[k] }; })
        .sort(function (a, b) { return b.ms - a.ms; });

      html.push('<div class="stackbar">' + segs.map(function (x) {
        const pct = st.total ? (x.ms / st.total * 100) : 0;
        return '<div class="seg" style="width:' + pct.toFixed(2) + '%;background:' + x.tag.color +
          ';opacity:.92" title="' + x.tag.label + ' ' + U.dur(x.ms) + '"></div>';
      }).join('') + '</div>');

      html.push('<div class="legend">' + segs.map(function (x) {
        const pct = st.total ? Math.round(x.ms / st.total * 100) : 0;
        return '<span class="li"><span class="dot" style="background:' + x.tag.color + '"></span>' +
          x.tag.label + ' <span class="pct">' + U.dur(x.ms) + ' · ' + pct + '%</span></span>';
      }).join('') + '</div>');
    }
    html.push('</div>');

    /* 计时器 */
    if (running) {
      const rt = D.tag(running.tag);
      const linked = running.taskId
        ? Store.get().tasks.find(function (x) { return x.id === running.taskId; })
        : null;
      html.push(
        '<div class="timer-card running">' +
        '<div class="tc-label"><span class="pulse"></span>正在计时 · ' + U.hm(running.start) + ' 开始</div>' +
        '<div class="elapsed" id="elapsed">' + U.clock(Date.now() - running.start) + '</div>' +
        '<div class="tc-title">' +
        '<span class="tl-tag" style="background:' + rt.color + '22;color:' + rt.color + '">' + rt.label + '</span>' +
        (running.title ? '　' + U.esc(running.title) : '') +
        (linked ? '<div class="task-sub rule" style="margin-top:7px">' +
          '↳ 记入任务：' + U.esc(linked.title) + '（预估 ' + linked.estMin + '分）</div>' : '') +
        '</div>' +
        '<div class="tc-actions">' +
        '<button class="btn btn-primary grow" id="stopBtn">停止并记录</button>' +
        '<button class="btn btn-quiet" id="cancelBtn">取消</button>' +
        '</div></div>'
      );
    } else {
      const dayKeyForTasks = s.meta ? U.dayKey(Date.now(), s.meta.dayStartHour) : U.dayKey(Date.now(), 4);
      const openTasks = Store.tasksOfDay(dayKeyForTasks)
        .filter(function (t) { return t.status === 'open'; });

      html.push(
        '<div class="timer-card">' +
        '<div class="tc-label">现在在做什么 <span style="margin-left:auto;letter-spacing:0;text-transform:none;font-weight:600;color:var(--dim)">按 S 快速开始</span></div>' +
        '<div class="tag-grid">' +
        D.TAGS.map(function (t) { return tagChip(t, tab.selTag === t.id); }).join('') +
        '</div>' +
        '<input class="title-input" id="newTitle" placeholder="具体在做什么？（可留空）" maxlength="60">' +
        (openTasks.length
          ? '<select class="task-pick" id="newTask">' +
            '<option value="">不关联任务（纯记录）</option>' +
            openTasks.map(function (t) {
              return '<option value="' + t.id + '">' + U.esc(t.title) +
                ' · 预估 ' + t.estMin + ' 分</option>';
            }).join('') +
            '</select>'
          : '') +
        '<div class="tc-actions" style="margin-top:14px">' +
        '<button class="btn btn-primary btn-lg" id="startBtn">▶ 开始计时</button>' +
        '</div></div>'
      );
    }

    /* 时间轴 */
    html.push('<div class="card"><div class="card-title">时间轴' +
      (st.count ? '<span class="rt">' + st.count + ' 条 · ' + U.dur(st.total) + '</span>' : '') +
      '</div>');

    if (st.count === 0) {
      html.push(
        '<div class="empty"><div class="big">○</div>' +
        '今天还没有记录。<br>点上面的「开始计时」，或者「补记」补上已经发生的事。' +
        '</div>'
      );
    } else {
      html.push('<div class="tl">');
      st.list.forEach(function (x) {
        const t = D.tag(x.tag);
        const m = x.mood ? D.mood(x.mood) : null;
        html.push(
          '<div class="tl-item" data-sid="' + x.id + '">' +
          '<div class="tl-rail"><span class="tl-dot" style="background:' + t.color + '"></span></div>' +
          '<div class="tl-body">' +
          '<div class="tl-top">' +
          '<span class="tl-time">' + U.hm(x.start) + '–' + U.hm(x.end) + '</span>' +
          '<span class="tl-name' + (x.title ? '' : ' empty') + '">' +
          U.esc(x.title || t.label) + '</span>' +
          (x.backfilled ? '<span class="tl-badge">补记</span>' : '') +
          (x.taskId ? '<span class="tl-badge ok">任务</span>' : '') +
          '<span class="tl-dur">' + U.dur(x.end - x.start) + '</span>' +
          (m ? '<span class="tl-mood" title="' + m.label + '">' + m.emoji + '</span>' : '') +
          '</div>' +
          (x.note ? '<div class="tl-note">' + U.esc(x.note) + '</div>' : '') +
          (x.plan ? '<div class="tl-plan">↳ 接下来：' + U.esc(x.plan) +
            (x.planDrafted ? ' <span class="tl-badge ok">已转任务</span>' : '') + '</div>' : '') +
          '</div></div>'
        );
      });
      html.push('</div>');
    }
    html.push('</div>');

    /* 底部动作 */
    html.push(
      '<div class="actions">' +
      '<button class="btn btn-ghost grow" id="backfillBtn">补记一段</button>' +
      '<button class="btn ' + (st.checked ? 'btn-done' : 'btn-quiet') + '" id="minimalBtn">' +
      (st.checked ? '✓ 今日已守住' : '今天就这样') + '</button>' +
      '</div>'
    );

    root.innerHTML = html.join('');
    bind(root, ctx, dayKey, st);
    startTick();
  }

  /* ---------------- 绑定 ---------------- */
  function bind(root, ctx, dayKey, st) {
    const s = state();

    const on = function (id, ev, fn) {
      const el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };

    /* 备份 */
    on('bannerBackup', 'click', function () {
      Store.exportAll();
      ctx.toast('备份已导出', 'ok');
    });
    on('bannerLater', 'click', function () {
      tab.backupDismissed = true;
      render(document.getElementById('view'), ctx);
    });

    /* 日期导航 */
    on('prevDay', 'click', function () {
      tab.followToday = false;
      tab.dayKey = U.shiftKey(dayKey, -1);
      render(root, ctx);
    });
    on('nextDay', 'click', function () {
      const nk = U.shiftKey(dayKey, 1);
      if (nk > todayKey()) return;
      tab.followToday = (nk === todayKey());
      tab.dayKey = nk;
      render(root, ctx);
    });
    on('todayBtn', 'click', function () {
      tab.followToday = true;
      tab.dayKey = todayKey();
      render(root, ctx);
    });

    /* 标签选择 */
    root.querySelectorAll('.tag-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        tab.selTag = b.dataset.tag;
        root.querySelectorAll('.tag-chip').forEach(function (x) {
          x.classList.toggle('on', x.dataset.tag === tab.selTag);
        });
      });
    });

    /* 开始 / 停止 */
    on('startBtn', 'click', function () {
      const ti = document.getElementById('newTitle');
      const ts = document.getElementById('newTask');
      const taskId = ts && ts.value ? ts.value : null;
      const task = taskId ? Store.getTask(taskId) : null;
      const rawTitle = ti ? ti.value.trim() : '';
      Store.startTimer(tab.selTag, rawTitle || (task ? task.title : ''), taskId);
      ctx.toast(task ? '开始计时 · 记入「' + task.title + '」' : '开始计时', 'ok');
    });

    on('stopBtn', 'click', function () {
      const raw = Store.stopTimer();
      if (!raw) return;
      const ses = Store.addSession(raw);
      openSessionSheet(ses.id, ctx, true);
    });

    on('cancelBtn', 'click', function () {
      if (!confirm('放弃这段计时？不会保存。')) return;
      Store.cancelTimer();
      ctx.toast('已取消');
    });

    /* 补记 */
    on('backfillBtn', 'click', function () {
      const now = Date.now();
      const ses = Store.addSession({
        start: now - 25 * 60000,
        end: now,
        tag: tab.selTag,
        title: '',
        backfilled: true
      });
      openSessionSheet(ses.id, ctx, true);
    });

    /* 1 分钟版 */
    on('minimalBtn', 'click', function () {
      Store.markMinimalDay(dayKey, !st.checked);
      ctx.toast(st.checked ? '已取消打卡' : '今天守住了', 'ok');
    });

    /* 时间轴项 → 编辑 */
    root.querySelectorAll('.tl-item').forEach(function (el) {
      el.addEventListener('click', function () {
        openSessionSheet(el.dataset.sid, ctx, false);
      });
    });
  }

  /* ---------------- 结算 / 编辑弹层 ---------------- */
  function openSessionSheet(id, ctx, isNew) {
    const s = Store.get().sessions.find(function (x) { return x.id === id; });
    if (!s) return;

    let mood = s.mood;
    let tag = s.tag;
    let timeOpen = false;

    const html =
      '<div class="sheet-head">' +
      '<div><h3>' + (isNew ? '记录这一段' : '编辑记录') + '</h3>' +
      '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
      U.hm(s.start) + ' 开始' + (s.backfilled ? ' · 补记' : '') + '</div></div>' +
      '<div class="dur">' + U.dur(s.end - s.start) + '</div>' +
      '</div>' +

      '<div class="sheet-body">' +
      '<div class="field"><label>标签</label><div class="tag-grid" id="shTagGrid">' +
      D.TAGS.map(function (t) { return tagChip(t, t.id === tag); }).join('') +
      '</div></div>' +

      '<div class="field"><label>在做什么 <span class="opt">可选</span></label>' +
      '<input type="text" id="shTitle" maxlength="60" placeholder="例如：写登录页表单验证" value="' +
      U.esc(s.title) + '"></div>' +

      '<div class="field"><label>这段时间感觉怎么样 <span class="opt">这是识别「回避」的唯一传感器</span></label>' +
      '<div class="mood-row" id="shMoodRow">' + moodRow(mood) + '</div>' +
      '<button class="mood-clear" id="shMoodClear"' + (mood ? '' : ' style="display:none"') + '>清除</button>' +
      '</div>' +

      '<div class="field"><label>备注 <span class="opt">可选</span></label>' +
      '<textarea id="shNote" placeholder="一句话：发生了什么 / 卡在哪">' + U.esc(s.note) + '</textarea></div>' +

      '<div class="field"><label>接下来我打算做 <span class="opt">可选 · 保存后自动转成任务草稿</span></label>' +
      '<input type="text" id="shPlan" maxlength="80" placeholder="例如：明天把表单校验写完" value="' +
      U.esc(s.plan) + '"></div>' +

      '<div class="field">' +
      '<button class="toggle-time" id="shTglTime">调整起止时间</button>' +
      '<div class="timeedit" id="shTimeEdit">' +
      '<div><label style="display:block;font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:var(--dim);margin-bottom:6px">开始</label>' +
      '<input type="datetime-local" id="shStart" value="' + U.toLocalInput(s.start) + '"></div>' +
      '<div><label style="display:block;font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:var(--dim);margin-bottom:6px">结束</label>' +
      '<input type="datetime-local" id="shEnd" value="' + U.toLocalInput(s.end) + '"></div>' +
      '</div></div>' +
      '</div>' +

      '<div class="sheet-foot">' +
      '<button class="btn btn-quiet" id="shDel">删除</button>' +
      '<button class="btn btn-primary" id="shSave">保存</button>' +
      '</div>';

    ctx.sheet(html, {
      onMount: function (box) {
        /* 标签 */
        box.querySelectorAll('#shTagGrid .tag-chip').forEach(function (b) {
          b.addEventListener('click', function () {
            tag = b.dataset.tag;
            box.querySelectorAll('#shTagGrid .tag-chip').forEach(function (x) {
              x.classList.toggle('on', x.dataset.tag === tag);
            });
          });
        });

        /* 情绪 */
        const clearBtn = box.querySelector('#shMoodClear');
        const syncClear = function () {
          if (clearBtn) clearBtn.style.display = mood ? '' : 'none';
        };
        const paintMood = function () {
          box.querySelectorAll('#shMoodRow .mood-btn').forEach(function (b) {
            b.classList.toggle('on', Number(b.dataset.mood) === mood);
          });
          syncClear();
        };
        box.querySelectorAll('#shMoodRow .mood-btn').forEach(function (b) {
          b.onclick = function () {
            const v = Number(b.dataset.mood);
            mood = (mood === v) ? null : v;   /* 再点一次取消 */
            paintMood();
          };
        });
        if (clearBtn) {
          clearBtn.onclick = function () { mood = null; paintMood(); };
        }
        paintMood();

        /* 时间展开 */
        box.querySelector('#shTglTime').onclick = function () {
          timeOpen = !timeOpen;
          box.querySelector('#shTimeEdit').classList.toggle('show', timeOpen);
        };

        /* 保存 */
        box.querySelector('#shSave').onclick = function () {
          const patch = {
            tag: tag,
            title: box.querySelector('#shTitle').value.trim(),
            note: box.querySelector('#shNote').value.trim(),
            plan: box.querySelector('#shPlan').value.trim(),
            mood: mood
          };

          if (timeOpen) {
            const ns = U.fromLocalInput(box.querySelector('#shStart').value);
            const ne = U.fromLocalInput(box.querySelector('#shEnd').value);
            if (ns != null && ne != null && ne > ns) {
              patch.start = ns;
              patch.end = ne;
            }
          }

          const planText = patch.plan;
          Store.updateSession(id, patch);

          /* 计划 → 任务草稿 */
          if (planText) {
            const cur = Store.get().sessions.find(function (x) { return x.id === id; });
            if (cur && !cur.planDrafted) {
              Store.addDraft(planText, id);
              Store.updateSession(id, { planDrafted: true });
            }
          }

          ctx.closeSheet();
          if (mood == null) {
            ctx.toast('已保存 · 下次试试记一下情绪', 'warn');
          } else if (planText) {
            ctx.toast('已保存，计划已转成任务草稿', 'ok');
          } else {
            ctx.toast('已保存', 'ok');
          }
        };

        /* 删除 */
        box.querySelector('#shDel').onclick = function () {
          if (!confirm('删除这条记录？')) return;
          Store.removeSession(id);
          ctx.closeSheet();
          ctx.toast('已删除');
        };
      }
    });
  }

  /* ---------------- 对外 ---------------- */
  w.TabLog = {
    render: render,
    reset: function () {
      tab.dayKey = null;
      tab.followToday = true;
      stopTick();
    },
    onMinute: function () {
      /* 跨过逻辑日边界时，如果还停在"今天"，自动跟随到今天 */
      if (!tab.followToday) return;
      const k = todayKey();
      if (tab.dayKey !== k) {
        tab.dayKey = k;
        if (w.App && w.App.rerender) w.App.rerender();
      }
    },
    hotkey: function () {
      const s = state();
      if (s.running) {
        const raw = Store.stopTimer();
        if (raw) {
          const ses = Store.addSession(raw);
          openSessionSheet(ses.id, {
            toast: w.App.toast, sheet: w.App.sheet,
            closeSheet: w.App.closeSheet, go: w.App.go
          }, true);
        }
      } else {
        Store.startTimer(tab.selTag, '');
        w.App.toast('开始计时', 'ok');
      }
    }
  };
})(window);
