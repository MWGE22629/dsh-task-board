/**
 * Task board Client half.
 *
 * Board = parking lot. A card sits in the main grid; opening it removes the
 * card from the board and raises a floating window that hosts the task's
 * Session. The window has exactly one chrome control, `−`, which drops the
 * Session reference, destroys the window, and puts the card back in its slot.
 * A card is on the board XOR its window is open.
 *
 * Native seams only:
 *   sidebar.panellist  list  { id, order, label }   the icon beside Plugins
 *   main               keyed { key: 'taskboard' }   the board itself
 *   shell.overlay      list  { id, order }          the frame-wide floating layer
 *   + declared session-scoped child slot `taskboard.window`, mounted under the
 *     standard `SessionProvider` seat for exactly one SessionReference.
 *
 * The board panel gets no Session binding by design; Sessions enter only
 * through windows, and each window retains one reference for its own lifetime
 * (硬约束 5: subscription follows the window, never a global feed).
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-task-board',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // The search field lives in a portal above the board (and above floating
    // task windows), because its popover must not be clipped by the board's
    // stacking context nor push the billing clock around when it expands.
    const { createPortal } = require('react-dom')
    // The sidebar's session rows and this card must name the same moment the
    // same way, so borrow the shared bucketing instead of re-deriving it.
    const { relativeTime } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'dsh-task-board'
    const PANEL_ID = 'taskboard'
    const ENDPOINT = 'dsh-task-board'
    const WINDOW_SLOT = 'taskboard.window'
    const LANE_MIME = 'application/x-dsh-task-board-lane'
    const SEND_TIMEOUT_MS = 20000

    const ZH = {
      panel: '任务看板',
      untitled: '待安排',
      'state.draft': '草稿',
      collapse: '收回看板',
      collapseHint: '收回看板（Esc）',
      draftPlaceholder: '第一条指令 — Enter 发送，Shift+Enter 换行',
      creating: '正在创建会话…',
      sendFailed: '第一条指令发送失败',
      noWorkspace: '这张卡还没有绑定工作区',
      pin: '钉住',
      unpin: '取消钉住',
      'state.draft': '草稿',
      'state.idle': '空闲',
      'state.running': '运行中',
      'state.needsDecision': '需决策',
      'state.done': '已完成',
      'state.failed': '故障停止',
      'state.stopped': '已停止',
      'state.settling': '结算中',
      'phase.thinking': '思考中',
      'phase.writing': '正在写',
      'phase.awaiting': '等待你的决定',
      'stall.quiet': '静默 {d}',
      storageUnavailable: '看板存储不可用，改动只保留在当前页面',
      // 看板不能新建工作区，只能把已有工作区排上板，所以叫「关注」。
      addWorkspace: '关注工作区',
      noWorkspaceLane: '还没有分区。用「关注工作区」把工作区排到看板上。',
      laneDetached: '未绑定工作区',
      laneEmpty: '这一区还没有任务',
      addCardHere: '在本区新建任务',
      removeLane: '取消关注此工作区',
      laneHasCards: '该工作区还有任务，先清空再取消关注',
      noWorkspaces: '没有可用的工作区',
      runningFor: '已运行 {d}',
      // Same buckets and words as the sidebar's session rows.
      'time.now': '刚刚',
      'time.minutes': '{n}分钟',
      'time.hours': '{n}小时',
      'time.days': '{n}天',
      'time.months': '{n}个月',
      'time.years': '{n}年',
      'time.ago': '{t}前',
      updatedAt: '上次更新：{time}',
      allWorkspaces: '全部工作区已上板',
      removeTask: '从看板移除',
      removeTaskConfirm: '再点一次确认',
      laneRowsPrefix: '工作区排列',
      laneRowsSuffix: '行',
      laneRowsHint: '分 {n} 行排列工作区，不改变卡片大小',
      dropToAdd: '松手即可把该会话加入看板',
      addToBoard: '加入看板',
      inBoard: '已在看板',
      sessionGone: '该会话已不存在',
      resume: '继续',
      resuming: '恢复中…',
      // 会话正文搜索（只搜板上已有卡片的会话）
      searchPlaceholder: '搜索会话',
      searchHint: '输入至少 2 个字符，在已上板会话的正文里搜索',
      searchScopeLabel: '范围',
      searchScopeAll: '全部工作区',
      searchOnlyCards: '只搜索板上已有卡片对应的会话',
      searchSearching: '搜索中…',
      searchEmpty: '没有命中',
      searchFailed: '搜索失败',
      searchPartial: '{n} 个会话读取失败',
      searchTruncated: '结果已截断',
      searchLocateMiss: '已打开会话，但没定位到那条消息',
      // 顶部居中的峰谷时段徽标
      peakNow: '现在是梁文【峰】',
      valleyNow: '现在是梁文【谷】',
      valleyRemain: '还有 {h} 小时 {m} 分钟结束',
      peakValleyHint: '高峰时段：工作日北京时间 9:00-12:00 与 14:00-18:00，共 7 小时；其余时段（晚间、夜间及周末全天）维持半价',
    }

    const EN = {
      panel: 'Task board',
      untitled: 'To plan',
      collapse: 'Back to the board',
      collapseHint: 'Back to the board (Esc)',
      draftPlaceholder: 'First instruction — Enter sends, Shift+Enter adds a line',
      creating: 'Creating the session…',
      sendFailed: 'The first instruction failed',
      noWorkspace: 'This card has no workspace bound',
      pin: 'Pin',
      unpin: 'Unpin',
      'state.draft': 'Draft',
      'state.idle': 'Idle',
      'state.running': 'Running',
      'state.needsDecision': 'Needs a decision',
      'state.done': 'Done',
      'state.failed': 'Failed',
      'state.stopped': 'Stopped',
      'state.settling': 'Settling',
      'phase.thinking': 'Thinking',
      'phase.writing': 'Writing',
      'phase.awaiting': 'Waiting for you',
      'stall.quiet': 'Quiet {d}',
      storageUnavailable: 'Board storage is unavailable; changes stay in this page',
      addWorkspace: 'Follow workspace',
      noWorkspaceLane: 'No lane yet. Use “Follow workspace” to put one on the board.',
      laneDetached: 'Unbound workspace',
      laneEmpty: 'No task in this lane yet',
      addCardHere: 'New task in this lane',
      removeLane: 'Unfollow this workspace',
      laneHasCards: 'This workspace still has tasks; clear them before unfollowing',
      noWorkspaces: 'No workspace available',
      runningFor: 'Running for {d}',
      'time.now': 'now',
      'time.minutes': '{n}min',
      'time.hours': '{n}h',
      'time.days': '{n}d',
      'time.months': '{n}mo',
      'time.years': '{n}y',
      'time.ago': '{t} ago',
      updatedAt: 'Last updated: {time}',
      allWorkspaces: 'Every workspace is already on the board',
      removeTask: 'Remove from the board',
      removeTaskConfirm: 'Click again to confirm',
      laneRowsPrefix: 'Workspaces in',
      laneRowsSuffix: 'rows',
      laneRowsHint: 'Lay workspaces out in {n} rows; card size is unchanged',
      dropToAdd: 'Drop to add this session to the board',
      addToBoard: 'Add to board',
      inBoard: 'Already on the board',
      sessionGone: 'That session no longer exists',
      resume: 'Continue',
      resuming: 'Resuming…',
      // Session-content search (boarded sessions only)
      searchPlaceholder: 'Search sessions',
      searchHint: 'Type at least 2 characters to search inside the sessions parked on the board',
      searchScopeLabel: 'Scope',
      searchScopeAll: 'All workspaces',
      searchOnlyCards: 'Only sessions that already have a card on the board',
      searchSearching: 'Searching…',
      searchEmpty: 'No match',
      searchFailed: 'Search failed',
      searchPartial: '{n} session(s) could not be read',
      searchTruncated: 'Results truncated',
      searchLocateMiss: 'Session opened, but the message could not be located',
      peakNow: 'Now DeepSeek [peak]',
      valleyNow: 'Now DeepSeek [valley]',
      valleyRemain: '{h}h {m}m left',
      peakValleyHint: 'Peak: weekdays 9:00-12:00 and 14:00-18:00 Beijing time, 7 hours total; everything else — evenings, nights and weekends — keeps the half price',
    }

    const local = (key) => ZH[key] ?? key

    const CSS = `
.tb-board{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.tb-head{position:relative;display:flex;align-items:center;gap:12px;padding:18px 24px 20px}
.tb-title{margin:0;font-size:18px;font-weight:600;line-height:26px}
.tb-new{height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.tb-new:hover{background:var(--dsw-alias-bg-layer-2)}
.tb-head-actions{display:flex;align-items:center;gap:10px;margin-left:auto;min-width:0}
.tb-warn{font-size:12px;color:var(--dsw-alias-state-warn-primary);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:46%;min-width:0;pointer-events:none}
.tb-clock{display:block;font-size:12px;line-height:18px;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;pointer-events:none;overflow:hidden;text-overflow:ellipsis}
.tb-clock-peak{color:var(--dsw-alias-state-warn-primary)}
.tb-clock-valley{color:var(--dsw-alias-state-success-primary)}
.tb-search-anchor{display:block;flex:none;width:127px;height:26px;pointer-events:none}
.tb-search-layer{position:fixed;z-index:200;display:flex;align-items:center;pointer-events:auto}
.tb-search-box{display:flex;align-items:center;gap:6px;height:26px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);transition:border-color .12s ease,background .12s ease}
.tb-search-box:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.tb-search-layer.is-open .tb-search-box{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}
.tb-search-box input{width:88px;padding:0;border:0;outline:none;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:16px}
.tb-search-layer.is-open .tb-search-box input{width:190px}
.tb-search-box input::placeholder{color:var(--dsw-alias-label-tertiary)}
.tb-search-panel{position:fixed;z-index:auto;display:flex;flex-direction:column;max-height:min(460px,62vh);padding:10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);box-shadow:0 18px 44px rgba(0,0,0,.34)}
.tb-search-scope{display:flex;flex-wrap:wrap;align-items:center;gap:4px;max-height:78px;overflow-y:auto;padding:0 2px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.tb-search-scope-label{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-right:2px}
.tb-scope-chip{height:22px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:20px;cursor:pointer;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-scope-chip:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.tb-scope-chip.is-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}
.tb-search-note{padding:6px 2px 2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.tb-search-body{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:1px;padding-top:4px}
.tb-search-hint{padding:8px 6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.tb-hit{display:flex;flex-direction:column;gap:3px;width:100%;padding:7px 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.tb-hit:hover,.tb-hit.is-active{background:var(--dsw-alias-interactive-bg-hover)}
.tb-hit-meta{display:flex;align-items:center;gap:8px;min-width:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.tb-hit-card{font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.tb-hit-ws{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.tb-hit-time{margin-left:auto;flex:none;font-variant-numeric:tabular-nums}
.tb-hit-text{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.tb-hit-text mark{background:rgba(255,196,0,.34);color:var(--dsw-alias-label-primary);border-radius:2px;padding:0 1px}
.tbwin-row-flash{animation:tb-row-flash 2.4s ease}
@keyframes tb-row-flash{0%,55%{background:rgba(255,196,0,.16)}100%{background:transparent}}
::highlight(tb-search-hit){background-color:rgba(255,196,0,.5);color:inherit}
.tb-empty{padding:0 24px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.tb-rows{display:flex;align-items:center;gap:6px}
.tb-rows-label{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.tb-seg{display:flex;align-items:center;gap:1px;padding:2px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.tb-seg-btn{width:24px;height:22px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer}
.tb-seg-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.tb-seg-btn.is-on{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
.tb-lanes{display:grid;grid-auto-flow:column;grid-auto-columns:292px;gap:14px;flex:1;min-height:0;padding:0 24px 26px;overflow-x:auto;overflow-y:hidden;align-items:stretch}
.tb-lanes[data-rows="1"]{grid-template-rows:minmax(0,1fr)}
.tb-lanes[data-rows="2"]{grid-template-rows:repeat(2,minmax(0,1fr))}
.tb-lanes[data-rows="3"]{grid-template-rows:repeat(3,minmax(0,1fr))}
.tb-lane{display:flex;flex-direction:column;min-height:0;min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.tb-lane.is-dragging{opacity:.45}
.tb-lane.is-target{border-color:var(--dsw-alias-brand-primary)}
.tb-lane-head{display:flex;align-items:center;gap:8px;flex:none;padding:10px 8px 9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:grab}
.tb-lane-head:active{cursor:grabbing}
.tb-lane-title{font-size:13px;font-weight:600;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-lane-count{font-size:11px;color:var(--dsw-alias-label-secondary);flex:none}
.tb-lane-actions{margin-left:auto;display:flex;gap:1px;flex:none}
.tb-lane-btn{width:20px;height:20px;display:flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1;cursor:pointer}
.tb-lane-btn:hover:not(:disabled){background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}
.tb-lane-btn:disabled{opacity:.35;cursor:default}
.tb-lane-body{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0;overflow-y:auto;padding:10px}
.tb-lane-empty{padding:6px 4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.tb-board.is-drop .tb-lane{border-color:var(--dsw-alias-brand-primary);border-style:dashed}
.tb-card{position:relative;display:flex;flex-direction:column;gap:6px;min-height:112px;padding:12px 12px 10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;transition:border-color .12s ease,background .12s ease,transform .12s ease}
.tb-card:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);transform:translateY(-1px)}
.tb-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.tb-card-title{font-size:14px;font-weight:600;line-height:20px;word-break:break-word;padding-right:46px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.tb-card:hover .tb-card-title{-webkit-line-clamp:2}
.tb-card-foot{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.tb-card-action{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:16px}
.tb-card-output{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;min-height:16px}
.tb-card-output-full{display:none;position:absolute;left:8px;right:8px;top:60px;max-height:calc(100% - 68px);overflow:auto;z-index:5;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);box-shadow:0 10px 26px rgba(0,0,0,.26);font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}
.tb-card:hover .tb-card-output-full{display:block}
.tb-card-resume{position:absolute;right:8px;bottom:8px;z-index:6;height:22px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:20px;cursor:pointer}
.tb-card-resume:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.tb-card-resume.is-busy{opacity:.6;cursor:default}
.tb-card:has(.tb-card-resume) .tb-card-output{padding-right:56px}
.tb-stall{font-variant-numeric:tabular-nums;margin-left:auto;flex:none}
.tb-stall.is-warn{color:var(--dsw-alias-state-warn-primary)}
.tb-stall.is-bad{color:var(--dsw-alias-state-error-primary);font-weight:600}
.tb-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}
.tb-card-needsDecision .tb-dot,.tb-card-done .tb-dot,.tb-card-failed .tb-dot{width:8px;height:8px}
.tb-card-needsDecision .tb-dot{background:var(--dsw-alias-state-warn-primary)}
.tb-card-done .tb-dot{background:var(--dsw-alias-state-success-primary)}
.tb-card-failed .tb-dot{background:var(--dsw-alias-state-error-primary)}
.tb-card-stopped .tb-dot{background:transparent;box-shadow:inset 0 0 0 1.5px var(--dsw-alias-state-warn-primary)}
.tb-spin{width:9px;height:9px;flex:none;box-sizing:border-box;border-radius:50%;border:1.5px solid var(--dsw-alias-label-tertiary);border-top-color:transparent;animation:tb-turn 1s linear infinite}
@keyframes tb-turn{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.tb-spin{animation:none;border-top-color:var(--dsw-alias-label-tertiary);opacity:.6}}
.tb-chip{font-size:12px;line-height:16px}
.tb-chip-running{color:var(--dsw-alias-label-primary)}
.tb-chip-needsDecision{color:var(--dsw-alias-state-warn-primary);font-weight:600}
.tb-chip-done{color:var(--dsw-alias-state-success-primary)}
.tb-chip-failed{color:var(--dsw-alias-state-error-primary);font-weight:600}
.tb-chip-stopped{color:var(--dsw-alias-state-warn-primary)}
.tb-chip-settling{color:var(--dsw-alias-label-secondary)}
.tb-elapsed{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);flex:none;font-variant-numeric:tabular-nums}
.tb-age{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none;font-variant-numeric:tabular-nums}
.tb-pop{position:absolute;top:50px;right:0;z-index:60;min-width:236px;max-height:320px;overflow:auto;padding:6px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);box-shadow:0 14px 36px rgba(0,0,0,.26)}
.tb-pop-row{display:flex;width:100%;align-items:center;gap:8px;padding:7px 8px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.tb-pop-row:hover{background:var(--dsw-alias-bg-layer-2)}
.tb-pop-row:disabled{opacity:.5;cursor:default}
.tb-pop-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-pop-path{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}
.tb-pop-note{padding:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.tb-scrim{position:fixed;inset:0;z-index:50}
.tb-card-busy{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary)}
.tb-card-actions{position:absolute;top:6px;right:6px;display:flex;gap:1px;opacity:0}
.tb-card:hover .tb-card-actions,.tb-card-actions.has-on{opacity:1}
.tb-pin,.tb-card-x{width:20px;height:20px;display:flex;align-items:center;justify-content:center;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;font-size:13px;line-height:1}
.tb-pin:hover,.tb-card-x:hover{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}
.tb-pin.is-on{color:var(--dsw-alias-brand-primary);opacity:1}
.tb-card-x.is-armed{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-state-error-primary);width:auto;padding:0 6px;font-size:11px}
.tb-rowadd{width:20px;height:20px;display:flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.tb-rowadd:hover{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}
.tb-overlay{position:fixed;inset:0;pointer-events:none}
.tbwin{position:fixed;display:flex;flex-direction:column;pointer-events:auto;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 18px 48px rgba(0,0,0,.28);overflow:hidden;min-width:340px;min-height:240px}
.tbwin-head{display:flex;align-items:center;gap:8px;height:34px;flex:none;padding:0 6px 0 12px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);cursor:grab;user-select:none;touch-action:none}
.tbwin-head:active{cursor:grabbing}
.tbwin-h{position:absolute;z-index:40;touch-action:none}
.tbwin-h-n{top:0;left:11px;right:11px;height:6px;cursor:ns-resize}
.tbwin-h-s{bottom:0;left:11px;right:11px;height:7px;cursor:ns-resize}
.tbwin-h-w{left:0;top:11px;bottom:11px;width:6px;cursor:ew-resize}
.tbwin-h-e{right:0;top:11px;bottom:11px;width:6px;cursor:ew-resize}
.tbwin-h-nw{top:0;left:0;width:11px;height:11px;cursor:nwse-resize}
.tbwin-h-ne{top:0;right:0;width:11px;height:11px;cursor:nesw-resize}
.tbwin-h-sw{bottom:0;left:0;width:11px;height:11px;cursor:nesw-resize}
.tbwin-h-se{bottom:0;right:0;width:11px;height:11px;cursor:nwse-resize}
.tbwin-title{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46%}
.tbwin-ws{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:38%}
.tbwin-collapse{position:relative;z-index:50;flex:none;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:16px;line-height:1;cursor:pointer;padding:0}
.tbwin-collapse:hover{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}
.tbwin-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.tb-draft{display:flex;flex-direction:column;flex:1;min-height:0;padding:12px;gap:8px}
.tb-draft-input{flex:1;min-height:0;resize:none;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:10px 12px;outline:none}
.tb-draft-input:focus{border-color:var(--dsw-alias-brand-primary)}
.tb-draft-note{font-size:12px;color:var(--dsw-alias-label-secondary)}
.tb-draft-error{font-size:12px;color:var(--dsw-alias-state-error-primary)}
.tb-embed-error{padding:16px;font-size:12px;color:var(--dsw-alias-state-error-primary);overflow:auto}
`

    // ------------------------------------------------------------- helpers

    const uid = () => `tbc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const newRequestId = () =>
      (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)

    const EMPTY = Object.freeze({
      cards: [], pinned: [], partitions: [], windows: [], sending: [], continuing: [], sendError: {},
      digests: {}, laneRows: 1, dragLane: null, dropActive: false,
      zTop: 20, ready: false, storageError: null,
    })

    /**
     * Board state that survives a re-apply of this plugin in the same page.
     *
     * The client half can be disposed and applied again without a page reload
     * (an HMR revision, or a host-driven fiber restart). Without a carry-over the
     * board restarts from the empty boot snapshot and re-reads storage, which made
     * the board appear to "revert to the old state" whenever the panel was left
     * and re-entered. The page session's memory is authoritative; storage only
     * seeds a genuinely fresh page.
     */
    let carriedBoard = null

    /** One stylesheet element shared by every apply of this package in the page. */
    let styleElement = null
    let styleRefs = 0

    /** Minimal observable; components read it through useSyncExternalStore. */
    function createBoard(onPublish) {
      let snapshot = EMPTY
      const listeners = new Set()
      const publish = (next) => {
        snapshot = next
        onPublish?.(next)
        for (const listener of [...listeners]) listener()
      }
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        set: publish,
        patch(patch) {
          publish({ ...snapshot, ...patch })
        },
      }
    }

    /** The persisted board facts. Windows and timers are runtime-only. */
    function persistedOf(state) {
      const pinned = [...state.pinned]
      return {
        version: 1,
        pinned,
        partitions: [...state.partitions],
        laneRows: state.laneRows,
        cards: state.cards
          .slice()
          .sort((a, b) => a.slot - b.slot)
          .map((card) => ({
            id: card.id,
            title: card.title,
            state: card.state,
            sessionId: card.sessionId,
            workspaceId: card.workspaceId,
            workspacePath: card.workspacePath,
            draftPrompt: card.draftPrompt,
            slot: card.slot,
            createdAt: card.createdAt,
            outcome: card.outcome ?? null,
            lastText: card.lastText ?? '',
          })),
      }
    }

    function hydrate(doc) {
      const cards = Array.isArray(doc?.cards) ? doc.cards : []
      return {
        cards: cards.map((card, index) => {
          const stored = typeof card.state === 'string' ? card.state : 'draft'
          const outcome = card.outcome !== null && typeof card.outcome === 'object'
            && typeof card.outcome.kind === 'string'
            ? card.outcome
            : null
          return {
            id: typeof card.id === 'string' ? card.id : uid(),
            title: typeof card.title === 'string' ? card.title : '',
            // A settle that was interrupted by shutdown falls back to the neutral
            // ending; anything the Host classified is stored on the card already.
            state: stored === 'settling' ? 'done' : stored,
            sessionId: typeof card.sessionId === 'string' ? card.sessionId : null,
            workspaceId: typeof card.workspaceId === 'string' ? card.workspaceId : null,
            workspacePath: typeof card.workspacePath === 'string' ? card.workspacePath : '',
            draftPrompt: typeof card.draftPrompt === 'string' ? card.draftPrompt : '',
            slot: Number.isInteger(card.slot) ? card.slot : index,
            createdAt: Number.isFinite(card.createdAt) ? card.createdAt : Date.now(),
            outcome,
            lastText: typeof card.lastText === 'string' ? card.lastText : '',
          }
        }),
        pinned: Array.isArray(doc?.pinned) ? doc.pinned.filter((id) => typeof id === 'string') : [],
        partitions: Array.isArray(doc?.partitions)
          ? doc.partitions.filter((id) => typeof id === 'string')
          : [],
        laneRows: doc?.laneRows === 2 || doc?.laneRows === 3 ? doc.laneRows : 1,
      }
    }

    /** Exact-route RPC carrier shared with the Host half (see index.js). */
    function createTransport(ctx) {
      let resolved
      const connection = () => {
        if (resolved === undefined) resolved = ctx.get('connection') ?? null
        return resolved
      }
      return {
        async call(method, payload) {
          const conn = connection()
          if (conn === null || typeof conn.rpc?.call !== 'function') {
            throw Object.assign(new Error(local('storageUnavailable')), { code: 'taskboard/offline' })
          }
          const result = await conn.rpc.call('/api', ENDPOINT, { method, payload })
          if (result !== null && typeof result === 'object' && 'ok' in result) {
            if (result.ok === false) throw new Error(result.error?.message ?? local('storageUnavailable'))
            return result.value
          }
          return result
        },
      }
    }

    /** Most recently active Workspace, then the first one. */
    function pickWorkspace(workspaces, sessions) {
      const items = workspaces?.items ?? []
      if (items.length === 0) return null
      let best = null
      let bestAt = -1
      for (const workspace of items) {
        for (const sessionId of workspace.sessionIds ?? []) {
          const at = sessions?.byId?.[sessionId]?.updatedAt ?? 0
          if (at > bestAt) {
            bestAt = at
            best = workspace
          }
        }
      }
      return best ?? items[0]
    }

    function summaryTitle(summary) {
      if (summary === null || typeof summary !== 'object') return undefined
      const title = summary.title ?? summary.projectionValues?.title
      return typeof title === 'string' && title.trim() !== '' ? title : undefined
    }

    const statusOf = (statuses, id) => statuses?.get?.(id) ?? statuses?.[id]

    /** `M:SS`, unbounded above (no hour fold — a long turn may run past 60 minutes). */
    function formatDuration(ms) {
      const total = Math.max(0, Math.floor(ms / 1000))
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      return `${minutes}:${String(seconds).padStart(2, '0')}`
    }

    /** The sidebar row's compact age ("刚刚"/"5分钟"/"2天"), through this plugin's dictionary. */
    function timeLabel(at, now, t) {
      const { unit, n } = relativeTime(at, now)
      return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
    }

    /** Hover variant: distances wrap in the ago template; the now bucket stays bare. */
    function agoLabel(at, now, t) {
      const { unit, n } = relativeTime(at, now)
      return unit === 'now' ? t('time.now') : t('time.ago', { t: t(`time.${unit}`, { n }) })
    }

    // --- peak/valley billing clock ---------------------------------------
    //
    // 峰 = 工作日（周一至周五）北京时间 9:00-12:00 与 14:00-18:00，共 7 小时；
    // 其余全部是谷（午休、晚间、夜间、周末全天，半价）。北京时间为 UTC+8 且
    // 无夏令时，直接用算术偏移换算，机器在任何时区下结果一致。

    const BJ_OFFSET_MIN = 480
    const MS_MIN = 60 * 1000
    const MS_HOUR = 60 * MS_MIN
    const MS_DAY = 24 * MS_HOUR
    const PEAK_WINDOWS = [
      { from: 9 * 60, to: 12 * 60, label: '9:00-12:00' },
      { from: 14 * 60, to: 18 * 60, label: '14:00-18:00' },
    ]

    /**
     * Classify `nowMs` into peak or valley and stamp the boundaries.
     * Returns `{ phase, label?, endAt, syncedMs }` where `endAt` is the real
     * epoch ms at which this period ends (for peak: this window's close; for
     * valley: the next peak window's open).
     */
    function readPeakValley(nowMs) {
      const shiftMs = (new Date(nowMs).getTimezoneOffset() + BJ_OFFSET_MIN) * MS_MIN
      const bj = new Date(nowMs + shiftMs)
      const day = bj.getDay() // 0 Sun … 6 Sat
      const minuteOfDay = bj.getHours() * 60
        + bj.getMinutes()
        + bj.getSeconds() / 60
        + bj.getMilliseconds() / MS_MIN
      // Epoch ms of Beijing midnight today, still in the shifted frame.
      const midnightShifted = bj.getTime() - minuteOfDay * MS_MIN
      // Real epoch ms for Beijing wall time on `delta` days from today at `minute`.
      const at = (delta, minute) => midnightShifted + delta * MS_DAY + minute * MS_MIN - shiftMs
      const isWeekday = (d) => {
        const index = ((day + d) % 7 + 7) % 7
        return index >= 1 && index <= 5
      }

      if (day >= 1 && day <= 5) {
        for (const win of PEAK_WINDOWS) {
          if (minuteOfDay >= win.from && minuteOfDay < win.to) {
            return { phase: 'peak', label: win.label, endAt: at(0, win.to), syncedMs: nowMs }
          }
        }
      }

      // Valley: count down to the next peak window opening.
      let endAt = null
      if (day >= 1 && day <= 5) {
        if (minuteOfDay < PEAK_WINDOWS[0].from) endAt = at(0, PEAK_WINDOWS[0].from)
        else if (minuteOfDay < PEAK_WINDOWS[1].from) endAt = at(0, PEAK_WINDOWS[1].from)
      }
      if (endAt === null) {
        // Evening or weekend: the next weekday morning at 9:00.
        for (let delta = 1; delta <= 7; delta += 1) {
          if (isWeekday(delta)) {
            endAt = at(delta, PEAK_WINDOWS[0].from)
            break
          }
        }
      }
      return { phase: 'valley', endAt, syncedMs: nowMs }
    }

    /** Header height plus a little air; a window must keep its whole header on screen. */
    const WINDOW_HEAD = 34
    const TOP_GAP = 6

    /**
     * The frame publishes its reserved window-chrome strip as custom properties on
     * the root; a floating window that slides under it can never be grabbed again.
     * Read it from the document (both roots, first resolvable wins), with a desktop
     * fallback so a composition that publishes nothing still reserves the caption.
     */
    function frameTopInset() {
      if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return 0
      const desktop = typeof document !== 'undefined'
        && document.documentElement?.dataset?.windowsTitlebar !== undefined
      for (const root of [document.documentElement, document.body]) {
        if (root === null || root === undefined) continue
        let css
        try {
          css = getComputedStyle(root)
        } catch {
          continue
        }
        for (const name of ['--dsh-frame-overlay-top', '--dsh-frame-top-clearance']) {
          const raw = css.getPropertyValue(name).trim()
          if (raw === '') continue
          const value = Number.parseFloat(raw)
          if (Number.isFinite(value)) return Math.max(0, value)
        }
      }
      return desktop ? 44 : 0
    }

    /**
     * Keep the header reachable and, when the height is known, keep the whole
     * window inside the viewport: a window whose bottom edge sits below the screen
     * has no grabbable bottom resize band at all.
     */
    function clampOrigin(x, y, height) {
      const inset = frameTopInset() + TOP_GAP
      const maxX = Math.max(0, window.innerWidth - 160)
      let maxY = Math.max(inset, window.innerHeight - WINDOW_HEAD - TOP_GAP)
      if (Number.isFinite(height) && height > 0) {
        maxY = Math.max(inset, Math.min(maxY, window.innerHeight - height))
      }
      return {
        x: Math.min(Math.max(0, Math.round(x)), maxX),
        y: Math.min(Math.max(inset, Math.round(y)), maxY),
      }
    }

    /**
     * Hit-test the header after clamping: whatever chrome the composition draws
     * (caption, drag strip, window menus), walk the window down until the header
     * itself is the topmost element at its own centre. This is the guard that
     * holds even when the published tokens are missing or wrong.
     */
    function reachableOrigin(element, x, y, height) {
      let target = clampOrigin(x, y, height)
      if (typeof document?.elementFromPoint !== 'function' || element === null) return target
      const maxY = Math.max(target.y, window.innerHeight - WINDOW_HEAD - TOP_GAP)
      const probeX = target.x + 80
      for (let step = 0; step < 80; step += 1) {
        const hit = document.elementFromPoint(probeX, target.y + Math.round(WINDOW_HEAD / 2))
        if (hit === null || hit === undefined || element.contains(hit)) return target
        const nextY = target.y + 8
        if (nextY > maxY) return target
        target = { ...target, y: nextY }
      }
      return target
    }

    /** Resize floor, matching the window's own CSS minimum. */
    const MIN_W = 340
    const MIN_H = 240

    /** Resize handle directions: four edges plus four corners. */
    const RESIZE_DIRS = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']

    /**
     * One resize step. The edge opposite the dragged one stays anchored, so a
     * north/west drag moves the origin; that origin is then clamped to the same
     * chrome strip the drag clamps to, and the size keeps the opposite edge fixed.
     */
    function resizeRect(rect, dir, dx, dy) {
      const inset = frameTopInset() + TOP_GAP
      let x = rect.x
      let y = rect.y
      let w = rect.w
      let h = rect.h
      if (dir.includes('e')) w += dx
      if (dir.includes('s')) h += dy
      if (dir.includes('w')) {
        x += dx
        w -= dx
      }
      if (dir.includes('n')) {
        y += dy
        h -= dy
      }
      if (w < MIN_W) {
        if (dir.includes('w')) x -= MIN_W - w
        w = MIN_W
      }
      if (h < MIN_H) {
        if (dir.includes('n')) y -= MIN_H - h
        h = MIN_H
      }
      if (x < 0) {
        w += x
        x = 0
      }
      if (y < inset) {
        h += y - inset
        y = inset
      }
      return {
        x,
        y,
        w: Math.max(MIN_W, Math.min(w, window.innerWidth - x)),
        h: Math.max(MIN_H, Math.min(h, window.innerHeight - y)),
      }
    }

    /**
     * Map one Host-recorded `TurnEndReason` onto a card state.
     * `completed` / `max-tokens` / `forked` are normal endings; `error` and
     * `blocked` are failures; `aborted` is a stop when the user caused it and a
     * failure when something else did; `interrupted` reads as stopped.
     */
    function outcomeState(outcome) {
      const kind = outcome?.kind
      if (kind === 'error' || kind === 'blocked') return 'failed'
      if (kind === 'aborted') return outcome?.cause === 'user' ? 'stopped' : 'failed'
      if (kind === 'interrupted') return 'stopped'
      return 'done'
    }

    /** Live facts win; the persisted value is the resting state. */
    function displayState(card, summary, scoped) {
      if (card.sessionId === null) return 'draft'
      if (scoped !== null && scoped !== undefined && scoped.pendingInteraction != null) return 'needsDecision'
      if ((scoped?.running ?? summary?.running) === true) return 'running'
      if (card.state === 'draft' || card.state === 'running') return 'idle'
      return card.state
    }

    // ---------------------------------------------------------- components

    class EmbedBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { message: null }
      }
      static getDerivedStateFromError(error) {
        return { message: error instanceof Error ? error.message : String(error) }
      }
      componentDidCatch(error) {
        console.error('[dsh-task-board] conversation embed failed:', error)
      }
      render() {
        if (this.state.message !== null) return h('div', { className: 'tb-embed-error' }, this.state.message)
        return this.props.children
      }
    }

    /** The sidebar cell; it owns only its glyph geometry. */
    function BoardIcon({ size = 18, active = false }) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: active ? 2 : 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block' },
      },
      h('rect', { x: 3, y: 4, width: 7, height: 16, rx: 1.6 }),
      h('rect', { x: 14, y: 4, width: 7, height: 9, rx: 1.6 }),
      h('path', { d: 'M14 17h7' }))
    }

    /** What the card says the task is doing right now (one line, ellipsized). */
    function actionLine(digest, state, now, runningSince, t) {
      const live = state === 'running' || state === 'settling'
      if (digest !== undefined && digest !== null) {
        if (digest.phase === 'tool' && digest.tool) {
          const hint = digest.tool.hint ? ` · ${digest.tool.hint}` : ''
          return `⚙ ${digest.tool.name}${hint}`
        }
        if (digest.phase === 'writing' && live) return `✎ ${t('phase.writing')}`
        if (live) {
          const since = digest.startedAt ?? runningSince ?? now
          return `${t('phase.thinking')} · ${formatDuration(now - since)}`
        }
      } else if (live) {
        return `${t('phase.thinking')} · ${formatDuration(now - (runningSince ?? now))}`
      }
      if (state === 'needsDecision') return t('phase.awaiting')
      return ''
    }

    /** The most useful sentence the card can show: live stream, last output, or why it stopped. */
    function outputLine(card, digest, state) {
      if (state === 'failed') return card.outcome?.message ?? card.outcome?.code ?? ''
      // A finished Turn's stored text is newer than the last polled digest.
      if (state === 'done' || state === 'stopped') return card.outcome?.text ?? card.lastText ?? ''
      if (digest?.stream) return digest.stream
      if (digest?.text) return digest.text
      if (state === 'running' || state === 'settling') return ''
      return card.outcome?.text ?? card.lastText ?? ''
    }

    function TaskCard({ card, summary, digest, now, state: stateProp, pinned, busy, resuming, elapsedMs, runningSince, t, onOpen, onPin, onRemove, onResume }) {
      const state = stateProp
      const live = card.sessionId === null ? undefined : summaryTitle(summary)
      const title = live ?? (card.title === '' ? t('untitled') : card.title)
      // `settling` keeps the spinner: the Turn has stopped but the Host has not
      // classified its ending yet, and guessing "done" here is exactly what made
      // a failed or stopped Turn read as complete.
      const spinning = state === 'running' || state === 'settling'
      const note = card.outcome?.message ?? card.outcome?.code ?? undefined
      // A draft that already holds typed text loses that text, so it asks twice.
      const needsConfirm = card.sessionId === null && card.draftPrompt.trim() !== ''

      const action = actionLine(digest, state, now, runningSince, t)
      const output = outputLine(card, digest, state)
      // "Is it stuck?" — the Host stamps every event, so silence is measurable.
      const lastEvent = typeof digest?.lastEventAt === 'number' ? digest.lastEventAt : undefined
      const quietMs = state === 'running' && lastEvent !== undefined ? Math.max(0, now - lastEvent) : 0
      const stalled = quietMs >= 60000
      // The moment the sidebar's session row dates: the Host's last update for
      // this Session, falling back to the classified Turn ending or the last
      // polled digest when the Session summary is not there. `createdAt` stays
      // out: a card dragged in today from an old Session must still read "2天".
      const stamps = card.sessionId === null
        ? []
        : [summary?.updatedAt, card.outcome?.at, digest?.lastEventAt]
          .filter((value) => Number.isFinite(value) && value > 0)
      const updatedAtMs = stamps.length === 0 ? undefined : Math.max(...stamps)
      // Running cards already spend this slot on elapsed or quiet time.
      const showAge = updatedAtMs !== undefined && state !== 'running' && state !== 'settling'
      // A Turn that ended abnormally can be nudged straight from the board: no
      // window, no conversation, one "继续" message sent to that Session.
      const resumeVisible = card.sessionId !== null && (state === 'failed' || state === 'stopped')

      const [armed, setArmed] = React.useState(false)
      React.useEffect(() => {
        if (!armed) return undefined
        const timer = setTimeout(() => setArmed(false), 3500)
        return () => clearTimeout(timer)
      }, [armed])
      return h('div', {
        className: `tb-card tb-card-${state}`,
        role: 'button',
        tabIndex: 0,
        onClick: () => onOpen(card.id),
        onKeyDown: (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onOpen(card.id)
        },
      },
      h('div', { className: `tb-card-actions${pinned ? ' has-on' : ''}` },
        h('button', {
          type: 'button',
          className: `tb-pin${pinned ? ' is-on' : ''}`,
          title: pinned ? t('unpin') : t('pin'),
          'aria-label': pinned ? t('unpin') : t('pin'),
          onClick: (event) => {
            event.stopPropagation()
            onPin(card.id)
          },
        }, h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true },
          h('path', {
            d: 'M6 1h4l-.8 4 2.3 2.2H3.5L5.8 5 5 1zM8 7.2V15',
            fill: pinned ? 'currentColor' : 'none',
            stroke: 'currentColor',
            strokeWidth: 1.3,
            strokeLinejoin: 'round',
            strokeLinecap: 'round',
          }))),
        h('button', {
          type: 'button',
          className: `tb-card-x${armed ? ' is-armed' : ''}`,
          title: armed ? t('removeTaskConfirm') : t('removeTask'),
          'aria-label': t('removeTask'),
          onClick: (event) => {
            event.stopPropagation()
            if (needsConfirm && !armed) {
              setArmed(true)
              return
            }
            onRemove(card.id)
          },
        }, armed ? t('removeTaskConfirm') : '×')),
      h('div', { className: 'tb-card-title', title }, title),
      h('div', { className: 'tb-card-foot' },
        spinning
          ? h('span', { className: 'tb-spin', role: 'presentation' })
          : h('span', { className: 'tb-dot' }),
        h('span', {
          className: `tb-chip tb-chip-${state}`,
          title: note,
        }, t(`state.${state}`)),
        showAge
          ? h('span', {
            className: 'tb-age',
            title: t('updatedAt', { time: agoLabel(updatedAtMs, now, t) }),
          }, timeLabel(updatedAtMs, now, t))
          : null,
        busy ? h('span', { className: 'tb-card-busy' }, t('creating')) : null,
        stalled
          ? h('span', {
            className: `tb-stall ${quietMs >= 300000 ? 'is-bad' : 'is-warn'}`,
            title: t('stall.quiet', { d: formatDuration(quietMs) }),
          }, t('stall.quiet', { d: formatDuration(quietMs) }))
          : state === 'running' && elapsedMs !== undefined
            ? h('span', {
              className: 'tb-elapsed',
              title: t('runningFor', { d: formatDuration(elapsedMs) }),
            }, formatDuration(elapsedMs))
            : null),
      action === ''
        ? h('div', { className: 'tb-card-action' }, '')
        : h('div', { className: 'tb-card-action', title: action }, action),
      output === ''
        ? null
        : [
          h('div', { key: 'clamp', className: 'tb-card-output' }, output),
          h('div', { key: 'full', className: 'tb-card-output-full' }, output),
        ],
      resumeVisible
        ? h('button', {
          type: 'button',
          className: `tb-card-resume${resuming ? ' is-busy' : ''}`,
          disabled: resuming,
          title: t('resume'),
          onClick: (event) => {
            event.stopPropagation()
            if (!resuming) onResume(card.id)
          },
        }, resuming ? t('resuming') : `▶ ${t('resume')}`)
        : null)
    }

    /**
     * The billing badge, centered in the board header.
     *
     * It touches the wall clock only when it must: on mount (the board was
     * just opened) and once an hour to re-verify the period. Between checks
     * the countdown decrements itself one local minute at a time; reaching a
     * period boundary is itself a re-verify trigger, so there is no per-second
     * clock polling behind this text.
     */
    function PeakClockBadge({ t }) {
      const [clock, setClock] = React.useState(() => readPeakValley(Date.now()))
      const clockRef = React.useRef(clock)
      clockRef.current = clock
      const stepsRef = React.useRef(0)
      const [, nudge] = React.useState(0)

      React.useEffect(() => {
        const resync = () => {
          stepsRef.current = 0
          setClock(readPeakValley(Date.now()))
          nudge((value) => value + 1)
        }
        // 对表：每过 1 小时校验一次时间点（打开看板时已由挂载对过一次）。
        const hourly = setInterval(resync, MS_HOUR)
        // 平时自减：本地每分钟走一格，不与时钟交互；跨过时段边界才对表。
        const minute = setInterval(() => {
          const current = clockRef.current
          if (current.endAt - current.syncedMs - (stepsRef.current + 1) * MS_MIN <= 0) {
            resync()
            return
          }
          stepsRef.current += 1
          nudge((value) => value + 1)
        }, MS_MIN)
        return () => {
          clearInterval(hourly)
          clearInterval(minute)
        }
      }, [])

      // Ceiling, so the badge reads “1 分钟” until the minute fully elapses.
      const remainMinutes = Math.ceil(
        Math.max(0, clock.endAt - clock.syncedMs - stepsRef.current * MS_MIN) / MS_MIN,
      )
      const text = clock.phase === 'peak'
        ? `${t('peakNow')} · ${clock.label}`
        : `${t('valleyNow')} · ${t('valleyRemain', {
          h: String(Math.floor(remainMinutes / 60)),
          m: String(remainMinutes % 60),
        })}`
      return h('span', {
        className: `tb-clock tb-clock-${clock.phase}`,
        title: t('peakValleyHint'),
      }, text)
    }

    // --- session-content search -------------------------------------------
    //
    // Only sessions that already own a board card are searched: a card is the
    // user's statement that this session matters, and it is also what gives a
    // hit somewhere to open. Locating a hit inside the hosted conversation is
    // best-effort by design — the platform exposes no "open at seq" API — so we
    // page the window back to the hit and match the message text in the DOM.
    //
    // The anchor/normalise/flash helpers are adapted from dsh-session-workbench
    // (MIT, https://github.com/PolinniZhong/dsh-session-workbench), which solved
    // the same locate problem against the same chat DOM.

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    /** Settle with `promise`, or reject after `ms` so a stuck read never freezes the UI. */
    function raceTimeout(promise, ms) {
      let timer
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), ms)
      })
      return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
    }

    function normText(value) {
      return String(value ?? '').replace(/\s+/gu, '')
    }

    /**
     * Markdown-clean slices of the hit text, longest first. Several candidates
     * are kept because a rendered message may not contain every raw-text token
     * (a URL's href, a fenced block's delimiter, …).
     */
    function stableAnchors(text) {
      const segments = String(text ?? '').split(/[\s*#>`\-[\]()|_~=…]+/u).filter((segment) => segment.length >= 6)
      if (segments.length === 0) return []
      segments.sort((a, b) => b.length - a.length)
      return [...new Set(segments.map((segment) => segment.slice(0, 48)))].slice(0, 3)
    }

    /** Literal, case-insensitive, whitespace-flexible query matcher (global). */
    function queryPattern(query) {
      const parts = query.trim().split(/\s+/u).map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
      if (parts.length === 0 || parts.join('') === '') return null
      return new RegExp(parts.join('\\s+'), 'giu')
    }

    /** Snippet nodes with the query occurrences wrapped in <mark>. */
    function highlightParts(text, query) {
      const pattern = queryPattern(query)
      if (pattern === null) return text
      const nodes = []
      let cursor = 0
      for (const match of text.matchAll(pattern)) {
        if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
        nodes.push(h('mark', { key: `mark-${match.index}` }, match[0]))
        cursor = match.index + match[0].length
      }
      if (cursor < text.length) nodes.push(text.slice(cursor))
      return nodes
    }

    /** The floating window that hosts `cardId`, once its conversation mounted. */
    function findWindow(cardId) {
      for (const frame of document.querySelectorAll('.tbwin[data-card]')) {
        if (frame.getAttribute('data-card') === cardId
          && frame.querySelector('[data-conversation-content]') !== null) return frame
      }
      return null
    }

    /** The rendered message row whose text contains one of the anchors. */
    function findAnchorRow(frame, needles) {
      const rows = frame.querySelectorAll('[data-chat-anchor-key]')
      for (const needle of needles) {
        for (const row of rows) {
          if (normText(row.textContent).includes(needle)) return row
        }
      }
      return null
    }

    /** Scroll the hit into view and flash its row (twice: follow-tail can snap back). */
    function flashRow(row) {
      const scroll = (behavior) => {
        try {
          row.scrollIntoView({ behavior, block: 'center' })
        } catch {
          row.scrollIntoView()
        }
      }
      scroll('smooth')
      setTimeout(() => { if (row.isConnected) scroll('auto') }, 320)
      setTimeout(() => { if (row.isConnected) scroll('auto') }, 900)
      row.classList.add('tbwin-row-flash')
      setTimeout(() => row.classList.remove('tbwin-row-flash'), 2400)
    }

    /**
     * Paint the query occurrences inside one row with the CSS Custom Highlight
     * API. No DOM nodes are inserted, so React's reconciliation is untouched and
     * the highlight disappears on the next render or after the timeout.
     */
    function highlightQuery(row, query) {
      const pattern = queryPattern(query)
      if (pattern === null || typeof Highlight !== 'function'
        || typeof CSS === 'undefined' || CSS.highlights === undefined) return
      const ranges = []
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        const text = node.data
        pattern.lastIndex = 0
        let match = pattern.exec(text)
        while (match !== null) {
          const range = document.createRange()
          range.setStart(node, match.index)
          range.setEnd(node, match.index + match[0].length)
          ranges.push(range)
          if (match[0].length === 0) break
          match = pattern.exec(text)
        }
      }
      if (ranges.length === 0) return
      CSS.highlights.set('tb-search-hit', new Highlight(...ranges))
      setTimeout(() => CSS.highlights.delete('tb-search-hit'), 6000)
    }

    /** Line-art magnifier used by the header search field. */
    function MagnifierIcon({ size = 13 }) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      h('circle', { cx: 7, cy: 7, r: 4.2 }),
      h('path', { d: 'M10.2 10.2 13.5 13.5' }))
    }

    /**
     * Header search field + result popover.
     *
     * Scope is two-dimensional by intent but one-dimensional today: the session
     * dimension is fixed to "sessions that already have a card" (the only ones
     * that can be opened here), while the workspace dimension is chosen by the
     * chips — every followed workspace, or a subset.
     */
    function SearchBox(props) {
      const { t, actions, runtime } = props
      const workspaces = Array.isArray(props.workspaces) ? props.workspaces : []
      const cards = Array.isArray(props.cards) ? props.cards : []
      const sessions = props.sessions
      const [open, setOpen] = React.useState(false)
      const [query, setQuery] = React.useState('')
      const [scope, setScope] = React.useState([])
      const [active, setActive] = React.useState(0)
      const [result, setResult] = React.useState({ phase: 'idle', items: [], failed: 0, truncated: false })
      const rootRef = React.useRef(null)
      const inputRef = React.useRef(null)
      const timerRef = React.useRef(null)
      const runRef = React.useRef(0)
      const anchorRef = React.useRef(null)
      const layerRef = React.useRef(null)
      const [anchor, setAnchor] = React.useState(null)
      const [boxWidth, setBoxWidth] = React.useState(0)

      // The visible field lives in a fixed portal; this in-flow anchor reserves
      // its slot immediately left of "关注工作区" and marks its right edge, so
      // the field expands leftward without moving the button.
      const measure = React.useCallback(() => {
        const node = anchorRef.current
        if (node === null) return
        const rect = node.getBoundingClientRect()
        setAnchor((previous) => (previous !== null
          && Math.abs(previous.right - rect.right) < 0.5
          && Math.abs(previous.top - rect.top) < 0.5
          ? previous
          : { right: rect.right, top: rect.top }))
      }, [])

      React.useLayoutEffect(() => {
        measure()
        const center = anchorRef.current?.parentElement
        let observer = null
        if (typeof ResizeObserver === 'function' && center !== null && center !== undefined) {
          observer = new ResizeObserver(measure)
          observer.observe(center)
        }
        window.addEventListener('resize', measure)
        return () => {
          observer?.disconnect()
          window.removeEventListener('resize', measure)
        }
      }, [measure])

      // The expanded field is wider; keep the panel centred under the actual
      // field and clamped inside the viewport.
      React.useLayoutEffect(() => {
        const layer = layerRef.current
        if (layer === null) return
        const update = () => {
          const width = layer.getBoundingClientRect().width
          setBoxWidth((previous) => (Math.abs(previous - width) < 0.5 ? previous : width))
        }
        update()
        let observer = null
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(update)
          observer.observe(layer)
        }
        return () => observer?.disconnect()
      }, [anchor, open])

      React.useEffect(() => {
        runtime.searchOpen = open
        return () => { runtime.searchOpen = false }
      }, [open])

      const close = React.useCallback(() => {
        setOpen(false)
        setActive(0)
      }, [])

      const runSearch = React.useCallback(async (text) => {
        const trimmed = text.trim()
        if (trimmed.length < 2) {
          setResult({ phase: 'idle', items: [], failed: 0, truncated: false })
          return
        }
        const id = ++runRef.current
        setResult((previous) => ({ ...previous, phase: 'loading' }))
        try {
          const value = await actions.searchSessions(trimmed, scope.length === 0 ? null : scope)
          if (id !== runRef.current) return
          setResult({
            phase: 'done',
            forQuery: trimmed,
            items: Array.isArray(value?.items) ? value.items : [],
            failed: Number(value?.failed) || 0,
            truncated: value?.truncated === true,
          })
          setActive(0)
        } catch (error) {
          if (id !== runRef.current) return
          setResult({
            phase: 'error',
            items: [],
            failed: 0,
            truncated: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }, [actions, scope])

      React.useEffect(() => {
        if (!open) return
        if (timerRef.current !== null) clearTimeout(timerRef.current)
        const trimmed = query.trim()
        if (trimmed.length < 2) {
          // A shorter query supersedes any in-flight response.
          runRef.current += 1
          setResult({ phase: 'idle', items: [], failed: 0, truncated: false })
          return
        }
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          void runSearch(trimmed)
        }, 300)
        return () => {
          if (timerRef.current !== null) clearTimeout(timerRef.current)
        }
      }, [query, scope, open, runSearch])

      React.useEffect(() => {
        if (!open) return
        const onPointerDown = (event) => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) close()
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => document.removeEventListener('pointerdown', onPointerDown, true)
      }, [open, close])

      // Escape belongs to the popover while it is open, wherever focus sits.
      // The board's window-close shortcut backs off on `runtime.searchOpen`.
      React.useEffect(() => {
        if (!open) return
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          close()
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [open, close])

      const toggleScope = (workspaceId) => {
        setScope((previous) => (previous.includes(workspaceId)
          ? previous.filter((id) => id !== workspaceId)
          : [...previous, workspaceId]))
      }

      const openHit = async (item) => {
        close()
        try {
          const outcome = await actions.revealSearchHit({ ...item, query: query.trim() })
          if (outcome?.located === false) console.warn(`[dsh-task-board] ${t('searchLocateMiss')}`)
        } catch (error) {
          console.warn('[dsh-task-board] reveal failed:', error)
        }
      }

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close()
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          if (timerRef.current !== null) {
            clearTimeout(timerRef.current)
            timerRef.current = null
            void runSearch(query)
            return
          }
          const fresh = result.phase === 'done' && result.forQuery === query.trim()
          if (fresh && result.items.length > 0) void openHit(result.items[active] ?? result.items[0])
          else void runSearch(query)
          return
        }
        if (event.key === 'ArrowDown' && result.phase === 'done' && result.items.length > 0) {
          event.preventDefault()
          setActive((index) => (index + 1) % result.items.length)
          return
        }
        if (event.key === 'ArrowUp' && result.phase === 'done' && result.items.length > 0) {
          event.preventDefault()
          setActive((index) => (index - 1 + result.items.length) % result.items.length)
        }
      }

      const cardOf = (item) => cards.find((card) => card.id === item.cardId)
      const workspaceOf = (card) => workspaces.find((workspace) => workspace.workspaceId === card?.workspaceId)
      const cardTitle = (item) => {
        const card = cardOf(item)
        const summary = sessions?.byId?.[item.sessionId]
        return card?.title || summaryTitle(summary) || t('untitled')
      }

      let body
      if (query.trim().length < 2 || result.phase === 'idle') {
        body = h('div', { className: 'tb-search-hint' }, t('searchHint'))
      } else if (result.phase === 'loading') {
        body = h('div', { className: 'tb-search-hint' }, t('searchSearching'))
      } else if (result.phase === 'error') {
        body = h('div', { className: 'tb-search-hint' }, `${t('searchFailed')}: ${result.error ?? ''}`)
      } else if (result.items.length === 0) {
        body = h('div', { className: 'tb-search-hint' }, t('searchEmpty'))
      } else {
        body = result.items.map((item, index) => {
          const card = cardOf(item)
          const workspace = workspaceOf(card)
          const label = workspace?.title ?? card?.workspacePath ?? ''
          return h('button', {
            key: `${item.cardId}:${item.seq}`,
            type: 'button',
            className: `tb-hit${index === active ? ' is-active' : ''}`,
            onMouseEnter: () => setActive(index),
            onClick: () => { void openHit(item) },
          },
          h('span', { className: 'tb-hit-meta' },
            h('span', { className: 'tb-hit-card' }, cardTitle(item)),
            label === '' ? null : h('span', { className: 'tb-hit-ws' }, label),
            item.total > 1 ? h('span', { className: 'tb-hit-ws' }, `${item.total}×`) : null,
            h('span', { className: 'tb-hit-time' },
              item.time === null || item.time === undefined ? '' : timeLabel(item.time, Date.now(), t))),
          h('span', { className: 'tb-hit-text' }, highlightParts(item.snippet ?? '', query)))
        })
      }

      const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth
      const panelWidth = Math.max(260, Math.min(560, viewportWidth - 24))
      const fieldWidth = boxWidth === 0 ? 127 : boxWidth
      const fieldLeft = anchor === null ? 12 : anchor.right - fieldWidth
      const panelLeft = anchor === null ? 12 : Math.min(
        Math.max(12, fieldLeft + fieldWidth / 2 - panelWidth / 2),
        Math.max(12, viewportWidth - panelWidth - 12),
      )
      const panelTop = anchor === null ? 0 : anchor.top + 34

      return h(React.Fragment, null,
        h('div', { ref: anchorRef, className: 'tb-search-anchor', 'aria-hidden': true }),
        anchor === null || typeof document === 'undefined' ? null : createPortal(
          h('div', {
            ref: rootRef,
            className: `tb-search-layer${open ? ' is-open' : ''}`,
            style: { right: viewportWidth - anchor.right, top: anchor.top },
          },
          h('div', {
            className: 'tb-search-box',
            onClick: () => {
              setOpen(true)
              inputRef.current?.focus?.()
            },
          },
            h(MagnifierIcon, null),
            h('input', {
              ref: inputRef,
              type: 'search',
              value: query,
              maxLength: 120,
              placeholder: t('searchPlaceholder'),
              'aria-label': t('searchPlaceholder'),
              onFocus: () => setOpen(true),
              onChange: (event) => setQuery(event.target.value),
              onKeyDown,
            })),
          open
            ? h('div', {
              className: 'tb-search-panel',
              role: 'dialog',
              'aria-label': t('searchPlaceholder'),
              style: { left: panelLeft, top: panelTop, width: panelWidth },
            },
            workspaces.length === 0
              ? null
              : h('div', { className: 'tb-search-scope' },
                h('span', { className: 'tb-search-scope-label' }, t('searchScopeLabel')),
                h('button', {
                  type: 'button',
                  className: `tb-scope-chip${scope.length === 0 ? ' is-on' : ''}`,
                  onClick: () => setScope([]),
                }, t('searchScopeAll')),
                workspaces.map((workspace) => h('button', {
                  key: workspace.workspaceId,
                  type: 'button',
                  title: workspace.path,
                  className: `tb-scope-chip${scope.includes(workspace.workspaceId) ? ' is-on' : ''}`,
                  onClick: () => toggleScope(workspace.workspaceId),
                }, workspace.title ?? workspace.path))),
            h('div', { className: 'tb-search-note' },
              t('searchOnlyCards'),
              result.phase === 'done' && result.truncated ? ` · ${t('searchTruncated')}` : '',
              result.phase === 'done' && result.failed > 0 ? ` · ${t('searchPartial', { n: result.failed })}` : ''),
            h('div', { className: 'tb-search-body' }, body))
            : null),
          document.body))
    }

    /** `main / taskboard` — the lanes, the new-task controls, the follow-workspace picker, the billing badge. */
    function TaskBoardPanel(props) {
      const { board, actions, runtime, useSessions, useWorkspaces, useSessionStatus } = props
      const t = props.t ?? local
      const state = React.useSyncExternalStore(board.subscribe, board.getSnapshot)
      const sessions = useSessions((snapshot) => snapshot)
      const workspaces = useWorkspaces((snapshot) => snapshot)
      const statuses = useSessionStatus((snapshot) => snapshot)
      const latest = React.useRef({ workspaces, sessions })
      latest.current = { workspaces, sessions }

      // One clock for every running card: a plain 1s tick, no Session subscription.
      // The same tick pulls the Host digest for running cards — one batched RPC per
      // second while something runs, silent otherwise.
      const [, tick] = React.useState(0)
      const runningIds = React.useRef([])
      React.useEffect(() => {
        const timer = setInterval(() => {
          tick((value) => value + 1)
          if (runningIds.current.length > 0) void actions.pollDigests(runningIds.current)
        }, 1000)
        return () => clearInterval(timer)
      }, [])

      const [pickerOpen, setPickerOpen] = React.useState(false)

      // Backfill the summary line once per mount for cards restored without one.
      React.useEffect(() => {
        if (state.ready) actions.backfillSummaries()
      }, [state.ready])

      const open = new Set(state.windows.map((win) => win.cardId))
      const pinned = new Set(state.pinned)
      const parked = state.cards.filter((card) => !open.has(card.id))

      const items = workspaces?.items ?? []
      const byId = new Map(items.map((item) => [item.workspaceId, item]))
      // Every explicitly added lane, then any workspace that still owns parked cards,
      // so a card can never become invisible by removing its lane.
      const laneIds = [...new Set([
        ...state.partitions.filter((id) => byId.has(id)),
        ...parked.map((card) => card.workspaceId).filter((id) => id !== null && byId.has(id)),
      ])]
      const detached = parked.filter((card) => card.workspaceId === null || !byId.has(card.workspaceId))
      const available = items.filter((item) => !laneIds.includes(item.workspaceId))
      const now = Date.now()

      // Sessions whose card is currently running: the only ones worth polling.
      const moving = new Set()
      for (const card of parked) {
        if (card.sessionId === null) continue
        const cardState = displayState(card, sessions?.byId?.[card.sessionId], statusOf(statuses, card.sessionId))
        if (cardState === 'running') moving.add(card.sessionId)
      }
      runningIds.current = [...moving]

      const renderCard = (card) => {
        const summary = card.sessionId === null ? undefined : sessions?.byId?.[card.sessionId]
        const scoped = card.sessionId === null ? undefined : statusOf(statuses, card.sessionId)
        const cardState = displayState(card, summary, scoped)
        const since = card.sessionId === null ? undefined : runtime.runningSince.get(card.sessionId)
        return h(TaskCard, {
          key: card.id,
          card,
          summary,
          digest: card.sessionId === null ? undefined : state.digests?.[card.sessionId],
          now,
          state: cardState,
          pinned: pinned.has(card.id),
          busy: state.sending.includes(card.id),
          resuming: state.continuing.includes(card.id),
          elapsedMs: cardState === 'running' && since !== undefined ? now - since : undefined,
          runningSince: since,
          t,
          onOpen: actions.openCard,
          onPin: actions.togglePin,
          onRemove: actions.removeCard,
          onResume: actions.resumeCard,
        })
      }

      /**
       * Card order inside a lane.
       *
       * Pinned cards stay above everything and keep their creation order among
       * themselves (pinning is an explicit user statement). The rest sort by how
       * much attention they need: a broken Turn first, then a question waiting on
       * the user, then live work, then everything that finished.
       *
       * Drafts are hand-written in `draft` and `idle` falls with the finished
       * group, so an untouched card never floats above real work.
       */
      const STATE_RANK = {
        failed: 0,
        needsDecision: 1,
        running: 2,
        settling: 3,
        stopped: 4,
        done: 5,
        idle: 6,
        draft: 7,
      }

      const sortCards = (cards) => cards.slice().sort((a, b) => {
        const pa = pinned.has(a.id) ? 0 : 1
        const pb = pinned.has(b.id) ? 0 : 1
        if (pa !== pb) return pa - pb
        if (pa === 0) return a.slot - b.slot
        const ra = STATE_RANK[displayState(a, sessions?.byId?.[a.sessionId], statusOf(statuses, a.sessionId))] ?? 9
        const rb = STATE_RANK[displayState(b, sessions?.byId?.[b.sessionId], statusOf(statuses, b.sessionId))] ?? 9
        return ra - rb || a.slot - b.slot
      })

      // --- lane drag reordering (our own DOM, HTML5 DnD) -----------------
      const [laneDrag, setLaneDrag] = React.useState(null)

      const laneDragProps = (id) => ({
        draggable: true,
        onDragStart: (event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData(LANE_MIME, id)
          // Keep the browser from treating this as a Session drag.
          event.dataTransfer.setData('text/plain', '')
          setLaneDrag(id)
        },
        onDragEnd: () => setLaneDrag(null),
        onDragOver: (event) => {
          if (laneDrag === null || laneDrag === id) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        },
        onDrop: (event) => {
          const source = event.dataTransfer.getData(LANE_MIME) || laneDrag
          setLaneDrag(null)
          if (source === null || source === '' || source === id) return
          event.preventDefault()
          event.stopPropagation()
          const next = laneIds.filter((laneId) => laneId !== source)
          const at = next.indexOf(id)
          if (at < 0) return
          next.splice(at, 0, source)
          actions.setLaneOrder(next)
        },
      })

      // --- Session drop (drag a session row out of the sidebar) ----------
      const acceptsSession = (event) => Array.from(event.dataTransfer.types ?? []).includes('text/plain')

      const onBoardDragOver = (event) => {
        if (laneDrag !== null || !acceptsSession(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }

      const onBoardDrop = (event) => {
        if (laneDrag !== null) return
        const sessionId = event.dataTransfer.getData('text/plain')
        if (sessionId === '') return
        if (sessions?.byId?.[sessionId] === undefined) return
        event.preventDefault()
        event.stopPropagation()
        actions.addSessionCard(sessionId, latest.current)
      }

      const lanes = laneIds.map((id) => {
        const workspace = byId.get(id)
        const cards = sortCards(parked.filter((card) => card.workspaceId === id))
        return h('section', {
          className: `tb-lane${laneDrag === id ? ' is-dragging' : ''}`,
          key: id,
        },
        h('header', { className: 'tb-lane-head', ...laneDragProps(id) },
          h('span', { className: 'tb-lane-title', title: workspace.path },
            workspace.title ?? workspace.path),
          h('span', { className: 'tb-lane-count' }, String(cards.length)),
          h('div', { className: 'tb-lane-actions' },
            h('button', {
              type: 'button',
              className: 'tb-lane-btn',
              title: t('addCardHere'),
              'aria-label': t('addCardHere'),
              onClick: () => actions.createCard(latest.current, id),
            }, '+'),
            h('button', {
              type: 'button',
              className: 'tb-lane-btn',
              title: cards.length === 0 ? t('removeLane') : t('laneHasCards'),
              'aria-label': t('removeLane'),
              disabled: cards.length > 0,
              onClick: () => actions.removePartition(id),
            }, '×'))),
        h('div', { className: 'tb-lane-body' },
          cards.length === 0
            ? h('div', { className: 'tb-lane-empty' }, t('laneEmpty'))
            : cards.map(renderCard)))
      })

      if (detached.length > 0) {
        lanes.push(h('section', { className: 'tb-lane', key: '__detached' },
          h('header', { className: 'tb-lane-head' },
            h('span', { className: 'tb-lane-title' }, t('laneDetached')),
            h('span', { className: 'tb-lane-count' }, String(detached.length))),
          h('div', { className: 'tb-lane-body' }, sortCards(detached).map(renderCard))))
      }

      return h('div', {
        className: `tb-board${laneDrag !== null ? ' is-drop' : ''}`,
        onDragOver: onBoardDragOver,
        onDrop: onBoardDrop,
      },
      h('header', { className: 'tb-head' },
        h('h1', { className: 'tb-title' }, t('panel')),
        h('div', { className: 'tb-center' },
          h(PeakClockBadge, { t })),
        h('div', { className: 'tb-rows' },
          h('span', { className: 'tb-rows-label' }, t('laneRowsPrefix')),
          h('div', {
            className: 'tb-seg',
            role: 'group',
            'aria-label': `${t('laneRowsPrefix')} 1 2 3 ${t('laneRowsSuffix')}`,
          }, [1, 2, 3].map((rows) => h('button', {
            key: rows,
            type: 'button',
            className: `tb-seg-btn${state.laneRows === rows ? ' is-on' : ''}`,
            'aria-pressed': state.laneRows === rows,
            title: t('laneRowsHint', { n: rows }),
            onClick: () => actions.setLaneRows(rows),
          }, String(rows)))),
          h('span', { className: 'tb-rows-label' }, t('laneRowsSuffix'))),
        h('div', { className: 'tb-head-actions' },
          h(SearchBox, {
            t,
            actions,
            runtime,
            workspaces: items.filter((item) => laneIds.includes(item.workspaceId)),
            cards: state.cards,
            sessions,
          }),
          h('button', {
            type: 'button',
            className: 'tb-new',
            onClick: () => setPickerOpen((value) => !value),
          }, t('addWorkspace')),
          state.storageError === null ? null
            : h('span', { className: 'tb-warn', title: state.storageError }, t('storageUnavailable'))),
        pickerOpen
          ? [
            h('div', { key: 'scrim', className: 'tb-scrim', onClick: () => setPickerOpen(false) }),
            h('div', { key: 'pop', className: 'tb-pop' },
              available.length === 0
                ? h('div', { className: 'tb-pop-note' }, t('allWorkspaces'))
                : available.map((item) => h('button', {
                  key: item.workspaceId,
                  type: 'button',
                  className: 'tb-pop-row',
                  onClick: () => {
                    actions.addPartition(item.workspaceId)
                    setPickerOpen(false)
                  },
                },
                h('span', { className: 'tb-pop-name' }, item.title ?? item.path),
                h('span', { className: 'tb-pop-path', title: item.path }, item.path)))),
          ]
          : null),
      lanes.length === 0
        ? h('div', { className: 'tb-empty' }, t('noWorkspaceLane'))
        : h('div', {
          className: 'tb-lanes',
          'data-rows': String(state.laneRows),
        }, lanes))
    }

    /**
     * `sidebar.workspaces.session.row.action` — one hover button per shipped
     * Session row. Drag-and-drop from the sidebar works too, but the row is only
     * draggable while its list runs a drag controller, so this button is the
     * always-available path. Renders nothing once the Session is on the board.
     */
    function AddToBoardButton(props) {
      const { board, actions, sessionId, useSessions, useWorkspaces } = props
      const t = props.t ?? local
      const state = React.useSyncExternalStore(board.subscribe, board.getSnapshot)
      const sessions = useSessions((snapshot) => snapshot)
      const workspaces = useWorkspaces((snapshot) => snapshot)
      const context = React.useRef({ sessions, workspaces })
      context.current = { sessions, workspaces }
      if (typeof sessionId !== 'string') return null
      if (state.cards.some((card) => card.sessionId === sessionId)) return null
      return h('button', {
        type: 'button',
        className: 'tb-rowadd',
        title: t('addToBoard'),
        'aria-label': t('addToBoard'),
        onClick: () => actions.addSessionCard(sessionId, context.current),
      }, h('svg', {
        viewBox: '0 0 16 16',
        width: 13,
        height: 13,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      h('rect', { x: 2, y: 3, width: 5, height: 10, rx: 1 }),
      h('rect', { x: 9, y: 3, width: 5, height: 6, rx: 1 }),
      h('path', { d: 'M9 12h5' })))
    }

    /**
     * Replacement renderer for the `file` user-text node.
     *
     * `ui-reference` occupies this key and its activation calls
     * `ctx.sidebarRight.openResource(...)`, which throws in a composition with no
     * mounted right-hand session surface ("sidebarRight: no session surface is
     * mounted") — the click then surfaces a retry dialog and never reaches the OS.
     *
     * Registering the same key replaces that occupant, so the board's windows get
     * a chip whose activation is the Host opener. Nothing about the click needs to
     * be raced: the shipped handler is simply not installed any more.
     */
    /**
     * One floating window; the header is the drag region.
     *
     * Pointer capture is deliberately NOT used: it retargets every pointer event
     * to the captured element, so per-element move/up handlers stop firing as soon
     * as the pointer leaves the header. The drag instead binds window-level
     * listeners for its own duration, which stays responsive anywhere on screen.
     */
    function TaskWindow({ win, card, summary, t, actions, children }) {
      const frame = React.useRef(null)
      const live = card === undefined ? undefined : summaryTitle(summary)
      const title = live ?? (card === undefined || card.title === '' ? t('untitled') : card.title)


      /**
       * File chips inside a board window open through the Host instead of the
       * right-hand preview column.
       *
       * The Conversation body is portalled to <body>, so this window's DOM subtree
       * does NOT contain the chip — an earlier `frame.current.contains(target)`
       * gate silently dropped every click. Ownership is instead decided by which
       * chip was clicked, and the chip set belongs to this board: nothing else in
       * the app renders `[data-ref-chip]` inside a floating window.
       *
       * Capture on `document` + `stopImmediatePropagation` runs before React's
       * root-delegated handler, so `ui-reference`'s activation (which throws
       * "sidebarRight: no session surface is mounted" outside the main panel) never
       * runs. The main conversation keeps its shipped behaviour because there is no
       * board window open for it.
       */
      const handleChipClick = (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey) return
        // Two shapes render a file reference, and they carry different attributes:
        //   `ReferenceChip` (user text nodes)   → `[data-ref-chip="file"]`
        //   a Markdown inline-code mention     → `button._fileMention_*` + title
        // The second is what a model-written `path/to/file.js` becomes, so it is
        // the one a reader actually clicks.
        const target = event.target?.closest?.('[data-ref-chip], button[class*="fileMention"]')
        if (target === null || target === undefined) return
        const kind = target.getAttribute('data-ref-chip')
        if (kind !== null && kind !== 'file' && kind !== 'folder') return
        // Only when THIS window's Session is parked in a board window.
        const sessionId = win.sessionId
        if (typeof sessionId !== 'string' || !actions.isFloating(sessionId)) return
        const raw = (target.getAttribute('title') ?? '').trim()
        if (raw === '') return
        const cleaned = raw.replace(/^@/, '').replace(/^"(.*)"$/, '$1')
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        actions.openPath(cleaned, card?.workspacePath ?? summary?.cwd)
      }

      const chipClickRef = React.useRef(handleChipClick)
      chipClickRef.current = handleChipClick

      React.useEffect(() => {
        const listener = (event) => chipClickRef.current(event)
        document.addEventListener('click', listener, true)
        return () => document.removeEventListener('click', listener, true)
      }, [])

      // Self-heal a restored window whose header would land under the chrome.
      React.useEffect(() => {
        const element = frame.current
        if (element === null) return
        const next = reachableOrigin(element, win.x, win.y, win.h)
        if (next.x === win.x && next.y === win.y) return
        element.style.left = `${next.x}px`
        element.style.top = `${next.y}px`
        actions.moveWindow(win.cardId, next)
      }, [win.cardId])

      const handleDown = (event) => {
        if (event.button !== 0) return
        if (event.target.closest('.tbwin-collapse') !== null) return
        const element = frame.current
        if (element === null) return
        event.preventDefault()

        const startX = event.clientX
        const startY = event.clientY
        const origin = clampOrigin(win.x, win.y, win.h)
        let moved = false

        const move = (moveEvent) => {
          const dx = moveEvent.clientX - startX
          const dy = moveEvent.clientY - startY
          if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
          moved = true
          const next = clampOrigin(origin.x + dx, origin.y + dy, win.h)
          element.style.left = `${next.x}px`
          element.style.top = `${next.y}px`
        }

        const finish = (upEvent) => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          if (!moved) return
          const x = Number.parseFloat(element.style.left)
          const y = Number.parseFloat(element.style.top)
          const next = reachableOrigin(element, Number.isFinite(x) ? x : origin.x, Number.isFinite(y) ? y : origin.y, win.h)
          element.style.left = `${next.x}px`
          element.style.top = `${next.y}px`
          actions.moveWindow(win.cardId, next)
          upEvent?.preventDefault?.()
        }

        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', finish)
      }

      const startResize = (event, dir) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        const element = frame.current
        if (element === null) return
        const rect = { x: win.x, y: win.y, w: win.w, h: win.h }
        const startX = event.clientX
        const startY = event.clientY
        let active = false

        const move = (moveEvent) => {
          const dx = moveEvent.clientX - startX
          const dy = moveEvent.clientY - startY
          if (!active && Math.abs(dx) < 2 && Math.abs(dy) < 2) return
          active = true
          const next = resizeRect(rect, dir, dx, dy)
          element.style.left = `${next.x}px`
          element.style.top = `${next.y}px`
          element.style.width = `${next.w}px`
          element.style.height = `${next.h}px`
        }

        const finish = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          if (!active) return
          actions.resizeWindow(win.cardId, {
            x: Number.parseFloat(element.style.left) || rect.x,
            y: Number.parseFloat(element.style.top) || rect.y,
            w: Number.parseFloat(element.style.width) || rect.w,
            h: Number.parseFloat(element.style.height) || rect.h,
          })
        }

        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', finish)
      }

      return h('section', {
        ref: frame,
        className: 'tbwin',
        style: { left: `${win.x}px`, top: `${win.y}px`, width: `${win.w}px`, height: `${win.h}px`, zIndex: win.z },
        onPointerDown: () => actions.focusWindow(win.cardId),
        'data-card': win.cardId,
      },
      h('header', {
        className: 'tbwin-head',
        onPointerDown: handleDown,
      },
      h('span', { className: 'tbwin-title', title }, title),
      card?.workspacePath ? h('span', { className: 'tbwin-ws', title: card.workspacePath }, card.workspacePath) : null,
      h('button', {
        type: 'button',
        className: 'tbwin-collapse',
        title: t('collapseHint'),
        'aria-label': t('collapse'),
        onPointerDown: (event) => event.stopPropagation(),
        onClick: () => actions.collapseWindow(win.cardId),
      }, '−')),
      h('div', { className: 'tbwin-body' }, children),
      // Handles paint last: the embedded conversation owns the bottom band
      // (its sticky composer) and would otherwise swallow the bottom edge.
      RESIZE_DIRS.map((dir) => h('div', {
        key: dir,
        className: `tbwin-h tbwin-h-${dir}`,
        onPointerDown: (event) => startResize(event, dir),
      })))
    }

    /** Draft body: the input box, and nothing else. Enter sends. */
    function DraftBody({ card, busy, failed, t, actions }) {
      const [text, setText] = React.useState(card?.draftPrompt ?? '')
      const area = React.useRef(null)
      React.useEffect(() => {
        area.current?.focus()
      }, [])
      if (card === undefined) return h('div', { className: 'tb-draft' })
      return h('div', { className: 'tb-draft' },
        h('textarea', {
          ref: area,
          className: 'tb-draft-input',
          value: text,
          placeholder: t('draftPlaceholder'),
          spellCheck: false,
          disabled: busy,
          onChange: (event) => {
            setText(event.target.value)
            actions.setDraft(card.id, event.target.value)
          },
          onKeyDown: (event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            if (text.trim() === '' || busy) return
            actions.sendDraft(card.id, text)
          },
        }),
        busy ? h('div', { className: 'tb-draft-note' }, t('creating')) : null,
        failed ? h('div', { className: 'tb-draft-error' }, `${t('sendFailed')}: ${failed}`) : null)
    }

    /**
     * taskboard.window — registered in the Session scope. `SessionProvider`
     * around it makes the Factory occurrence inherit this window's Session, so
     * the shipped Conversation body (Chat stream + composer + the pending
     * question composer chain) renders for exactly this Session.
     */
    function TaskWindowBody(props) {
      const t = props.t ?? local
      if (props.sessionId === undefined || props.sessionId === null) {
        return h('div', { className: 'tb-draft' }, h('div', { className: 'tb-draft-note' }, t('creating')))
      }
      if (typeof props.renderFactorySlot !== 'function') {
        return h('div', { className: 'tb-embed-error' }, t('storageUnavailable'))
      }
      return h(EmbedBoundary, null,
        props.renderFactorySlot(
          'conversation.content',
          { variant: 'embedded', phase: 'active', hero: false },
          {},
        ))
    }

    /** shell.overlay — the floating layer and window lifetime owner. */
    function TaskWindowLayer(props) {
      const { board, actions, runtime, renderSlot, SessionProvider, useSessions, useSessionStatus } = props
      const t = props.t ?? local
      const state = React.useSyncExternalStore(board.subscribe, board.getSnapshot)
      const sessions = useSessions((snapshot) => snapshot)
      const statuses = useSessionStatus ? useSessionStatus((snapshot) => snapshot) : undefined

      React.useEffect(() => {
        actions.syncFromSessions(sessions, statuses)
      }, [sessions, statuses])

      React.useEffect(() => {
        const onResize = () => actions.clampWindows()
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

      return h('div', { className: 'tb-overlay' },
        state.windows.map((win) => {
          const card = state.cards.find((item) => item.id === win.cardId)
          const summary = card?.sessionId ? sessions?.byId?.[card.sessionId] : undefined
          let body
          if (win.sessionId === null) {
            body = h(DraftBody, {
              card,
              busy: state.sending.includes(win.cardId),
              failed: state.sendError[win.cardId] ?? null,
              t,
              actions,
            })
          } else if (typeof SessionProvider !== 'function' || typeof renderSlot !== 'function' || win.reference === null) {
            body = h('div', { className: 'tb-embed-error' }, t('storageUnavailable'))
          } else {
            body = h(SessionProvider, { session: win.reference },
              renderSlot(WINDOW_SLOT, { cardId: win.cardId }))
          }
          return h(TaskWindow, {
            key: win.cardId,
            win,
            card,
            summary,
            t,
            actions,
          }, body)
        }))
    }

    // ------------------------------------------------------------- plugin

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        const board = createBoard((next) => {
          carriedBoard = next
        })
        const transport = createTransport(ctx)
        const references = new Map()
        const lastRunning = new Map()
        const runningSince = new Map()
        /** Per-card window size, remembered for the page session (never persisted). */
        const windowSize = new Map()
        const runtime = {
          runningSince,
          /**
           * The window that last took a pointer down (or was just opened).
           * Window-level keys resolve to it when the key event itself has no
           * owner inside a window (for example after dragging the header).
           */
          activeCardId: null,
          /** True while the header search popover owns Escape. */
          searchOpen: false,
        }
        let saveTimer = null
        let disposed = false
        let pollBusy = false
        // One backfill attempt per session per page session; the log read is not free.
        const backfilled = new Set()
        // Hard gate: nothing may reach disk before the stored document has been
        // read back. A write composed from the empty boot snapshot would erase
        // the whole board, which is exactly what a reload/HMR re-apply raced into.
        let hydrated = false
        let pendingWrite = false

        const carried = carriedBoard
        styleRefs += 1
        if (styleElement === null || !styleElement.isConnected) {
          styleElement = document.createElement('style')
          styleElement.dataset.plugin = NS
          document.head.appendChild(styleElement)
        }
        styleElement.textContent = CSS

        // Re-applying in the same page keeps the cards, lanes and row count; only
        // the runtime-only windows, pending sends and drag state restart.
        board.set(carried === null
          ? { ...EMPTY }
          : {
            ...carried,
            windows: [],
            sending: [],
            sendError: {},
            dragLane: null,
            dropActive: false,
            zTop: 20,
            ready: false,
            storageError: null,
          })

        // --- persistence ------------------------------------------------

        const writeNow = () => {
          if (saveTimer !== null) {
            clearTimeout(saveTimer)
            saveTimer = null
          }
          if (!hydrated) {
            pendingWrite = true
            return
          }
          pendingWrite = false
          const doc = persistedOf(board.getSnapshot())
          transport.call('write', { doc }).then(
            () => {
              if (board.getSnapshot().storageError !== null) board.patch({ storageError: null })
            },
            (error) => board.patch({ storageError: error?.message ?? String(error) }),
          )
        }

        const writeSoon = () => {
          if (saveTimer !== null) clearTimeout(saveTimer)
          saveTimer = setTimeout(writeNow, 300)
        }

        // --- actions ----------------------------------------------------

        const actions = {
          /** Create a draft card, bound to `workspaceId` when given, else to the active workspace. */
          createCard(context, workspaceId) {
            const current = board.getSnapshot()
            const workspace = workspaceId === undefined
              ? pickWorkspace(context?.workspaces, context?.sessions)
              : (context?.workspaces?.items ?? []).find((item) => item.workspaceId === workspaceId)
            if (workspaceId !== undefined && workspace === undefined) return
            const slot = current.cards.reduce((max, card) => Math.max(max, card.slot), -1) + 1
            const card = {
              id: uid(),
              title: '',
              state: 'draft',
              sessionId: null,
              workspaceId: workspace?.workspaceId ?? null,
              workspacePath: workspace?.path ?? '',
              draftPrompt: '',
              slot,
              createdAt: Date.now(),
              outcome: null,
            }
            const partitions = workspace === undefined || current.partitions.includes(workspace.workspaceId)
              ? current.partitions
              : [...current.partitions, workspace.workspaceId]
            board.set({ ...current, cards: [...current.cards, card], partitions })
            writeNow()
          },

          addPartition(workspaceId) {
            const current = board.getSnapshot()
            if (current.partitions.includes(workspaceId)) return
            board.set({ ...current, partitions: [...current.partitions, workspaceId] })
            writeNow()
          },

          removePartition(workspaceId) {
            const current = board.getSnapshot()
            const hasCards = current.cards.some((card) => card.workspaceId === workspaceId)
            if (hasCards) return
            board.set({
              ...current,
              partitions: current.partitions.filter((id) => id !== workspaceId),
            })
            writeNow()
          },

          /** Persist the visible lane order; auto-included lanes become explicit here. */
          setLaneOrder(nextIds) {
            const current = board.getSnapshot()
            const same = current.partitions.length === nextIds.length
              && current.partitions.every((id, index) => id === nextIds[index])
            if (same) return
            board.set({ ...current, partitions: nextIds })
            writeNow()
          },

          setLaneRows(rows) {
            const current = board.getSnapshot()
            if (current.laneRows === rows) return
            board.set({ ...current, laneRows: rows })
            writeNow()
          },

          /** Drop a Session dragged from the sidebar onto the board. */
          addSessionCard(sessionId, context) {
            const current = board.getSnapshot()
            const existing = current.cards.find((card) => card.sessionId === sessionId)
            if (existing !== undefined) return
            const sessions = context?.sessions
            const summary = sessions?.byId?.[sessionId]
            if (summary === undefined) return
            const items = context?.workspaces?.items ?? []
            const workspace = items.find((item) => (item.sessionIds ?? []).includes(sessionId))
              ?? items.find((item) => summary.cwd !== undefined && item.path === summary.cwd)
            const slot = current.cards.reduce((max, card) => Math.max(max, card.slot), -1) + 1
            const card = {
              id: uid(),
              title: summaryTitle(summary) ?? '',
              state: 'draft',
              sessionId,
              workspaceId: workspace?.workspaceId ?? null,
              workspacePath: workspace?.path ?? (summary.cwd ?? ''),
              draftPrompt: '',
              slot,
              createdAt: Date.now(),
              outcome: null,
            }
            const partitions = workspace === undefined || current.partitions.includes(workspace.workspaceId)
              ? current.partitions
              : [...current.partitions, workspace.workspaceId]
            lastRunning.set(sessionId, summary.running === true)
            if (summary.running === true) runningSince.set(sessionId, Date.now())
            board.set({
              ...current,
              cards: [...current.cards, card],
              partitions,
            })
            writeNow()
          },

          /** Take one card off the board. The Session itself is untouched. */
          removeCard(cardId) {
            const current = board.getSnapshot()
            const win = current.windows.find((item) => item.cardId === cardId)
            if (win !== undefined) actions.collapseWindow(cardId)
            const after = board.getSnapshot()
            const card = after.cards.find((item) => item.id === cardId)
            if (card?.sessionId !== null && card?.sessionId !== undefined) {
              lastRunning.delete(card.sessionId)
              runningSince.delete(card.sessionId)
            }
            board.set({
              ...after,
              cards: after.cards.filter((item) => item.id !== cardId),
              pinned: after.pinned.filter((id) => id !== cardId),
            })
            writeNow()
          },

          /** Re-clamp every window after a viewport change (never above the chrome strip). */
          clampWindows() {
            const current = board.getSnapshot()
            if (current.windows.length === 0) return
            let changed = false
            const windows = current.windows.map((win) => {
              const next = clampOrigin(win.x, win.y, win.h)
              const w = Math.max(MIN_W, Math.min(win.w, window.innerWidth - next.x))
              const h = Math.max(MIN_H, Math.min(win.h, window.innerHeight - next.y))
              if (next.x === win.x && next.y === win.y && w === win.w && h === win.h) return win
              changed = true
              return { ...win, x: next.x, y: next.y, w, h }
            })
            if (changed) board.set({ ...current, windows })
          },

          /** Commit one finished resize; the size is remembered per card. */
          resizeWindow(cardId, rect) {
            const current = board.getSnapshot()
            const target = current.windows.find((win) => win.cardId === cardId)
            if (target === undefined) return
            const w = Math.max(MIN_W, Math.min(Math.round(rect.w), window.innerWidth))
            const h = Math.max(MIN_H, Math.min(Math.round(rect.h), window.innerHeight))
            // Re-anchor after the size change so the whole window stays on screen:
            // a window whose bottom edge is off-screen has no grabbable bottom band.
            const origin = clampOrigin(rect.x, rect.y, h)
            windowSize.set(cardId, { w, h })
            board.set({
              ...current,
              windows: current.windows.map((win) => (
                win.cardId === cardId ? { ...win, x: origin.x, y: origin.y, w, h } : win
              )),
            })
          },

          togglePin(cardId) {
            const current = board.getSnapshot()
            const pinned = current.pinned.includes(cardId)
              ? current.pinned.filter((id) => id !== cardId)
              : [...current.pinned, cardId]
            board.set({ ...current, pinned })
            writeNow()
          },

          openCard(cardId) {
            const current = board.getSnapshot()
            if (current.windows.some((win) => win.cardId === cardId)) return
            const card = current.cards.find((item) => item.id === cardId)
            if (card === undefined) return

            let reference = null
            if (card.sessionId !== null) {
              const sessions = ctx.get('sessions')
              if (typeof sessions?.retain !== 'function') return
              try {
                reference = sessions.retain(card.sessionId, { source: `taskboard:${card.id}` })
                references.set(card.id, reference)
                reference.ready?.catch?.((error) => {
                  console.error('[dsh-task-board] session open failed:', error)
                })
              } catch (error) {
                console.error('[dsh-task-board] retain failed:', error)
                return
              }
            }

            const index = current.windows.length
            const remembered = windowSize.get(card.id)
            const height = remembered?.h ?? Math.max(MIN_H, Math.min(720, window.innerHeight - 160))
            const origin = clampOrigin(88 + (index % 6) * 34, 64 + (index % 6) * 26, height)
            const win = {
              cardId: card.id,
              sessionId: card.sessionId,
              reference,
              x: origin.x,
              y: origin.y,
              w: remembered?.w ?? Math.max(MIN_W, Math.min(760, window.innerWidth - 200)),
              h: height,
              z: current.zTop + 1,
            }
            board.set({ ...current, windows: [...current.windows, win], zTop: current.zTop + 1 })
            runtime.activeCardId = card.id
          },

          collapseWindow(cardId) {
            const current = board.getSnapshot()
            const reference = references.get(cardId)
            if (reference !== undefined) {
              references.delete(cardId)
              try {
                reference.release()
              } catch (error) {
                console.error('[dsh-task-board] release failed:', error)
              }
            }
            const sendError = { ...current.sendError }
            delete sendError[cardId]
            board.set({
              ...current,
              windows: current.windows.filter((win) => win.cardId !== cardId),
              sendError,
            })
            if (runtime.activeCardId === cardId) runtime.activeCardId = null
            writeNow()
          },

          focusWindow(cardId) {
            const current = board.getSnapshot()
            const target = current.windows.find((win) => win.cardId === cardId)
            if (target === undefined) return
            runtime.activeCardId = cardId
            // Already front-most: re-publishing would re-render the embedded
            // conversation (and its editor) on every pointerdown inside it.
            if (current.windows.every((win) => win.z <= target.z)) return
            const top = current.zTop + 1
            board.set({
              ...current,
              zTop: top,
              windows: current.windows.map((win) => (win.cardId === cardId ? { ...win, z: top } : win)),
            })
          },

          moveWindow(cardId, position) {
            const current = board.getSnapshot()
            board.set({
              ...current,
              windows: current.windows.map((win) => (
                win.cardId === cardId ? { ...win, x: position.x, y: position.y } : win
              )),
            })
          },

          setDraft(cardId, text) {
            const current = board.getSnapshot()
            board.set({
              ...current,
              cards: current.cards.map((card) => (card.id === cardId ? { ...card, draftPrompt: text } : card)),
            })
            writeSoon()
          },

          /**
           * Mirror live Session facts onto cards using the framework feeds only
           * (`useSessions` summary + `useSessionStatus`), never a Session stream —
           * the parked board subscribes to no Session feed (硬约束 5).
           */
          syncFromSessions(sessions, statuses) {
            if (sessions?.byId === undefined) return
            const current = board.getSnapshot()
            let changed = false
            const settled = []
            const cards = current.cards.map((card) => {
              if (card.sessionId === null) return card
              const summary = sessions.byId[card.sessionId]
              const scoped = statusOf(statuses, card.sessionId)
              const running = (scoped?.running ?? summary?.running) === true
              const was = lastRunning.get(card.sessionId) === true
              if (running !== was) {
                lastRunning.set(card.sessionId, running)
                if (!running) runningSince.delete(card.sessionId)
                else if (!runningSince.has(card.sessionId)) runningSince.set(card.sessionId, Date.now())
              }
              if (summary === undefined) return card
              let next = card
              const title = summaryTitle(summary)
              if (title !== undefined && title !== card.title) {
                next = { ...next, title }
                changed = true
              }
              if (was && !running) {
                // Park the card in `settling` until the Host's turn/end arrives.
                // Never assume "completed": a failed or user-stopped Turn would
                // then be indistinguishable, which is the bug this replaces.
                if (next.state !== 'settling') {
                  next = { ...next, state: 'settling' }
                  changed = true
                }
                settled.push(card.sessionId)
              }
              if (next.state === 'draft' && running) {
                next = { ...next, state: 'running', outcome: null }
                changed = true
              }
              return next
            })
            if (!changed) return
            board.set({ ...current, cards })
            writeSoon()
            if (settled.length > 0) actions.reconcileOutcomes(settled)
          },

          /**
           * Fill in the summary line for cards that have none yet.
           *
           * `resolveOutcomes` only runs on a live running→stopped transition, so a
           * card restored from disk as `done` would otherwise never be asked about.
           * This backfills it once per page mount, from the Host's durable log read.
           */
          backfillSummaries() {
            const current = board.getSnapshot()
            const missing = current.cards
              .filter((card) => card.sessionId !== null
                && (card.lastText ?? '') === ''
                && (card.state === 'done' || card.state === 'stopped' || card.state === 'failed')
                && !backfilled.has(card.sessionId))
              .map((card) => card.sessionId)
            if (missing.length === 0) return
            const ids = [...new Set(missing)]
            for (const id of ids) backfilled.add(id)
            void actions.resolveOutcomes(ids)
          },

          /**
           * Ask the Host what each of these Sessions' last Turn actually ended with.
           * The Host records `turn/end` reasons from its own event feed, so this needs
           * no Client-side Session subscription.
           */
          async resolveOutcomes(sessionIds) {
            const ids = [...new Set(sessionIds.filter((id) => typeof id === 'string'))]
            if (ids.length === 0) return false
            let table
            try {
              table = await transport.call('outcomes', { sessionIds: ids })
            } catch (error) {
              console.warn('[dsh-task-board] outcome read failed:', error)
              return false
            }
            if (table === null || typeof table !== 'object') return false
            const current = board.getSnapshot()
            let changed = false
            const cards = current.cards.map((card) => {
              if (card.sessionId === null) return card
              const entry = table[card.sessionId]
              if (entry === undefined) return card
              const outcome = entry.outcome ?? null
              const lastText = typeof entry.text === 'string' && entry.text !== ''
                ? entry.text
                : (card.lastText ?? '')
              // The last output is useful on its own: a finished Turn always has one,
              // while a Session whose live `turn/end` was missed may have no outcome.
              let next = card
              if (lastText !== (card.lastText ?? '')) next = { ...next, lastText }
              if (outcome !== null) {
                const mapped = outcomeState(outcome)
                const sameOutcome = card.outcome !== null && card.outcome !== undefined
                  && card.outcome.kind === outcome.kind && card.outcome.turn === outcome.turn
                if (mapped !== card.state || !sameOutcome) next = { ...next, state: mapped, outcome }
              }
              if (next === card) return card
              changed = true
              // The classified ending is stored on the card and persisted with it,
              // so a restarted Host reuses it instead of re-deriving anything.
              return next
            })
            if (!changed) return true
            board.set({ ...current, cards })
            writeNow()
            return true
          },
          /** Whether this Session is currently hosted by a board window. */
          isFloating(sessionId) {
            return board.getSnapshot().windows.some((win) => win.sessionId === sessionId)
          },

          /**
           * Hand a local path to the operating system's default application.
           * The Host half owns the spawn and resolves relative paths against `base`.
           */
          openPath(target, base) {
            if (typeof target !== 'string' || target === '') return
            transport.call('open', { path: target, base }).catch((error) => {
              console.error('[dsh-task-board] open failed:', error)
            })
          },

          /**
           * "继续" — send one follow-up message to a Session whose Turn ended
           * abnormally, without opening its window.
           *
           * A reference is taken only for the duration of the send and released
           * immediately: this is a one-shot write, not a subscription, so the
           * board still holds no Session feed while a card is parked.
           */
          async resumeCard(cardId) {
            const current = board.getSnapshot()
            const card = current.cards.find((item) => item.id === cardId)
            if (card === undefined || card.sessionId === null) return
            if (current.continuing.includes(cardId)) return
            const sessions = ctx.get('sessions')
            if (typeof sessions?.retain !== 'function') return

            board.set({ ...current, continuing: [...current.continuing, cardId] })
            let reference = null
            try {
              reference = sessions.retain(card.sessionId, { source: `taskboard-resume:${card.id}` })
              await reference.ready
              const session = sessions.binding(card.sessionId)?.session
              if (typeof session?.prompt !== 'function') throw new Error('session prompt is unavailable')
              const result = await session.prompt(
                [{ type: 'text', text: local('resume') }],
                'queue',
                AbortSignal.timeout(SEND_TIMEOUT_MS),
                newRequestId(),
              )
              if (result !== null && typeof result === 'object' && result.ok === false) {
                throw new Error(result.error?.message ?? 'prompt rejected')
              }
              const after = board.getSnapshot()
              const sendError = { ...after.sendError }
              delete sendError[cardId]
              board.set({
                ...after,
                continuing: after.continuing.filter((id) => id !== cardId),
                sendError,
                cards: after.cards.map((item) => (item.id === cardId
                  ? { ...item, state: 'running', outcome: null }
                  : item)),
              })
              lastRunning.set(card.sessionId, true)
              runningSince.set(card.sessionId, Date.now())
              writeNow()
            } catch (error) {
              console.error('[dsh-task-board] resume failed:', error)
              const after = board.getSnapshot()
              board.set({
                ...after,
                continuing: after.continuing.filter((id) => id !== cardId),
                sendError: {
                  ...after.sendError,
                  [cardId]: error instanceof Error ? error.message : String(error),
                },
              })
            } finally {
              if (reference !== null) {
                try {
                  reference.release()
                } catch {
                  /* already gone */
                }
              }
            }
          },

          /** One batched read of the Host's live digests for the running cards. */
          async pollDigests(sessionIds) {
            if (pollBusy || disposed) return
            const ids = [...new Set(sessionIds.filter((id) => typeof id === 'string'))]
            if (ids.length === 0) return
            pollBusy = true
            try {
              const table = await transport.call('digests', { sessionIds: ids })
              if (table === null || typeof table !== 'object' || disposed) return
              const current = board.getSnapshot()
              const next = { ...(current.digests ?? {}) }
              let changed = false
              for (const id of ids) {
                const digest = table[id]
                if (digest === null || digest === undefined) continue
                const previous = next[id]
                if (previous !== undefined
                  && previous.lastEventAt === digest.lastEventAt
                  && previous.phase === digest.phase
                  && previous.stream === digest.stream
                  && previous.text === digest.text) continue
                next[id] = digest
                changed = true
              }
              if (!changed) return
              // Runtime-only: digests are never persisted and never trigger a write.
              board.set({ ...current, digests: next })
            } catch (error) {
              console.warn('[dsh-task-board] digest read failed:', error)
            } finally {
              pollBusy = false
            }
          },

          /**
           * Session-content search over the board's own cards. The Host owns the
           * scan (and the literal-match semantics); this is a plain RPC.
           */
          async searchSessions(query, workspaceIds) {
            return transport.call('search', {
              query,
              workspaceIds: Array.isArray(workspaceIds) ? workspaceIds : null,
            })
          },

          /**
           * Open the hit's card window, page its conversation back to the hit,
           * then scroll to the message row and paint the query occurrences.
           *
           * Returns `{located}`; false means the window is open but the exact
           * message could not be matched (markdown rendering, older-than-window
           * hit, or a long page-out).
           */
          async revealSearchHit(hit) {
            if (hit === null || typeof hit !== 'object' || typeof hit.cardId !== 'string') {
              return { located: false }
            }
            actions.openCard(hit.cardId)

            const needles = stableAnchors(hit.snippet)
            if (needles.length === 0) return { located: false }
            const seq = Number.isFinite(hit.seq) ? hit.seq : null
            const sessions = ctx.get('sessions')
            const deadline = Date.now() + 15000
            let session
            let lastPageAt = 0

            // One click has to do everything: the window mounts, the Session
            // binds, the tail page lands, then older pages load. Each of those
            // is asynchronous and may finish in any order, so keep converging
            // instead of giving one attempt a fixed budget.
            while (Date.now() < deadline) {
              const frame = findWindow(hit.cardId)
              if (frame !== null) {
                if (session === undefined) session = sessions?.binding?.(hit.sessionId)?.session
                if (session !== undefined && session !== null) {
                  try {
                    if (typeof session.open === 'function' && session.openState !== 'open') {
                      await raceTimeout(session.open(), 3000)
                    }
                    if (seq !== null && Number.isFinite(session.baseSeq) && session.baseSeq > seq
                      && Date.now() - lastPageAt > 1200) {
                      lastPageAt = Date.now()
                      if (typeof session.loadThrough === 'function') {
                        await raceTimeout(session.loadThrough(seq), 8000)
                      } else if (typeof session.loadOlder === 'function') {
                        await raceTimeout(session.loadOlder(), 6000)
                      }
                    }
                  } catch (error) {
                    // A transient open/page failure is retried by the loop.
                    console.warn('[dsh-task-board] search locate paging failed:', error)
                  }
                }
                const row = findAnchorRow(frame, needles)
                if (row !== null) {
                  flashRow(row)
                  if (typeof hit.query === 'string') highlightQuery(row, hit.query)
                  return { located: true }
                }
              }
              await sleep(120)
            }
            return { located: false }
          },

          /** One read now, bounded retries while the Host commits the Turn, then a neutral fallback. */
          reconcileOutcomes(sessionIds) {
            void actions.resolveOutcomes(sessionIds)
            for (const delay of [600, 1800]) {
              setTimeout(() => {
                if (!disposed) void actions.resolveOutcomes(sessionIds)
              }, delay)
            }
            setTimeout(() => {
              if (disposed) return
              const current = board.getSnapshot()
              const ids = new Set(sessionIds)
              let changed = false
              const cards = current.cards.map((card) => {
                if (card.sessionId === null || !ids.has(card.sessionId)) return card
                if (card.state !== 'settling') return card
                changed = true
                return { ...card, state: 'done' }
              })
              if (!changed) return
              board.set({ ...current, cards })
              writeSoon()
            }, 3600)
          },

          async sendDraft(cardId, text) {
            const current = board.getSnapshot()
            const card = current.cards.find((item) => item.id === cardId)
            if (card === undefined || card.sessionId !== null) return
            if (current.sending.includes(cardId)) return
            if (card.workspaceId === null) {
              board.set({ ...current, sendError: { ...current.sendError, [cardId]: local('noWorkspace') } })
              return
            }
            const uiWorkspace = ctx.get('uiWorkspace')
            if (typeof uiWorkspace?.connectWorkspace !== 'function') {
              board.set({ ...current, sendError: { ...current.sendError, [cardId]: local('storageUnavailable') } })
              return
            }

            board.set({ ...current, sending: [...current.sending, cardId] })
            let reference = null
            try {
              const sessionId = await uiWorkspace.connectWorkspace(card.workspaceId)
              const sessions = ctx.get('sessions')
              reference = sessions.retain(sessionId, { source: `taskboard:${cardId}` })
              references.set(cardId, reference)
              await reference.ready

              const session = sessions.binding(sessionId)?.session
              if (typeof session?.prompt !== 'function') throw new Error('session prompt is unavailable')
              const result = await session.prompt(
                [{ type: 'text', text }],
                'queue',
                AbortSignal.timeout(SEND_TIMEOUT_MS),
                newRequestId(),
              )
              if (result !== null && typeof result === 'object' && result.ok === false) {
                throw new Error(result.error?.message ?? 'prompt rejected')
              }

              const after = board.getSnapshot()
              const sendError = { ...after.sendError }
              delete sendError[cardId]
              board.set({
                ...after,
                sending: after.sending.filter((id) => id !== cardId),
                sendError,
                cards: after.cards.map((item) => (item.id === cardId
                  ? { ...item, sessionId, state: 'running', draftPrompt: '', outcome: null }
                  : item)),
                windows: after.windows.map((win) => (win.cardId === cardId
                  ? { ...win, sessionId, reference }
                  : win)),
              })
              writeNow()
            } catch (error) {
              console.error('[dsh-task-board] first prompt failed:', error)
              if (reference !== null && references.get(cardId) === reference) {
                references.delete(cardId)
                try {
                  reference.release()
                } catch {
                  /* already gone */
                }
              }
              const after = board.getSnapshot()
              board.set({
                ...after,
                sending: after.sending.filter((id) => id !== cardId),
                sendError: {
                  ...after.sendError,
                  [cardId]: error instanceof Error ? error.message : String(error),
                },
              })
            }
          },
        }

        // --- window keys -------------------------------------------------

        /**
         * Remember which window the pointer last entered, and clear it as soon
         * as the pointer lands anywhere else. Escape belongs to the window the
         * user is actually working in — not to a window left open behind the
         * main conversation.
         */
        ctx.effect(() => {
          const track = (event) => {
            const target = event.target
            const frame = target instanceof Element ? target.closest('.tbwin') : null
            runtime.activeCardId = frame === null ? null : frame.getAttribute('data-card')
          }
          document.addEventListener('pointerdown', track, true)
          return () => document.removeEventListener('pointerdown', track, true)
        }, 'dsh-task-board: active window tracking')

        /**
         * Escape closes the current window.
         *
         * This rides the app-wide shortcut arbitration instead of a private
         * document listener: the shared channel already accounts for IME
         * composition, repeat presses, open menus/dialogs, and — crucially —
         * DSH's own double-Escape “stop the running Turn” gesture. A handler
         * earlier in the chain marks the event `defaultPrevented`, and we back
         * off; a live Turn also keeps the key so the close never swallows the
         * stop press. Everything else closes this window and only this one.
         */
        ctx.inject(['shortcuts'], (scope) => {
          scope.effect(() => scope.shortcuts.observeFixedInput((input) => {
            if (input.type !== 'keydown') return
            const { gesture, context } = input
            if (gesture.code !== 'Escape' || gesture.repeat || gesture.composing) return
            if (gesture.defaultPrevented || gesture.control || gesture.alt || gesture.shift || gesture.meta) return
            if (context.modal != null) return
            // The header search popover owns Escape while it is open.
            if (runtime.searchOpen) return

            const current = board.getSnapshot()
            if (current.windows.length === 0) return
            const element = context.target instanceof Element ? context.target : null
            const frame = element === null ? null : element.closest('.tbwin')
            const cardId = frame === null ? runtime.activeCardId : frame.getAttribute('data-card')
            if (cardId === null || cardId === undefined) return

            const win = current.windows.find((item) => item.cardId === cardId)
            if (win === undefined) return
            // While the pointer is in the hosted conversation, a live Turn keeps
            // DSH's double-Escape stop. Chrome/body focus closes even then.
            const inConversation = element !== null && element.closest('[data-conversation-session]') !== null
            if (win.sessionId !== null && inConversation && lastRunning.get(win.sessionId) === true) return

            input.consume()
            // Make this the tracked window first, so collapsing it also clears
            // the tracker: one Escape closes exactly one window.
            runtime.activeCardId = cardId
            actions.collapseWindow(cardId)
          }), 'dsh-task-board: escape closes the current window')
        })

        // --- slot registrations -----------------------------------------

        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-task-board: dictionaries')

        ctx.slots.inject('shell.overlay', function* () {
          yield ctx.slots.register({
            name: 'shell.overlay',
            id: 'taskboard-windows',
            order: 100,
            locale: NS,
            children: { [WINDOW_SLOT]: { kind: 'single', scope: 'session' } },
            inject: () => ({ board, actions, runtime }),
          }, TaskWindowLayer)

          yield ctx.slots.register({
            name: WINDOW_SLOT,
            locale: NS,
            inject: () => ({ board, actions, runtime }),
          }, TaskWindowBody)
        })

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => ctx.get('locale')?.bind?.(NS)?.('panel') ?? local('panel'),
        }, BoardIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ board, actions, runtime }),
        }, TaskBoardPanel))

        ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.row.action',
          id: 'taskboard-add',
          order: 150,
          locale: NS,
          inject: () => ({ board, actions }),
        }, AddToBoardButton))

        // --- boot --------------------------------------------------------

        /**
         * Read the document, retrying while the transport is still coming up.
         * Writes stay gated until this succeeds; a failed read must never look
         * like an empty board that is then written back over the real one.
         */
        const hydrateBoard = (attempt) => {
          transport.call('read', {}).then(
            (doc) => {
              if (disposed) return
              hydrated = true
              const local = board.getSnapshot()
              const restored = hydrate(doc)
              // Page memory wins over storage: a carried board is never older than
              // the file, and a read that arrives late must not roll it back.
              if (local.cards.length > 0) {
                board.set({ ...local, ready: true, storageError: null })
              } else {
                // A genuinely fresh page: storage seeds the board.
                board.set({ ...local, ...restored, ready: true, storageError: null })
              }
              if (pendingWrite) writeNow()
              const sessionIds = board.getSnapshot().cards
                .map((card) => card.sessionId)
                .filter((id) => typeof id === 'string')
              if (sessionIds.length > 0) void actions.resolveOutcomes(sessionIds)
            },
            (error) => {
              if (disposed) return
              if (attempt < 10) {
                setTimeout(() => {
                  if (!disposed) hydrateBoard(attempt + 1)
                }, 400 + attempt * 400)
                return
              }
              board.patch({ ready: true, storageError: error?.message ?? String(error) })
              console.warn('[dsh-task-board] board storage unavailable:', error)
            },
          )
        }

        hydrateBoard(0)

        ctx.effect(() => () => {
          disposed = true
          if (saveTimer !== null) clearTimeout(saveTimer)
          for (const reference of references.values()) {
            try {
              reference.release()
            } catch {
              /* teardown only */
            }
          }
          references.clear()
          // A newer apply in the same page shares this element; only the last
          // living apply may remove it.
          styleRefs -= 1
          if (styleRefs <= 0) {
            styleRefs = 0
            styleElement?.remove?.()
            styleElement = null
          }
          // Only a still-pending debounce needs flushing; a routine teardown must
          // not race a fresher write from the apply that replaces it.
          if (hydrated && saveTimer !== null) {
            clearTimeout(saveTimer)
            saveTimer = null
            transport.call('write', { doc: persistedOf(board.getSnapshot()) }).catch(() => {})
          }
        }, 'dsh-task-board: teardown')
      },
    }
  },
})
