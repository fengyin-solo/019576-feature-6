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
            localStorage.removeItem(this.GUIDE_STEP_KEY);
        } catch (e) {
            // 忽略存储错误
        }
    },

    /**
     * 获取上次进行到的引导步骤（0 起）
     * 未开始或已完成时返回 null
     */
    getGuideStep() {
        try {
            if (this.isGuideCompleted()) return null;
            const value = parseInt(localStorage.getItem(this.GUIDE_STEP_KEY), 10);
            return isNaN(value) ? null : value;
        } catch (e) {
            return null;
        }
    },

    /**
     * 记录当前引导步骤（中途退出后可回到这一步）
     */
    setGuideStep(step) {
        try {
            localStorage.setItem(this.GUIDE_STEP_KEY, String(step));
        } catch (e) {
            // 忽略存储错误
        }
    },

    /**
     * 重置引导状态（重新查看引导时使用）
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
