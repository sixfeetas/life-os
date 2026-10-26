/* ============================================================
   Life OS · Tab 3：自省
   ------------------------------------------------------------
   两种对话模式，约束方式不同：

   【督导】短、快、只抓一处「说了没做」的矛盾。
   【分析】长、深、可给判断和建议，但每条判断必须可追溯、可反驳。

   不限制条数和长度——那只会误伤深聊，拦不住空转。
   真正限制的是「空转」：连续几轮什么都没产出，才提示。

   观点必须有证据才算数：3 次支持证据 = 内化。
   反证和“说不清”也必须保留；落地率只是参考，不是分数。
   ============================================================ */
(function (w) {

  let sub = 'insights';          // insights | anchors | chat
  let showDropped = false;
  let chatBusy = false;
  let chatMode = 'audit';        // audit（督导）| analyze（分析）

  const STALL_LIMIT = 3;         // 连续几轮无产出就提醒
  const state = () => Store.get();
  const todayKey = () => Store.todayKey();

  const STATUS = {
    proposed:   { label: '提出',   order: 0 },
    testing:    { label: '试验中', order: 1 },
    verified:   { label: '已验证', order: 2 },
    internalized: { label: '已内化', order: 3 },
    dormant:    { label: '休眠',   order: 4 },
    dropped:    { label: '已放弃', order: 5 }
  };

  const THEME_SUGGEST = ['注意力', '拖延', '睡眠', '输入与输出', '编程学习', '情绪', '关系', '身体'];

  function dotRow(n, max) {
    max = max || 3;
    let h = '<span class="dots">';
    for (let i = 0; i < max; i++) {
      h += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    }
    return h + '</span>';
  }

  function evidenceCounts(insight) {
    const out = { support: 0, counter: 0, unclear: 0 };
    ((insight && insight.evidences) || []).forEach(function (ev) {
      const stance = ev && (ev.stance || 'support');
      if (stance === 'counter' || stance === 'unclear') out[stance]++;
      else out.support++;
    });
    return out;
  }

  function weekRange() {
    const end = todayKey();
    return { start: U.shiftKey(end, -6), end: end };
  }

  function weekKeyFor(dayKey) {
    const d = U.keyToDate(dayKey);
    const mondayOffset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - mondayOffset);
    return 'week-' + U.dateStr(d.getTime());
  }

  function reasonLabel(id) {
    const reason = D.REASONS.find(function (item) { return item.id === id; });
    return reason ? reason.label : '未标注';
  }

  function daysSince(ts) {
    if (!ts) return null;
    return Math.floor((Date.now() - ts) / 86400000);
  }

  /* ================= 每日提问（数据触发，不依赖 AI） ================= */
  function dailyQuestion() {
    const s = state();
    const tk = todayKey();

    // 1. 还没做基线
    if (!Store.hasBaseline()) {
      return {
        kind: 'baseline',
        q: '你还没有基线。没有 Day 0，30 天后就没有对照——只能靠感觉说"我变强了"。',
        action: '做一次 60 分钟的能力探针，录下来或写下来'
      };
    }

    // 2. 顺延 3 次的任务
    const zombie = s.tasks.find(function (t) {
      return t.status === 'open' && t.deferCount >= 3;
    });
    if (zombie) {
      return {
        kind: 'zombie',
        q: '「' + zombie.title + '」已经顺延 ' + zombie.deferCount + ' 次了。' +
           '你是真的想做它，还是它只是看起来该做？',
        action: '拆小 / 换时间 / 删掉——三选一'
      };
    }

    // 3. 有动作但长期没证据的观点
    const stale = s.insights.find(function (it) {
      if (it.status === 'dropped' || it.status === 'internalized') return false;
      if (!it.action || !it.action.text) return false;
      const last = it.lastEvidenceAt || it.createdAt;
      return daysSince(last) >= 3 && evidenceCounts(it).support === 0;
    });
    if (stale) {
      return {
        kind: 'stale',
        q: '「' + stale.claim + '」这个观点，你给了它一个动作，但 ' +
           daysSince(stale.lastEvidenceAt || stale.createdAt) + ' 天没有证据。' +
           '是没做，还是做了但没记？',
        action: '今天给它一次证据，或者承认它不重要'
      };
    }

    // 4. 情绪低 + 时间长的回避
    const st = Store.statsOfDay(tk);
    const low = (st.list || []).filter(function (x) {
      return x.mood != null && x.mood <= 2 && (x.end - x.start) >= 20 * 60000;
    });
    if (low.length) {
      const top = low.sort(function (a, b) {
        return (b.end - b.start) - (a.end - a.start);
      })[0];
      return {
        kind: 'avoid',
        q: '「' + (top.title || D.tag(top.tag).label) + '」花了 ' + U.dur(top.end - top.start) +
           '，情绪 ' + top.mood + ' 星。你回避的是这件事本身，还是它带来的不舒服？',
        action: '把这件事拆到 10 分钟能开始的大小'
      };
    }

    // 5. 有观点、有动作，但行动没有闭合
    const lr = Store.landingRate();
    if (lr.total >= 5 && lr.rate !== null && lr.rate < 0.3) {
      const loop = Store.actionLoop();
      return {
        kind: 'inflate',
        q: '你提出了 ' + lr.total + ' 个观点，其中 ' + loop.withAction +
           ' 个有具体动作，' + loop.completedTasks + ' 个动作真正完成了。' +
           '哪一步断了？',
        action: '选一个有动作的观点，完成一次并记录证据；做不到就改动作或放弃它'
      };
    }

    // 6. 默认：追问最近一条证据
    const withEv = s.insights
      .filter(function (it) { return it.evidences && it.evidences.length; })
      .sort(function (a, b) { return (b.lastEvidenceAt || 0) - (a.lastEvidenceAt || 0); })[0];
    if (withEv) {
      const last = withEv.evidences[withEv.evidences.length - 1];
      const stance = last.stance === 'counter' || last.stance === 'unclear'
        ? last.stance
        : 'support';
      const prefix = stance === 'counter'
        ? '上次留下的是一条反证：'
        : stance === 'unclear'
          ? '上次仍然说不清：'
          : '上次的支持证据是：';
      return {
        kind: 'followup',
        q: '「' + withEv.claim + '」' + prefix + (last.text || '（没写内容）') +
           (stance === 'counter' ? '。它是否已经足以推翻原观点？' : '。这次它还会成立吗？'),
        action: stance === 'counter'
          ? '先判断原观点是否该修改或放弃，不要急着补一条支持证据'
          : '今天再试一次，看是否重复'
      };
    }

    return {
      kind: 'start',
      q: '还没有任何观点。不用憋一句漂亮话——写下你最近真正反复想到的一件事。',
      action: '新建一个观点，给它一个今天能做的动作'
    };
  }

  /* ================= 渲染 ================= */
  function render(root, ctx) {
    const s = state();

    const html = [];
    html.push('<div class="page-head"><div class="date">自省' +
      '<span class="weekday">周三层 · 只看证据</span></div></div>');

    /* 证据与行动总览 */
    const lr = Store.landingRate();
    const loop = Store.actionLoop();
    const internalized = s.insights.filter(function (x) { return x.status === 'internalized'; }).length;
    const testing = s.insights.filter(function (x) {
      return x.status === 'testing' || x.status === 'verified';
    }).length;

    html.push('<div class="card">');
    html.push('<div class="card-title">观点与行动 <span class="rt">参考指标，不是分数</span></div>');
    if (lr.total === 0) {
      html.push('<div class="rate-note" style="margin-top:0">' +
        '还没有观点。这里会同时看三件事：有没有具体动作、动作有没有完成、结果有没有改变你的判断。</div>');
    } else {
      const pct = lr.rate === null ? 0 : Math.round(lr.rate * 100);
      html.push(
        '<div class="plan-bar">' +
        '<div class="pb"><span class="v ' + (pct >= 60 ? 'green' : pct >= 30 ? 'blue' : 'pink') + '">' +
        pct + '%</span><span class="k">有支持证据</span></div>' +
        '<div class="pb"><span class="v">' + lr.total + '</span><span class="k">进行中观点</span></div>' +
        '<div class="pb"><span class="v green">' + internalized + '</span><span class="k">已内化</span></div>' +
        '<div class="pb"><span class="v">' + testing + '</span><span class="k">试验中</span></div>' +
        '</div>' +
        '<div class="rate-bar"><div class="fill" style="width:' + pct + '%"></div></div>' +
        '<div class="rate-note">' +
        lr.withEvidence + ' 个观点有支持证据。比例低不要求你少提观点；先检查动作是否太大、太模糊，或者根本不值得做。' +
        '</div>'
      );
    }
    html.push(
      '<div class="loop-title">行动闭环 <span>累计</span></div>' +
      '<div class="loop-grid">' +
      '<div class="loop-cell"><b>' + loop.withAction + '</b><span>有具体动作</span></div>' +
      '<div class="loop-cell"><b class="blue">' + loop.convertedToTask + '</b><span>转成任务</span></div>' +
      '<div class="loop-cell"><b class="green">' + loop.completedTasks + '</b><span>任务完成</span></div>' +
      '<div class="loop-cell"><b class="green">' + loop.support + '</b><span>支持证据</span></div>' +
      '<div class="loop-cell"><b class="pink">' + loop.counter + '</b><span>反证</span></div>' +
      '</div>' +
      '<div class="rate-note">闭环不是“想明白”，而是：有动作 → 转成任务 → 完成 → 记录结果。' +
      (loop.counter ? ' 已有反证，说明观点正在接受真实检验。' : '') + '</div>'
    );
    html.push('</div>');

    /* 今日提问 */
    const dq = dailyQuestion();
    html.push(
      '<div class="focus" style="margin-bottom:14px">' +
      '<div class="lab">今天唯一要回答的问题</div>' +
      '<div class="txt" style="font-size:15px;line-height:1.65">' + U.esc(dq.q) + '</div>' +
      '<div class="ins-act" style="margin-top:11px"><span class="lbl">→ </span>' + U.esc(dq.action) + '</div>' +
      (s.meta.ai && s.meta.ai.enabled
        ? '<div class="row" style="margin-top:11px"><button class="btn btn-sm btn-primary" id="askAI">拿这个问题问 AI</button></div>'
        : '') +
      '</div>'
    );

    /* 子 tab */
    html.push(
      '<div class="sub-tabs">' +
      '<button data-sub="insights" class="' + (sub === 'insights' ? 'on' : '') + '">观点</button>' +
      '<button data-sub="anchors" class="' + (sub === 'anchors' ? 'on' : '') + '">锚点</button>' +
      '<button data-sub="chat" class="' + (sub === 'chat' ? 'on' : '') + '">审计对话</button>' +
      '</div>'
    );

    if (sub === 'insights') html.push(insightsHTML(s));
    else if (sub === 'anchors') html.push(anchorsHTML(s));
    else html.push(chatHTML(s, ctx));

    root.innerHTML = html.join('');
    bind(root, ctx, dq);
  }

  /* ---------- 跨模块周复盘 ---------- */
  function weeklyReviewHTML(s) {
    const range = weekRange();
    const weekKey = weekKeyFor(range.end);
    const saved = Store.getWeeklyReview(weekKey);
    const sessions = s.sessions.filter(function (item) {
      return item.dayKey >= range.start && item.dayKey <= range.end;
    });
    const activeDays = {};
    const tagMs = {};
    let totalMs = 0;

    sessions.forEach(function (item) {
      const duration = Math.max(0, item.end - item.start);
      activeDays[item.dayKey] = true;
      totalMs += duration;
      tagMs[item.tag || 'other'] = (tagMs[item.tag || 'other'] || 0) + duration;
    });

    const tagRows = Object.keys(tagMs).map(function (tagId) {
      return { id: tagId, ms: tagMs[tagId] };
    }).sort(function (a, b) {
      return b.ms - a.ms;
    });

    const repeated = s.tasks.filter(function (task) {
      return task.status === 'open' && (task.deferCount || 0) >= 2;
    }).sort(function (a, b) {
      return (b.deferCount || 0) - (a.deferCount || 0);
    }).slice(0, 4);

    const incomplete = s.tasks.filter(function (task) {
      if (task.status !== 'open' && task.status !== 'missed') return false;
      return task.dayKey >= range.start && task.dayKey <= range.end;
    });
    const reasonCounts = {};
    incomplete.forEach(function (task) {
      const key = task.reason || 'unknown';
      reasonCounts[key] = (reasonCounts[key] || 0) + 1;
    });
    const reasonRows = Object.keys(reasonCounts).map(function (key) {
      return { key: key, count: reasonCounts[key] };
    }).sort(function (a, b) {
      return b.count - a.count;
    });

    const supportByInsight = {};
    const counterByInsight = {};
    s.insights.forEach(function (insight) {
      (insight.evidences || []).forEach(function (ev) {
        const key = U.dayKey(ev.at, s.meta.dayStartHour);
        if (key < range.start || key > range.end) return;
        const stance = ev.stance || 'support';
        if (stance === 'support') supportByInsight[insight.id] = (supportByInsight[insight.id] || 0) + 1;
        if (stance === 'counter') counterByInsight[insight.id] = (counterByInsight[insight.id] || 0) + 1;
      });
    });

    const changed = function (counts) {
      return s.insights.filter(function (insight) {
        return !!counts[insight.id];
      }).map(function (insight) {
        return { claim: insight.claim, count: counts[insight.id] };
      }).sort(function (a, b) {
        return b.count - a.count;
      });
    };
    const supported = changed(supportByInsight);
    const countered = changed(counterByInsight);

    const html = [];
    html.push(
      '<details class="card weekly-review" open>' +
      '<summary><span>最近 7 个逻辑日 · 合起来看</span>' +
      '<em>' + U.esc(range.start.slice(5).replace('-', '/')) + ' - ' +
      U.esc(range.end.slice(5).replace('-', '/')) + '</em></summary>' +
      '<div class="week-stats">' +
      '<div><b>' + Object.keys(activeDays).length + '</b><span>有记录的天</span></div>' +
      '<div><b>' + sessions.length + '</b><span>条记录</span></div>' +
      '<div><b>' + U.dur(totalMs) + '</b><span>总时长</span></div>' +
      '<div><b>' + incomplete.length + '</b><span>未闭合任务</span></div>' +
      '</div>'
    );

    html.push('<div class="week-section"><div class="week-h">时间去了哪里</div>');
    if (tagRows.length) {
      html.push('<div class="week-tags">' + tagRows.slice(0, 5).map(function (row) {
        const tag = D.tag(row.id);
        return '<span style="--tagc:' + tag.color + '"><i></i>' +
          U.esc(tag.label) + ' · ' + U.dur(row.ms) + '</span>';
      }).join('') + '</div>');
    } else {
      html.push('<div class="week-empty">这 7 天还没有记录。</div>');
    }
    html.push('</div>');

    html.push('<div class="week-section"><div class="week-h">反复顺延</div>');
    if (repeated.length) {
      html.push('<div class="week-list">' + repeated.map(function (task) {
        return '<div><span>' + U.esc(task.title || '（未命名）') + '</span>' +
          '<b>' + task.deferCount + ' 次</b></div>';
      }).join('') + '</div>');
    } else {
      html.push('<div class="week-empty">没有顺延 2 次以上的任务。</div>');
    }
    html.push('</div>');

    html.push('<div class="week-section"><div class="week-h">没有闭合的任务</div>');
    if (incomplete.length) {
      html.push('<div class="week-tags week-reasons">' + reasonRows.map(function (row) {
        return '<span>' + U.esc(reasonLabel(row.key === 'unknown' ? '' : row.key)) +
          ' · ' + row.count + '</span>';
      }).join('') + '</div>');
      html.push('<div class="week-list">' + incomplete.slice(0, 5).map(function (task) {
        return '<div><span>' + U.esc(task.title || '（未命名）') + '</span>' +
          '<em>' + U.esc(task.reason ? reasonLabel(task.reason) : '未标原因') + '</em></div>';
      }).join('') + '</div>');
    } else {
      html.push('<div class="week-empty">这 7 天的任务都闭合了。</div>');
    }
    html.push('</div>');

    html.push('<div class="week-section"><div class="week-h">观点发生了什么</div>');
    if (supported.length || countered.length) {
      html.push('<div class="week-change">');
      supported.slice(0, 3).forEach(function (item) {
        html.push('<div class="support"><span>获得支持</span>' + U.esc(item.claim) +
          '<b>+' + item.count + '</b></div>');
      });
      countered.slice(0, 3).forEach(function (item) {
        html.push('<div class="counter"><span>被反证</span>' + U.esc(item.claim) +
          '<b>+' + item.count + '</b></div>');
      });
      html.push('</div>');
    } else {
      html.push('<div class="week-empty">这 7 天没有新的支持证据或反证。</div>');
    }
    html.push('</div>');

    html.push(
      '<div class="week-focus">' +
      '<label for="weeklyFocus">下周只改一件事</label>' +
      '<textarea id="weeklyFocus" maxlength="120" placeholder="写一个能观察结果的动作，不写“更努力”">' +
      U.esc(saved ? saved.focus : '') + '</textarea>' +
      '<div class="week-focus-foot">' +
      '<span>' + (saved && saved.updatedAt
        ? '上次保存 ' + U.dateStr(saved.updatedAt).slice(5).replace('-', '/')
        : '还没有保存') + '</span>' +
      '<button class="btn btn-primary btn-sm" id="saveWeekly">保存这件事</button>' +
      '</div></div>'
    );
    html.push('</details>');
    return html.join('');
  }

  /* ---------- 观点列表 ---------- */
  function insightsHTML(s) {
    const html = [];

    html.push(weeklyReviewHTML(s));

    /* 防通胀：同主题重复 */
    const themeMap = {};
    s.insights.forEach(function (it) {
      if (it.status === 'dropped' || !it.theme) return;
      themeMap[it.theme] = (themeMap[it.theme] || 0) + 1;
    });
    const hot = Object.keys(themeMap).filter(function (k) { return themeMap[k] >= 3; });
    if (hot.length) {
      html.push('<div class="inflate">' +
        '「' + hot.slice(0, 3).join('」「') + '」这些主题你已经提了 3 次以上。<br>' +
        '这次换个做法，或者承认它不重要——重复思考不是进步。' +
        '</div>');
    }

    const live = s.insights
      .filter(function (it) { return it.status !== 'dropped'; })
      .sort(function (a, b) {
        const oa = STATUS[a.status] ? STATUS[a.status].order : 9;
        const ob = STATUS[b.status] ? STATUS[b.status].order : 9;
        if (oa !== ob) return oa - ob;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });

    if (!live.length) {
      html.push(
        '<div class="card"><div class="empty" style="padding:22px 14px">' +
        '<div class="big">◇</div>' +
        '还没有观点。<br>写下你最近真正反复想到的一件事，<br>然后给它一个今天能做的动作。' +
        '<br><button class="empty-add" id="newInsight">+ 新建观点</button>' +
        '</div></div>'
      );
    } else {
      html.push('<div class="card"><div class="card-title">观点卡' +
        '<span class="rt">' + live.length + ' 条</span></div>');
      live.forEach(function (it) { html.push(insightCardHTML(it)); });
      html.push(
        '<div style="margin-top:6px"><button class="btn btn-ghost btn-sm" id="newInsight">+ 新建观点</button></div>'
      );
      html.push('</div>');
    }

    /* 已放弃（折叠） */
    const dropped = s.insights.filter(function (it) { return it.status === 'dropped'; });
    if (dropped.length) {
      html.push('<div class="closed-wrap">');
      html.push('<button class="closed-toggle" id="toggleDropped">' +
        (showDropped ? '▾' : '▸') + ' 已放弃 ' + dropped.length + ' 条（这些是成功，不是失败）</button>');
      if (showDropped) {
        html.push('<div class="card" style="margin-top:8px">');
        dropped.forEach(function (it) { html.push(insightCardHTML(it)); });
        html.push('</div>');
      }
      html.push('</div>');
    }

    return html.join('');
  }

  function insightCardHTML(it) {
    const counts = evidenceCounts(it);
    const canAddEv = it.status !== 'dropped';
    const html = [];

    html.push('<div class="ins ' + it.status + (counts.counter ? ' has-counter' : '') +
      '" data-ins="' + it.id + '">');

    html.push(
      '<div class="ins-head">' +
      '<span class="ins-state">' + (STATUS[it.status] ? STATUS[it.status].label : it.status) + '</span>' +
      (it.theme ? '<span class="ins-theme">#' + U.esc(it.theme) + '</span>' : '') +
      '<span class="ins-ev">' + dotRow(Math.min(counts.support, 3)) +
      '<span class="n">支持 ' + counts.support + ' · 反证 ' + counts.counter +
      (counts.unclear ? ' · 说不清 ' + counts.unclear : '') + '</span></span>' +
      '</div>'
    );

    html.push('<div class="ins-claim">' + U.esc(it.claim || '（无内容）') + '</div>');
    if (it.quote) html.push('<div class="ins-quote">' + U.esc(it.quote) + '</div>');
    if (it.falsifier) {
      html.push('<div class="ins-falsifier"><span>什么会证明我错了</span>' +
        U.esc(it.falsifier) + '</div>');
    }
    if (counts.counter) {
      html.push('<div class="ins-counter-warning">' +
        '已有 ' + counts.counter + ' 条反证。这个观点可能不成立，先看反例，不要急着解释掉它。' +
        '</div>');
    }

    if (it.action && it.action.text) {
      const meta = [];
      if (it.action.trigger) meta.push(it.action.trigger);
      if (it.action.minutes) meta.push(it.action.minutes + ' 分钟');
      if (it.action.evidence) meta.push('完成标准：' + it.action.evidence);
      html.push(
        '<div class="ins-act"><span class="lbl">动作</span> ' + U.esc(it.action.text) +
        (meta.length ? '<div class="meta">' + U.esc(meta.join(' · ')) + '</div>' : '') +
        '</div>'
      );
    } else if (it.status !== 'dropped') {
      html.push('<div class="ins-act" style="color:var(--dim);background:rgba(88,91,112,.14)">' +
        '<span class="lbl" style="color:var(--dim)">还没有动作</span>　' +
        '没有动作的观点，只是想法。</div>');
    }

    if (it.status === 'dropped' && it.droppedReason) {
      html.push('<div class="ins-act" style="color:var(--dim);background:rgba(88,91,112,.12)">' +
        '放弃理由：' + U.esc(it.droppedReason) + '</div>');
    }

    /* 证据列表 */
    if (it.evidences && it.evidences.length) {
      html.push('<div class="ev-list">');
      it.evidences.forEach(function (ev) {
        const stance = ev.stance === 'counter' || ev.stance === 'unclear'
          ? ev.stance
          : 'support';
        const stanceLabel = { support: '支持', counter: '反证', unclear: '说不清' }[stance];
        html.push(
          '<div class="ev-item ' + stance + '">' +
          '<span class="d">' + U.dateStr(ev.at).slice(5).replace('-', '/') + '</span>' +
          '<span class="stance">' + stanceLabel + '</span>' +
          '<span class="t">' + U.esc(ev.text || '（没写内容）') + '</span>' +
          (it.status !== 'dropped'
            ? '<button class="x" data-del-ev="' + it.id + '|' + ev.id + '" title="删除这条证据">×</button>'
            : '') +
          '</div>'
        );
      });
      html.push('</div>');
    }

    /* 操作 */
    if (it.status !== 'dropped') {
      html.push('<div class="ins-actions">');
      if (canAddEv) {
        html.push('<button class="ta play" data-add-ev="' + it.id + '">+ 加一次证据</button>');
      }
      /* 第三条任务来源：自省 → 今日任务 */
      if (it.action && it.action.text && it.status !== 'internalized') {
        html.push('<button class="ta" data-ins-task="' + it.id + '">→ 转成今日任务</button>');
      }
      html.push('<button class="ta" data-edit-ins="' + it.id + '">编辑</button>');
      if (it.status === 'internalized') {
        html.push('<button class="ta" data-drop-ins="' + it.id + '">归档</button>');
      } else if (it.status === 'dormant') {
        html.push('<button class="ta" data-revive-ins="' + it.id + '">唤醒</button>');
        html.push('<button class="ta bad" data-drop-ins="' + it.id + '">放弃</button>');
      } else {
        html.push('<button class="ta bad" data-drop-ins="' + it.id + '">放弃</button>');
      }
      html.push('</div>');
    } else {
      html.push('<div class="ins-actions">' +
        '<button class="ta" data-revive-ins="' + it.id + '">重新开始</button></div>');
    }

    html.push('</div>');
    return html.join('');
  }

  /* ---------- 锚点 ---------- */
  function anchorsHTML(s) {
    const html = [];
    const anchors = s.anchors.slice().sort(function (a, b) { return b.at - a.at; });
    const base = anchors.filter(function (a) { return a.kind === 'baseline'; });
    const probes = anchors.filter(function (a) { return a.kind !== 'baseline'; });

    html.push('<div class="card"><div class="card-title">结果锚点 <span class="rt">只校准，不计分</span></div>');
    html.push('<div class="rate-note" style="margin-top:0;margin-bottom:12px">' +
      '锚点不是评分，是校准。连续两次不通过 → 该改方法，不是更努力。' +
      '<br>它永远不会进段位，也永远不会被"补考"。</div>');

    if (!base.length) {
      html.push(
        '<div class="inflate" style="background:rgba(203,166,247,.1);border-color:rgba(203,166,247,.35);color:var(--ctp-mauve)">' +
        '<b>最重要的那一步：Day 0 基线。</b><br>' +
        '没有基线，30 天后你只能靠感觉说"我变强了"。<br>' +
        '哪怕粗糙也要做：60 分钟从零搭一个能跑的东西，录屏或写下来存着。' +
        '</div>'
      );
    }

    if (anchors.length) {
      anchors.forEach(function (a) {
        const res = a.result || 'none';
        const resLabel = { pass: '通过', fail: '未通过', partial: '部分通过', none: '未测' }[res];
        html.push(
          '<div class="anchor ' + (res === 'none' ? 'none' : res) + '" data-anchor="' + a.id + '">' +
          '<div class="anchor-line">' +
          '<span class="anchor-kind ' + (a.kind === 'baseline' ? 'base' : '') + '">' +
          (a.kind === 'baseline' ? '基线' : '探针') + '</span>' +
          '<span class="anchor-title">' + U.esc(a.title || '（未命名）') + '</span>' +
          '<span class="anchor-res ' + (res === 'none' ? '' : res) + '">' + resLabel + '</span>' +
          '</div>' +
          (a.passCriteria ? '<div class="anchor-sub">通过标准：' + U.esc(a.passCriteria) + '</div>' : '') +
          (a.method ? '<div class="anchor-sub" style="color:var(--faint)">做法：' + U.esc(a.method) + '</div>' : '') +
          '<div class="anchor-sub" style="color:var(--faint)">' + U.dateStr(a.at) +
          (a.note ? ' · ' + U.esc(a.note) : '') + '</div>' +
          '<div class="anchor-actions">' +
          '<button class="ta" data-set-res="' + a.id + '">记录结果</button>' +
          '<button class="ta" data-edit-anchor="' + a.id + '">编辑</button>' +
          '</div></div>'
        );
      });
    }

    /* 连续失败校准 */
    if (probes.length >= 2) {
      const recent = probes.slice(0, 2);
      if (recent.every(function (a) { return a.result === 'fail'; })) {
        html.push('<div class="calib">' +
          '连续两次探针都没通过。<br>' +
          '这不是"我还不够努力"的信号，是<b>方法可能错了</b>的信号。<br>' +
          '问题不是"要不要更拼"，而是"我练的东西对吗"。' +
          '</div>');
      }
    }

    const since = Store.daysSinceAnchor();
    if (since !== null && since >= 14) {
      html.push('<div class="inflate" style="margin-top:12px">' +
        '距离上次锚点已经 ' + since + ' 天了。该做下一次了——低频但真实。' +
        '</div>');
    }

    html.push('<div class="row" style="margin-top:14px;gap:8px">' +
      '<button class="btn btn-ghost btn-sm" id="newAnchor">+ 加一次探针</button>' +
      (base.length ? '' : '<button class="btn btn-primary btn-sm" id="newBaseline">做 Day 0 基线</button>') +
      '</div>');

    html.push('</div>');
    return html.join('');
  }

  /* ---------- 对话 ---------- */
  function chatHTML(s, ctx) {
    const tk = todayKey();
    const cs = chatState(s);
    const log = cs.log;
    const ai = s.meta.ai || {};
    const aiOn = !!ai.enabled;
    const suff = dataSufficiency(s);
    const isAnalyze = chatMode === 'analyze';
    const rebuttals = s.rebuttals || [];

    const html = [];
    html.push('<div class="card">');
    html.push('<div class="card-title">AI 对话' +
      '<span class="rt">' + (aiOn ? U.esc(ai.model || 'AI 已接入') : '手动模式') + '</span></div>');

    /* 模式切换 */
    html.push(
      '<div class="mode-switch">' +
      '<button class="mode-btn' + (!isAnalyze ? ' on' : '') + '" data-mode="audit">' +
      '<b>督导</b><span>抓「说了没做」</span></button>' +
      '<button class="mode-btn' + (isAnalyze ? ' on' : '') + '" data-mode="analyze">' +
      '<b>分析</b><span>看模式、给判断</span></button>' +
      '</div>'
    );

    /* 说明 */
    html.push(
      '<div class="audit-intro">' +
      (isAnalyze
        ? '<div class="ai-q">分析模式</div>' +
          '把最近 14 天的记录摊开，找模式、下判断、给一条建议。<br>' +
          '<div class="ai-q">约束</div>' +
          '每条判断必须能追溯到具体记录，并标置信度。你可以点「这条不对」反驳它。'
        : '<div class="ai-q">督导模式</div>' +
          '只做一件事：抓一处「说了但没做」的矛盾，然后问你一句。<br>' +
          '<div class="ai-q">约束</div>' +
          '不复述统计数字，不鼓励你。素材不够时会直接说没有。') +
      '</div>'
    );

    /* 数据用量（两种模式门槛不同） */
    if (isAnalyze) {
      const dayCount = (function () {
        const d = {};
        s.sessions.forEach(function (x) { if (x.dayKey) d[x.dayKey] = 1; });
        return Object.keys(d).length;
      })();
      if (dayCount < 2) {
        html.push(
          '<div class="audit-thin">只有 ' + dayCount + ' 天记录。' +
          '分析需要跨天看模式，现在下结论会很不准，但你可以先试试看它怎么说。</div>'
        );
      }
    } else if (suff.level === 'none') {
      /* 督导模式：没有明确矛盾就不开工 */
      html.push(
        '<div class="audit-blocked">' +
        '<div class="ab-title">督导模式下没有可抓的矛盾</div>' +
        '督导要拿「你说的」和「你做的」对照。现在没有明确的不一致，' +
        '它只能把你的数字复述一遍——那不是它笨，是没原料。' +
        '<div class="ab-need-t">还差这些：</div>' +
        '<ul class="ab-need">' +
        suff.need.map(function (n) { return '<li>' + U.esc(n) + '</li>'; }).join('') +
        '</ul>' +
        '<div class="ab-foot">想现在就让 AI 说点什么，切到「分析」模式——那个门槛低得多。</div>' +
        '</div>'
      );
    } else if (suff.level === 'thin') {
      html.push(
        '<div class="audit-thin">目前只有 ' + suff.items.length +
        ' 条可抓的矛盾，对话可能比较单薄。切到「分析」模式能看到更多。</div>'
      );
    }

    /* 督导模式：可抓的线索 */
    if (!isAnalyze && suff.items.length) {
      html.push('<div class="audit-items">');
      html.push('<div class="ai-h">能抓到的矛盾（' + suff.items.length + '）</div>');
      suff.items.slice(0, 6).forEach(function (it) {
        html.push('<div class="audit-item">· ' + U.esc(it.text) + '</div>');
      });
      if (suff.items.length > 6) {
        html.push('<div class="audit-item" style="opacity:.5">…还有 ' +
          (suff.items.length - 6) + ' 条</div>');
      }
      html.push('</div>');
    }

    /* AI 接入状态 */
    if (!aiOn) {
      html.push(
        '<div class="row" style="margin-top:11px">' +
        '<button class="btn btn-sm btn-ghost" id="copyPrompt">复制提示词</button>' +
        '<button class="btn btn-sm btn-quiet" id="openAICfg">去设置接入 AI</button>' +
        '</div>'
      );
    } else {
      html.push(
        '<div class="row" style="margin-top:11px">' +
        '<button class="btn btn-sm btn-quiet" id="openAICfg">AI 设置</button>' +
        (rebuttals.length
          ? '<button class="btn btn-sm btn-quiet" id="showRebuttals">已反驳 ' +
            rebuttals.length + ' 条</button>'
          : '') +
        '</div>'
      );
    }

    /* 消息 */
    if (!log.length) {
      html.push('<div class="empty" style="padding:18px 12px">' +
        '没有对话。直接问它「你看到了什么」，或者说说你最近卡在哪。' +
        '</div>');
    } else {
      html.push('<div class="chat" id="chatBox">');
      log.forEach(function (m, idx) {
        const cls = m.role === 'ai' ? 'ai' : m.role === 'me' ? 'me' : 'sys';
        const who = m.role === 'ai' ? 'AI' : m.role === 'me' ? '我' : '提示';
        html.push('<div class="msg ' + cls + '"><span class="who">' + who + '</span>' +
          '<div class="bub">' + U.esc(m.text) + '</div>' +
          (m.role === 'ai'
            ? '<div class="msg-tools"><button class="msg-tool" data-rebut="' + idx + '">这条不对</button>' +
              '<button class="msg-tool" data-take="' + idx + '">变成观点卡</button></div>'
            : '') +
          '</div>');
      });
      html.push('</div>');
    }

    /* 空转提示 */
    if (cs.stall >= STALL_LIMIT) {
      html.push(
        '<div class="stall-warn">连续 ' + cs.stall + ' 轮没有产出。' +
        '你可以继续问，但也许该去做了——或者点下面「今天只记录」。</div>'
      );
    }

    /* 输入 */
    html.push(
      '<div class="chat-input">' +
      '<textarea id="chatText" placeholder="' +
      (isAnalyze ? '问它：我最近有什么模式？或者说说你觉得哪里不对…'
                 : '回它一句，或者说你今天真实做了什么…') + '"></textarea>' +
      '<button class="chat-send" id="chatSend">发送</button>' +
      '</div>'
    );

    /* 出口 */
    html.push(
      '<div class="row" style="margin-top:14px;gap:8px">' +
      '<button class="btn btn-sm btn-ghost" id="makeInsight">把结论变成观点卡</button>' +
      '<button class="btn btn-sm btn-quiet" id="onlyRecord">今天只记录，不安排任务</button>' +
      '</div>'
    );

    html.push('</div>');
    return html.join('');
  }

  /* ================= 绑定 ================= */
  function bind(root, ctx, dq) {
    const on = function (id, ev, fn) {
      const el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };

    /* 子 tab */
    root.querySelectorAll('[data-sub]').forEach(function (b) {
      b.onclick = function () {
        sub = b.dataset.sub;
        render(root, ctx);
      };
    });

    on('toggleDropped', 'click', function () {
      showDropped = !showDropped;
      render(root, ctx);
    });

    on('saveWeekly', 'click', function () {
      const focus = document.getElementById('weeklyFocus').value.trim();
      if (!focus) {
        ctx.toast('写下一件下周要改的事', 'warn');
        return;
      }
      Store.saveWeeklyReview(weekKeyFor(todayKey()), focus);
      ctx.toast('周复盘已保存', 'ok');
    });

    /* 新建 / 编辑观点 */
    on('newInsight', 'click', function () { openInsightSheet(null, ctx); });
    root.querySelectorAll('[data-edit-ins]').forEach(function (b) {
      b.onclick = function () { openInsightSheet(b.dataset.editIns, ctx); };
    });

    /* 加证据 */
    root.querySelectorAll('[data-add-ev]').forEach(function (b) {
      b.onclick = function () { openEvidenceSheet(b.dataset.addEv, ctx); };
    });

    /* 删除证据 */
    /* 观点动作 → 今日任务 */
    root.querySelectorAll('[data-ins-task]').forEach(function (b) {
      b.onclick = function () {
        const it = Store.getInsight(b.dataset.insTask);
        if (!it || !it.action || !it.action.text) return;
        const t = Store.addTask({
          title: it.action.text,
          estMin: it.action.minutes || 20,
          trigger: it.action.trigger || '',
          doneRule: it.action.evidence || '',
          insightId: it.id
        });
        Store.updateInsight(it.id, { action: { taskId: t.id } });
        ctx.toast('已加入今日任务', 'ok');
        setTimeout(function () {
          if (confirm('去「计划」看看这条任务？')) ctx.go('plan');
        }, 120);
      };
    });

    root.querySelectorAll('[data-del-ev]').forEach(function (b) {
      b.onclick = function () {
        const p = b.dataset.delEv.split('|');
        if (!confirm('删掉这条证据？')) return;
        Store.removeEvidence(p[0], p[1]);
        ctx.toast('已删除');
      };
    });

    /* 放弃 / 唤醒 */
    root.querySelectorAll('[data-drop-ins]').forEach(function (b) {
      b.onclick = function () { openDropSheet(b.dataset.dropIns, ctx); };
    });
    root.querySelectorAll('[data-revive-ins]').forEach(function (b) {
      b.onclick = function () {
        Store.updateInsight(b.dataset.reviveIns, {
          status: 'proposed',
          droppedReason: ''
        });
        ctx.toast('已重新开始', 'ok');
      };
    });

    /* 锚点 */
    on('newAnchor', 'click', function () { openAnchorSheet(null, ctx); });
    on('newBaseline', 'click', function () { openAnchorSheet(null, ctx, 'baseline'); });
    root.querySelectorAll('[data-set-res]').forEach(function (b) {
      b.onclick = function () { openResultSheet(b.dataset.setRes, ctx); };
    });
    root.querySelectorAll('[data-edit-anchor]').forEach(function (b) {
      b.onclick = function () { openAnchorSheet(b.dataset.editAnchor, ctx); };
    });

    /* 对话模式切换 */
    root.querySelectorAll('[data-mode]').forEach(function (b) {
      b.onclick = function () {
        chatMode = b.dataset.mode === 'analyze' ? 'analyze' : 'audit';
        render(root, ctx);
      };
    });

    /* 对话 */
    on('chatSend', 'click', function () { sendChat(root, ctx); });
    const ta = document.getElementById('chatText');
    if (ta) {
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          sendChat(root, ctx);
        }
      });
    }

    /* 反驳 AI 判断 */
    root.querySelectorAll('[data-rebut]').forEach(function (b) {
      b.onclick = function () { openRebuttalSheet(Number(b.dataset.rebut), ctx); };
    });

    /* 把某条 AI 回复变成观点卡 */
    root.querySelectorAll('[data-take]').forEach(function (b) {
      b.onclick = function () {
        const tk = todayKey();
        const log = (state().chats && state().chats[tk]) || [];
        const m = log[Number(b.dataset.take)];
        if (!m) return;
        markProduced('insight');
        /* 用 AI 回复的第一句作为观点草稿，让他自己改 */
        const firstLine = (m.text || '').split(/[\n。！？]/).filter(Boolean)[0] || '';
        openInsightSheet(null, ctx, true, firstLine.slice(0, 60));
      };
    });

    on('showRebuttals', 'click', function () { openRebuttalList(ctx); });
    on('copyPrompt', 'click', function () { copyAuditPrompt(ctx); });
    on('openAICfg', 'click', function () { openAIConfigSheet(ctx); });
    on('makeInsight', 'click', function () {
      markProduced('insight');
      openInsightSheet(null, ctx, true);
    });
    on('onlyRecord', 'click', function () {
      Store.markMinimalDay(todayKey(), true);
      ctx.toast('今天就这样，够了', 'ok');
    });
    on('askAI', 'click', function () {
      sub = 'chat';
      render(root, ctx);
      setTimeout(function () {
        const box = document.getElementById('chatText');
        if (box) {
          box.value = '今天的提问：' + dq.q;
          box.focus();
        }
      }, 60);
    });

    /* 滚动到底 */
    const cb = document.getElementById('chatBox');
    if (cb) cb.scrollTop = cb.scrollHeight;
  }

  /* ================= 观点编辑 ================= */
  function openInsightSheet(id, ctx, fromChat, prefill) {
    const it = id ? Store.getInsight(id) : null;
    let theme = it ? it.theme : '';

    const html =
      '<div class="sheet-head"><div><h3>' + (it ? '编辑观点' : '新建观点') + '</h3>' +
      '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
      '写你自己的话。不要写漂亮句子——漂亮句子不需要被验证。' +
      '</div></div></div>' +
      '<div class="sheet-body">' +
      '<div class="field"><label>一句话观点 <span class="opt">写成你自己的话</span></label>' +
      '<textarea id="iClaim" maxlength="120" placeholder="例如：专注来自减少选择，而不是增加意志力">' +
      U.esc(it ? it.claim : (prefill || '')) + '</textarea>' +
      (prefill && !it
        ? '<div class="rate-note" style="margin-top:6px">这句是从 AI 回复里摘的，' +
          '建议改成你自己的说法——别人的句子不需要被验证。</div>'
        : '') +
      '</div>' +

      '<div class="field"><label>出处 / 上下文 <span class="opt">可选</span></label>' +
      '<input type="text" id="iQuote" maxlength="120" placeholder="从哪来的？日记、对话、某本书" value="' +
      U.esc(it ? it.quote : '') + '"></div>' +

      '<div class="field"><label>什么结果会证明我错了？ <span class="opt">可选，但很重要</span></label>' +
      '<textarea id="iFalsifier" maxlength="120" placeholder="例如：连续三次在安静环境里仍无法专注，就说明“专注靠减少选择”不成立">' +
      U.esc(it ? it.falsifier : '') + '</textarea></div>' +

      '<div class="field"><label>主题 <span class="opt">同类观点出现 3 次会提醒你</span></label>' +
      '<div class="tag-grid" id="iThemes">' +
      THEME_SUGGEST.map(function (t) {
        return '<button class="tag-chip' + (theme === t ? ' on' : '') +
          '" data-theme="' + t + '" style="--tagc:var(--ctp-mauve)">' + t + '</button>';
      }).join('') +
      '</div>' +
      '<input type="text" id="iThemeCustom" style="margin-top:8px" maxlength="12" ' +
      'placeholder="或自己写一个主题" value="' +
      (theme && THEME_SUGGEST.indexOf(theme) === -1 ? U.esc(theme) : '') + '">' +
      '</div>' +

      '<div class="field"><label>动作 <span class="opt">没有动作的观点只是想法</span></label>' +
      '<input type="text" id="iAct" maxlength="80" placeholder="今天能做的具体动作" value="' +
      U.esc(it ? it.action.text : '') + '">' +
      '<div class="add-form show" style="border:none;padding:0;margin-top:9px">' +
      '<div class="row2">' +
      '<input class="title-input" id="iMin" type="number" min="1" step="5" placeholder="分钟" value="' +
      (it && it.action.minutes ? it.action.minutes : 20) + '">' +
      '<input class="title-input" id="iTrig" maxlength="30" placeholder="什么时候开始" value="' +
      U.esc(it ? it.action.trigger : '') + '">' +
      '</div></div>' +
      '<input type="text" id="iEvRule" style="margin-top:9px" maxlength="80" ' +
      'placeholder="什么算做到了一次？（证据标准）" value="' +
      U.esc(it ? it.action.evidence : '') + '">' +
      '</div>' +
      '</div>' +
      '<div class="sheet-foot">' +
      (it ? '<button class="btn btn-danger" id="iDel">删除</button>' : '') +
      '<button class="btn btn-primary" id="iSave">' + (it ? '保存' : '创建') + '</button>' +
      '</div>';

    ctx.sheet(html, {
      onMount: function (box) {
        box.querySelectorAll('#iThemes .tag-chip').forEach(function (b) {
          b.onclick = function () {
            theme = (theme === b.dataset.theme) ? '' : b.dataset.theme;
            box.querySelectorAll('#iThemes .tag-chip').forEach(function (x) {
              x.classList.toggle('on', x.dataset.theme === theme);
            });
            box.querySelector('#iThemeCustom').value = '';
          };
        });
        box.querySelector('#iThemeCustom').addEventListener('input', function () {
          if (this.value.trim()) {
            theme = this.value.trim();
            box.querySelectorAll('#iThemes .tag-chip').forEach(function (x) {
              x.classList.remove('on');
            });
          }
        });

        box.querySelector('#iSave').onclick = function () {
          const claim = box.querySelector('#iClaim').value.trim();
          if (!claim) { ctx.toast('观点不能为空', 'warn'); return; }

          const custom = box.querySelector('#iThemeCustom').value.trim();
          const finalTheme = custom || theme;
          const minutes = parseInt(box.querySelector('#iMin').value, 10);

          const patch = {
            claim: claim,
            quote: box.querySelector('#iQuote').value.trim(),
            theme: finalTheme,
            falsifier: box.querySelector('#iFalsifier').value.trim(),
            action: {
              text: box.querySelector('#iAct').value.trim(),
              trigger: box.querySelector('#iTrig').value.trim(),
              minutes: (isNaN(minutes) || minutes < 1) ? 20 : minutes,
              evidence: box.querySelector('#iEvRule').value.trim()
            }
          };

          if (it) {
            Store.updateInsight(it.id, patch);
            ctx.closeSheet();
            ctx.toast('已保存', 'ok');
          } else {
            const created = Store.addInsight(patch);
            markProduced('insight');
            ctx.closeSheet();
            if (finalTheme && Store.themeCount(finalTheme) >= 3) {
              ctx.toast('这个主题你提过 3 次了——这次记得换个做法', 'warn');
            } else {
              ctx.toast('已创建 · 现在给它一次证据', 'ok');
            }
            setTimeout(function () { openEvidenceSheet(created.id, ctx); }, 260);
          }
        };

        const delBtn = box.querySelector('#iDel');
        if (delBtn) {
          delBtn.onclick = function () {
            if (!confirm('删除这个观点？证据也会一起删掉。')) return;
            Store.removeInsight(it.id);
            ctx.closeSheet();
            ctx.toast('已删除');
          };
        }

        box.querySelector('#iClaim').focus();
      }
    });
  }

  /* ================= 证据 ================= */
  function openEvidenceSheet(id, ctx) {
    const it = Store.getInsight(id);
    if (!it) return;
    const counts = evidenceCounts(it);

    /* 可关联的今天已闭合任务 */
    const doneTasks = Store.tasksOfDay(todayKey()).filter(function (t) {
      return t.status === 'done';
    });

    const html =
      '<div class="sheet-head"><div><h3>加一条证据</h3>' +
      '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
      '支持 ' + counts.support + ' · 反证 ' + counts.counter +
      (counts.unclear ? ' · 说不清 ' + counts.unclear : '') + '</div></div>' +
      '<div class="dur">' + dotRow(Math.min(counts.support, 3)) + '</div>' +
      '</div>' +
      '<div class="sheet-body">' +
      '<div class="field"><label>观点</label>' +
      '<div style="font-size:13.5px;line-height:1.6;color:var(--sub)">' +
      U.esc(it.claim) + '</div></div>' +

      '<div class="field"><label>这条证据是在说什么 <span class="opt">三类都要保留</span></label>' +
      '<div class="stance-switch" id="evStance">' +
      '<button type="button" class="on support" data-stance="support">' +
      '<b>支持这个观点</b><span>结果符合预期</span></button>' +
      '<button type="button" class="counter" data-stance="counter">' +
      '<b>反驳这个观点</b><span>结果与预期相反</span></button>' +
      '<button type="button" class="unclear" data-stance="unclear">' +
      '<b>目前说不清</b><span>信息还不够</span></button>' +
      '</div></div>' +

      '<div class="field"><label id="evTextLabel">支持这个观点的事实 <span class="opt">事实，不是解释</span></label>' +
      '<textarea id="evText" placeholder="例如：手机放另一个房间，写完 40 分钟没被打断"></textarea>' +
      '</div>' +

      (it.action && it.action.evidence
        ? '<div class="field"><label>判定标准</label>' +
          '<div style="font-size:12.5px;color:var(--dim)">' + U.esc(it.action.evidence) + '</div></div>'
        : '') +

      (doneTasks.length
        ? '<div class="field"><label>关联今天完成的任务 <span class="opt">可选</span></label>' +
          '<select id="evTask"><option value="">不关联</option>' +
          doneTasks.map(function (t) {
            return '<option value="' + t.id + '">' + U.esc(t.title) + '</option>';
          }).join('') +
          '</select></div>'
        : '') +

      (it.falsifier
        ? '<div class="field"><label>你事先写下的反证条件</label>' +
          '<div class="evidence-falsifier">' + U.esc(it.falsifier) + '</div></div>'
        : '') +
      '</div>' +
      '<div class="sheet-foot">' +
      '<button class="btn btn-quiet" id="evCancel">取消</button>' +
      '<button class="btn btn-primary" id="evSave">记下支持证据</button>' +
      '</div>';

    ctx.sheet(html, {
      onMount: function (box) {
        let stance = 'support';
        const labels = {
          support: '支持这个观点的事实',
          counter: '怎么反驳了这个观点',
          unclear: '为什么这次还说不清'
        };
        const placeholders = {
          support: '例如：手机放另一个房间，写完 40 分钟没被打断',
          counter: '例如：手机放另一个房间后，还是连续刷了 30 分钟，并没有更专注',
          unclear: '例如：今天状态很差，无法判断是这个方法还是睡眠不足导致的'
        };
        const buttonLabels = {
          support: '记下支持证据',
          counter: '保留这条反证',
          unclear: '记作“说不清”'
        };

        box.querySelectorAll('#evStance [data-stance]').forEach(function (button) {
          button.onclick = function () {
            stance = button.dataset.stance;
            box.querySelectorAll('#evStance [data-stance]').forEach(function (item) {
              item.classList.toggle('on', item === button);
            });
            box.querySelector('#evTextLabel').innerHTML =
              labels[stance] + ' <span class="opt">事实，不是解释</span>';
            box.querySelector('#evText').placeholder = placeholders[stance];
            box.querySelector('#evSave').textContent = buttonLabels[stance];
          };
        });

        box.querySelector('#evCancel').onclick = function () { ctx.closeSheet(); };
        box.querySelector('#evSave').onclick = function () {
          const text = box.querySelector('#evText').value.trim();
          if (!text) { ctx.toast('写一句这次发生了什么', 'warn'); return; }
          const sel = box.querySelector('#evTask');
          Store.addEvidence(id, {
            text: text,
            taskId: sel && sel.value ? sel.value : null,
            stance: stance
          });
          markProduced('evidence');
          ctx.closeSheet();
          const after = Store.getInsight(id);
          const afterCounts = evidenceCounts(after);
          if (stance === 'counter') {
            ctx.toast('反证已保留 · 这个观点可能不成立', 'warn');
          } else if (stance === 'unclear') {
            ctx.toast('已记作“说不清” · 不推进状态', 'ok');
          } else if (afterCounts.support >= 3) {
            ctx.toast('第 3 次支持证据 · 已内化', 'ok');
          } else if (afterCounts.support === 2) {
            ctx.toast('第 2 次支持证据 · 已验证（再 1 次算内化）', 'ok');
          } else {
            ctx.toast('第 1 次支持证据 · 开始试验', 'ok');
          }
        };
        box.querySelector('#evText').focus();
      }
    });
  }

  /* ================= 放弃 ================= */
  function openDropSheet(id, ctx) {
    const it = Store.getInsight(id);
    if (!it) return;
    const html =
      '<div class="sheet-head"><div><h3>放弃这个观点</h3>' +
      '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
      '干净地放弃是成功，不是失败。' +
      '</div></div></div>' +
      '<div class="sheet-body"><div class="field">' +
      '<label>为什么放弃 <span class="opt">诚实一点</span></label>' +
      '<textarea id="dropWhy" placeholder="例如：它对我的生活没有实际影响 / 试了三次都不成立"></textarea>' +
      '</div></div>' +
      '<div class="sheet-foot">' +
      '<button class="btn btn-quiet" id="dropCancel">取消</button>' +
      '<button class="btn btn-danger" id="dropOk">放弃</button>' +
      '</div>';
    ctx.sheet(html, {
      onMount: function (box) {
        box.querySelector('#dropCancel').onclick = function () { ctx.closeSheet(); };
        box.querySelector('#dropOk').onclick = function () {
          Store.updateInsight(id, {
            status: 'dropped',
            droppedReason: box.querySelector('#dropWhy').value.trim()
          });
          ctx.closeSheet();
          ctx.toast('已放弃 · 这样你就不用再想它了', 'ok');
        };
        box.querySelector('#dropWhy').focus();
      }
    });
  }

  /* ================= 锚点 ================= */
  function openAnchorSheet(id, ctx, forceKind) {
    const a = id ? state().anchors.find(function (x) { return x.id === id; }) : null;
    const kind = a ? a.kind : (forceKind || 'probe');

    const html =
      '<div class="sheet-head"><div><h3>' +
      (a ? '编辑锚点' : kind === 'baseline' ? 'Day 0 基线' : '新的探针') + '</h3>' +
      '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
      (kind === 'baseline'
        ? '粗糙的基线 > 完美的基线 > 没有基线'
        : '同条件、不提前练、能失败') +
      '</div></div></div>' +
      '<div class="sheet-body">' +
      '<div class="field"><label>测什么</label>' +
      '<input type="text" id="aTitle" maxlength="60" placeholder="例如：60 分钟从零搭一个能跑的表单" value="' +
      U.esc(a ? a.title : '') + '"></div>' +
      '<div class="field"><label>通过标准 <span class="opt">要能明确判"过/不过"</span></label>' +
      '<input type="text" id="aCriteria" maxlength="100" placeholder="例如：页面能提交且空输入被拦住" value="' +
      U.esc(a ? a.passCriteria : '') + '"></div>' +
      '<div class="field"><label>怎么做 <span class="opt">越具体越可重复</span></label>' +
      '<input type="text" id="aMethod" maxlength="100" placeholder="例如：从空白文件开始，不许查自己的旧代码" value="' +
      U.esc(a ? a.method : '') + '"></div>' +
      '<div class="field"><label>限时（分钟）</label>' +
      '<input type="number" id="aMin" min="10" step="5" value="' + (a ? a.minutes : 60) + '"></div>' +
      '</div>' +
      '<div class="sheet-foot">' +
      (a ? '<button class="btn btn-danger" id="aDel">删除</button>' : '') +
      '<button class="btn btn-primary" id="aSave">' + (a ? '保存' : '创建') + '</button>' +
      '</div>';

    ctx.sheet(html, {
      onMount: function (box) {
        box.querySelector('#aSave').onclick = function () {
          const title = box.querySelector('#aTitle').value.trim();
          if (!title) { ctx.toast('写一下测什么', 'warn'); return; }
          const min = parseInt(box.querySelector('#aMin').value, 10);
          const data = {
            kind: kind,
            title: title,
            passCriteria: box.querySelector('#aCriteria').value.trim(),
            method: box.querySelector('#aMethod').value.trim(),
            minutes: (isNaN(min) || min < 1) ? 60 : min
          };
          if (a) {
            Store.updateAnchor(a.id, data);
            ctx.toast('已保存', 'ok');
          } else {
            Store.addAnchor(data);
            ctx.toast(kind === 'baseline' ? '基线已建立' : '探针已创建', 'ok');
          }
          ctx.closeSheet();
        };
        const del = box.querySelector('#aDel');
        if (del) {
          del.onclick = function () {
            if (!confirm('删除这个锚点？')) return;
            Store.removeAnchor(a.id);
            ctx.closeSheet();
            ctx.toast('已删除');
          };
        }
        box.querySelector('#aTitle').focus();
      }
    });
  }

  function openResultSheet(id, ctx) {
    const a = state().anchors.find(function (x) { return x.id === id; });
    if (!a) return;
    let result = a.result;

    const html =
      '<div class="sheet-head"><div><h3>记录结果</h3>' +
      '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
      U.esc(a.title) + '</div></div></div>' +
      '<div class="sheet-body">' +
      '<div class="field"><label>结果</label>' +
      '<div class="tag-grid" id="rGrid">' +
      '<button class="tag-chip" data-r="pass" style="--tagc:var(--ctp-green)">通过</button>' +
      '<button class="tag-chip" data-r="partial" style="--tagc:var(--ctp-yellow)">部分通过</button>' +
      '<button class="tag-chip" data-r="fail" style="--tagc:var(--ctp-red)">未通过</button>' +
      '</div></div>' +
      '<div class="field"><label>一句说明 <span class="opt">卡在哪 / 差多少</span></label>' +
      '<textarea id="rNote" placeholder="例如：能提交，但空输入没拦住">' +
      U.esc(a.note || '') + '</textarea></div>' +
      '</div>' +
      '<div class="sheet-foot">' +
      '<button class="btn btn-quiet" id="rCancel">取消</button>' +
      '<button class="btn btn-primary" id="rSave">保存</button>' +
      '</div>';

    ctx.sheet(html, {
      onMount: function (box) {
        const paint = function () {
          box.querySelectorAll('#rGrid .tag-chip').forEach(function (x) {
            x.classList.toggle('on', x.dataset.r === result);
          });
        };
        box.querySelectorAll('#rGrid .tag-chip').forEach(function (b) {
          b.onclick = function () { result = b.dataset.r; paint(); };
        });
        paint();

        box.querySelector('#rCancel').onclick = function () { ctx.closeSheet(); };
        box.querySelector('#rSave').onclick = function () {
          if (!result) { ctx.toast('选一个结果', 'warn'); return; }
          Store.updateAnchor(id, {
            result: result,
            note: box.querySelector('#rNote').value.trim(),
            at: a.at
          });
          ctx.closeSheet();
          ctx.toast('已记录', 'ok');
        };
      }
    });
  }

  /* ================= AI 对话 ================= */

  /* 审计原料：具体条目，不是汇总。
     这是上一版最大的错误——只给汇总数字，模型只能复述汇总数字。 */
  function buildEvidence(s) {
    const items = [];

    /* 1. 超时了却没写原因 */
    s.tasks.forEach(function (t) {
      if (t.status !== 'done') return;
      const act = Store.taskActualMs(t.id) / 60000;
      if (!(act > 0) || !(t.estMin > 0)) return;
      const r = act / t.estMin;
      if (r >= 1.5 && !t.delta) {
        items.push({
          kind: 'overrun',
          text: (t.dayKey || '') + '「' + t.title + '」预估 ' + t.estMin +
                ' 分、实际 ' + Math.round(act) + ' 分（超 ' + Math.round((r - 1) * 100) +
                '%），但没写为什么超时'
        });
      }
    });

    /* 2. 僵尸任务 */
    s.tasks.forEach(function (t) {
      if (t.status === 'open' && t.deferCount >= 3) {
        items.push({
          kind: 'zombie',
          text: '「' + t.title + '」已经顺延 ' + t.deferCount + ' 次，还挂在待办里'
        });
      }
    });

    /* 3. 观点给了动作，却没有支持证据 */
    s.insights.forEach(function (it) {
      if (it.status === 'dropped' || it.status === 'internalized') return;
      const counts = evidenceCounts(it);
      if (it.action && it.action.text && counts.support === 0) {
        const days = Math.floor((Date.now() - it.createdAt) / 86400000);
        const extra = [];
        if (counts.counter) extra.push('反证 ' + counts.counter + ' 条');
        if (counts.unclear) extra.push('说不清 ' + counts.unclear + ' 条');
        items.push({
          kind: 'no-evidence',
          text: '观点「' + it.claim + '」提出 ' + days + ' 天了，动作是「' +
                it.action.text + '」，但至今 0 次支持证据' +
                (extra.length ? '（' + extra.join('、') + '）' : '')
        });
      }
    });

    /* 4. 明确的反证：不要解释掉它，先看它是否推翻原观点 */
    s.insights.forEach(function (it) {
      if (it.status === 'dropped') return;
      const counts = evidenceCounts(it);
      if (!counts.counter) return;
      const lastCounter = (it.evidences || []).filter(function (ev) {
        return ev.stance === 'counter';
      }).sort(function (a, b) {
        return (b.at || 0) - (a.at || 0);
      })[0];
      items.push({
        kind: 'counter-evidence',
        text: '观点「' + it.claim + '」已有 ' + counts.counter + ' 条反证。最近一次是：' +
              ((lastCounter && lastCounter.text) || '（无内容）') +
              (it.falsifier ? '。你事先写的证伪条件是：' + it.falsifier : '')
      });
    });

    /* 5. 低情绪 + 长时长（回避信号） */
    s.sessions.forEach(function (x) {
      if (x.mood != null && x.mood <= 2 && (x.end - x.start) >= 30 * 60000) {
        items.push({
          kind: 'avoid',
          text: U.dateStr(x.start) + '「' + (x.title || D.tag(x.tag).label) + '」' +
                U.dur(x.end - x.start) + '，情绪 ' + x.mood + ' 星' +
                (x.note ? '，你当时写「' + x.note + '」' : '')
        });
      }
    });

    /* 6. 说了要做，但没变成任务 */
    s.sessions.forEach(function (x) {
      if (x.plan && !x.planDrafted) {
        items.push({
          kind: 'unconverted',
          text: U.dateStr(x.start) + ' 你说「' + x.plan + '」，但没转成任务，也没后文'
        });
      }
    });

    /* 7. 同主题重复提 */
    const themeMap = {};
    s.insights.forEach(function (it) {
      if (it.status === 'dropped' || !it.theme) return;
      (themeMap[it.theme] = themeMap[it.theme] || []).push(it.claim);
    });
    Object.keys(themeMap).forEach(function (k) {
      if (themeMap[k].length >= 3) {
        items.push({
          kind: 'repeat',
          text: '主题「' + k + '」你提了 ' + themeMap[k].length + ' 次：' +
                themeMap[k].map(function (c) { return '「' + c + '」'; }).join('、')
        });
      }
    });

    /* 8. 该做基线了 */
    if (!Store.hasBaseline() && s.sessions.length >= 10) {
      items.push({
        kind: 'no-baseline',
        text: '已经记了 ' + s.sessions.length + ' 条记录，但还没做 Day 0 基线，'
              + '这意味着之后没有对照'
      });
    }

    return items;
  }

  /* ============ 分析模式：更厚的原料 ============
     督导只需要"一条矛盾"；分析需要看趋势和模式，
     所以把最近 14 天的原始记录都摊开给它。 */
  function buildAnalysisMaterial(s) {
    const DAY = 86400000;
    const since = Date.now() - 14 * DAY;
    const lines = [];

    /* 1. 逐日记录（原始，不汇总） */
    const byDay = {};
    s.sessions.forEach(function (x) {
      if (x.start < since) return;
      if (!byDay[x.dayKey]) byDay[x.dayKey] = [];
      byDay[x.dayKey].push(x);
    });
    const days = Object.keys(byDay).sort();

    lines.push('## 逐日记录（最近 14 天）');
    if (!days.length) {
      lines.push('（无）');
    } else {
      days.forEach(function (k) {
        const list = byDay[k].sort(function (a, b) { return a.start - b.start; });
        const total = U.sum(list, function (x) { return x.end - x.start; });
        lines.push('');
        lines.push('### ' + k + '（共 ' + U.dur(total) + '）');
        list.forEach(function (x) {
          const bits = [
            U.hm(x.start) + '–' + U.hm(x.end),
            D.tag(x.tag).label,
            U.dur(x.end - x.start)
          ];
          if (x.title) bits.push('「' + x.title + '」');
          if (x.mood != null) bits.push('情绪' + x.mood + '/5');
          if (x.stopReason) bits.push('为什么停：' + reasonLabel(x.stopReason));
          if (x.note) bits.push('备注：' + x.note);
          if (x.taskId) bits.push('[关联任务]');
          if (x.backfilled) bits.push('[补记]');
          lines.push('- ' + bits.join(' · '));
        });
      });
    }

    /* 2. 任务：预估 vs 实际 */
    const tasks = s.tasks.filter(function (t) {
      return (t.createdAt >= since) || t.status === 'open';
    });
    lines.push('');
    lines.push('## 任务（预估 vs 实际）');
    if (!tasks.length) {
      lines.push('（无）');
    } else {
      tasks.forEach(function (t) {
        const act = Store.taskActualMs(t.id) / 60000;
        const st = { open: '未完成', done: '完成', missed: '没做成', dropped: '删掉' }[t.status] || t.status;
        const parts = ['[' + st + ']', '「' + t.title + '」', '预估' + t.estMin + '分'];
        if (act > 0) {
          parts.push('实际' + Math.round(act) + '分');
          if (t.estMin > 0) {
            parts.push('偏差' + (act / t.estMin >= 1 ? '+' : '') +
              Math.round((act / t.estMin - 1) * 100) + '%');
          }
        } else {
          parts.push('无计时');
        }
        if (t.deferCount) parts.push('顺延' + t.deferCount + '次');
        if (t.doneRule) parts.push('完成标准：' + t.doneRule);
        if (t.reason) {
          const r = D.REASONS.find(function (x) { return x.id === t.reason; });
          parts.push('没做成原因：' + (r ? r.label : t.reason));
        }
        if (t.delta) parts.push('他自己写的：' + t.delta);
        lines.push('- ' + parts.join(' · '));
      });
    }

    /* 3. 观点与证据 */
    lines.push('');
    lines.push('## 观点与证据');
    if (!s.insights.length) {
      lines.push('（无）');
    } else {
      s.insights.forEach(function (it) {
        const counts = evidenceCounts(it);
        const parts = [
          '[' + it.status + ']',
          '「' + it.claim + '」',
          '支持' + counts.support,
          '反证' + counts.counter,
          '说不清' + counts.unclear
        ];
        if (it.theme) parts.push('主题：' + it.theme);
        if (it.action && it.action.text) parts.push('动作：' + it.action.text);
        if (it.falsifier) parts.push('证伪条件：' + it.falsifier);
        lines.push('- ' + parts.join(' · '));
        (it.evidences || []).forEach(function (ev) {
          const stance = ev.stance === 'counter' || ev.stance === 'unclear'
            ? ev.stance
            : 'support';
          const label = { support: '支持', counter: '反证', unclear: '说不清' }[stance];
          lines.push('    · [' + label + '] ' + U.dateStr(ev.at) + ' ' + (ev.text || '（无内容）'));
        });
      });
    }

    /* 4. 锚点 */
    if (s.anchors.length) {
      lines.push('');
      lines.push('## 结果锚点');
      s.anchors.forEach(function (a) {
        lines.push('- [' + (a.kind === 'baseline' ? '基线' : '探针') + '] ' + a.title +
          ' · 结果：' + (a.result || '未测') + (a.note ? ' · ' + a.note : ''));
      });
    }

    const reviewKeys = Object.keys(s.weeklyReviews || {}).sort(function (a, b) {
      return (Number(s.weeklyReviews[b] && s.weeklyReviews[b].updatedAt) || 0) -
        (Number(s.weeklyReviews[a] && s.weeklyReviews[a].updatedAt) || 0);
    }).slice(0, 3);
    if (reviewKeys.length) {
      lines.push('');
      lines.push('## 用户自己写下的周复盘');
      reviewKeys.forEach(function (key) {
        const review = s.weeklyReviews[key];
        if (review && review.focus) {
          lines.push('- ' + key + '：下周只改一件事——' + review.focus);
        }
      });
    }

    return lines.join('\n');
  }

  /* 分析模式的提示词：放开长度，但要求可追溯、可反驳 */
  function analyzeSystemPrompt(s, material, rebuttals) {
    const lines = [
      '你是用户的行为分析顾问。你可以给出判断和建议，但有铁律。',
      '',
      '铁律：',
      '1. 每一条判断都必须能追溯到下面素材里的具体一条（日期 / 任务名 / 原话）。追不到就不要说。',
      '2. 允许推测，但必须标明这是推测，并给出置信度（低/中/高）。',
      '3. 不要重复用户已经反驳过的判断——那些写在「已反驳」里。',
      '4. 不要复述界面上已经显示的统计数字，除非它是你论证的一部分。',
      '5. 只给 1 条建议，而且必须今天或明天能做完、有完成标准。',
      '6. 如果你发现素材不足以支撑任何判断，直接说「数据不够，我下不了结论」，并说明缺什么。',
      '7. 不要鼓励、不要夸奖、不要写励志句。',
      '8. 反证与支持证据同等重要。不要解释掉反证，也不要把反证说成支持；无法判断时明确说不确定。',
      '',
      '输出格式（严格按这个结构）：',
      '【我看到的】3–5 条，每条带具体日期或任务名。',
      '【我推测】1–3 条判断，每条括号里标置信度。',
      '【我建议】只给 1 条，必须带完成标准。',
      '【我不确定】哪些数据缺失会让上面的结论翻盘。',
      ''
    ];

    if (rebuttals && rebuttals.length) {
      lines.push('已反驳（禁止再提出类似判断）：');
      rebuttals.forEach(function (r) {
        lines.push('- 他曾反驳：「' + r.text + '」' +
          (r.judgment ? '（针对的判断：' + r.judgment + '）' : ''));
      });
      lines.push('');
    }

    lines.push('=== 素材 ===');
    lines.push(material);
    return lines.join('\n');
  }

  /* ============ 产出追踪 ============
     不限制条数，限制"空转"：连续 N 轮没有任何东西落进记录，才提示。 */
  function chatState(s) {
    const tk = todayKey();
    const log = (s.chats && s.chats[tk]) || [];
    /* 空转 = 从最近一次"有产出"之后，你说过几句什么也没留下的废话。
       注意要数的是「你说的轮数」，不是「AI 消息条数」——
       一问一答是交错的，数 AI 条数会永远只有 1。 */
    let stall = 0;
    for (let i = log.length - 1; i >= 0; i--) {
      const m = log[i];
      if (m.role !== 'me') continue;      /* 只数用户发言 */
      if (m.produced) break;              /* 遇到有产出的就停 */
      stall++;
    }
    return { log: log, stall: stall };
  }

  /* 标记最近一轮"有产出" */
  function markProduced(kind, detail) {
    const tk = todayKey();
    Store.update(function (st) {
      if (!st.chats || !st.chats[tk]) return;
      const log = st.chats[tk];
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].role === 'me') { log[i].produced = kind || 'yes'; break; }
      }
    });
  }

  /* 数据够不够审计？不够就别硬生成句子。 */
  function dataSufficiency(s) {
    const items = buildEvidence(s);
    const days = {};
    s.sessions.forEach(function (x) { if (x.dayKey) days[x.dayKey] = 1; });
    const dayCount = Object.keys(days).length;
    const closed = s.tasks.filter(function (t) { return t.status !== 'open'; }).length;

    if (items.length === 0) {
      const need = [];
      if (dayCount < 3) need.push('至少 3 天记录（现在 ' + dayCount + ' 天）');
      if (closed < 3) need.push('至少 3 条有结果的任务，且带预估和计时（现在 ' + closed + ' 条）');
      if (!s.insights.length) need.push('至少 1 个观点，并给它一个动作');
      if (!need.length) need.push('再多记几天，让它有东西可以对照');
      return { level: 'none', items: items, need: need, dayCount: dayCount, closed: closed };
    }
    return {
      level: items.length <= 2 ? 'thin' : 'ok',
      items: items, need: [], dayCount: dayCount, closed: closed
    };
  }

  function auditSystemPrompt(s, items, prevAI, rebuttals) {
    const lines = [
      '你是记录审计员。你的工作：指出「他说要做的」和「他实际做的」之间的具体矛盾。',
      '',
      '硬规则：',
      '1. 禁止复述任何界面上已经显示过的统计数字。复述等于没说话。',
      '2. 必须指向素材里的具体一条：哪一天、哪件事、他当时的哪句话。要能让他立刻想起那一刻。',
      '3. 不要铺垫、不要总结、不要开场白。有问题就直说，没问题就说没有。',
      '4. 不许鼓励，不许生成格言或比喻，不许说「我理解你」「你说得真好」。',
      '5. 想给建议时只给 1 条，且必须今天能做完、有完成标准。',
      '6. 如果素材里没有一条能构成矛盾，就只回答「这次没找到具体矛盾」，然后停止。',
      '7. 不要重复你之前说过的话。',
      '8. 如果他在问「这个功能怎么用」这类元问题，直接回答，不要扯数据。',
      '9. 他问得越具体，就答得越具体；不要用长度限制自己。',
      '10. 反证不能被当成支持证据，也不能用一句解释把它消掉；必要时直接说原观点可能不成立。',
      ''
    ];

    if (rebuttals && rebuttals.length) {
      lines.push('他已反驳过的判断（禁止再提）：');
      rebuttals.forEach(function (r) {
        lines.push('- 「' + r.text + '」');
      });
      lines.push('');
    }

    if (prevAI && prevAI.length) {
      lines.push('你之前说过的话（禁止重复这些内容）：');
      prevAI.forEach(function (t) { lines.push('- ' + t.replace(/\n/g, ' ')); });
      lines.push('');
    }

    lines.push('可用素材（只能用这些，不许自己编数字）：');
    if (items.length) {
      items.forEach(function (it, i) { lines.push((i + 1) + '. ' + it.text); });
    } else {
      lines.push('（没有素材）');
    }

    return lines.join('\n');
  }

  function sendChat(root, ctx) {
    if (chatBusy) return;
    const s = state();
    const tk = todayKey();
    if (!s.chats[tk]) s.chats[tk] = [];

    const box = document.getElementById('chatText');
    const text = (box.value || '').trim();
    if (!text) return;

    Store.update(function (st) {
      if (!st.chats[tk]) st.chats[tk] = [];
      st.chats[tk].push({ role: 'me', text: text, at: Date.now() });
    });
    box.value = '';

    const ai = s.meta.ai;
    if (!ai || !ai.enabled || !ai.baseUrl || !ai.model) {
      /* 手动模式：记录下你的话，并给出一个"该问自己什么" */
      Store.update(function (st) {
        st.chats[tk].push({
          role: 'sys',
          text: '（手动模式）已记下。去把上面那个问题贴给 AI，再把它的回答带回来。\n' +
                '提示词点「复制审计提示词」就能拿到。',
          at: Date.now()
        });
      });
      render(root, ctx);
      return;
    }

    /* API 模式 */
    chatBusy = true;

    const log = s.chats[tk];          /* 拿到最新引用（刚才 push 过） */
    const suff = dataSufficiency(s);
    const rebuttals = (s.rebuttals || []).slice(-8);
    const isAnalyze = chatMode === 'analyze';

    const prevAI = log
      .filter(function (m) { return m.role === 'ai'; })
      .slice(-2)
      .map(function (m) { return m.text; });

    const sys = isAnalyze
      ? analyzeSystemPrompt(s, buildAnalysisMaterial(s), rebuttals)
      : auditSystemPrompt(s, suff.items, prevAI, rebuttals);

    /* 只带上用户自己的话，不把之前的 AI 回复塞进历史——
       否则模型会模仿自己上一轮的"复述数字"风格。
       注意：log 里最后一条就是刚写进去的这句，要排除，否则会重复发送。 */
    const priorMine = log
      .filter(function (m) { return m.role === 'me'; })
      .slice(0, -1)
      .slice(-6)
      .map(function (m) { return { role: 'user', content: m.text }; });

    const history = priorMine.concat([{ role: 'user', content: text }]);

    fetch(ai.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (ai.apiKey || '')
      },
      body: JSON.stringify({
        model: ai.model,
        temperature: isAnalyze ? 0.5 : 0.3,
        max_tokens: isAnalyze ? 3000 : 1500,
        messages: [{ role: 'system', content: sys }].concat(history),
        stream: false
      })
    })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (raw) {
            throw new AiError(aiErrorMessage(r.status, raw), 'http');
          });
        }
        return r.text().then(function (raw) {
          /* 先拿原文：JSON 解析失败也能把片段显示出来 */
          let data = null;
          try { data = JSON.parse(raw); } catch (e) {
            throw new AiError('返回的不是 JSON。原始内容：' + raw.slice(0, 200), 'notjson');
          }
          const got = extractReply(data);
          if (!got.text) {
            throw new AiError(emptyReplyMessage(got, data), 'empty', data);
          }
          return got.text;
        });
      })
      .then(function (reply) {
        Store.update(function (st) {
          st.chats[tk].push({ role: 'ai', text: reply, at: Date.now() });
        });
        chatBusy = false;
        render(root, ctx);
      })
      .catch(function (err) {
        chatBusy = false;
        const isNet = !(err instanceof AiError);
        const text = isNet
          ? '请求没能发出去：' + (err && err.message || err) +
            '\n\n这通常才是 CORS 或网络问题。检查：接口地址是否可访问、' +
            '是否需要在本地起转发代理。'
          : err.message;
        Store.update(function (st) {
          st.chats[tk].push({ role: 'sys', text: text, at: Date.now() });
        });
        render(root, ctx);
      });
  }

  /* 区分"网络没通"和"通了但没内容" */
  function AiError(message, kind) {
    this.name = 'AiError';
    this.message = message;
    this.kind = kind;
  }
  AiError.prototype = Object.create(Error.prototype);

  /* 从各种可能的返回结构里把正文抠出来 */
  function extractReply(data) {
    const ch = data && data.choices && data.choices[0];
    if (!ch) return { text: '', finish: '', reasoning: '', hasChoices: false };
    const msg = ch.message || {};
    /* content 可能在字符串里，也可能是分段数组 */
    let content = msg.content;
    if (Array.isArray(content)) {
      content = content.map(function (p) {
        return typeof p === 'string' ? p : (p && p.text) || '';
      }).join('');
    }
    if (typeof content !== 'string') content = '';
    return {
      text: content.trim(),
      finish: ch.finish_reason || '',
      reasoning: (msg.reasoning_content || msg.reasoning || '').trim(),
      hasChoices: true
    };
  }

  /* 正文为空时，说清楚到底为什么，别一句"返回为空"了事 */
  function emptyReplyMessage(got, data) {
    const usage = (data && data.usage) || {};
    const bits = [];

    if (!got.hasChoices) {
      return '接口返回了 200，但里面没有 choices 字段。\n' +
             '这通常说明接口地址不对——检查结尾是否多写了 /v1 或少写了 /v1，' +
             '并确认地址不是网页而是 API 端点。\n' +
             '原始返回片段：' + JSON.stringify(data).slice(0, 200);
    }

    if (got.finish === 'length') {
      bits.push('模型把 token 额度用完了，正文一个字都没剩下（finish_reason = length）。');
      bits.push('多半是它在"思考"上花光了额度。已经帮你把上限从 500/1400 提到 1500/3000，' +
                '再试一次通常就好了。');
    } else if (got.reasoning) {
      bits.push('模型只返回了思考内容，正文是空的。');
      bits.push('思考片段：' + got.reasoning.slice(0, 180));
    } else if (got.finish === 'content_filter') {
      bits.push('内容被服务端的安全策略拦下了。换个问法试试。');
    } else {
      bits.push('接口返回 200，但正文是空的。');
    }

    if (usage.total_tokens != null) {
      bits.push('用量：prompt ' + (usage.prompt_tokens || '?') +
                ' + completion ' + (usage.completion_tokens || '?') +
                ' = ' + usage.total_tokens + ' tokens');
    }
    bits.push('原始返回片段：' + JSON.stringify(data).slice(0, 200));
    return bits.join('\n');
  }

  /* 把各家 API 的错误响应翻译成人话 */
  function aiErrorMessage(status, raw) {
    let detail = '';
    try {
      const j = JSON.parse(raw);
      detail = (j.error && j.error.message) || j.message || '';
    } catch (e) {
      detail = String(raw || '').slice(0, 160);
    }

    const hint = {
      400: '请求参数有问题，最常见是模型名写错',
      401: 'API Key 无效或没填',
      402: '账户余额不足',
      403: '这个 Key 没有访问权限',
      404: '接口地址或模型名不对（地址不要带 /chat/completions）',
      422: '参数格式不对',
      429: '请求太频繁或额度用完了，等一下再试',
      500: '对方服务器出错了，稍后再试',
      502: '网关错误，多半是代理转发出问题',
      503: '对方服务暂时不可用'
    }[status] || '请求失败';

    return hint + '（HTTP ' + status + '）' + (detail ? '：' + detail : '');
  }

  /* ================= 反驳 ================= */
  function openRebuttalSheet(msgIndex, ctx) {
    const tk = todayKey();
    const s = state();
    const log = (s.chats && s.chats[tk]) || [];
    const m = log[msgIndex];
    if (!m || m.role !== 'ai') return;

    const judgment = (m.text || '').split(/[\n。！？]/).filter(Boolean)[0] || '';

    const html =
      '<div class="sheet-head"><div><h3>这条不对</h3>' +
      '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
      '反驳会被永久记住，以后不会再提同样的判断。' +
      '</div></div></div>' +
      '<div class="sheet-body">' +
      '<div class="field"><label>它说了什么</label>' +
      '<div style="font-size:12.5px;color:var(--dim);line-height:1.65;' +
      'background:rgba(88,91,112,.14);border-radius:9px;padding:9px 11px">' +
      U.esc(judgment) + '</div></div>' +
      '<div class="field"><label>为什么不对</label>' +
      '<textarea id="rbText" placeholder="例如：那天我在忙项目，不是回避；或者我根本没这个习惯"></textarea></div>' +
      '</div>' +
      '<div class="sheet-foot">' +
      '<button class="btn btn-quiet" id="rbCancel">取消</button>' +
      '<button class="btn btn-primary" id="rbSave">记下反驳</button>' +
      '</div>';

    ctx.sheet(html, {
      onMount: function (box) {
        box.querySelector('#rbCancel').onclick = function () { ctx.closeSheet(); };
        box.querySelector('#rbSave').onclick = function () {
          const text = box.querySelector('#rbText').value.trim();
          if (!text) { ctx.toast('写一句为什么不对', 'warn'); return; }
          Store.addRebuttal({ text: text, judgment: judgment });
          markProduced('rebuttal');
          ctx.closeSheet();
          ctx.toast('已记下 · 以后不会再提这个判断', 'ok');
        };
        box.querySelector('#rbText').focus();
      }
    });
  }

  function openRebuttalList(ctx) {
    const list = (state().rebuttals || []).slice().reverse();
    const html =
      '<div class="sheet-head"><div><h3>已反驳</h3>' +
      '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
      '这些判断不会再出现在对话里' +
      '</div></div></div>' +
      '<div class="sheet-body">' +
      (list.length
        ? list.map(function (r) {
            return '<div class="rb-item">' +
              '<div class="rb-jud">' + U.esc(r.judgment || '（未记录原判断）') + '</div>' +
              '<div class="rb-why">你的反驳：' + U.esc(r.text) + '</div>' +
              '<button class="msg-tool" data-unrebut="' + r.id + '">撤销</button>' +
              '</div>';
          }).join('')
        : '<div class="empty">还没有反驳过任何判断。</div>') +
      '</div>' +
      '<div class="sheet-foot"><button class="btn btn-quiet" id="rbClose">关闭</button></div>';

    ctx.sheet(html, {
      onMount: function (box) {
        box.querySelector('#rbClose').onclick = function () { ctx.closeSheet(); };
        box.querySelectorAll('[data-unrebut]').forEach(function (b) {
          b.onclick = function () {
            Store.removeRebuttal(b.dataset.unrebut);
            ctx.closeSheet();
            ctx.toast('已撤销');
          };
        });
      }
    });
  }

  function copyAuditPrompt(ctx) {
    const s = state();
    let sys, tail;
    if (chatMode === 'analyze') {
      sys = analyzeSystemPrompt(s, buildAnalysisMaterial(s), s.rebuttals || []);
      tail = '\n\n请按上面的格式，分析我的记录并给出判断。';
    } else {
      const suff = dataSufficiency(s);
      if (suff.level === 'none') {
        ctx.toast('督导模式下没有可抓的矛盾，先攒几天记录，或切到分析模式', 'warn');
        return;
      }
      sys = auditSystemPrompt(s, suff.items, [], s.rebuttals || []);
      tail = '\n\n请从上面的素材里挑一条，指出矛盾，然后问我一个问题。只挑一条。';
    }
    const full = sys + tail;

    const done = function () {
      ctx.toast('提示词已复制，去粘给 AI', 'ok');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(full).then(done, function () { fallback(full); });
    } else {
      fallback(full);
    }
    function fallback(t) {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { ctx.toast('复制失败，请手动选择', 'warn'); }
      document.body.removeChild(ta);
    }
  }

  function openAIConfigSheet(ctx) {
    const ai = state().meta.ai || {};
    const html =
      '<div class="sheet-head"><div><h3>接入 AI</h3>' +
      '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
      'OpenAI 兼容接口。不填也能用（手动模式）。' +
      '</div></div></div>' +
      '<div class="sheet-body">' +

      '<div class="field"><label>一键填入 <span class="opt">省得手打出错</span></label>' +
      '<div class="tag-grid">' +
      '<button class="tag-chip" data-preset="deepseek" style="--tagc:var(--ctp-mauve)">DeepSeek</button>' +
      '<button class="tag-chip" data-preset="openai" style="--tagc:var(--ctp-teal)">OpenAI</button>' +
      '<button class="tag-chip" data-preset="local" style="--tagc:var(--ctp-blue)">本地 Ollama</button>' +
      '</div></div>' +

      '<div class="field"><label>接口地址 <span class="opt">结尾不要带 /chat/completions</span></label>' +
      '<input type="text" id="aiUrl" placeholder="https://api.deepseek.com" value="' +
      U.esc(ai.baseUrl || '') + '"></div>' +
      '<div class="field"><label>模型名</label>' +
      '<input type="text" id="aiModel" placeholder="deepseek-flash" value="' +
      U.esc(ai.model || '') + '"></div>' +
      '<div class="field"><label>API Key <span class="opt">只存在本机浏览器</span></label>' +
      '<input type="password" id="aiKey" placeholder="sk-...（Ollama 本地不需要）" value="' +
      U.esc(ai.apiKey || '') + '"></div>' +
      '<div class="rate-note" style="margin-top:0">' +
      'DeepSeek 已实测允许浏览器直连，不用代理。<br>' +
      '若换成会拦 CORS 的服务，可在本地起转发代理。' +
      '</div>' +
      '</div>' +
      '<div class="sheet-foot">' +
      '<button class="btn btn-quiet" id="aiOff">关闭 AI</button>' +
      '<button class="btn btn-ghost" id="aiTest">测试连接</button>' +
      '<button class="btn btn-primary" id="aiSave">保存并启用</button>' +
      '</div>';

    ctx.sheet(html, {
      onMount: function (box) {
        const urlEl = box.querySelector('#aiUrl');
        const modelEl = box.querySelector('#aiModel');
        const keyEl = box.querySelector('#aiKey');

        /* 预设 */
        const PRESETS = {
          deepseek: { url: 'https://api.deepseek.com', model: 'deepseek-flash' },
          openai: { url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
          local: { url: 'http://localhost:11434/v1', model: 'qwen2.5:7b' }
        };
        box.querySelectorAll('[data-preset]').forEach(function (b) {
          b.onclick = function () {
            const p = PRESETS[b.dataset.preset];
            if (!p) return;
            urlEl.value = p.url;
            modelEl.value = p.model;
            box.querySelectorAll('[data-preset]').forEach(function (x) {
              x.classList.toggle('on', x === b);
            });
            if (b.dataset.preset === 'local') keyEl.placeholder = '本地 Ollama 随便填或留空';
          };
        });

        /* 测试连接：只发一句最短的话，确认地址/模型/Key 都对 */
        const testBtn = box.querySelector('#aiTest');
        testBtn.onclick = function () {
          const url = urlEl.value.trim();
          const model = modelEl.value.trim();
          if (!url || !model) { ctx.toast('先填地址和模型名', 'warn'); return; }

          testBtn.disabled = true;
          testBtn.textContent = '测试中…';
          const t0 = Date.now();

          fetch(url.replace(/\/+$/, '') + '/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + (keyEl.value.trim() || '')
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: 'user', content: '回复两个字：收到' }],
              max_tokens: 300,
              stream: false
            })
          })
            .then(function (r) {
              if (!r.ok) return r.text().then(function (raw) {
                throw new AiError(aiErrorMessage(r.status, raw), 'http');
              });
              return r.text().then(function (raw) {
                let data = null;
                try { data = JSON.parse(raw); } catch (e) {
                  throw new AiError('返回的不是 JSON：' + raw.slice(0, 160), 'notjson');
                }
                const got = extractReply(data);
                if (!got.text) throw new AiError(emptyReplyMessage(got, data), 'empty');
                return got.text;
              });
            })
            .then(function (txt) {
              const ms = Date.now() - t0;
              testBtn.disabled = false;
              testBtn.textContent = '测试连接';
              ctx.toast('连接成功 · ' + ms + 'ms · 回复「' + txt.slice(0, 20) + '」', 'ok');
            })
            .catch(function (err) {
              testBtn.disabled = false;
              testBtn.textContent = '测试连接';
              /* 诊断信息较长，用弹层而不是 toast，否则看不清 */
              if (err instanceof AiError) {
                ctx.sheet(
                  '<div class="sheet-head"><div><h3>连接失败</h3>' +
                  '<div style="font-size:12px;color:var(--dim);margin-top:3px">' +
                  'HTTP 通了，但没能拿到正文</div></div></div>' +
                  '<div class="sheet-body">' +
                  '<pre class="diag">' + U.esc(err.message) + '</pre>' +
                  '</div>' +
                  '<div class="sheet-foot"><button class="btn btn-primary" id="diagOk">知道了</button></div>',
                  { onMount: function (b) {
                      b.querySelector('#diagOk').onclick = function () { ctx.closeSheet(); };
                    } }
                );
              } else {
                ctx.toast('请求没发出去：' + (err && err.message || err), 'warn');
              }
            });
        };

        box.querySelector('#aiSave').onclick = function () {
          const url = box.querySelector('#aiUrl').value.trim();
          const model = box.querySelector('#aiModel').value.trim();
          if (!url || !model) { ctx.toast('地址和模型名都要填', 'warn'); return; }
          Store.setAI({
            enabled: true,
            baseUrl: url,
            model: model,
            apiKey: box.querySelector('#aiKey').value.trim()
          });
          ctx.closeSheet();
          ctx.toast('AI 已启用', 'ok');
        };
        box.querySelector('#aiOff').onclick = function () {
          Store.setAI({ enabled: false });
          ctx.closeSheet();
          ctx.toast('已切回手动模式');
        };
      }
    });
  }

  /* ================= 对外 ================= */
  w.TabInsight = {
    render: render,
    reset: function () {
      sub = 'insights';
      showDropped = false;
      chatBusy = false;
    }
  };
})(window);
