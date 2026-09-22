/**
 * 本地存储管理（简化版）
 */
const Storage = {
    GUIDE_KEY: 'optics_guide_completed',
    GUIDE_STEP_KEY: 'optics_guide_step',

    /**
     * 检查引导是否完成
     */
    isGuideCompleted() {
        try {
            return localStorage.getItem(this.GUIDE_KEY) === 'true';
        } catch (e) {
            return false;
        }
    },

    /**
     * 标记引导完成
     */
    setGuideCompleted() {
        try {
            localStorage.setItem(this.GUIDE_KEY, 'true');
        } catch (e) {
            // 忽略存储错误
        }
    },

    /**
     * 获取上次退出时所在的引导步骤（0 表示欢迎页）
     */
    getGuideStep() {
        try {
            const step = parseInt(localStorage.getItem(this.GUIDE_STEP_KEY), 10);
            return Number.isFinite(step) && step > 0 ? step : 0;
        } catch (e) {
            return 0;
        }
    },

    /**
     * 记录当前引导步骤，供中途退出后续走
     */
    setGuideStep(step) {
        try {
            localStorage.setItem(this.GUIDE_STEP_KEY, String(step));
        } catch (e) {
            // 忽略存储错误
        }
    },

    /**
     * 清除引导步骤记录
     */
    clearGuideStep() {
        try {
            localStorage.removeItem(this.GUIDE_STEP_KEY);
        } catch (e) {
            // 忽略存储错误
        }
    },

    /**
     * 重置引导状态
     */
    resetGuide() {
        try {
            localStorage.removeItem(this.GUIDE_KEY);
            localStorage.removeItem(this.GUIDE_STEP_KEY);
        } catch (e) {
            // 忽略存储错误
        }
    }
};
