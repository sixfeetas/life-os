/* ============================================================
   Life OS · 工具函数
   ============================================================ */
(function (w) {
  const U = {};

  U.uid = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  U.pad = function (n, w) {
    return String(n).padStart(w || 2, '0');
  };

  /* ---------- 时间格式 ---------- */

  // 毫秒 → 01:23:45
  U.clock = function (ms) {
    ms = Math.max(0, ms || 0);
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return U.pad(h) + ':' + U.pad(m) + ':' + U.pad(s);
  };

  // 毫秒 → "1小时25分" / "25分" / "<1分"
  U.dur = function (ms) {
    ms = Math.max(0, ms || 0);
    if (ms < 60000) return '<1分';
    const min = Math.round(ms / 60000);
    if (min < 60) return min + '分';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? h + '小时' + m + '分' : h + '小时';
  };

  // 毫秒 → 用于统计的分钟数（至少 1 分钟，避免 0）
  U.mins = function (ms) {
    return Math.max(1, Math.round((ms || 0) / 60000));
  };

  // 时间戳 → 09:10
  U.hm = function (ts) {
    const d = new Date(ts);
    return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  };

  // 时间戳 → 2026-10-26
  U.dateStr = function (ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
  };

  /* ---------- 逻辑日（可配置几点换日） ---------- */

  // 返回某时间戳所属的"逻辑日" key，如 '2026-10-26'
  U.dayKey = function (ts, dayStartHour) {
    const h = (dayStartHour == null ? 4 : dayStartHour) * 3600000;
    return U.dateStr(ts - h);
  };

  // '2026-10-26' → Date（当天 00:00）
  U.keyToDate = function (key) {
    const p = key.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  };

  // key 加 n 天
  U.shiftKey = function (key, n) {
    const d = U.keyToDate(key);
    d.setDate(d.getDate() + n);
    return U.dateStr(d.getTime());
  };

  // 距今天数（key 相对今天，正数为过去）
  U.daysAgo = function (key, dayStartHour) {
    const today = U.dayKey(Date.now(), dayStartHour);
    return Math.round((U.keyToDate(today) - U.keyToDate(key)) / 86400000);
  };

  U.weekday = function (key) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][U.keyToDate(key).getDay()];
  };

  // 友好的日期标题
  U.dateTitle = function (key, dayStartHour) {
    const d = U.daysAgo(key, dayStartHour);
    if (d === 0) return '今天';
    if (d === 1) return '昨天';
    if (d === 2) return '前天';
    const p = key.split('-');
    return Number(p[1]) + '月' + Number(p[2]) + '日';
  };

  // datetime-local 输入值互转
  U.toLocalInput = function (ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate()) +
      'T' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  };
  U.fromLocalInput = function (v) {
    if (!v) return null;
    const t = new Date(v).getTime();
    return isNaN(t) ? null : t;
  };

  /* ---------- 杂项 ---------- */

  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  U.clamp = function (n, a, b) {
    return Math.min(b, Math.max(a, n));
  };

  U.debounce = function (fn, wait) {
    let t;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  };

  U.download = function (name, content, type) {
    const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  };

  U.sum = function (arr, fn) {
    return arr.reduce(function (s, x) { return s + (fn ? fn(x) : x); }, 0);
  };

  w.U = U;
})(window);
