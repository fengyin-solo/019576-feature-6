/**
 * 引导系统
 * 跟随真实界面的分步高亮引导：
 * - 每一步高亮对应的功能区域（素材库 / 画布 / 参数面板）
 * - 中途退出后再次进入会回到上次的步骤
 * - 目标区域在当前设备上被折叠时，自动切换到可操作的备选位置
 */
class GuideManager {
    constructor() {
        this.overlay = document.getElementById('guide-overlay');
        this.welcomeEl = document.getElementById('guide-welcome');
        this.tooltipEl = document.getElementById('guide-tooltip');
        this.spotlightEl = document.getElementById('guide-spotlight');
        this.arrowEl = document.getElementById('guide-tooltip-arrow');
        this.masks = {
            top: document.getElementById('guide-mask-top'),
            left: document.getElementById('guide-mask-left'),
            right: document.getElementById('guide-mask-right'),
            bottom: document.getElementById('guide-mask-bottom')
        };

        this.active = false;
        this.currentStep = 0; // 0 = 欢迎页，1..N = 高亮步骤

        // 高亮步骤定义：target 为首选区域，fallbacks 为区域被折叠时的备选可操作位置
        this.steps = [
            {
                target: '#lens-library',
                fallbacks: ['#lens-library .lens-item', '#lens-library .sidebar-header'],
                title: '第 1 步：透镜素材库',
                desc: '这里是透镜素材库。按住任意一个透镜卡片（比如凸透镜），把它拖拽到中间的画布上，就添加好了一个透镜。',
                hint: '凸透镜可以让光线汇聚到一点',
                prefer: 'right'
            },
            {
                target: '#canvas-wrapper',
                fallbacks: ['#optics-canvas', '.canvas-section'],
                title: '第 2 步：画布与光路',
                desc: '这里是画布。透镜会放置在这里，点击上方工具栏的「启动光路」，就能实时观察光线穿过透镜时的偏折过程。',
                hint: '红色是入射光，蓝色是折射光',
                prefer: 'bottom'
            },
            {
                target: '#params-panel',
                fallbacks: ['#params-panel .sidebar-content', '#params-panel .sidebar-header'],
                title: '第 3 步：参数调节面板',
                desc: '这里是参数面板。点击画布上的透镜后，可以在这里调节折射率、尺寸、弧度和材料，光路会跟着实时变化。',
                hint: '折射率越大，光偏折越明显',
                prefer: 'left'
            }
        ];

        this.init();
    }

    /**
     * 初始化
     */
    init() {
        this.bindEvents();

        // 窗口尺寸/方向变化时重新定位高亮与气泡
        this.onResize = Utils.debounce(() => {
            if (this.active && this.currentStep > 0) {
                this.layoutStep();
            }
        }, 100);
        window.addEventListener('resize', this.onResize);

        // 未完成引导时自动弹出；已完成则不再自动弹出
        if (!Storage.isGuideCompleted()) {
            this.show();
        }

        // 监听显示引导事件
        window.addEventListener('showGuide', () => {
            this.show();
        });
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // 欢迎页：开始引导
        document.getElementById('btn-start-guide').addEventListener('click', () => {
            this.goToStep(1);
        });

        // 欢迎页：跳过引导
        document.getElementById('btn-skip-guide').addEventListener('click', () => {
            this.complete();
        });

        // 步骤导航
        document.getElementById('btn-guide-next').addEventListener('click', () => {
            this.nextStep();
        });

        document.getElementById('btn-guide-prev').addEventListener('click', () => {
            this.prevStep();
        });

        // 中途退出（记录当前步骤，下次继续）
        document.getElementById('btn-guide-exit').addEventListener('click', () => {
            this.exit();
        });

        // ESC 键中途退出
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.active) {
                this.exit();
            }
        });
    }

    /**
     * 显示引导
     * 已完成过引导时从头开始复习；未完成时回到上次退出的步骤
     */
    show() {
        const startStep = Storage.isGuideCompleted()
            ? 0
            : Utils.clamp(Storage.getGuideStep(), 0, this.steps.length);

        this.active = true;
        this.overlay.classList.remove('hidden');
        this.goToStep(startStep);
    }

    /**
     * 隐藏引导
     */
    hide() {
        this.active = false;
        this.overlay.classList.add('hidden');
    }

    /**
     * 跳转到指定步骤
     */
    goToStep(index) {
        if (index > this.steps.length) {
            this.complete();
            return;
        }

        this.currentStep = index;

        if (index === 0) {
            // 欢迎页模式
            this.overlay.classList.remove('step-mode');
            this.welcomeEl.classList.remove('hidden');
            this.tooltipEl.classList.add('hidden');
            this.spotlightEl.classList.add('hidden');
            this.setMasksVisible(false);
        } else {
            // 高亮步骤模式
            this.overlay.classList.add('step-mode');
            this.welcomeEl.classList.add('hidden');
            this.tooltipEl.classList.remove('hidden');
            this.renderStep();
        }

        // 记录进度，中途退出后可以续走
        if (!Storage.isGuideCompleted()) {
            Storage.setGuideStep(index);
        }
    }

    /**
     * 渲染当前步骤的文案与按钮
     */
    renderStep() {
        const step = this.steps[this.currentStep - 1];

        document.getElementById('guide-step-num').textContent =
            `${this.currentStep}/${this.steps.length}`;
        document.getElementById('guide-step-title').textContent = step.title;
        document.getElementById('guide-step-desc').textContent = step.desc;
        document.getElementById('guide-step-hint').textContent = step.hint;

        document.getElementById('btn-guide-prev').classList
            .toggle('hidden', this.currentStep <= 1);
        document.getElementById('btn-guide-next').textContent =
            this.currentStep === this.steps.length ? '完成' : '下一步';

        this.layoutStep();
    }

    /**
     * 布局当前步骤：定位高亮框、遮罩与说明气泡
     */
    layoutStep() {
        const step = this.steps[this.currentStep - 1];
        const targetEl = this.resolveTarget(step);
        const rect = targetEl ? this.getClampedRect(targetEl) : null;

        if (rect) {
            this.spotlightEl.classList.remove('hidden');
            this.setMasksVisible(true);
            this.positionSpotlight(rect);
        } else {
            // 没有可指向的区域：仅居中展示说明气泡
            this.spotlightEl.classList.add('hidden');
            this.setMasksVisible(false);
        }

        this.positionTooltip(rect, step.prefer);
    }

    /**
     * 解析步骤指向的目标元素
     * 首选区域被折叠（不可见/尺寸过小/滚出视野）时，依次尝试备选的可操作位置
     */
    resolveTarget(step) {
        const candidates = [step.target].concat(step.fallbacks || []);

        for (const selector of candidates) {
            const el = document.querySelector(selector);
            if (!el) continue;

            if (this.isOperable(el)) return el;

            // 可能被折叠在滚动容器内，先尝试滚动到可视区域再判断
            try {
                el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } catch (e) {
                // 忽略滚动异常
            }
            if (this.isOperable(el)) return el;
        }

        return null;
    }

    /**
     * 判断元素当前是否可操作（可见且在视口内有足够尺寸）
     */
    isOperable(el) {
        if (!el || !el.isConnected) return false;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;

        const rect = el.getBoundingClientRect();
        const minSize = 48; // 最小可触控尺寸
        if (rect.width < minSize || rect.height < minSize) return false;

        const visibleW = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
        const visibleH = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        return visibleW >= minSize && visibleH >= minSize;
    }

    /**
     * 获取元素钳制在视口内的矩形（含高亮留白）
     */
    getClampedRect(el) {
        const pad = 6;
        const r = el.getBoundingClientRect();
        const left = Utils.clamp(r.left - pad, 0, window.innerWidth);
        const top = Utils.clamp(r.top - pad, 0, window.innerHeight);
        const right = Utils.clamp(r.right + pad, 0, window.innerWidth);
        const bottom = Utils.clamp(r.bottom + pad, 0, window.innerHeight);

        return {
            left: left,
            top: top,
            right: right,
            bottom: bottom,
            width: Math.max(right - left, 0),
            height: Math.max(bottom - top, 0)
        };
    }

    /**
     * 定位高亮框与四块遮罩
     */
    positionSpotlight(rect) {
        const s = this.spotlightEl.style;
        s.left = rect.left + 'px';
        s.top = rect.top + 'px';
        s.width = rect.width + 'px';
        s.height = rect.height + 'px';

        const vw = window.innerWidth;
        const vh = window.innerHeight;

        this.setMask(this.masks.top, 0, 0, vw, rect.top);
        this.setMask(this.masks.bottom, 0, rect.bottom, vw, vh - rect.bottom);
        this.setMask(this.masks.left, 0, rect.top, rect.left, rect.height);
        this.setMask(this.masks.right, rect.right, rect.top, vw - rect.right, rect.height);
    }

    setMask(el, left, top, width, height) {
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.width = Math.max(width, 0) + 'px';
        el.style.height = Math.max(height, 0) + 'px';
    }

    setMasksVisible(visible) {
        Object.values(this.masks).forEach(mask => {
            mask.classList.toggle('hidden', !visible);
        });
    }

    /**
     * 定位说明气泡：优先放在目标偏好的一侧，空间不足时自动换边，
     * 最终钳制在视口内，保证说明完整呈现
     */
    positionTooltip(rect, prefer) {
        const tooltip = this.tooltipEl;
        const margin = 8;
        const gap = 14;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // 先复位再测量气泡的自然尺寸
        tooltip.style.left = '0px';
        tooltip.style.top = '0px';
        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;

        if (!rect) {
            const left = Math.max(margin, (vw - tw) / 2);
            const top = Math.max(margin, (vh - th) / 2);
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
            tooltip.dataset.arrow = 'none';
            return;
        }

        // 目标各方向的可用空间
        const spaces = {
            right: vw - rect.right - gap,
            left: rect.left - gap,
            bottom: vh - rect.bottom - gap,
            top: rect.top - gap
        };

        const fits = (dir) => {
            if (dir === 'right' || dir === 'left') {
                return spaces[dir] >= tw && vh >= th + margin * 2;
            }
            return spaces[dir] >= th;
        };

        // 偏好方向优先，其余按常见阅读顺序补充
        const order = [prefer, 'bottom', 'top', 'right', 'left']
            .filter((d, i, arr) => d && arr.indexOf(d) === i);

        let dir = order.find(fits);
        if (!dir) {
            // 都放不下时选空间最大的方向，位置交给钳制逻辑处理
            dir = order.reduce((best, d) => spaces[d] > spaces[best] ? d : best, order[0]);
        }

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        let left;
        let top;

        if (dir === 'right') {
            left = rect.right + gap;
            top = centerY - th / 2;
        } else if (dir === 'left') {
            left = rect.left - gap - tw;
            top = centerY - th / 2;
        } else if (dir === 'bottom') {
            left = centerX - tw / 2;
            top = rect.bottom + gap;
        } else {
            left = centerX - tw / 2;
            top = rect.top - gap - th;
        }

        // 钳制在视口内，保证说明完整可见
        left = Utils.clamp(left, margin, Math.max(margin, vw - tw - margin));
        top = Utils.clamp(top, margin, Math.max(margin, vh - th - margin));

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
        tooltip.dataset.arrow = dir;
        this.positionArrow(dir, rect, left, top, tw, th);
    }

    /**
     * 定位气泡箭头，使其指向目标区域中心
     */
    positionArrow(dir, rect, tooltipLeft, tooltipTop, tw, th) {
        const arrowSize = 12;
        const edgePadding = 14;

        if (dir === 'right' || dir === 'left') {
            const centerY = rect.top + rect.height / 2;
            const offset = Utils.clamp(
                centerY - tooltipTop - arrowSize / 2,
                edgePadding,
                Math.max(edgePadding, th - arrowSize - edgePadding)
            );
            this.arrowEl.style.top = offset + 'px';
            this.arrowEl.style.left = '';
            this.arrowEl.style.right = '';
            this.arrowEl.style.bottom = '';
        } else if (dir === 'bottom' || dir === 'top') {
            const centerX = rect.left + rect.width / 2;
            const offset = Utils.clamp(
                centerX - tooltipLeft - arrowSize / 2,
                edgePadding,
                Math.max(edgePadding, tw - arrowSize - edgePadding)
            );
            this.arrowEl.style.left = offset + 'px';
            this.arrowEl.style.top = '';
            this.arrowEl.style.right = '';
            this.arrowEl.style.bottom = '';
        }
    }

    /**
     * 下一步
     */
    nextStep() {
        this.goToStep(this.currentStep + 1);
    }

    /**
     * 上一步
     */
    prevStep() {
        if (this.currentStep > 1) {
            this.goToStep(this.currentStep - 1);
        }
    }

    /**
     * 中途退出：记录当前步骤，下次进入时继续
     */
    exit() {
        if (!Storage.isGuideCompleted()) {
            Storage.setGuideStep(this.currentStep);
            Utils.showToast('引导已暂停，点击右上角 ? 可从中断处继续', 'info');
        }
        this.hide();
    }

    /**
     * 完成引导
     */
    complete() {
        Storage.setGuideCompleted();
        Storage.clearGuideStep();
        this.hide();
        Utils.showToast('开始你的光学探索之旅吧！', 'success');
    }
}
