/* ============================================================
   Life OS · 存储层
   - 单一版本化数据结构
   - 每个模块只写自己的命名空间
   - 第一天就支持 导出 / 导入 全量备份
   ============================================================ */
(function (w) {

  const KEY = 'lifeos_v1';
  const VERSION = 1;

  let state = null;
  let listeners = [];
  let dirty = false;

  /* ---------------- 安全存储 ----------------
     手机浏览器用 file:// 打开时，localStorage 可能被禁用（抛异常）。
     这时退化成内存存储：功能全都能用，但关掉页面数据就没了。
     必须让界面知道这件事，否则用户会以为自己在用正常版。 */
  const storage = (function () {
    try {
      const probe = '__lifeos_probe__';
      w.localStorage.setItem(probe, '1');
      w.localStorage.removeItem(probe);
      return { ok: true, why: '', get: function (k) { return w.localStorage.getItem(k); },
               set: function (k, v) { w.localStorage.setItem(k, v); },
               del: function (k) { w.localStorage.removeItem(k); } };
    } catch (e) {
      const mem = {};
      return {
        ok: false,
        why: (e && e.name) || 'blocked',
        get: function (k) { return (k in mem) ? mem[k] : null; },
        set: function (k, v) { mem[k] = String(v); },
        del: function (k) { delete mem[k]; }
      };
    }
  })();

  /* ---------------- 默认结构 ---------------- */
  function defaults() {
    return {
      version: VERSION,
      app: 'life-os',

      meta: {
        dayStartHour: 4,          // 逻辑日以凌晨 4 点切分
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        lastBackupAt: null,       // 上次导出备份的时间
        onboarded: false,
        ai: {                     // 自省层可选的 AI 接入（默认关闭，离线也能用）
          enabled: false,
          baseUrl: '',
          model: '',
          apiKey: ''
        }
      },

      // 原子单位：一条记录
      sessions: [],
      // 运行中的计时器（持久化，刷新/关页面也不会丢）
      running: null,

      // Tab 2
      tasks: [],
      drafts: [],                 // 从"接下来我打算做"转来的任务草稿

      // Tab 3
      insights: [],
      anchors: [],
      chats: {},                  // { dayKey: [{role,text,at,produced}] }
      rebuttals: [],              // AI 判断被反驳的记录，永久喂回提示词防止重复

      // 按逻辑日记录的打卡状态
      days: {}
    };
  }

  /* ---------------- 读取 ---------------- */
  function migrate(raw) {
    const base = defaults();
    if (!raw || typeof raw !== 'object') return base;

    const s = Object.assign(base, raw);
    s.meta = Object.assign(base.meta, raw.meta || {});
    s.version = VERSION;

    if (!Array.isArray(s.sessions)) s.sessions = [];
    if (!Array.isArray(s.tasks)) s.tasks = [];
    if (!Array.isArray(s.drafts)) s.drafts = [];
    if (!Array.isArray(s.insights)) s.insights = [];
    if (!Array.isArray(s.anchors)) s.anchors = [];
    if (!s.days || typeof s.days !== 'object') s.days = {};
    if (!s.chats || typeof s.chats !== 'object') s.chats = {};
    if (!Array.isArray(s.rebuttals)) s.rebuttals = [];

    // 清洗观点卡
    s.insights = s.insights
      .filter(function (x) { return x && typeof x === 'object'; })
      .map(function (x) {
        const it = Object.assign({
          id: x.id || U.uid(),
          claim: x.claim || '',
          quote: x.quote || '',
          theme: x.theme || '',
          source: x.source || 'manual',
          status: x.status || 'proposed',
          evidences: Array.isArray(x.evidences) ? x.evidences : [],
          createdAt: x.createdAt || Date.now(),
          lastEvidenceAt: x.lastEvidenceAt || null,
          droppedReason: x.droppedReason || ''
        }, x);
        it.action = Object.assign(
          { text: '', trigger: '', minutes: 20, evidence: '' },
          x.action || {}
        );
        it.evidences = it.evidences.filter(function (e) { return e && e.at; });
        it.evidences.forEach(function (e) {
          if (!e.id) e.id = U.uid();
          if (e.text === undefined) e.text = '';
        });
        return it;
      });

    // 清洗锚点
    s.anchors = s.anchors
      .filter(function (x) { return x && typeof x === 'object'; })
      .map(function (x) {
        return {
          id: x.id || U.uid(),
          kind: x.kind || 'probe',
          title: x.title || '',
          method: x.method || '',
          passCriteria: x.passCriteria || '',
          at: x.at || Date.now(),
          result: x.result || null,
          note: x.note || '',
          minutes: x.minutes || 60
        };
      });

    // 清洗异常记录
    s.sessions = s.sessions.filter(function (x) {
      return x && typeof x.start === 'number' && typeof x.end === 'number' && x.end >= x.start;
    });
    s.sessions.forEach(function (x) {
      if (!x.id) x.id = U.uid();
      if (!x.dayKey) x.dayKey = U.dayKey(x.start, s.meta.dayStartHour);
      if (x.mood === undefined) x.mood = null;
      if (typeof x.backfilled !== 'boolean') x.backfilled = false;
      if (x.taskId === undefined) x.taskId = null;
    });

    // 清洗任务：补齐缺失字段，丢掉无 id 的坏数据
    s.tasks = s.tasks
      .filter(function (t) { return t && typeof t === 'object'; })
      .map(function (t) {
        const d = {
          id: t.id || U.uid(),
          title: t.title || '',
          doneRule: t.doneRule || '',
          estMin: (t.estMin && t.estMin > 0) ? t.estMin : 20,
          trigger: t.trigger || '',
          dayKey: t.dayKey || U.dayKey(t.createdAt || Date.now(), s.meta.dayStartHour),
          status: t.status || 'open',
          createdAt: t.createdAt || Date.now(),
          closedAt: t.closedAt || null,
          deferCount: t.deferCount || 0,
          reason: t.reason || '',
          delta: t.delta || '',
          fromDraftId: t.fromDraftId || null
        };
        return d;
      });

    return s;
  }

  function load() {
    try {
      const raw = storage.get(KEY);
      state = raw ? migrate(JSON.parse(raw)) : defaults();
    } catch (e) {
      console.warn('[store] 读取失败，使用空白数据', e);
      state = defaults();
    }
    dirty = false;
    return state;
  }

  /* ---------------- 写入 ---------------- */
  let saveFailed = false;
  const persistNow = function () {
    try {
      storage.set(KEY, JSON.stringify(state));
      dirty = false;
      saveFailed = false;
    } catch (e) {
      saveFailed = true;
      console.error('[store] 保存失败（可能空间已满）', e);
    }
  };
  const persist = U.debounce(persistNow, 180);

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { console.error(e); }
    });
  }

  /* ---------------- 对外 API ---------------- */
  const Store = {
    get: function () { return state; },

    // 变更数据：fn(state) 里直接改，返回后自动保存并通知
    update: function (fn) {
      const r = fn(state);
      dirty = true;
      persist();
      emit();
      return r;
    },

    // 立即保存（重要节点用，比如关闭页面前）
    flush: function () { if (dirty) persistNow(); },

    /* 存储健康状态——界面据此决定要不要警告"数据不会保存" */
    storageInfo: function () {
      return { persistent: storage.ok, reason: storage.why, failed: saveFailed };
    },

    subscribe: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
    },

    /* ---------- 备份 ---------- */
    exportAll: function () {
      const payload = JSON.parse(JSON.stringify(state));
      payload._exportedAt = new Date().toISOString();
      payload._app = 'life-os';
      U.download('life-os-备份-' + U.dateStr(Date.now()) + '.json',
        JSON.stringify(payload, null, 2), 'application/json');
      Store.update(function (s) { s.meta.lastBackupAt = Date.now(); });
    },

    importAll: function (text) {
      const obj = JSON.parse(text);
      if (!obj || !Array.isArray(obj.sessions)) {
        throw new Error('不是有效的 Life OS 备份文件');
      }
      const next = migrate(obj);
      next.meta.lastOpenedAt = Date.now();
      storage.set(KEY, JSON.stringify(next));
      state = next;
      emit();
      return next;
    },

    /* ---------- 会话 ---------- */
    sessionsOfDay: function (dayKey) {
      return state.sessions
        .filter(function (s) { return s.dayKey === dayKey; })
        .sort(function (a, b) { return a.start - b.start; });
    },

    addSession: function (data) {
      const s = Object.assign({
        id: U.uid(),
        start: Date.now(),
        end: Date.now(),
        tag: 'other',
        title: '',
        note: '',
        plan: '',
        mood: null,
        taskId: null,
        backfilled: false
      }, data);
      s.dayKey = U.dayKey(s.start, state.meta.dayStartHour);
      if (s.end < s.start) s.end = s.start;
      Store.update(function (st) { st.sessions.push(s); });
      return s;
    },

    updateSession: function (id, patch) {
      Store.update(function (st) {
        const s = st.sessions.find(function (x) { return x.id === id; });
        if (!s) return;
        Object.assign(s, patch);
        if (s.end < s.start) s.end = s.start;
        s.dayKey = U.dayKey(s.start, st.meta.dayStartHour);
      });
    },

    removeSession: function (id) {
      Store.update(function (st) {
        st.sessions = st.sessions.filter(function (x) { return x.id !== id; });
      });
    },

    /* ---------- 计时器 ---------- */
    startTimer: function (tag, title, taskId) {
      Store.update(function (st) {
        st.running = {
          start: Date.now(),
          tag: tag || 'other',
          title: title || '',
          taskId: taskId || null
        };
      });
    },

    stopTimer: function () {
      const st = state;
      if (!st.running) return null;
      const r = st.running;
      const end = Date.now();
      Store.update(function (s) { s.running = null; });
      return { start: r.start, end: end, tag: r.tag, title: r.title, taskId: r.taskId, backfilled: false };
    },

    cancelTimer: function () {
      Store.update(function (st) { st.running = null; });
    },

    /* ---------- 每日打卡 ---------- */
    markMinimalDay: function (dayKey, on) {
      Store.update(function (st) {
        if (!st.days[dayKey]) st.days[dayKey] = {};
        st.days[dayKey].minimal = !!on;
      });
    },

    /* ---------- 任务 ---------- */
    todayKey: function () {
      return U.dayKey(Date.now(), state.meta.dayStartHour);
    },

    addTask: function (data) {
      const t = Object.assign({
        id: U.uid(),
        title: '',
        doneRule: '',        // 什么算完成
        estMin: 20,          // 预估耗时（分钟）
        trigger: '',         // 什么时候开始（可选）
        dayKey: Store.todayKey(),
        status: 'open',      // open | done | missed | dropped
        createdAt: Date.now(),
        closedAt: null,
        deferCount: 0,
        reason: '',          // 未完成原因
        delta: '',           // 差在哪 / 为什么超时
        fromDraftId: null
      }, data);
      if (!t.estMin || t.estMin < 1) t.estMin = 20;
      Store.update(function (st) { st.tasks.push(t); });
      return t;
    },

    getTask: function (id) {
      return state.tasks.find(function (t) { return t.id === id; }) || null;
    },

    updateTask: function (id, patch) {
      Store.update(function (st) {
        const t = st.tasks.find(function (x) { return x.id === id; });
        if (t) Object.assign(t, patch);
      });
    },

    removeTask: function (id) {
      Store.update(function (st) {
        st.tasks = st.tasks.filter(function (x) { return x.id !== id; });
      });
    },

    // 某逻辑日的任务（按 dayKey，顺延后 dayKey 会更新到当天）
    tasksOfDay: function (dayKey) {
      return state.tasks
        .filter(function (t) { return t.dayKey === dayKey; })
        .sort(function (a, b) { return a.createdAt - b.createdAt; });
    },

    // 任务的实际耗时（关联记录之和）—— 这是唯一真值，不另填
    taskActualMs: function (taskId) {
      return U.sum(
        state.sessions.filter(function (s) { return s.taskId === taskId; }),
        function (s) { return s.end - s.start; }
      );
    },

    // 跨日顺延：昨天的未闭合任务移到今天，deferCount +1（幂等）
    reconcileTasks: function () {
      const today = Store.todayKey();
      let changed = 0;
      state.tasks.forEach(function (t) {
        if (t.status === 'open' && t.dayKey && t.dayKey < today) {
          t.dayKey = today;
          t.deferCount = (t.deferCount || 0) + 1;
          changed++;
        }
      });
      if (changed) {
        dirty = true;
        persistNow();
        emit();          // 和其他写操作保持一致：改了就通知界面
      }
      return changed;
    },

    /* ---------- 任务草稿（Tab1 → Tab2 的接缝） ---------- */
    addDraft: function (text, fromSessionId) {
      const d = {
        id: U.uid(),
        text: text,
        createdAt: Date.now(),
        dayKey: U.dayKey(Date.now(), state.meta.dayStartHour),
        fromSessionId: fromSessionId || null,
        consumed: false
      };
      Store.update(function (st) { st.drafts.push(d); });
      return d;
    },

    /* ---------- 观点卡（Tab 3） ---------- */
    // 状态：proposed（提出）→ testing（试验中）→ verified（已验证）→ internalized（内化）
    //       另有 dormant（休眠，30 天无证据）、dropped（主动放弃）
    // 证据门槛：3 次独立证据才算内化。前 2 次只是"试验中"。
    addInsight: function (data) {
      const it = Object.assign({
        id: U.uid(),
        claim: '',            // 一句话观点（必须是你的原话）
        quote: '',            // 原始出处 / 原话上下文
        theme: '',            // 主题，用于"这句话你说过 3 次了"检测
        source: 'manual',     // manual | ai | daily
        status: 'proposed',
        action: {
          text: '',
          trigger: '',
          minutes: 20,
          evidence: ''        // 什么算完成
        },
        evidences: [],
        createdAt: Date.now(),
        lastEvidenceAt: null,
        droppedReason: ''
      }, data);
      if (!it.evidences) it.evidences = [];
      Store.update(function (st) { st.insights.push(it); });
      return it;
    },

    getInsight: function (id) {
      return state.insights.find(function (x) { return x.id === id; }) || null;
    },

    updateInsight: function (id, patch) {
      Store.update(function (st) {
        const it = st.insights.find(function (x) { return x.id === id; });
        if (!it) return;
        if (patch.action) {
          it.action = Object.assign({}, it.action || {}, patch.action);
          delete patch.action;
        }
        Object.assign(it, patch);
      });
    },

    removeInsight: function (id) {
      Store.update(function (st) {
        st.insights = st.insights.filter(function (x) { return x.id !== id; });
      });
    },

    addEvidence: function (insightId, data) {
      const ev = Object.assign({
        id: U.uid(),
        at: Date.now(),
        text: '',
        taskId: null,
        sessionId: null
      }, data);

      Store.update(function (st) {
        const it = st.insights.find(function (x) { return x.id === insightId; });
        if (!it) return;
        if (!it.evidences) it.evidences = [];
        it.evidences.push(ev);
        it.lastEvidenceAt = ev.at;

        // 状态完全由证据数推导（和 removeEvidence 同一套规则）
        if (it.status === 'dropped') return;
        const n = it.evidences.length;
        it.status = n >= 3 ? 'internalized' : n === 2 ? 'verified' : n === 1 ? 'testing' : 'proposed';
      });
      return ev;
    },

    removeEvidence: function (insightId, evidenceId) {
      Store.update(function (st) {
        const it = st.insights.find(function (x) { return x.id === insightId; });
        if (!it || !it.evidences) return;
        it.evidences = it.evidences.filter(function (e) { return e.id !== evidenceId; });

        // 状态完全由证据数推导。只有「已放弃」是终态，不参与回退。
        if (it.status === 'dropped') return;
        const n = it.evidences.length;
        it.status = n >= 3 ? 'internalized' : n === 2 ? 'verified' : n === 1 ? 'testing' : 'proposed';
      });
    },

    // 同主题出现次数（用于防观点通胀）
    themeCount: function (theme) {
      if (!theme) return 0;
      return state.insights.filter(function (x) {
        return x.theme && x.theme === theme && x.status !== 'dropped';
      }).length;
    },

    // 落地率 = 有证据的观点 / 提出的观点（不含主动放弃）
    landingRate: function () {
      const live = state.insights.filter(function (x) { return x.status !== 'dropped'; });
      if (!live.length) return { rate: null, withEvidence: 0, total: 0 };
      const withEv = live.filter(function (x) {
        return x.evidences && x.evidences.length > 0;
      }).length;
      return { rate: withEv / live.length, withEvidence: withEv, total: live.length };
    },

    // 30 天无证据 → 标记休眠
    sweepInsights: function () {
      const cutoff = Date.now() - 30 * 86400000;
      let changed = 0;
      state.insights.forEach(function (it) {
        if (it.status === 'dropped' || it.status === 'dormant' || it.status === 'internalized') return;
        const last = it.lastEvidenceAt || (it.evidences && it.evidences.length
          ? Math.max.apply(null, it.evidences.map(function (e) { return e.at; }))
          : it.createdAt);
        if (last < cutoff) {
          it.status = 'dormant';
          changed++;
        }
      });
      if (changed) { dirty = true; persistNow(); emit(); }
      return changed;
    },

    /* ---------- 结果锚点（Tab 3） ----------
       锚点不是评分，是校准：连续两次不通过 → 该改方法，不是更努力。
       永远不改判，永远不进段位。 */
    addAnchor: function (data) {
      const a = Object.assign({
        id: U.uid(),
        kind: 'probe',        // baseline | probe
        title: '',
        method: '',           // 怎么测
        passCriteria: '',     // 通过标准
        at: Date.now(),
        result: null,         // pass | fail | partial
        note: '',
        minutes: 60
      }, data);
      Store.update(function (st) { st.anchors.push(a); });
      return a;
    },

    updateAnchor: function (id, patch) {
      Store.update(function (st) {
        const a = st.anchors.find(function (x) { return x.id === id; });
        if (a) Object.assign(a, patch);
      });
    },

    removeAnchor: function (id) {
      Store.update(function (st) {
        st.anchors = st.anchors.filter(function (x) { return x.id !== id; });
      });
    },

    hasBaseline: function () {
      return state.anchors.some(function (a) { return a.kind === 'baseline'; });
    },

    // 距离上次锚点多少天（没有任何锚点返回 null）
    daysSinceAnchor: function () {
      if (!state.anchors.length) return null;
      const last = Math.max.apply(null, state.anchors.map(function (a) { return a.at; }));
      return Math.floor((Date.now() - last) / 86400000);
    },

    /* ---------- 反驳（Tab 3） ---------- */
    addRebuttal: function (data) {
      const r = Object.assign({
        id: U.uid(),
        at: Date.now(),
        text: '',         // 他为什么不同意
        judgment: ''      // 被反驳的那条 AI 判断（可选）
      }, data);
      Store.update(function (st) {
        if (!Array.isArray(st.rebuttals)) st.rebuttals = [];
        st.rebuttals.push(r);
      });
      return r;
    },

    removeRebuttal: function (id) {
      Store.update(function (st) {
        st.rebuttals = (st.rebuttals || []).filter(function (x) { return x.id !== id; });
      });
    },

    /* ---------- AI 配置 ---------- */
    setAI: function (cfg) {
      Store.update(function (st) {
        st.meta.ai = Object.assign({
          enabled: false,
          baseUrl: '',
          model: '',
          apiKey: ''
        }, st.meta.ai || {}, cfg);
      });
    },

    /* ---------- 统计 ---------- */
    statsOfDay: function (dayKey) {
      const list = Store.sessionsOfDay(dayKey);
      const total = U.sum(list, function (s) { return s.end - s.start; });
      const moods = list.map(function (s) { return s.mood; }).filter(function (m) { return m != null; });
      const byTag = {};
      list.forEach(function (s) {
        byTag[s.tag] = (byTag[s.tag] || 0) + (s.end - s.start);
      });
      const realtime = list.filter(function (s) { return !s.backfilled; }).length;
      return {
        list: list,
        count: list.length,
        total: total,
        avgMood: moods.length ? U.sum(moods) / moods.length : null,
        byTag: byTag,
        realtimeRate: list.length ? realtime / list.length : null,
        checked: !!(state.days[dayKey] && state.days[dayKey].minimal)
      };
    },

    resetAll: function () {
      try { storage.del(KEY); } catch (e) { /* 内存模式也允许清空 */ }
      state = defaults();
      emit();
    }
  };

  // 跨标签页同步
  w.addEventListener('storage', function (e) {
    if (e.key !== KEY || !e.newValue) return;
    try {
      state = migrate(JSON.parse(e.newValue));
      emit();
    } catch (err) { /* ignore */ }
  });

  // 关闭前落盘
  w.addEventListener('beforeunload', function () { Store.flush(); });
  w.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') Store.flush();
  });

  load();

  w.Store = Store;
})(window);
