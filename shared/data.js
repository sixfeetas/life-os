/* ============================================================
   Life OS · 领域常量
   标签与情绪的定义集中在这里，改这里即可改全局
   ============================================================ */
(function (w) {

  // 记录标签：id 一旦存进数据就不要改
  // 颜色取自 Catppuccin Mocha，保持低饱和、同明度、奶油感
  const TAGS = [
    { id: 'study', label: '学习',    color: '#89b4fa' }, // Blue
    { id: 'code',  label: '编程',    color: '#cba6f7' }, // Mauve
    { id: 'read',  label: '阅读',    color: '#94e2d5' }, // Teal
    { id: 'move',  label: '运动',    color: '#a6e3a1' }, // Green
    { id: 'rest',  label: '休息',    color: '#9399b2' }, // Overlay2
    { id: 'fun',   label: '娱乐',    color: '#f5c2e7' }, // Pink
    { id: 'chore', label: '杂事',    color: '#fab387' }, // Peach
    { id: 'other', label: '其他',    color: '#7f849c' }  // Overlay1
  ];

  // 情绪 1–5
  const MOODS = [
    { v: 1, emoji: '😖', label: '很差', color: '#f38ba8' }, // Red
    { v: 2, emoji: '😕', label: '较差', color: '#fab387' }, // Peach
    { v: 3, emoji: '😐', label: '一般', color: '#f9e2af' }, // Yellow
    { v: 4, emoji: '🙂', label: '不错', color: '#94e2d5' }, // Teal
    { v: 5, emoji: '😄', label: '很好', color: '#a6e3a1' }  // Green
  ];

  // 任务未闭合 / 差值归因（Tab 2 使用，先定义好保证数据一致）
  const REASONS = [
    { id: 'distracted', label: '分心' },
    { id: 'harder',  label: '太难' },
    { id: 'unwilling', label: '不想做' },
    { id: 'interrupted', label: '被打断' },
    { id: 'notime',  label: '没时间' },
    { id: 'state', label: '状态差' },
    { id: 'unclear', label: '说不清' },
    { id: 'badplan', label: '计划错了' }
  ];

  const D = {
    TAGS: TAGS,
    MOODS: MOODS,
    REASONS: REASONS,

    tag: function (id) {
      return TAGS.find(function (t) { return t.id === id; }) || TAGS[TAGS.length - 1];
    },
    mood: function (v) {
      return MOODS.find(function (m) { return m.v === v; }) || null;
    }
  };

  w.D = D;
})(window);
