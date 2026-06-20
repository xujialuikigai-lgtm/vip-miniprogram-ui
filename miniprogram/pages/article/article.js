// 富文本内容页
// 通过页面参数 key 调用 product.getArticle 拉取后台配置的富文本内容，
// 使用 rich-text 组件渲染。标题随内容类型（购买须知/账号填写说明/平台公告）变化，
// 含加载态、异常态（可重试）与空态。
// Requirements: 19.6
import { request } from '../../utils/request';
import { PageState } from '../../utils/types';
/** 允许的内容页标识与对应标题（需与云函数 getArticle 放行的 key 对齐） */
const ARTICLE_TITLE_MAP = {
    purchase_notice: '购买须知',
    account_guide: '账号填写说明',
    platform_announcement: '平台公告'
};
Page({
    data: {
        /** 页面状态：loading / success / error / empty */
        state: PageState.LOADING,
        /** 内容标识 */
        key: '',
        /** 页面标题（随内容类型变化） */
        title: '',
        /** 富文本内容（HTML 字符串，由 rich-text 安全渲染） */
        content: '',
        /** 错误提示文案 */
        errorMsg: ''
    },
    onLoad(options) {
        const key = (options && options.key) || '';
        // 非法 key 直接进入异常态，避免无效请求
        if (!key || !ARTICLE_TITLE_MAP[key]) {
            this.setData({ state: PageState.ERROR, errorMsg: '内容标识无效' });
            return;
        }
        const title = ARTICLE_TITLE_MAP[key];
        // 标题随内容类型变化
        wx.setNavigationBarTitle({ title });
        this.setData({ key, title });
        this.loadArticle();
    },
    /**
     * 加载富文本内容（product.getArticle）
     * 首次进入展示加载态；失败展示异常态并提供重试；内容为空展示空态。
     */
    async loadArticle() {
        this.setData({ state: PageState.LOADING, errorMsg: '' });
        try {
            const data = await request({
                name: 'product',
                action: 'getArticle',
                data: { key: this.data.key }
            });
            // 富文本内容统一转为字符串交给 rich-text 渲染
            const content = data && data.content ? String(data.content) : '';
            if (!content) {
                this.setData({ state: PageState.EMPTY, content: '' });
                return;
            }
            this.setData({ state: PageState.SUCCESS, content });
        }
        catch (err) {
            this.setData({
                state: PageState.ERROR,
                errorMsg: (err && err.message) || '加载失败，请重试'
            });
        }
    }
});
