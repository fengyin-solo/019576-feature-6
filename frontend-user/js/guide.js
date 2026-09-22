/**
 * 实景步骤引导系统
 *
 * 三步依次指向：左侧素材库 → 中间画布 → 右侧参数面板，
 * 用聚光高亮标出当前操作区域，用户完成实际操作后才解锁下一步。
 * - 中途退出会记住当前步骤，再次进入从该步继续
 * - 全部完成后不再自动弹出
 * - 目标区域在当前设备上被折叠/不可见时，自动改指可操作的替代位置
 */
class GuideManager {
    constructor(canvasManager) {
        this.canvasManager = canvasManager || null;

        // 欢迎遮罩与实景引导层
        this.overlay = document.getElementById('guide-overlay');
        this.tour = document.getElementById('guide-tour');
        this.spotlight = document.getElementById('guide-tour-spotlight');
        this.popover = document.getElementById('guide-tour-popover');

        this.currentStep = 0;
        this.isActive = false;
        this.targetEl = null;
        this._targetMarked = null;
        this._advanceTimer = null;
        this._rafPending = false;
        this._paramChanged = false;

        // 步骤定义
        // selector：首选高亮区域；fallbacks：该区域被折叠/不可见时依次改指的可操作位置
        this.steps = [
            {
                title: '第一步 · 添加透镜',
                desc: '这里是<strong>左侧透镜素材库</strong>。在桌面端，把一个<strong>凸透镜</strong>拖拽到中间画布上；在手机/平板上，直接<strong>点击</strong>素材卡片也可以添加。',
                hint: '凸透镜中间厚、边缘薄，可以让平行光线汇聚到一点。',
                selectors: ['#lens-library'],
                fallbacks: [
                    { selector: '#lens-library .sidebar-content', scrollIntoView: true },
                    { selector: '#lens-library .lens-item', scrollIntoView: true },
                    { selector: '#lens-library .sidebar-header' }
                ],
                waitingText: '请从素材库添加一个透镜',
                doneText: '透镜已添加 ✅'
            },
            {
                title: '第二步 · 观察画布与光路',
                desc: '这里是<strong>中间画布</strong>，透镜放在这里并可以拖动摆放。点击画布上方的<strong>「启动光路」</strong>按钮，观察红色入射光穿过透镜后变成蓝色折射光。',
                hint: '再次点击同一个按钮可以暂停光路，方便慢慢观察。',
                selectors: ['#canvas-wrapper'],
                fallbacks: [
                    { selector: '#btn-toggle-light' },
                    { selector: '.canvas-toolbar' }
                ],
                waitingText: '请点击「启动光路」按钮',
                doneText: '光路已启动 ✅'
            },
            {
                title: '第三步 · 调节透镜参数',
                desc: '这里是<strong>右侧参数面板</strong>。先点击画布上的透镜选中它，然后拖动<strong>「折射率」</strong>滑块（或改变材料），观察光路偏折程度的变化。',
                hint: '折射率越大，光线在透镜中偏折得越明显。',
                selectors: ['#params-panel'],
                fallbacks: [
                    { selector: '#param-ri', scrollIntoView: true },
                    { selector: '#panel-params', scrollIntoView: true },
                    { selector: '#params-panel .sidebar-header' }
                ],
                waitingText: '请选中透镜并调节任意参数',
                doneText: '参数已调节 ✅'
            }
        ];

        this.init();
    }

    /**
     * 初始化
     */
    init() {
        this.bindEvents();

        // 首次使用：显示欢迎页；未完成且有进度：直接回到上次那一步；已完成：不自动弹出
        if (Storage.isGuideCompleted()) return;

        const savedStep = Storage.getGuideStep();
        if (savedStep !== null) {
            this.startTour(Math.min(savedStep, this.steps.length - 1));
        } else {
            this.showWelcome();
        }
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // 欢迎页
        document.getElementById('btn-start-guide').addEventListener('click', () => {
            this.hideWelcome();
            this.startTour(0);
        });
        document.getElementById('btn-skip-guide').addEventListener('click', () => {
            this.complete();
        });

        // 步骤气泡
        document.getElementById('btn-tour-next').addEventListener('click', () => {
            this.goNext();
        });
        document.getElementById('btn-tour-exit').addEventListener('click', () => {
            this.exitTour();
        });
        document.getElementById('btn-exit-tour').addEventListener('click', () => {
            this.exitTour();
        });

        // 外部事件：帮助按钮重新打开引导
        window.addEventListener('showGuide', () => {
            if (this.isActive) return;
            if (Storage.isGuideCompleted()) {
                // 已完成用户通过帮助按钮回顾，从欢迎页重新开始
                Storage.resetGuide();
                this.showWelcome();
            } else {
                const savedStep = Storage.getGuideStep();
                if (savedStep !== null) {
                    this.startTour(Math.min(savedStep, this.steps.length - 1));
                } else {
                    this.showWelcome();
                }
            }
        });

        // 用户实际操作事件（仅在引导进行中用于解锁步骤）
        window.addEventListener('lensAdded', () => {
            if (this.isActive && this.currentStep === 0) {
                this.markStepDone();
            }
        });
        window.addEventListener('lightToggled', (e) => {
            if (!this.isActive || this.currentStep !== 1) return;
            if (e.detail && e.detail.running) {
                this.markStepDone();
            } else {
                // 延迟期内又暂停了光路：撤回解锁，停留在本步
                clearTimeout(this._advanceTimer);
                this._advanceTimer = null;
                document.getElementById('btn-tour-next').disabled = true;
                this.refreshStatus();
            }
        });
        window.addEventListener('lensParamChanged', () => {
            if (this.isActive && this.currentStep === 2) {
                this.markStepDone();
            }
        });

        // 键盘：ESC 退出
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isActive) {
                this.exitTour();
            }
        });

        // 目标区域可能因滚动/旋转/折叠变化，重新定位
        window.addEventListener('resize', () => this.scheduleReposition());
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.scheduleReposition(), 200);
        });
        document.addEventListener('scroll', () => this.scheduleReposition(), true);
    }

    /* ---------------- 欢迎页 ---------------- */

    showWelcome() {
        this.overlay.classList.remove('hidden');
    }

    hideWelcome() {
        this.overlay.classList.add('hidden');
    }

    /* ---------------- 引导流程 ---------------- */

    /**
     * 开始（或继续）实景引导
     */
    startTour(stepIndex) {
        this.hideWelcome();
        this.isActive = true;
        this.tour.classList.remove('hidden');
        this.showStep(stepIndex);
    }

    /**
     * 中途退出：记住当前步骤，下次回到这一步
     */
    exitTour() {
        if (!this.isActive) return;
        Storage.setGuideStep(this.currentStep);
        this.teardownTour();
        Utils.showToast('引导已暂停，点击右上角「?」可从这一步继续', 'info', 2600);
    }

    /**
     * 完成引导：标记完成，之后不再自动弹出
     */
    complete() {
        Storage.setGuideCompleted();
        this.hideWelcome();
        this.teardownTour();
        Utils.showToast('引导完成，开始你的光学探索之旅吧！', 'success');
    }

    teardownTour() {
        this.isActive = false;
        clearTimeout(this._advanceTimer);
        this._advanceTimer = null;
        this.tour.classList.add('hidden');
        this.clearTargetMark();
        this.targetEl = null;
    }

    /**
     * 显示指定步骤
     */
    showStep(index) {
        this.currentStep = index;
        Storage.setGuideStep(index);
        clearTimeout(this._advanceTimer);
        this._advanceTimer = null;
        if (index !== 2) this._paramChanged = false;

        const step = this.steps[index];
        const isLast = index === this.steps.length - 1;

        document.getElementById('tour-step-num').textContent = `${index + 1}/${this.steps.length}`;
        document.getElementById('tour-step-title').textContent = step.title;
        document.getElementById('tour-step-desc').innerHTML = step.desc;
        document.getElementById('tour-step-hint-text').textContent = step.hint;

        const nextBtn = document.getElementById('btn-tour-next');
        nextBtn.disabled = true;
        nextBtn.textContent = isLast ? '完成引导' : '下一步';

        // 该步骤的前置条件（如第三步需要画布上有透镜）不满足时，给出可操作入口
        this.renderStepAction(step);
        this.refreshStatus();

        this.clearTargetMark();
        this.targetEl = this.resolveTarget(step);
        this.markTarget();

        // 等待布局完成后定位聚光与气泡
        requestAnimationFrame(() => requestAnimationFrame(() => this.position()));
    }

    /**
     * 当前步骤前置条件不满足时，在气泡中提供可操作按钮
     */
    renderStepAction(step) {
        const actionBox = document.getElementById('tour-step-action');
        actionBox.innerHTML = '';
        actionBox.classList.add('hidden');

        if (this.currentStep === 2 && this.getLenses().length === 0) {
            actionBox.innerHTML = '<button class="btn btn-secondary btn-sm" id="btn-tour-add-lens">画布上还没有透镜，点我先放一个凸透镜</button>';
            actionBox.classList.remove('hidden');
            actionBox.querySelector('#btn-tour-add-lens').addEventListener('click', () => {
                this.addSampleLens();
            });
        }
    }

    /**
     * 判断当前步骤要求的操作是否已完成
     */
    isStepDone() {
        if (this.currentStep === 0) {
            return this.getLenses().length > 0;
        }
        if (this.currentStep === 1) {
            return !!(this.canvasManager && this.canvasManager.getRenderer().isRunning);
        }
        if (this.currentStep === 2) {
            // 实际调节动作由 lensParamChanged 事件确认
            return !!this._paramChanged;
        }
        return false;
    }

    /**
     * 用户完成了当前步骤要求的实际操作
     */
    markStepDone() {
        if (this.currentStep === 2) this._paramChanged = true;
        this.refreshStatus();

        const nextBtn = document.getElementById('btn-tour-next');
        nextBtn.disabled = false;
        nextBtn.focus({ preventScroll: true });

        // 自动延迟进入下一步，同时保留按钮供用户手动推进；
        // 延迟期间若操作被撤销（如又暂停了光路）则停留
        clearTimeout(this._advanceTimer);
        this._advanceTimer = setTimeout(() => {
            if (this.isActive && this.isStepDone()) this.goNext();
        }, 1400);
    }

    goNext() {
        clearTimeout(this._advanceTimer);
        if (this.currentStep >= this.steps.length - 1) {
            this.complete();
        } else {
            this.showStep(this.currentStep + 1);
        }
    }

    refreshStatus() {
        const step = this.steps[this.currentStep];
        const statusEl = document.getElementById('tour-step-status');
        const done = this.isStepDone();
        statusEl.textContent = done ? step.doneText : step.waitingText;
        statusEl.classList.toggle('is-done', done);
    }

    /* ---------------- 目标定位 ---------------- */

    /**
     * 解析当前步骤的高亮目标：
     * 首选完整区域；若该区域在当前设备上被折叠/不可见/不可操作，
     * 依次尝试替代选择器，并把可滚动的目标滚动到可视位置。
     */
    resolveTarget(step) {
        const candidates = [
            ...step.selectors.map(sel => ({ selector: sel })),
            ...(step.fallbacks || [])
        ];

        for (const candidate of candidates) {
            const el = document.querySelector(candidate.selector);
            if (!el) continue;

            if (candidate.scrollIntoView) {
                try {
                    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                } catch (e) {
                    el.scrollIntoView();
                }
            }

            if (this.isOperable(el)) {
                return el;
            }
        }
        return null;
    }

    /**
     * 判断元素在当前设备上是否真实可见且有足够的可操作面积
     */
    isOperable(el) {
        if (!el || !el.getClientRects().length) return false;

        const rect = el.getBoundingClientRect();
        if (rect.width < 24 || rect.height < 24) return false;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
            return false;
        }

        // 被祖先 overflow 裁剪到不可见（区域被折叠）时视为不可操作
        const visibleRect = this.getVisibleRect(el, rect);
        if (!visibleRect || visibleRect.width < 24 || visibleRect.height < 24) {
            return false;
        }

        return true;
    }

    /**
     * 获取元素相对视口的可见部分（排除被滚动容器裁剪的区域）
     */
    getVisibleRect(el, rect) {
        let left = rect.left;
        let top = rect.top;
        let right = rect.right;
        let bottom = rect.bottom;

        let parent = el.parentElement;
        while (parent && parent !== document.body) {
            const pStyle = window.getComputedStyle(parent);
            const clipsX = /(auto|hidden|scroll|clip)/.test(pStyle.overflowX);
            const clipsY = /(auto|hidden|scroll|clip)/.test(pStyle.overflowY);
            if (clipsX || clipsY) {
                const pr = parent.getBoundingClientRect();
                if (clipsX) {
                    left = Math.max(left, pr.left);
                    right = Math.min(right, pr.right);
                }
                if (clipsY) {
                    top = Math.max(top, pr.top);
                    bottom = Math.min(bottom, pr.bottom);
                }
            }
            parent = parent.parentElement;
        }

        if (right <= left || bottom <= top) return null;
        return {
            left, top,
            right, bottom,
            width: right - left,
            height: bottom - top
        };
    }

    markTarget() {
        this.clearTargetMark();
        if (this.targetEl) {
            this.targetEl.classList.add('guide-target-active');
            this._targetMarked = this.targetEl;
        }
    }

    clearTargetMark() {
        if (this._targetMarked) {
            this._targetMarked.classList.remove('guide-target-active');
            this._targetMarked = null;
        }
    }

    /**
     * 计算聚光框位置并选择气泡摆放方向
     */
    position() {
        if (!this.isActive) return;

        const pad = 6;
        let spotRect;

        if (this.targetEl) {
            const visible = this.getVisibleRect(this.targetEl, this.targetEl.getBoundingClientRect());
            spotRect = visible || this.targetEl.getBoundingClientRect();
        } else {
            // 兜底：屏幕中央的小区域
            spotRect = {
                left: window.innerWidth / 2 - 60,
                top: window.innerHeight / 2 - 30,
                right: window.innerWidth / 2 + 60,
                bottom: window.innerHeight / 2 + 30,
                width: 120,
                height: 60
            };
        }

        const s = {
            left: spotRect.left - pad,
            top: spotRect.top - pad,
            width: (spotRect.right - spotRect.left) + pad * 2,
            height: (spotRect.bottom - spotRect.top) + pad * 2
        };
        this.spotlight.style.transform = `translate(${s.left}px, ${s.top}px)`;
        this.spotlight.style.width = `${s.width}px`;
        this.spotlight.style.height = `${s.height}px`;

        this.positionPopover(s);
    }

    /**
     * 把说明气泡放到空间最充足的一侧，并确保说明完整呈现、不被裁剪
     */
    positionPopover(spot) {
        const pop = this.popover;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const gap = 12;
        const margin = 10;

        // 先以最大允许宽度测量气泡自身高度
        pop.style.maxWidth = `${Math.min(340, vw - margin * 2)}px`;
        pop.style.left = '0px';
        pop.style.top = '0px';
        pop.style.right = 'auto';
        pop.style.bottom = 'auto';

        const popW = pop.offsetWidth;
        const popH = pop.offsetHeight;

        // 各方向可用空间
        const space = {
            bottom: vh - (spot.top + spot.height) - gap,
            top: spot.top - gap,
            right: vw - (spot.left + spot.width) - gap,
            left: spot.left - gap
        };

        // 能完整放下的方向里，选空间最大的
        const fits = ['bottom', 'top', 'right', 'left']
            .filter(d => space[d] >= (d === 'left' || d === 'right' ? popW : popH))
            .sort((a, b) => space[b] - space[a]);

        let side;
        if (fits.length > 0) {
            side = fits[0];
        } else {
            // 都放不下时，优先让气泡压在高亮区域上（底部/右侧/左侧），
            // 避免气泡盖住区域外待操作的控件（如画布上方的「启动光路」）
            const priority = ['bottom', 'right', 'left', 'top'];
            side = priority
                .filter(d => space[d] >= 80)
                .sort((a, b) => space[b] - space[a])[0];
            if (!side) {
                side = priority.reduce((a, b) => (space[a] >= space[b] ? a : b));
            }
        }

        let left;
        let top;
        const arrow = pop.querySelector('.guide-tour-arrow') || this.createArrow();

        if (side === 'bottom' || side === 'top') {
            left = spot.left + spot.width / 2 - popW / 2;
            top = side === 'bottom'
                ? spot.top + spot.height + gap
                : spot.top - gap - popH;
        } else {
            left = side === 'right'
                ? spot.left + spot.width + gap
                : spot.left - gap - popW;
            top = spot.top + spot.height / 2 - popH / 2;
        }

        // 限制在视口内（保证说明完整可见）
        left = Utils.clamp(left, margin, vw - popW - margin);
        top = Utils.clamp(top, margin, vh - popH - margin);

        pop.style.left = `${left}px`;
        pop.style.top = `${top}px`;
        pop.dataset.side = side;

        // 箭头指向聚光框中心
        const spotCX = spot.left + spot.width / 2;
        const spotCY = spot.top + spot.height / 2;
        arrow.style.left = 'auto';
        arrow.style.top = 'auto';
        arrow.style.right = 'auto';
        arrow.style.bottom = 'auto';
        if (side === 'bottom' || side === 'top') {
            const arrowX = Utils.clamp(spotCX - left, 16, popW - 16);
            arrow.style.left = `${arrowX}px`;
            arrow.style.top = side === 'bottom' ? '-7px' : 'auto';
            arrow.style.bottom = side === 'top' ? '-7px' : 'auto';
        } else {
            const arrowY = Utils.clamp(spotCY - top, 16, popH - 16);
            arrow.style.top = `${arrowY}px`;
            arrow.style.left = side === 'right' ? '-7px' : 'auto';
            arrow.style.right = side === 'left' ? '-7px' : 'auto';
        }
    }

    createArrow() {
        const arrow = document.createElement('div');
        arrow.className = 'guide-tour-arrow';
        this.popover.appendChild(arrow);
        return arrow;
    }

    scheduleReposition() {
        if (!this.isActive) return;
        if (this._rafPending) return;
        this._rafPending = true;
        requestAnimationFrame(() => {
            this._rafPending = false;
            if (this.isActive) this.position();
        });
    }

    /* ---------------- 辅助操作 ---------------- */

    getLenses() {
        return this.canvasManager ? this.canvasManager.lenses : [];
    }

    addSampleLens() {
        if (!this.canvasManager) return;
        const renderer = this.canvasManager.getRenderer();
        const lens = new Lens({
            type: CONFIG.LENS_TYPES.CONVEX,
            x: renderer.width / 2,
            y: renderer.height / 2,
            material: 'normal'
        });
        this.canvasManager.addLens(lens);
        this.canvasManager.selectLens(lens);
        window.dispatchEvent(new CustomEvent('lensAdded', { detail: lens }));
        // 透镜已选中后刷新气泡中的前置条件提示
        this.renderStepAction(this.steps[this.currentStep]);
        this.refreshStatus();
        // 参数面板展开后，重新解析目标（此时可直接高亮折射率滑块）并定位
        requestAnimationFrame(() => {
            this.clearTargetMark();
            this.targetEl = this.resolveTarget(this.steps[this.currentStep]);
            this.markTarget();
            this.position();
        });
    }
}
