// 骨架屏组件 skeleton
// 在页面数据加载期间展示带渐变流光动画的占位骨架；
// 若加载时间超过 timeout（默认 10 秒）仍处于 loading 状态，
// 自动切换为网络异常提示，并提供重试按钮（向父级冒泡 retry 事件）。
// Requirements: 16.3

/** 默认超时时间（毫秒）：超过后切换为异常状态 */
const DEFAULT_TIMEOUT = 10000;

Component({
  options: {
    // 允许使用全局样式（TDesign 主题变量）
    addGlobalClass: true,
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 是否处于加载态：true 展示骨架，false 隐藏
    loading: {
      type: Boolean,
      value: false,
      observer(this: any, value: boolean) {
        this.onLoadingChange(value);
      },
    },
    // 骨架类型：list（列表行）/ card（卡片）/ text（文本块）
    type: {
      type: String,
      value: 'list',
    },
    // 占位重复行数（卡片/列表项数量）
    rows: {
      type: Number,
      value: 3,
    },
    // 加载超时时间（毫秒），超时后切换为异常提示
    timeout: {
      type: Number,
      value: DEFAULT_TIMEOUT,
    },
  },

  data: {
    // 是否已超时（切换为异常态）
    timedOut: false,
    // 用于 wx:for 渲染占位行的数组
    rowList: [] as number[],
  },

  lifetimes: {
    attached(this: any) {
      // 初始化占位行数组
      this.buildRows();
      // 若挂载时已处于加载态，启动超时计时
      if (this.data.loading) {
        this.onLoadingChange(true);
      }
    },
    detached(this: any) {
      // 组件销毁时清理计时器，防止内存泄漏
      this.clearTimer();
    },
  },

  observers: {
    rows(this: any) {
      this.buildRows();
    },
  },

  methods: {
    /**
     * 构建占位行数组（供 wx:for 使用）
     */
    buildRows(this: any) {
      const count = Math.max(1, Number(this.data.rows) || 1);
      const rowList: number[] = [];
      for (let i = 0; i < count; i++) rowList.push(i);
      this.setData({ rowList });
    },

    /**
     * loading 状态变化处理：
     * - 进入加载：重置超时标记并启动计时器
     * - 结束加载：清理计时器
     */
    onLoadingChange(this: any, loading: boolean) {
      this.clearTimer();
      if (loading) {
        this.setData({ timedOut: false });
        const timeout = Number(this.data.timeout) || DEFAULT_TIMEOUT;
        this._timer = setTimeout(() => {
          // 超时仍未结束加载：切换为异常态并通知父级
          this.setData({ timedOut: true });
          this.triggerEvent('timeout');
        }, timeout);
      } else {
        this.setData({ timedOut: false });
      }
    },

    /**
     * 清理超时计时器
     */
    clearTimer(this: any) {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
    },

    /**
     * 点击重试：清理计时器并向父级冒泡 retry 事件
     */
    onRetry(this: any) {
      this.clearTimer();
      this.triggerEvent('retry');
    },
  },
});
