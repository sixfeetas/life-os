/* ============================================================
   Life OS · Supabase 自动同步
   - 本地数据始终优先保存，断网不影响使用
   - 同一账号在电脑 / 手机间自动合并
   - AI API Key 只留在本机，绝不上传
   ============================================================ */
(function (w) {
  'use strict';

  const SUPABASE_URL = 'https://qgjmouupwzyfvxoyiyxm.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnam1vdXVwd3p5ZnZ4b3lpeXhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5ODc3MzIsImV4cCI6MjEwODU2MzczMn0.ZoIOTKAXqTvwKDIHTonAu2Q6HVSrHzpDwRRMui4lmIA';
  const AUTH_KEY = 'lifeos_cloud_auth_v1';
  const META_PREFIX = 'lifeos_cloud_meta_v1_';
  const TABLE = '/rest/v1/lifeos_state';

  const LIST_FIELDS = ['sessions', 'tasks', 'drafts', 'insights', 'anchors', 'rebuttals'];
  const OBJECT_FIELDS = ['days', 'chats'];

  const SETUP_SQL = [
    'create table if not exists public.lifeos_state (',
    '  user_id uuid primary key references auth.users(id) on delete cascade,',
    '  payload jsonb not null,',
    '  revision bigint not null default 1,',
    '  updated_at timestamptz not null default now()',
    ');',
    '',
    'alter table public.lifeos_state enable row level security;',
    '',
    'drop policy if exists "read own lifeos state" on public.lifeos_state;',
    'create policy "read own lifeos state"',
    'on public.lifeos_state for select',
    'using (auth.uid() = user_id);',
    '',
    'drop policy if exists "insert own lifeos state" on public.lifeos_state;',
    'create policy "insert own lifeos state"',
    'on public.lifeos_state for insert',
    'with check (auth.uid() = user_id);',
    '',
    'drop policy if exists "update own lifeos state" on public.lifeos_state;',
    'create policy "update own lifeos state"',
    'on public.lifeos_state for update',
    'using (auth.uid() = user_id)',
    'with check (auth.uid() = user_id);',
    '',
    'revoke all on public.lifeos_state from anon;',
    'grant select, insert, update on public.lifeos_state to authenticated;'
  ].join('\n');

  let auth = readJson(w.localStorage, AUTH_KEY);
  let cloudMeta = emptyMeta();
  let previous = null;
  let started = false;
  let applying = false;
  let changeSeq = 0;
  let debounceTimer = null;
  let inflight = null;
  let refreshPromise = null;
  let onStatus = null;
  let onApplied = null;

  const status = {
    signedIn: !!(auth && auth.access_token && auth.user && auth.user.id),
    email: auth && auth.user ? auth.user.email || '' : '',
    userId: auth && auth.user ? auth.user.id || '' : '',
    phase: auth ? 'idle' : 'signed-out',
    lastSyncedAt: null,
    error: '',
    setupRequired: false,
    pending: false
  };

  function readJson(storage, key) {
    try {
      const raw = storage && storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeJson(storage, key, value) {
    try {
      if (value == null) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[cloud] 本机同步状态写入失败', e);
      return false;
    }
  }

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function emptyMeta() {
    return { stamps: {}, tombstones: {} };
  }

  function metaKey(userId) {
    return META_PREFIX + userId;
  }

  function saveMeta() {
    if (auth && auth.user && auth.user.id) {
      writeJson(w.localStorage, metaKey(auth.user.id), cloudMeta);
    }
  }

  function loadMeta() {
    cloudMeta = emptyMeta();
    if (!auth || !auth.user || !auth.user.id) return;
    const saved = readJson(w.localStorage, metaKey(auth.user.id));
    if (saved && typeof saved === 'object') {
      cloudMeta.stamps = saved.stamps && typeof saved.stamps === 'object' ? saved.stamps : {};
      cloudMeta.tombstones = saved.tombstones && typeof saved.tombstones === 'object'
        ? saved.tombstones
        : {};
    }
  }

  function saveAuth() {
    writeJson(w.localStorage, AUTH_KEY, auth);
  }

  function setAuth(data) {
    if (!data || !data.access_token || !data.user) {
      throw new Error('登录没有返回有效账号');
    }
    auth = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || '',
      token_type: data.token_type || 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
      user: {
        id: data.user.id,
        email: data.user.email || ''
      }
    };
    saveAuth();
    status.signedIn = true;
    status.email = auth.user.email;
    status.userId = auth.user.id;
    loadMeta();
  }

  function clearAuth() {
    auth = null;
    writeJson(w.localStorage, AUTH_KEY, null);
    cloudMeta = emptyMeta();
    status.signedIn = false;
    status.email = '';
    status.userId = '';
    status.phase = 'signed-out';
    status.pending = false;
    status.error = '';
    emitStatus();
  }

  function emitStatus() {
    if (typeof onStatus === 'function') {
      try { onStatus(getStatus()); } catch (e) { console.error(e); }
    }
  }

  function setStatus(patch) {
    Object.assign(status, patch || {});
    emitStatus();
  }

  function translation(message, code) {
    const m = String(message || '');
    if (code === 'PGRST205' || /Could not find the table|schema cache/i.test(m)) {
      status.setupRequired = true;
      return '同步数据库还没建好';
    }
    if (/Invalid login credentials/i.test(m)) return '邮箱或密码不正确';
    if (/Email not confirmed/i.test(m)) return '邮箱还没有确认，请先去邮箱点确认链接';
    if (/User already registered/i.test(m)) return '这个邮箱已经注册过，请直接登录';
    if (/Password should be at least/i.test(m)) return '密码至少需要 6 位';
    if (/Unable to validate email address/i.test(m)) return '邮箱格式不正确';
    if (/For security purposes/i.test(m)) return '操作太频繁，请稍等一会儿再试';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return '连不上同步服务，请检查网络';
    return m || '同步服务返回了错误';
  }

  function httpError(body, response) {
    const err = new Error(
      body && (body.msg || body.message || body.error_description || body.error)
        ? (body.msg || body.message || body.error_description || body.error)
        : '请求失败'
    );
    err.status = response.status;
    err.code = body && body.code;
    return err;
  }

  async function rawRequest(path, options) {
    const response = await fetch(SUPABASE_URL + path, Object.assign({
      cache: 'no-store'
    }, options || {}));
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch (e) { body = text; }
    }
    if (!response.ok) throw httpError(body, response);
    return body;
  }

  function authRequest(path, payload) {
    return rawRequest(path, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  }

  function tokenIsFresh() {
    if (!auth || !auth.access_token) return false;
    if (!auth.expires_at) return true;
    return Number(auth.expires_at) * 1000 > Date.now() + 90000;
  }

  async function refreshAccess(force) {
    if (!auth || !auth.refresh_token) throw new Error('登录已过期，请重新登录');
    if (!force && tokenIsFresh()) return;
    if (refreshPromise) return refreshPromise;
    refreshPromise = authRequest('/auth/v1/token?grant_type=refresh_token', {
      refresh_token: auth.refresh_token
    }).then(function (data) {
      setAuth(data);
    }).catch(function (err) {
      clearAuth();
      throw new Error(translation(err.message, err.code));
    }).finally(function () {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function restRequest(path, options, retried) {
    if (!auth) throw new Error('请先登录同步账号');
    if (!tokenIsFresh()) await refreshAccess(true);

    const headers = Object.assign({
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + auth.access_token,
      'Content-Type': 'application/json'
    }, options && options.headers ? options.headers : {});

    const response = await fetch(SUPABASE_URL + path, Object.assign({ cache: 'no-store' }, options, {
      headers: headers
    }));
    if (response.status === 401 && !retried) {
      await refreshAccess(true);
      return restRequest(path, options, true);
    }
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch (e) { body = text; }
    }
    if (!response.ok) throw httpError(body, response);
    return body;
  }

  function recordTime(record) {
    if (!record || typeof record !== 'object') return 0;
    const keys = [
      'updatedAt', 'modifiedAt', 'closedAt', 'lastEvidenceAt', 'createdAt',
      'at', 'start', 'end'
    ];
    let latest = 0;
    keys.forEach(function (key) {
      const n = Number(record[key]);
      if (isFinite(n) && n > latest) latest = n;
    });
    if (Array.isArray(record.evidences)) {
      record.evidences.forEach(function (ev) {
        const n = Number(ev && ev.at);
        if (isFinite(n) && n > latest) latest = n;
      });
    }
    return latest;
  }

  function recordId(record) {
    if (!record || typeof record !== 'object') return '';
    return String(record.id || record.createdAt || record.at || '');
  }

  function recordMap(list) {
    const map = {};
    (Array.isArray(list) ? list : []).forEach(function (record) {
      const id = recordId(record);
      if (id) map[id] = record;
    });
    return map;
  }

  function signature(value) {
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }

  function infoSize(value) {
    return signature(value).length;
  }

  function maxStamp(a, b) {
    const na = Number(a) || 0;
    const nb = Number(b) || 0;
    return Math.max(na, nb);
  }

  function seedStamps(state) {
    if (!state || typeof state !== 'object') return;
    LIST_FIELDS.forEach(function (field) {
      (Array.isArray(state[field]) ? state[field] : []).forEach(function (record) {
        const key = field + '|' + recordId(record);
        if (!cloudMeta.stamps[key]) cloudMeta.stamps[key] = recordTime(record) || 0;
      });
    });
    OBJECT_FIELDS.forEach(function (field) {
      const obj = state[field] && typeof state[field] === 'object' ? state[field] : {};
      Object.keys(obj).forEach(function (key) {
        const stampKey = field + '|' + key;
        if (!cloudMeta.stamps[stampKey]) {
          const records = Array.isArray(obj[key]) ? obj[key] : [obj[key]];
          cloudMeta.stamps[stampKey] = records.reduce(function (n, item) {
            return Math.max(n, recordTime(item));
          }, 0);
        }
      });
    });
    if (state.running && !cloudMeta.stamps['running|running']) {
      cloudMeta.stamps['running|running'] = recordTime(state.running);
    }
    if (!cloudMeta.stamps['meta|core']) {
      cloudMeta.stamps['meta|core'] = recordTime(state.meta) || Number(state.meta && state.meta.createdAt) || 0;
    }
  }

  function metaCore(state) {
    const meta = state && state.meta ? state.meta : {};
    const ai = meta.ai || {};
    return {
      dayStartHour: meta.dayStartHour,
      createdAt: meta.createdAt,
      onboarded: meta.onboarded,
      ai: {
        enabled: !!ai.enabled,
        baseUrl: ai.baseUrl || '',
        model: ai.model || ''
      }
    };
  }

  function observeChanges(state) {
    if (!started || applying || !previous) return;
    const now = Date.now();
    let changed = false;

    LIST_FIELDS.forEach(function (field) {
      const oldMap = recordMap(previous[field]);
      const newMap = recordMap(state[field]);
      Object.keys(newMap).forEach(function (id) {
        const key = field + '|' + id;
        if (!oldMap[id] || signature(oldMap[id]) !== signature(newMap[id])) {
          cloudMeta.stamps[key] = now;
          changed = true;
        }
      });
      Object.keys(oldMap).forEach(function (id) {
        if (!newMap[id]) {
          const key = field + '|' + id;
          cloudMeta.tombstones[key] = now;
          delete cloudMeta.stamps[key];
          changed = true;
        }
      });
    });

    OBJECT_FIELDS.forEach(function (field) {
      const oldObj = previous[field] && typeof previous[field] === 'object' ? previous[field] : {};
      const newObj = state[field] && typeof state[field] === 'object' ? state[field] : {};
      Object.keys(newObj).forEach(function (key) {
        const stampKey = field + '|' + key;
        if (!Object.prototype.hasOwnProperty.call(oldObj, key) ||
            signature(oldObj[key]) !== signature(newObj[key])) {
          cloudMeta.stamps[stampKey] = now;
          changed = true;
        }
      });
      Object.keys(oldObj).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(newObj, key)) {
          const stampKey = field + '|' + key;
          cloudMeta.tombstones[stampKey] = now;
          delete cloudMeta.stamps[stampKey];
          changed = true;
        }
      });
    });

    if (signature(previous.running) !== signature(state.running)) {
      if (state.running) cloudMeta.stamps['running|running'] = now;
      else {
        cloudMeta.tombstones['running|running'] = now;
        delete cloudMeta.stamps['running|running'];
      }
      changed = true;
    }

    if (signature(metaCore(previous)) !== signature(metaCore(state))) {
      cloudMeta.stamps['meta|core'] = now;
      changed = true;
    }

    previous = clone(state);
    if (changed) {
      changeSeq++;
      saveMeta();
      if (auth) scheduleSync();
    }
  }

  function normalizePackage(packageOrState) {
    if (!packageOrState || typeof packageOrState !== 'object') {
      return { state: null, sync: emptyMeta() };
    }
    if (packageOrState.format === 'lifeos-cloud-v1' && packageOrState.state) {
      return {
        state: packageOrState.state,
        sync: {
          stamps: packageOrState.sync && packageOrState.sync.stamps || {},
          tombstones: packageOrState.sync && packageOrState.sync.tombstones || {}
        }
      };
    }
    if (Array.isArray(packageOrState.sessions)) {
      return { state: packageOrState, sync: emptyMeta() };
    }
    return { state: null, sync: emptyMeta() };
  }

  function mergeStampMaps(a, b) {
    const merged = {};
    const keys = {};
    Object.keys(a || {}).forEach(function (key) { keys[key] = true; });
    Object.keys(b || {}).forEach(function (key) { keys[key] = true; });
    Object.keys(keys).forEach(function (key) {
      merged[key] = maxStamp(a && a[key], b && b[key]);
    });
    return merged;
  }

  function chooseRecord(localRecord, remoteRecord, key, localStamps, remoteStamps) {
    if (!localRecord) return clone(remoteRecord);
    if (!remoteRecord) return clone(localRecord);
    const localStamp = Number(localStamps && localStamps[key]) || 0;
    const remoteStamp = Number(remoteStamps && remoteStamps[key]) || 0;
    if (localStamp !== remoteStamp) {
      return clone(localStamp > remoteStamp ? localRecord : remoteRecord);
    }
    const localTime = recordTime(localRecord);
    const remoteTime = recordTime(remoteRecord);
    if (localTime !== remoteTime) {
      return clone(localTime > remoteTime ? localRecord : remoteRecord);
    }
    return clone(infoSize(localRecord) >= infoSize(remoteRecord) ? localRecord : remoteRecord);
  }

  function tombstoneWins(key, stamps, tombstones) {
    return Number(tombstones[key] || 0) > Number(stamps[key] || 0);
  }

  function mergeLists(localState, remoteState, localStamps, remoteStamps, stamps, tombstones) {
    const out = {};
    LIST_FIELDS.forEach(function (field) {
      const localMap = recordMap(localState && localState[field]);
      const remoteMap = recordMap(remoteState && remoteState[field]);
      const ids = {};
      Object.keys(localMap).forEach(function (id) { ids[id] = true; });
      Object.keys(remoteMap).forEach(function (id) { ids[id] = true; });
      out[field] = Object.keys(ids).map(function (id) {
        const key = field + '|' + id;
        return {
          id: id,
          record: chooseRecord(localMap[id], remoteMap[id], key, localStamps, remoteStamps)
        };
      }).filter(function (item) {
        return !tombstoneWins(field + '|' + item.id, stamps, tombstones);
      }).map(function (item) {
        return item.record;
      });
    });
    return out;
  }

  function mergeObjectField(localState, remoteState, field, localStamps, remoteStamps, tombstones) {
    const localObj = localState && localState[field] && typeof localState[field] === 'object'
      ? localState[field]
      : {};
    const remoteObj = remoteState && remoteState[field] && typeof remoteState[field] === 'object'
      ? remoteState[field]
      : {};
    const keys = {};
    Object.keys(localObj).forEach(function (key) { keys[key] = true; });
    Object.keys(remoteObj).forEach(function (key) { keys[key] = true; });
    const out = {};
    Object.keys(keys).forEach(function (key) {
      const stampKey = field + '|' + key;
      if (tombstoneWins(stampKey, stamps, tombstones)) return;
      if (!Object.prototype.hasOwnProperty.call(localObj, key)) {
        out[key] = clone(remoteObj[key]);
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(remoteObj, key)) {
        out[key] = clone(localObj[key]);
        return;
      }
      out[key] = chooseRecord(
        localObj[key],
        remoteObj[key],
        stampKey,
        localStamps,
        remoteStamps
      );
    });
    return out;
  }

  function mergeStates(localState, remoteState) {
    const local = localState || {};
    const remote = remoteState || {};
    const localStamps = cloudMeta.stamps;
    const remoteStamps = remote._syncStamps || {};
    const stamps = mergeStampMaps(localStamps, remoteStamps);
    const tombstones = mergeStampMaps(cloudMeta.tombstones, remote._syncTombstones || {});
    const mergedLists = mergeLists(local, remote, localStamps, remoteStamps, stamps, tombstones);
    const days = mergeObjectField(local, remote, 'days', localStamps, remoteStamps, tombstones);
    const chats = mergeObjectField(local, remote, 'chats', localStamps, remoteStamps, tombstones);

    let running = null;
    if (local.running && remote.running) {
      running = chooseRecord(
        local.running,
        remote.running,
        'running|running',
        localStamps,
        remoteStamps
      );
    } else if (local.running || remote.running) {
      running = clone(local.running || remote.running);
    }
    if (tombstoneWins('running|running', stamps, tombstones)) running = null;

    const out = {
      version: Number(local.version || remote.version || 1),
      app: 'life-os',
      meta: Object.assign({}, local.meta || remote.meta || {}, remote.meta || {}),
      sessions: mergedLists.sessions,
      running: running,
      tasks: mergedLists.tasks,
      drafts: mergedLists.drafts,
      insights: mergedLists.insights,
      anchors: mergedLists.anchors,
      chats: chats,
      rebuttals: mergedLists.rebuttals,
      days: days
    };

    const metaWinner = chooseRecord(
      local.meta,
      remote.meta,
      'meta|core',
      localStamps,
      remoteStamps
    );
    out.meta = Object.assign({}, local.meta || {}, remote.meta || {}, metaWinner || {});
    out.meta.createdAt = Math.min(
      Number(local.meta && local.meta.createdAt) || Infinity,
      Number(remote.meta && remote.meta.createdAt) || Infinity
    );
    if (!isFinite(out.meta.createdAt)) out.meta.createdAt = Date.now();
    out.meta.lastOpenedAt = Date.now();

    return {
      state: out,
      sync: { stamps: stamps, tombstones: tombstones }
    };
  }

  function cleanForCloud(state) {
    const payload = clone(state);
    if (payload && payload.meta) {
      delete payload.meta.lastOpenedAt;
      delete payload.meta.lastBackupAt;
      if (payload.meta.ai) payload.meta.ai.apiKey = '';
    }
    return payload;
  }

  function restoreLocalSecrets(state) {
    const current = Store.get();
    if (state.meta && state.meta.ai && current.meta && current.meta.ai) {
      state.meta.ai.apiKey = current.meta.ai.apiKey || '';
    }
    return state;
  }

  function packageForCloud(state, sync) {
    return {
      format: 'lifeos-cloud-v1',
      state: cleanForCloud(state),
      sync: {
        stamps: sync.stamps || {},
        tombstones: sync.tombstones || {}
      }
    };
  }

  async function fetchRemote() {
    const userId = encodeURIComponent(auth.user.id);
    const rows = await restRequest(
      TABLE + '?select=payload,revision,updated_at&user_id=eq.' + userId + '&limit=1',
      { method: 'GET' }
    );
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async function pushRemote(row, packageData, revision) {
    const userId = encodeURIComponent(auth.user.id);
    const now = new Date().toISOString();
    let result;
    if (row) {
      result = await restRequest(
        TABLE + '?user_id=eq.' + userId + '&revision=eq.' + Number(row.revision || 1),
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            payload: packageData,
            revision: revision,
            updated_at: now
          })
        }
      );
    } else {
      result = await restRequest(TABLE + '?on_conflict=user_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          user_id: auth.user.id,
          payload: packageData,
          revision: revision,
          updated_at: now
        })
      });
    }
    return Array.isArray(result) && result.length > 0;
  }

  function syncSignature(sync) {
    return signature({
      stamps: sync && sync.stamps || {},
      tombstones: sync && sync.tombstones || {}
    });
  }

  async function doSync() {
    if (!auth) {
      setStatus({ phase: 'signed-out' });
      return getStatus();
    }
    if (!navigator.onLine) {
      setStatus({ phase: 'offline', pending: true, error: '当前没有网络，数据已保存在本机' });
      return getStatus();
    }

    const seqAtStart = changeSeq;
    setStatus({ phase: 'syncing', error: '', pending: false });
    seedStamps(Store.get());
    saveMeta();

    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = await fetchRemote();
        const remotePackage = normalizePackage(row && row.payload);
        const remoteState = remotePackage.state;
        const remoteWithSync = remoteState ? Object.assign({}, remoteState, {
          _syncStamps: remotePackage.sync.stamps,
          _syncTombstones: remotePackage.sync.tombstones
        }) : null;
        const merged = mergeStates(Store.get(), remoteWithSync);
        const mergedState = restoreLocalSecrets(merged.state);
        delete mergedState._syncStamps;
        delete mergedState._syncTombstones;

        if (signature(Store.get()) !== signature(mergedState)) {
          applying = true;
          try {
            Store.importAll(JSON.stringify(mergedState));
          } finally {
            applying = false;
          }
          if (typeof onApplied === 'function') {
            try { onApplied(); } catch (e) { console.error(e); }
          }
        }

        const packageData = packageForCloud(mergedState, merged.sync);
        const remotePackageCurrent = packageForCloud(remoteState || {}, remotePackage.sync);
        const stateSame = signature(cleanForCloud(mergedState)) ===
          signature(remotePackageCurrent.state);
        const syncSame = syncSignature(merged.sync) === syncSignature(remotePackage.sync);

        if (!row || !stateSame || !syncSame) {
          const revision = Number(row && row.revision || 0) + 1;
          const saved = await pushRemote(row, packageData, revision);
          if (!saved) continue;
        }

        cloudMeta = {
          stamps: mergeStampMaps(cloudMeta.stamps, merged.sync.stamps),
          tombstones: mergeStampMaps(cloudMeta.tombstones, merged.sync.tombstones)
        };
        saveMeta();
        previous = clone(Store.get());
        status.setupRequired = false;
        status.lastSyncedAt = Date.now();
        status.pending = changeSeq !== seqAtStart;
        setStatus({ phase: status.pending ? 'pending' : 'synced', error: '' });
        if (status.pending) scheduleSync(400);
        return getStatus();
      }
      throw new Error('数据刚刚在另一台设备更新了，请再同步一次');
    } catch (err) {
      const message = translation(err.message, err.code);
      if (/登录已过期|重新登录/.test(message)) clearAuth();
      setStatus({
        phase: navigator.onLine === false ? 'offline' : 'error',
        error: message,
        pending: true
      });
      throw new Error(message);
    }
  }

  function scheduleSync(delay) {
    if (!auth) return;
    clearTimeout(debounceTimer);
    setStatus({ phase: status.phase === 'syncing' ? 'syncing' : 'pending', pending: true });
    debounceTimer = setTimeout(function () {
      syncNow().catch(function () {});
    }, delay == null ? 2200 : delay);
  }

  function syncNow() {
    if (!auth) return Promise.reject(new Error('请先登录同步账号'));
    if (inflight) return inflight;
    clearTimeout(debounceTimer);
    const job = doSync();
    inflight = job;
    return job.finally(function () {
      if (inflight === job) inflight = null;
    });
  }

  async function signIn(email, password) {
    if (!email || !password) throw new Error('请填写邮箱和密码');
    setStatus({ phase: 'syncing', error: '', setupRequired: false });
    try {
      const data = await authRequest('/auth/v1/token?grant_type=password', {
        email: String(email).trim(),
        password: String(password)
      });
      setAuth(data);
      previous = clone(Store.get());
      await syncNow();
      return getStatus();
    } catch (err) {
      const message = translation(err.message, err.code);
      setStatus({ phase: auth ? 'error' : 'signed-out', error: message });
      throw new Error(message);
    }
  }

  async function signUp(email, password) {
    if (!email || !password) throw new Error('请填写邮箱和密码');
    if (String(password).length < 6) throw new Error('密码至少需要 6 位');
    setStatus({ phase: 'syncing', error: '', setupRequired: false });
    try {
      const data = await authRequest('/auth/v1/signup', {
        email: String(email).trim(),
        password: String(password)
      });
      if (data && data.access_token && data.user) {
        setAuth(data);
        previous = clone(Store.get());
        await syncNow();
        return { signedIn: true, needsConfirm: false };
      }
      setStatus({ phase: 'signed-out', error: '' });
      return { signedIn: false, needsConfirm: true };
    } catch (err) {
      const message = translation(err.message, err.code);
      setStatus({ phase: 'signed-out', error: message });
      throw new Error(message);
    }
  }

  function signOut() {
    clearTimeout(debounceTimer);
    clearAuth();
    previous = clone(Store.get());
  }

  function getStatus() {
    return Object.assign({}, status);
  }

  function start() {
    if (started) return;
    started = true;
    previous = clone(Store.get());
    loadMeta();
    seedStamps(Store.get());
    Store.subscribe(observeChanges);

    w.addEventListener('online', function () {
      if (auth) syncNow().catch(function () {});
    });
    w.addEventListener('offline', function () {
      setStatus({ phase: auth ? 'offline' : 'signed-out', error: '当前没有网络，数据已保存在本机' });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && auth) {
        syncNow().catch(function () {});
      }
    });
    setInterval(function () {
      if (auth && document.visibilityState === 'visible' && navigator.onLine) {
        syncNow().catch(function () {});
      }
    }, 60000);

    if (auth) {
      setStatus({ signedIn: true, phase: 'syncing', email: auth.user.email || '' });
      syncNow().catch(function () {});
    } else {
      setStatus({ signedIn: false, phase: 'signed-out' });
    }
  }

  function init(options) {
    options = options || {};
    onStatus = options.onStatus || onStatus;
    onApplied = options.onApplied || onApplied;
    start();
  }

  w.Cloud = {
    init: init,
    getStatus: getStatus,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    syncNow: syncNow,
    setupSql: SETUP_SQL,
    projectUrl: SUPABASE_URL
  };
})(window);
