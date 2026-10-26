/* ============================================================
   Life OS · 存储层
   - 单一版本化数据结构
   - 每个模块只写自己的命名空间
   - 第一天就支持 导出 / 导入 全量备份
   ============================================================ */
(function (w) {

  const KEY = 'lifeos_v1';
  const BACKUP_KEY = 'lifeos_v1_backup';
  const CORRUPT_KEY = 'lifeos_v1_corrupt';
  const SNAPSHOT_PREFIX = 'lifeos_v1_snapshot_';
  const SNAPSHOT_LIMIT = 6;
  const VERSION = 1;

  let state = null;
  let listeners = [];
  let dirty = false;
  let loadIssue = '';
  let recoveredFromBackup = false;
  let recoveredFrom = '';

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
               del: function (k) { w.localStorage.removeItem(k); },
               keys: function () {
                 const out = [];
                 for (let i = 0; i < w.localStorage.length; i++) {
                   const key = w.localStorage.key(i);
                   if (key) out.push(key);
                 }
                 return out;
               } };
    } catch (e) {
      const mem = {};
      return {
        ok: false,
        why: (e && e.name) || 'blocked',
        get: function (k) { return (k in mem) ? mem[k] : null; },
        set: function (k, v) { mem[k] = String(v); },
        del: function (k) { delete mem[k]; },
        keys: function () { return Object.keys(mem); }
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
      weeklyReviews: {},          // { weekKey: {focus, updatedAt} }

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
    if (!s.weeklyReviews || typeof s.weeklyReviews !== 'object') s.weeklyReviews = {};

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
          falsifier: x.falsifier || '',
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
          if (e.stance !== 'counter' && e.stance !== 'unclear') e.stance = 'support';
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
      if (x.stopReason === undefined) x.stopReason = null;
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
          fromDraftId: t.fromDraftId || null,
          insightId: t.insightId || null
        };
        return d;
      });

    return s;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function snapshotKeys() {
    return storage.keys()
      .filter(function (key) { return key.indexOf(SNAPSHOT_PREFIX) === 0; });
  }

  function snapshotDay(key) {
    const suffix = key.slice(SNAPSHOT_PREFIX.length);
    return /^\d{4}-\d{2}-\d{2}$/.test(suffix) ? suffix : '';
  }

  function snapshotPreImportAt(key) {
    const marker = '_pre_import_';
    const index = key.indexOf(marker);
    return index < 0 ? 0 : Number(key.slice(index + marker.length)) || 0;
  }

  function snapshotOrder(key) {
    const day = snapshotDay(key);
    if (day) {
      // 当天正常快照代表最后一次成功保存，应排在导入前保护快照之前。
      return U.keyToDate(day).getTime() + 86399999;
    }
    return snapshotPreImportAt(key);
  }

  function cleanupSnapshots() {
    snapshotKeys().sort(function (a, b) {
      return snapshotOrder(b) - snapshotOrder(a);
    }).slice(SNAPSHOT_LIMIT).forEach(function (key) {
      try { storage.del(key); } catch (e) { /* 清理失败不影响主数据 */ }
    });
  }

  function recoverySnapshotKeys() {
    const keys = snapshotKeys();
    const daily = keys.filter(function (key) {
      return !!snapshotDay(key);
    }).sort(function (a, b) {
      return snapshotDay(b).localeCompare(snapshotDay(a));
    });
    const preImport = keys.filter(function (key) {
      return !snapshotDay(key) && snapshotPreImportAt(key) > 0;
    }).sort(function (a, b) {
      return snapshotPreImportAt(b) - snapshotPreImportAt(a);
    });
    return daily.concat(preImport);
  }

  function readState(raw, label) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sessions)) {
      throw new Error(label + '格式不完整');
    }
    return migrate(parsed);
  }

  function load() {
    const primaryRaw = storage.get(KEY);

    try {
      if (primaryRaw) {
        state = readState(primaryRaw, '主数据');
        recoveredFrom = 'main';
        return state;
      }
    } catch (e) {
      loadIssue = (e && e.message) || '主数据无法读取';
      console.warn('[store] 主数据读取失败，尝试恢复快照', e);
      try { storage.set(CORRUPT_KEY, primaryRaw); } catch (ignore) { /* 空间不足时不影响恢复 */ }
    }

    const keys = recoverySnapshotKeys();
    for (let i = 0; i < keys.length; i++) {
      try {
        state = readState(storage.get(keys[i]), '每日快照');
        recoveredFromBackup = true;
        recoveredFrom = keys[i];
        console.warn('[store] 已从每日快照恢复：' + keys[i]);
        return state;
      } catch (e) {
        loadIssue = loadIssue || (e && e.message) || '每日快照无法读取';
      }
    }

    try {
      const backupRaw = storage.get(BACKUP_KEY);
      if (backupRaw) {
        state = readState(backupRaw, '旧版恢复快照');
        recoveredFromBackup = true;
        recoveredFrom = BACKUP_KEY;
        console.warn('[store] 已从旧版恢复快照恢复');
        return state;
      }
    } catch (e) {
      loadIssue = loadIssue || (e && e.message) || '恢复快照无法读取';
      console.warn('[store] 恢复快照读取失败，使用空白数据', e);
    }

    if (!primaryRaw) {
      state = defaults();
    } else {
      state = defaults();
    }
    dirty = false;
    return state;
  }

  /* ---------------- 写入 ---------------- */
  let saveFailed = false;
  let saveError = '';
  let lastSavedAt = null;

  function writeSnapshot(next) {
    const json = JSON.stringify(next);
    storage.set(KEY, json);

    // Safari / 隐私模式偶尔会“静默拒绝”写入，读回校验比只看异常可靠。
    if (storage.get(KEY) !== json) {
      throw new Error('浏览器没有真正写入数据');
    }

    try {
      const hour = next.meta && next.meta.dayStartHour != null ? next.meta.dayStartHour : 4;
      const dayKey = U.dayKey(Date.now(), hour);
      cleanupSnapshots();
      storage.set(SNAPSHOT_PREFIX + dayKey, json);
      cleanupSnapshots();
      // 保留旧键，方便旧版本页面回退时不至于找不到恢复数据。
      storage.set(BACKUP_KEY, json);
    } catch (e) {
      // 主数据已经写入成功；快照失败不应把这次正常保存误报为失败。
      console.warn('[store] 恢复快照写入失败', e);
    }
  }

  const persistNow = function () {
    const wasFailed = saveFailed;
    try {
      writeSnapshot(state);
      dirty = false;
      saveFailed = false;
      saveError = '';
      lastSavedAt = Date.now();
    } catch (e) {
      saveFailed = true;
      saveError = (e && e.message) || '未知写入错误';
      console.error('[store] 保存失败（可能空间已满）', e);
    }
    if (wasFailed !== saveFailed) emit();
  };
  const persist = U.debounce(persistNow, 180);

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { console.error(e); }
    });
  }

  function parseBackup(input) {
    let obj = typeof input === 'string' ? JSON.parse(input) : clone(input);
    if (obj && obj.format === 'lifeos-cloud-v1' && obj.state) obj = obj.state;
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.sessions)) {
      throw new Error('不是有效的 Life OS 备份文件');
    }
    return {
      source: obj,
      state: migrate(obj),
      exportedAt: obj._exportedAt || obj.exportedAt || null
    };
  }

  function recordStamp(record) {
    if (!record || typeof record !== 'object') return 0;
    return Math.max(
      Number(record.end) || 0,
      Number(record.closedAt) || 0,
      Number(record.updatedAt) || 0,
      Number(record.lastEvidenceAt) || 0,
      Number(record.at) || 0,
      Number(record.createdAt) || 0,
      Number(record.start) || 0
    );
  }

  function mergeObjectMaps(current, incoming) {
    const out = clone(current || {});
    Object.keys(incoming || {}).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) {
        out[key] = clone(incoming[key]);
      }
    });
    return out;
  }

  function mergeUpdatedObjectMaps(current, incoming) {
    const out = clone(current || {});
    Object.keys(incoming || {}).forEach(function (key) {
      const existing = out[key];
      const candidate = incoming[key];
      if (!existing || (Number(candidate && candidate.updatedAt) || 0) >
          (Number(existing && existing.updatedAt) || 0)) {
        out[key] = clone(candidate);
      }
    });
    return out;
  }

  function mergeChatMaps(current, incoming) {
    const out = clone(current || {});
    Object.keys(incoming || {}).forEach(function (dayKey) {
      if (!Object.prototype.hasOwnProperty.call(out, dayKey)) {
        out[dayKey] = clone(incoming[dayKey]);
        return;
      }
      const list = Array.isArray(out[dayKey]) ? out[dayKey] : [];
      const extra = Array.isArray(incoming[dayKey]) ? incoming[dayKey] : [];
      const seen = {};
      list.concat(extra).forEach(function (msg) {
        const key = msg && msg.id
          ? String(msg.id)
          : [msg && msg.at, msg && msg.role, msg && msg.text].join('|');
        if (!seen[key]) {
          seen[key] = true;
          list.push(msg);
        }
      });
      out[dayKey] = list.sort(function (a, b) {
        return (Number(a && a.at) || 0) - (Number(b && b.at) || 0);
      });
    });
    return out;
  }

  function mergeInsight(current, incoming) {
    const out = Object.assign({}, clone(incoming || {}), clone(current || {}));
    out.action = Object.assign(
      { text: '', trigger: '', minutes: 20, evidence: '' },
      incoming && incoming.action || {},
      current && current.action || {}
    );
    out.falsifier = (current && current.falsifier) || (incoming && incoming.falsifier) || '';

    const evidenceMap = {};
    const evidence = [];
    [current, incoming].forEach(function (item) {
      ((item && item.evidences) || []).forEach(function (ev) {
        const key = ev && ev.id
          ? String(ev.id)
          : [ev && ev.at, ev && ev.stance, ev && ev.text].join('|');
        if (!key || evidenceMap[key]) return;
        evidenceMap[key] = true;
        evidence.push(clone(ev));
      });
    });
    out.evidences = evidence.sort(function (a, b) {
      return (Number(a && a.at) || 0) - (Number(b && b.at) || 0);
    });
    if (out.status !== 'dropped') {
      const support = out.evidences.filter(function (ev) {
        return (ev.stance || 'support') === 'support';
      }).length;
      out.status = support >= 3 ? 'internalized'
        : support === 2 ? 'verified'
          : support === 1 ? 'testing'
            : 'proposed';
    }
    if (out.evidences.length) {
      out.lastEvidenceAt = Math.max.apply(null, out.evidences.map(function (ev) {
        return Number(ev.at) || 0;
      }));
    }
    return out;
  }

  function mergeList(currentList, incomingList, field) {
    const out = Array.isArray(currentList) ? clone(currentList) : [];
    const seen = {};
    out.forEach(function (record, index) {
      const key = record && record.id ? String(record.id) : 'index:' + index;
      seen[key] = index;
    });

    (Array.isArray(incomingList) ? incomingList : []).forEach(function (record, index) {
      const key = record && record.id ? String(record.id) : 'incoming:' + index;
      if (!Object.prototype.hasOwnProperty.call(seen, key)) {
        seen[key] = out.length;
        out.push(clone(record));
        return;
      }
      if (field === 'insights') {
        out[seen[key]] = mergeInsight(out[seen[key]], record);
      } else if (recordStamp(record) > recordStamp(out[seen[key]])) {
        // 同一 id 只在导入记录明显更新时替换；其他冲突保留本机版本。
        out[seen[key]] = clone(record);
      }
    });
    return out;
  }

  function commitImported(next, label) {
    const before = JSON.stringify(state);
    try {
      try {
        const hour = state.meta && state.meta.dayStartHour != null ? state.meta.dayStartHour : 4;
        const dayKey = U.dayKey(Date.now(), hour);
        storage.set(SNAPSHOT_PREFIX + dayKey + '_pre_import_' + Date.now(), before);
      } catch (snapshotError) {
        console.warn('[store] 导入前快照写入失败，继续执行受保护的导入', snapshotError);
      }
      writeSnapshot(next);
    } catch (e) {
      try { storage.set(KEY, before); } catch (ignore) { /* 保留内存中的原数据 */ }
      throw e;
    }
    state = next;
    dirty = false;
    saveFailed = false;
    saveError = '';
    lastSavedAt = Date.now();
    recoveredFromBackup = false;
    recoveredFrom = 'main';
    emit();
    return label;
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
      return {
        persistent: storage.ok,
        reason: storage.why,
        failed: saveFailed,
        saveError: saveError,
        lastSavedAt: lastSavedAt,
        recovered: recoveredFromBackup,
        recoveredFrom: recoveredFrom,
        loadIssue: loadIssue,
        bytes: (function () {
          try { return JSON.stringify(state || {}).length; } catch (e) { return 0; }
        })(),
        snapshots: snapshotKeys().length
      };
    },

    subscribe: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
    },

    /* ---------- 备份 ---------- */
    exportAll: function () {
      const payload = JSON.parse(JSON.stringify(state));
      // API Key 只属于当前浏览器，不进入可分享的备份文件。
      if (payload.meta && payload.meta.ai) payload.meta.ai.apiKey = '';
      payload._exportedAt = new Date().toISOString();
      payload._app = 'life-os';
      payload._secretsExcluded = true;
      U.download('life-os-备份-' + U.dateStr(Date.now()) + '.json',
        JSON.stringify(payload, null, 2), 'application/json');
      Store.update(function (s) { s.meta.lastBackupAt = Date.now(); });
    },

    parseBackup: function (input) {
      return parseBackup(input);
    },

    previewImport: function (input) {
      const parsed = parseBackup(input);
      return {
        exportedAt: parsed.exportedAt,
        sessions: parsed.state.sessions.length,
        tasks: parsed.state.tasks.length,
        insights: parsed.state.insights.length,
        anchors: parsed.state.anchors.length,
        chats: Object.keys(parsed.state.chats || {}).length,
        current: {
          sessions: state.sessions.length,
          tasks: state.tasks.length,
          insights: state.insights.length,
          anchors: state.anchors.length
        }
      };
    },

    /* 默认导入只合并，绝不删除本机或云端已有记录。 */
    mergeImport: function (input) {
      const parsed = parseBackup(input);
      const incoming = parsed.state;
      const next = clone(state);
      next.meta = Object.assign({}, incoming.meta || {}, state.meta || {});
      next.meta.ai = Object.assign(
        {},
        incoming.meta && incoming.meta.ai || {},
        state.meta && state.meta.ai || {}
      );
      next.meta.lastOpenedAt = Date.now();
      next.sessions = mergeList(state.sessions, incoming.sessions, 'sessions');
      next.tasks = mergeList(state.tasks, incoming.tasks, 'tasks');
      next.drafts = mergeList(state.drafts, incoming.drafts, 'drafts');
      next.insights = mergeList(state.insights, incoming.insights, 'insights');
      next.anchors = mergeList(state.anchors, incoming.anchors, 'anchors');
      next.rebuttals = mergeList(state.rebuttals, incoming.rebuttals, 'rebuttals');
      next.days = mergeObjectMaps(state.days, incoming.days);
      next.chats = mergeChatMaps(state.chats, incoming.chats);
      next.weeklyReviews = mergeUpdatedObjectMaps(state.weeklyReviews, incoming.weeklyReviews);
      next.running = state.running || clone(incoming.running);

      const before = {
        sessions: state.sessions.length,
        tasks: state.tasks.length,
        insights: state.insights.length,
        anchors: state.anchors.length
      };
      commitImported(migrate(next), 'merge');
      return {
        mode: 'merge',
        added: {
          sessions: state.sessions.length - before.sessions,
          tasks: state.tasks.length - before.tasks,
          insights: state.insights.length - before.insights,
          anchors: state.anchors.length - before.anchors
        },
        snapshot: recoveredFrom
      };
    },

    /* 只有用户明确选择“完整替换”时才调用。 */
    replaceAll: function (input) {
      const parsed = parseBackup(input);
      const next = parsed.state;
      const currentKey = state.meta && state.meta.ai && state.meta.ai.apiKey;
      if (!next.meta.ai.apiKey && currentKey) next.meta.ai.apiKey = currentKey;
      next.meta.lastOpenedAt = Date.now();
      commitImported(migrate(next), 'replace');
      return { mode: 'replace', snapshot: recoveredFrom };
    },

    importAll: function (input) {
      return Store.mergeImport(input);
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
        stopReason: null,
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
        fromDraftId: null,
        insightId: null      // 由观点卡转来的任务，用于行动闭环统计
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
        stance: 'support',
        taskId: null,
        sessionId: null
      }, data);
      if (ev.stance !== 'counter' && ev.stance !== 'unclear') ev.stance = 'support';

      Store.update(function (st) {
        const it = st.insights.find(function (x) { return x.id === insightId; });
        if (!it) return;
        if (!it.evidences) it.evidences = [];
        it.evidences.push(ev);
        it.lastEvidenceAt = ev.at;

        // 只有支持证据推进状态；反证和“说不清”会保留，但不算支持次数。
        if (it.status === 'dropped') return;
        const n = it.evidences.filter(function (x) {
          return (x.stance || 'support') === 'support';
        }).length;
        it.status = n >= 3 ? 'internalized' : n === 2 ? 'verified' : n === 1 ? 'testing' : 'proposed';
      });
      return ev;
    },

    removeEvidence: function (insightId, evidenceId) {
      Store.update(function (st) {
        const it = st.insights.find(function (x) { return x.id === insightId; });
        if (!it || !it.evidences) return;
        it.evidences = it.evidences.filter(function (e) { return e.id !== evidenceId; });

        // 状态完全由支持证据数推导。只有「已放弃」是终态，不参与回退。
        if (it.status === 'dropped') return;
        const n = it.evidences.filter(function (x) {
          return (x.stance || 'support') === 'support';
        }).length;
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

    // 参考指标：有支持证据的观点 / 仍在进行的观点。它不是唯一指标。
    landingRate: function () {
      const live = state.insights.filter(function (x) { return x.status !== 'dropped'; });
      if (!live.length) return { rate: null, withEvidence: 0, total: 0 };
      const withEv = live.filter(function (x) {
        return (x.evidences || []).some(function (ev) {
          return (ev.stance || 'support') === 'support';
        });
      }).length;
      return { rate: withEv / live.length, withEvidence: withEv, total: live.length };
    },

    actionLoop: function () {
      const live = state.insights.filter(function (x) { return x.status !== 'dropped'; });
      const support = state.insights.reduce(function (n, it) {
        return n + (it.evidences || []).filter(function (ev) {
          return (ev.stance || 'support') === 'support';
        }).length;
      }, 0);
      const counter = state.insights.reduce(function (n, it) {
        return n + (it.evidences || []).filter(function (ev) {
          return ev.stance === 'counter';
        }).length;
      }, 0);
      return {
        withAction: live.filter(function (it) {
          return it.action && it.action.text;
        }).length,
        convertedToTask: live.filter(function (it) {
          return it.action && it.action.taskId;
        }).length,
        completedTasks: state.tasks.filter(function (task) {
          return task.insightId && task.status === 'done';
        }).length,
        support: support,
        counter: counter,
        dropped: state.insights.filter(function (it) { return it.status === 'dropped'; }).length
      };
    },

    getWeeklyReview: function (weekKey) {
      return state.weeklyReviews && state.weeklyReviews[weekKey]
        ? state.weeklyReviews[weekKey]
        : null;
    },

    saveWeeklyReview: function (weekKey, focus) {
      const entry = {
        focus: String(focus || '').trim(),
        updatedAt: Date.now()
      };
      Store.update(function (st) {
        if (!st.weeklyReviews || typeof st.weeklyReviews !== 'object') {
          st.weeklyReviews = {};
        }
        st.weeklyReviews[weekKey] = entry;
      });
      return entry;
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
      try {
        snapshotKeys().forEach(function (key) { storage.del(key); });
        storage.del(KEY);
        storage.del(BACKUP_KEY);
      } catch (e) { /* 内存模式也允许清空 */ }
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
