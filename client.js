window.__ModuleLoader__.load({
	id: 'dsh-sidebar-density',
	factory(require) {
		'use strict';

		const NS = 'dsh-sidebar-density';
		const STYLE_ID = 'dsh-sidebar-density-style';
		const POPOVER_ID = 'dsh-sidebar-density-popover';
		const TRIGGER_ID = 'dsh-sidebar-density-trigger';
		const STORAGE_KEY = 'dsh-sidebar-density:settings';

		/**
		 * 可调项。
		 *
		 * 字号是**偏移量**（+0 = 完全不动原 UI），不是绝对值：官方各处字号并不统一
		 * （14 / 13 / 12 / 10），设成统一值会把层级压平。用 `font-size:…` 无法做
		 * 相对缩放，所以这里给每个节点按「原始 px + 偏移」重算，原始值从内联样式
		 * 记忆里读，读不到就按选择器给默认基准。
		 */
		const LIVE = [
			{ key: 'gap', min: 0, max: 12, step: 1, fallback: 1, unit: 'px' },
			{ key: 'logoGap', min: 0, max: 40, step: 1, fallback: 4, unit: 'px' },
			{ key: 'sessionRow', min: 20, max: 40, step: 1, fallback: 26, unit: 'px' },
			{ key: 'panelRow', min: 22, max: 44, step: 1, fallback: 30, unit: 'px' },
			{ key: 'fontDelta', min: -3, max: 4, step: 1, fallback: 0, unit: 'px', signed: true },
			{ key: 'logoSize', min: 14, max: 40, step: 1, fallback: 24, unit: 'px' },
			{ key: 'newSession', min: 24, max: 44, step: 1, fallback: 30, unit: 'px' },
			{ key: 'hideNewSession', kind: 'toggle', fallback: false },
			{ key: 'panelColumns', kind: 'toggle', fallback: false },
			{ key: 'captionHeight', min: 20, max: 48, step: 1, fallback: 28, unit: 'px', patch: 'caption' },
			{ key: 'captionFont', min: 9, max: 16, step: 1, fallback: 12, unit: 'px', patch: 'font' },
			{ key: 'widthUnlock', kind: 'toggle', fallback: true, patch: 'width' },
		];

		const DEFAULTS = Object.freeze({
			gap: 1,
			logoGap: 4,
			sessionRow: 26,
			panelRow: 30,
			fontDelta: 0,
			logoSize: 24,
			logoImage: '',
			newSession: 30,
			captionHeight: 28,
			captionFont: 12,
			hideNewSession: false,
			panelColumns: false,
			widthUnlock: true,
			fontFamily: '',
		});

		/** 常用无衬线候选；真正的选择靠「搜索系统字体」（见下面的字体列表 API）。 */
		const FONT_PRESETS = [
			{ key: 'fontDefault', stack: '' },
			{ key: 'fontPingFang', stack: '"PingFang SC", ".PingFang SC", "苹方-简", "苹方"' },
			{ key: 'fontSystemUi', stack: 'system-ui' },
			{ key: 'fontYahei', stack: '"Microsoft YaHei UI", "Microsoft YaHei"' },
			{ key: 'fontMono', stack: 'ui-monospace, Consolas' },
			{ key: 'fontSerif', stack: 'Georgia, "Songti SC"' },
		];

		const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

		function readSettings() {
			const next = { ...DEFAULTS };
			let raw = null;
			try {
				raw = window.localStorage.getItem(STORAGE_KEY);
			} catch {
				raw = null;
			}
			if (raw === null) return next;
			try {
				const parsed = JSON.parse(raw);
				for (const field of LIVE) {
					const value = parsed?.[field.key];
					if (field.kind === 'toggle') {
						if (typeof value === 'boolean') next[field.key] = value;
						continue;
					}
					if (typeof value === 'number' && Number.isFinite(value)) {
						next[field.key] = clamp(Math.round(value), field.min, field.max);
					}
				}
				if (typeof parsed?.logoImage === 'string') next.logoImage = parsed.logoImage;
				if (typeof parsed?.fontFamily === 'string') {
					// 旧版本存的是预设 id（system / ui / mono / serif），不是真正的字族名。
					// 那些 id 不能当字体名用，迁移成空串（= 不改字体）。
					const legacy = parsed.fontFamily === '' || ['system', 'ui', 'mono', 'serif'].includes(parsed.fontFamily);
					next.fontFamily = legacy ? '' : parsed.fontFamily;
				}
			} catch {
				/* 坏数据按默认走 */
			}
			return next;
		}

		function writeSettings(settings) {
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
			} catch {
				/* 存不下不影响这次预览 */
			}
		}

		let current = readSettings();

		function emit() {
			refreshReadouts();
			applyStyles();
		}

		function setField(key, raw) {
			const field = LIVE.find((candidate) => candidate.key === key);
			if (field === undefined) return;
			const value = field.kind === 'toggle'
				? raw === true || raw === 'true'
				: clamp(Math.round(Number(raw)), field.min, field.max);
			current = { ...current, [key]: value };
			writeSettings(current);
			emit();
		}

		function setFont(stack) {
			current = { ...current, fontFamily: stack };
			writeSettings(current);
			emit();
		}

		function resetAll() {
			current = { ...DEFAULTS };
			writeSettings(current);
			emit();
		}

		/* ------------------------------------------------------------------ *
		 * 左侧栏定位
		 *
		 * 结构：root > scrollRegion > scrollArea[data-sidebar-scrollport]。
		 * 「含该属性的祖先」有好几层，靠 :has(> …) 会命中中间层；所以运行时给
		 * 整列打标记，并做宽高校验，避免误标到 body 或浮层上。
		 * ------------------------------------------------------------------ */

		const SIDEBAR = '[data-dsh-density]';

		function markColumn() {
			const scrollArea = document.querySelector('[data-sidebar-scrollport]');
			const column = scrollArea?.parentElement?.parentElement;
			if (column === undefined || column === null) return null;
			if (column === document.body || column === document.documentElement) return null;
			const rect = column.getBoundingClientRect();
			if (rect.width < 40 || rect.height < 100) return null;
			if (!column.hasAttribute('data-dsh-density')) column.setAttribute('data-dsh-density', '');
			return column;
		}

		/* ------------------------------------------------------------------ *
		 * 字号：按偏移量逐节点缩放
		 *
		 * 原 UI 的字号写在类选择器上（14 / 13 / 12 / 10），没有统一值可乘。
		 * 做法：第一次见到某个节点时记下它的 computed font-size 作为基准，之后
		 * 每次把「基准 + 偏移」写回内联样式。偏移为 0 时把内联样式移除，完全
		 * 还原原 UI。
		 * ------------------------------------------------------------------ */

		/** 节点的原始字号记忆：node -> 原始 px（首次干净状态下测得的基准）。 */
		const baseFontSize = new WeakMap();

		/*
		 * 参与字号缩放的候选节点。
		 *
		 * 只列「可能有自己字号声明」的叶子文本节点，**不要把行容器放进来**：
		 * 行容器（[role=treeitem]、按钮本身）在官方 CSS 里没有 font-size，
		 * 它的字号完全是从祖先继承来的。给容器设绝对值，等于给整行所有文字
		 * 定同一个值，层级就被压平了 —— 之前「字号被统一」正是这个原因。
		 *
		 * 现在只对真正有自己声明的文本节点动手：.title 14px、.meta 12px、
		 * .time 10px 各自保留差异。基准也按各自的计算值单独记。
		 */
		const FONT_TEXT_NODES = [
			`${SIDEBAR} [data-sidebar-scrollport] [role="treeitem"] span`,
			`${SIDEBAR} [data-sidebar-scrollport] nav[aria-label] button span`,
			// 新会话按钮：同样用 newSession 片段，避免把品牌区文字卷进来
			`${SIDEBAR} button[class*="newSession"] span`,
			// 没有 span 包裹的裸文本节点（无子元素的按钮）
			`${SIDEBAR} [data-sidebar-scrollport] nav[aria-label] button`,
			`${SIDEBAR} button[class*="newSession"]`,
		].join(',');

		/**
		 * 判断某个节点是否「自己有字号」。
		 *
		 * 做法：临时把内联字号设成一个极端值，看计算值是否跟着变。跟着变说明
		 * 字号来自自己（内联或自身规则），不跟着变说明是从祖先继承来的 ——
		 * 后者不该被单独缩放，否则就是把父级的值复制一份给子级。
		 * 容器节点正是靠这个被排除掉的。
		 */
		/**
		 * 判断节点的字号来源：自己有声明，还是从父级继承。
		 *
		 * 两个都失败的思路，记录下来避免再犯：
		 * 1. 「设内联 99px 看是否生效」—— 内联 font-size 永远覆盖继承，对每个
		 *    节点都返回 true，于是全部被当成有自己字号，最后写进同一个继承值
		 *    （实测全是 13.3333px）。这就是字号被统一的直接原因。
		 * 2. 「比较自己与父级的计算值」—— .title 声明 14px、父行也是 14px，
		 *    数值相等仍会被误判成继承，标题就缩不动。
		 *
		 * 可靠做法：**动父级**。把父级临时设成离群值，看子节点跟不跟。跟着变
		 * 说明是继承（不该单独缩放）；不跟说明它有自己的字号声明。
		 */
		function detectOwnFontSize(node) {
			const parent = node.parentElement;
			if (parent === null) return false;
			const backup = parent.style.getPropertyValue('font-size');
			const priority = parent.style.getPropertyPriority('font-size');
			parent.style.setProperty('font-size', '97px', 'important');
			const followed = Math.abs(Number.parseFloat(getComputedStyle(node).fontSize) - 97) < 0.6;
			if (backup === '') parent.style.removeProperty('font-size');
			else parent.style.setProperty('font-size', backup, priority);
			return !followed;
		}

		/**
		 * 按偏移量缩放左侧栏各节点字号。
		 *
		 * 关键顺序：**先全部清空内联字号，再测量，最后统一写入**。
		 * 之前的写法是「边改父级边读子级」，父级换成 13px 后子节点的 computed
		 * 也跟着变成 13px，于是所有节点收敛到同一个值 —— 那正是「字号被统一」
		 * 的原因。清空后测量，读到的才是原始 CSS 声明的值。
		 *
		 * 基准只测一次（WeakMap 缓存）：同一节点反复拖动时不再重测，也就不会
		 * 因父级已被改动而漂移。新出现的节点（切换会话）在同一次调用里补测。
		 */
		/** 已判定「自己有字号」的节点，避免反复探测。 */
		const ownFont = new WeakMap();

		function applyFontDelta(delta) {
			const column = markColumn();
			if (column === null) return;
			const candidates = [...column.querySelectorAll(FONT_TEXT_NODES)].filter((node) => node instanceof HTMLElement);

			// 第一步：清空候选节点的内联字号，回到 CSS 原始状态再判断。
			for (const node of candidates) node.style.removeProperty('font-size');
			void column.offsetHeight;

			// 第二步：先一次性判定完（探测要动父级，边测边判会互相污染）。
			const verdict = new Map();
			for (const node of candidates) {
				let own = ownFont.get(node);
				if (own === undefined) {
					own = detectOwnFontSize(node);
					ownFont.set(node, own);
				}
				verdict.set(node, own);
			}
			// 探测期间父级被反复改动，重新回到干净状态再取基准。
			for (const node of candidates) node.style.removeProperty('font-size');
			void column.offsetHeight;

			const nodes = candidates.filter((node) => verdict.get(node) === true);

			// 第三步：按各自基准记一次。此刻所有内联字号都是干净的。
			void column.offsetHeight;
			for (const node of nodes) {
				if (baseFontSize.has(node)) continue;
				const px = Number.parseFloat(getComputedStyle(node).fontSize);
				if (Number.isFinite(px) && px > 0) baseFontSize.set(node, px);
			}

			// 临时诊断：把每个节点的基准字号汇总出去（写作 document.title），外部可读。
			window.__DSH_FONT_REPORT__ = null;
			if (true) {
				const report = nodes.map((node) => ({
					text: (node.textContent ?? '').slice(0, 12),
					own: baseFontSize.get(node) ?? null,
					now: getComputedStyle(node).fontSize,
				}));
				window.__DSH_FONT_REPORT__ = report;
				// 落盘一份，便于用外部工具核对（标题会被 DocumentTitle 覆盖）。
				try {
					window.localStorage.setItem('dsh-sidebar-density:font-report', JSON.stringify(report));
				} catch {
					/* 存不下就算了，诊断不影响功能 */
				}
			}

			// 第四步：按各自基准 + 偏移写入。delta 为 0 时保持清空 = 完全还原原 UI。
			if (delta === 0) return;
			for (const node of nodes) {
				const base = baseFontSize.get(node);
				if (base === undefined) continue;
				node.style.setProperty('font-size', `${Math.max(8, Math.round(base + delta))}px`);
			}
		}

		/* ------------------------------------------------------------------ *
		 * Logo：只命中品牌区里那个 svg
		 *
		 * FishLogo 是 `<svg width height viewBox><path fill="currentColor"/></svg>`。
		 * 它是品牌区 brandIdentity 里第一个 span 的子节点，后面紧跟品牌名。
		 * 用 `span:has(> svg):has(+ span)` 精确命中，新会话按钮、顶栏、面板、
		 * 折叠栏的图标都没有「紧跟的兄弟 span」，不会被缩到。
		 * ------------------------------------------------------------------ */

		/**
		 * 品牌 logo 尺寸。
		 *
		 * 实际结构是 brandMark > span[data-copy-version] > svg —— svg 是孙节点，
		 * 所以 `span:has(> svg)` 这类直接子级选择器永远匹配不到（之前尺寸改不动
		 * 就是这里）。改用 JS 精确取值：logo 行里第一个不属于折叠按钮的 svg。
		 *
		 * 不能用 `[data-window-drag] svg:first-of-type`：折叠状态下 logo 行里
		 * 第一个 svg 是切换按钮的图标，那样会把按钮图标当成 logo 缩掉。
		 */
		/**
		 * 品牌 logo 尺寸 —— 只作用于鲸鱼图标，不动「deepseek」文字。
		 *
		 * 这里有两个不同的 svg：
		 * - FishLogo：纯图标，viewBox 比例接近 1:1，是品牌 mark；
		 * - BrandWordmark：图标 + 文字的整体排版，viewBox 宽高比很大（约 7.6:1）。
		 * 缩后者会把两种元素一起缩，字变小、整体变形 —— 那正是之前「logo 尺寸
		 * 改了没效果/改错对象」的原因。
		 *
		 * 所以按宽高比挑：窄高的那个是图标，宽扁的那个是字标整体。
		 * 用户要的是「logo 变大变小」= 整个品牌标识变大变小，所以两者都缩，
		 * 但各自按自己的宽高比等比缩放，不拉伸。
		 */
		/**
		 * 品牌 logo 尺寸 + 自定义替换。
		 *
		 * 尺寸要连「占位」一起缩：只缩 svg 不缩它所在的行，行高仍按原 logo 留白，
		 * 下面的内容就不会上移 —— 那正是之前「缩了没意义」的原因。所以这里
		 * 同时压 logo 行的高度与上下内边距。
		 *
		 * 替换：把一个 data URL 塞进品牌 mark 的 span，隐藏原 svg。原 svg 不删，
		 * 清空自定义图即原样恢复。
		 */
		/**
		 * 品牌标识：鱼 + “deepseek” + “HARNESS” 作为一个整体缩放。
		 *
		 * 官方 DOM 里这是三段独立元素（brandMark 里的 svg / brandName 里的文字 /
		 * brandName 里的版本牌）。分别设 width、font-size 很难让三者比例一致，
		 * 稍不留神就是「鱼变小了、字没变」。
		 *
		 * 所以改用 `zoom`：Chromium 的 zoom 会同时缩放视觉尺寸**和布局占位**，
		 * 把整块 brandIdentity 当一张图处理，三者等比，且它占的位置也跟着缩。
		 * 这就是「logo 与它占据的空间一起变小」的正确实现。
		 */
		function applyLogo(size, customImage) {
			const column = markColumn();
			if (column === null) return;
			const row = [...column.querySelectorAll('[data-window-drag]')]
				.find((node) => node.querySelector('svg') !== null && node.querySelector('[data-sidebar-toggle]') === null)
				?? column.querySelector('[data-window-drag]');
			if (row === null) return;
			const identity = row.querySelector('[aria-hidden="true"]') ?? row.querySelector('span,button') ?? row;

			// 基准：第一次运行时记下图标原宽与品牌行原高，之后都相对它换算。
			if (baseLogoWidth === 0) {
				const svg0 = [...row.querySelectorAll('svg')].find((node) => node.closest('[data-sidebar-toggle]') === null);
				const box = svg0?.viewBox?.baseVal;
				baseLogoWidth = box !== undefined && box.width > 0 ? box.width : 24;
				const px = Number.parseFloat(getComputedStyle(row).height);
				baseRowHeight = Number.isFinite(px) && px > 0 ? px : 60;
			}
			const scale = size / baseLogoWidth;

			// 1) 整体缩放：三者等比，独占位置一起变。
			if (Math.abs(scale - 1) < 0.02) identity.style.removeProperty('zoom');
			else identity.style.setProperty('zoom', String(scale));

			// 2) 行高跟随：zoom 只影响 identity 自身，行容器仍是固定高，
			//    这里显式压下去，下方内容才会上移。
			const rowHeight = Math.max(16, Math.round(baseRowHeight * scale));
			row.style.setProperty('height', `${rowHeight}px`, 'important');
			row.style.setProperty('min-height', `${rowHeight}px`, 'important');
			row.style.setProperty('padding-top', '0', 'important');
			row.style.setProperty('padding-bottom', '0', 'important');

			// 3) 自定义图片：替换图标本身（文字与版本牌保留，跟着整体缩放）。
			const svg = [...row.querySelectorAll('svg')]
				.find((node) => node.closest('[data-sidebar-toggle]') === null);
			if (svg === undefined) return;
			const mark = svg.parentElement;
			let image = mark.querySelector('[data-dsh-custom-logo]');
			if (customImage === '') {
				image?.remove();
				svg.style.removeProperty('display');
			} else {
				if (image === null) {
					image = document.createElement('img');
					image.setAttribute('data-dsh-custom-logo', '');
					image.alt = '';
					image.style.cssText = 'object-fit:contain;flex:none;';
					mark.append(image);
				}
				if (image.getAttribute('src') !== customImage) image.setAttribute('src', customImage);
				svg.style.setProperty('display', 'none', 'important');
				// zoom 已负责整体缩放，这里给基准尺寸即可。
				image.style.setProperty('width', `${baseLogoWidth}px`, 'important');
				image.style.setProperty('height', `${baseLogoWidth}px`, 'important');
			}
		}

		/** 品牌图标的基准宽度与品牌行基准高度（只记一次，拖回原值可完全还原）。 */
		let baseLogoWidth = 0;
		let baseRowHeight = 0;
		/** 品牌文字的基准字号。 */
		let baseNameSize = 0;

		/** 读本地图片文件成 data URL。 */
		function readImageFile(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
				reader.onerror = () => reject(new Error('read failed'));
				reader.readAsDataURL(file);
			});
		}

		function stylesheet(settings) {
			// 顶栏按钮尺寸：日志/工具栏那三个图标不吃这个值，只有顶栏用它。
			const captionButton = Math.max(18, Math.min(settings.captionHeight, settings.captionFont * 1.9));
			const fontRule = settings.fontFamily === '' ? '' : `font-family:${settings.fontFamily}!important;`;
			return [
				`${SIDEBAR}{`,
				`  --dsh-sidebar-inline-padding:6px;`,
				`  --dsh-sidebar-row-padding:10px;`,
				`  --dsh-sidebar-label-gap:4px;`,
				fontRule === '' ? '' : `  ${fontRule}`,
				'}',

				/* 插件区行高与间距（间距只在 ≥0 时生效，不再支持负值）。 */
				`${SIDEBAR} [data-sidebar-scrollport] nav[aria-label]{gap:${settings.gap}px!important;row-gap:${settings.gap}px!important;}`,
				`${SIDEBAR} [data-sidebar-scrollport] nav[aria-label] button{`,
				`  height:${settings.panelRow}px!important;min-height:${settings.panelRow}px!important;`,
				'}',

				/* 会话 / 工作区行高。 */
				`${SIDEBAR} [data-sidebar-scrollport] [role="treeitem"]{`,
				`  height:${settings.sessionRow}px!important;min-height:${settings.sessionRow}px!important;`,
				'}',

				/* 新会话按钮：高度、隐藏。
				 *
				 * 官方用固定 38px，只设 min-height 改不了「变矮」，所以 height 也要写。
				 * 隐藏时整块不占位（display:none），别用 visibility —— 那会留下空白。 */
				/* 新会话按钮：只能命中「带 newSession 类片段」的那个。
				 *
				 * 不能用 `button[aria-keyshortcuts]`：品牌区那个「点 logo 新建会话」
				 * 的按钮同样带这个属性，隐藏它会连 logo 一起藏掉（这是实际踩过的坑）。
				 * 类名里 `newSession` 这一段的哈希前缀会随版本变，所以用片段匹配。 */
				settings.hideNewSession === true
					? `${SIDEBAR} button[class*="newSession"]{display:none!important;}`
					: `${SIDEBAR} button[class*="newSession"]{`
						+ `height:${settings.newSession}px!important;`
						+ `min-height:${settings.newSession}px!important;`
						+ `padding-top:0!important;padding-bottom:0!important;}`
					,

				/* Logo 与插件区的间距。
				 *
				 * 隐藏新会话按钮后，logo 下方会留下「新会话的高度 + 各层 margin」
				 * 的空白。这段空白不是单一来源，而是三处叠加：
				 *   1. logoRow 与 scrollRegion 之间的列内流（新会话按钮消失后由
				 *      scrollRegion 的 margin-top 顶上来）；
				 *   2. scrollArea 网格的首行（官方 8px）；
				 *   3. panelList 的上边距。
				 *
				 * 所以不逐层去猜，而是把整段空白统一交给网格首行表达：其余两处
				 * 全部归零，只保留 logosGap 这一行。值越大空得越多，0 则紧贴。
				 */
				`${SIDEBAR} [data-sidebar-scrollport]{`,
				`  grid-template-rows:${settings.logoGap}px max-content 2px max-content!important;`,
				`}`,
				`${SIDEBAR} [data-sidebar-scrollport] nav[aria-label]{`,
				`  margin-top:0!important;`,
				`}`,
				/* scrollRegion 自带 margin-top:4px；隐藏新会话后它直接顶在 logo 下方，
				 * 这 4px 与网格首行叠加，必须一起归零才吃得住滑块。 */
				`${SIDEBAR} div:has(> [data-sidebar-scrollport]){margin-top:0!important;}`,

				/* 插件按钮双栏：插件名短，两列能省一半竖向空间；会话标题长，保持单列。
				 *
				 * 必须用 minmax(0,1fr)：写 1fr 等于 minmax(auto,1fr)，每列的
				 * min-content 会顶住不给缩，左栏窄下来后两列宽度还不相等、
				 * 右列直接被侧栏边缘切掉。行元素自己也要 min-width:0，
				 * 否则它作为 grid item 仍按内容撑开，把列再顶回去。
				 */
				settings.panelColumns === true
					? `${SIDEBAR} [data-sidebar-scrollport] nav[aria-label]{`
						+ `display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;`
						+ `gap:${settings.gap}px!important;}`
						+ `${SIDEBAR} [data-sidebar-scrollport] nav[aria-label]>*{`
						+ `min-width:0!important;max-width:100%!important;}`
						+ `${SIDEBAR} [data-sidebar-scrollport] nav[aria-label] button{`
						+ `height:${settings.panelRow}px!important;min-height:${settings.panelRow}px!important;`
						+ `overflow:hidden;white-space:nowrap;text-overflow:ellipsis;justify-content:flex-start;}`
					: '',

				/* 顶栏字号：菜单栏按钮（应用 / 编辑）一起跟随。 */
				`html{--dsh-caption-font:${settings.captionFont}px!important;}`,
				/* 收起侧边栏按钮：只命中 shell.leading（顶栏左上那个座）里的图标。
				 *
				 * 不能用 `[class*="iconButton"]`：会话头部那三个图标（搜索 / 视图 /
				 * 添加工具）用的是同一个类名片段，会被一起放大缩小 —— 这是实际
				 * 踩过的坑。leadingSeat 是顶栏独有的结构标记，用它限定作用域。
				 *
				 * 位置也要一起算：官方把它硬编码在 `top:11px; left:88px`，顶栏变矮
				 * 时它不会跟着上移、也不会垂直居中，所以这里按当前顶栏高度重算。
				 */
				`[data-shell-leading]{`,
				`  top:calc((var(--dsh-windows-titlebar-height,24px) - var(--dsh-caption-button,28px)) / 2 + 4px)!important;`,
				`  height:var(--dsh-caption-button,28px)!important;`,
				`}`,
				`[data-shell-leading] button{`,
				`  width:var(--dsh-caption-button,28px)!important;`,
				`  height:var(--dsh-caption-button,28px)!important;`,
				`  border-radius:6px!important;`,
				`}`,
				/* 图标尺寸也走变量，别在生成 CSS 时算死：
				 * 那样拖滑块时只有按钮变、图标不变。 */
				`[data-shell-leading] svg{`,
				`  width:calc(var(--dsh-caption-button,28px) * 0.56)!important;`,
				`  height:calc(var(--dsh-caption-button,28px) * 0.56)!important;`,
				`}`,

				/* 左栏宽度：由 asar 补丁解除上下限（176–320 → 120–900），
				 * 这里不需要再写死宽度；保留开关只为提示与回退。 */

				/* 浮层继承主题：只用主题 token，不写死颜色。 */
				/* 浮层表面：用 DSH 菜单自己的不透明主题 token。
				 *
				 * 之前用 `--dsw-alias-bg-overlay`，在默认深色皮肤里它是半透明的，
				 * 叠在侧栏底色上会发灰、和周围糊成一片。菜单表面 token 是不透明的，
				 * 与本机原生菜单（右键菜单、下拉）完全一致，明暗主题都跟得上。 */
				`#${POPOVER_ID}{`,
				`  position:fixed;z-index:1200;box-sizing:border-box;overflow-y:auto;`,
				`  padding:10px 12px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;`,
				`  background:var(--dsw-menu-surface-fill,var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1)));`,
				`  backdrop-filter:var(--dsw-menu-backdrop-filter,none);`,
				`  box-shadow:var(--dsw-elevation-panel,0 12px 32px rgba(0,0,0,.45));`,
				`  color:var(--dsw-alias-label-primary);font-size:12px;font-family:var(--dsw-font-family);`,
				`  transform-origin:left top;`,
				`  animation:dsh-density-in 180ms cubic-bezier(.22,1,.36,1);`,
				`}`,
				/* 从按钮一侧滑入 + 放大，收起来时反向淡出。 */
				`#${POPOVER_ID}[data-closing]{`,
				`  animation:dsh-density-out 130ms cubic-bezier(.4,0,1,1) forwards;pointer-events:none;`,
				`}`,
				`@keyframes dsh-density-in{`,
				`  from{opacity:0;transform:translateX(-6px) scale(.97);}`,
				`  to{opacity:1;transform:translateX(0) scale(1);}`,
				`}`,
				`@keyframes dsh-density-out{`,
				`  from{opacity:1;transform:translateX(0) scale(1);}`,
				`  to{opacity:0;transform:translateX(-6px) scale(.97);}`,
				`}`,
				`@media (prefers-reduced-motion:reduce){`,
				`  #${POPOVER_ID},#${POPOVER_ID}[data-closing]{animation:none;}`,
				`}`,
				`#${POPOVER_ID} input[type="range"]{accent-color:var(--dsw-alias-brand-primary);}`,
				`#${POPOVER_ID} button,#${POPOVER_ID} select{`,
				`  border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);`,
				`  color:inherit;font-family:inherit;cursor:pointer;`,
				`}`,
				`#${POPOVER_ID} button:hover{background:var(--dsw-alias-interactive-bg-hover);}`,
				`#${TRIGGER_ID}{`,
				`  display:inline-flex;align-items:center;justify-content:center;`,
				`  width:22px;height:22px;margin-left:2px;padding:0;border:none;border-radius:6px;`,
				`  background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none;`,
				`}`,
				`#${TRIGGER_ID}:hover,#${TRIGGER_ID}[aria-expanded="true"]{`,
				`  background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);`,
				`}`,
			].filter((line) => line !== '').join('\n');
		}

		function applyStyles() {
			markColumn();
			let tag = document.getElementById(STYLE_ID);
			if (tag === null) {
				tag = document.createElement('style');
				tag.id = STYLE_ID;
				document.head.appendChild(tag);
			}
			tag.textContent = stylesheet(current);
			// preload 把 --dsh-windows-titlebar-height 写成内联样式；样式表优先级低于
			// 内联，必须写内联值才压得住。写进去后 preload 的观察器会看到 style 变化，
			// 把新高度发给主进程，原生 caption 按钮随之变大变小。
			document.documentElement.style.setProperty('--dsh-windows-titlebar-height', `${current.captionHeight}px`);
			// 顶栏文字与「应用/编辑」按钮尺寸：补丁把这两处改成了读变量，
			// 这里写入就能让它们随滑块实时变化。
			document.documentElement.style.setProperty('--dsh-caption-font', `${current.captionFont}px`);
			// 按钮高度：比字号略大一点，保证不挤；并给折叠按钮同一个值。
			const captionButton = Math.max(18, Math.min(current.captionHeight, current.captionFont * 1.9));
			document.documentElement.style.setProperty('--dsh-caption-button', `${Math.round(captionButton)}px`);
			// 收起侧边栏那个座：官方把它硬编码在 top:11px，CSS 层的计算式
			// 一旦遇到更高特异性的规则就压不住。这里直接写内联样式（优先级最高），
			// 保证它始终与顶栏同高、与「应用/编辑」同尺寸并垂直居中。
			const seat = document.querySelector('[data-shell-leading]');
			if (seat !== null) {
				const size = Math.round(captionButton);
				const height = current.captionHeight;
				seat.style.setProperty('top', `${Math.max(0, Math.round((height - size) / 2))}px`, 'important');
				seat.style.setProperty('height', `${size}px`, 'important');
				for (const button of seat.querySelectorAll('button')) {
					button.style.setProperty('width', `${size}px`, 'important');
					button.style.setProperty('height', `${size}px`, 'important');
					button.style.setProperty('padding', '0', 'important');
				}
				for (const icon of seat.querySelectorAll('svg')) {
					const px = Math.max(10, Math.round(size * 0.56));
					icon.style.setProperty('width', `${px}px`, 'important');
					icon.style.setProperty('height', `${px}px`, 'important');
				}
			}
			applyFontDelta(current.fontDelta);
			applyLogo(current.logoSize, current.logoImage ?? '');
			positionCaption();
		}

		/* ------------------------------------------------------------------ *
		 * 系统字体：用 Chromium 的 Local Font Access（queryLocalFonts）
		 * ------------------------------------------------------------------ */

		let fontCache = null;
		let fontPending = null;

		/**
		 * 取本机字体列表。
		 *
		 * 走宿主侧的 /sidebar-density/fonts（见 index.js）：宿主自己读系统注册表，
		 * 不依赖浏览器的 Local Font Access 授权 —— 那个 API 需要用户手势，在插件的
		 * 只读探测里基本拿不到东西，这也是之前「系统字体没有加载」的原因。
		 */
		async function loadSystemFonts() {
			if (fontCache !== null) return fontCache;
			if (fontPending !== null) return fontPending;
			fontPending = (async () => {
				try {
					const response = await fetch('/sidebar-density/fonts', { credentials: 'same-origin' });
					if (!response.ok) throw new Error(String(response.status));
					const body = await response.json();
					fontCache = Array.isArray(body?.fonts) ? body.fonts : [];
				} catch {
					fontCache = [];
				} finally {
					fontPending = null;
				}
				return fontCache;
			})();
			return fontPending;
		}

		/* ------------------------------------------------------------------ *
		 * 浮层
		 * ------------------------------------------------------------------ */

		function el(tag, css, text) {
			const node = document.createElement(tag);
			if (css !== undefined && css !== '') node.style.cssText = css;
			if (text !== undefined) node.textContent = text;
			return node;
		}

		const PANEL_WIDTH = 276;
		/** 退场动画的定时器 id；toggle 与 close 共用，提前声明避免 TDZ。 */
		let closeTimer = 0;

		/**
		 * 浮层定位：纵向对齐触发按钮所在的那一行，横向贴左栏右边缘。
		 *
		 * 之前用「栏顶 + 8」或固定的 44px，面板会跑到按钮上方很远。现在直接读
		 * 触发器自己的矩形，把面板上沿和按钮上沿对齐，再向下夹取到视口内。
		 */
		function positionPopover() {
			const pop = document.getElementById(POPOVER_ID);
			const column = markColumn();
			if (pop === null) return;
			const rect = trigger?.getBoundingClientRect() ?? column?.getBoundingClientRect();
			if (rect === undefined) return;
			// 上限只留 16px 上下边距：面板内容固定约 700px，之前卡 600px 会把
			// 底部的字体区截在半截。窗口够高就完整展开，不够才滚动。
			const maxHeight = Math.max(320, window.innerHeight - 32);
			pop.style.maxHeight = `${maxHeight}px`;
			// 优先向上展开（从按钮行往上长），这样底部内容尽收眼底；
			// 上方空间不足才改为向下。两种都夹在视口内。
			const measured = Math.min(pop.offsetHeight || 720, maxHeight);
			const aboveTop = rect.top - measured - 8;
			const belowTop = rect.bottom + 8;
			const top = aboveTop >= 8
				? aboveTop
				: Math.min(belowTop, Math.max(8, window.innerHeight - measured - 8));
			pop.style.top = `${Math.round(top)}px`;
			pop.style.left = `${Math.round(rect.right + 10)}px`;
			pop.style.width = `${PANEL_WIDTH}px`;
		}

		function buildPopover() {
			const pop = el('div');
			pop.id = POPOVER_ID;
			pop.dataset.densityPopover = '';
			return pop;
		}

		function renderInto(pop) {
			const t = mkT();
			pop.replaceChildren();

			const head = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;');
			head.append(el('span', 'font-size:13px;font-weight:600;', t('title')));
			const reset = el('button', 'font-size:10px;padding:2px 8px;', t('reset'));
			reset.type = 'button';
			reset.addEventListener('click', () => resetAll());
			head.append(reset);
			pop.append(head);

			for (const field of LIVE) {
				// 开关类：一行标题 + 复选框，不占滑块高度。
				if (field.kind === 'toggle') {
					const row = el('label', 'display:flex;align-items:center;justify-content:space-between;'
						+ 'gap:8px;margin:10px 0;cursor:pointer;');
					row.append(el('span', 'font-size:11px;opacity:.85;', t(field.key)));
					const box = document.createElement('input');
					box.type = 'checkbox';
					box.checked = current[field.key] === true;
					box.dataset.toggle = field.key;
					box.style.cssText = 'accent-color:var(--dsw-alias-brand-primary);width:14px;height:14px;cursor:pointer;';
					box.addEventListener('change', () => setField(field.key, box.checked));
					row.append(box);
					pop.append(row);
					if (field.key === 'hideNewSession') {
						pop.append(el('div', 'margin:-6px 0 8px;font-size:10px;line-height:1.5;opacity:.55;',
							t('newSessionHint')));
					}
					if (field.patch !== undefined) {
						pop.append(el('div', 'margin:-4px 0 10px;font-size:10px;line-height:1.5;opacity:.55;',
							t(`patch_${field.patch}`)));
					}
					continue;
				}

				const label = el('label', 'display:block;margin:10px 0;');
				const line = el('div', 'display:flex;justify-content:space-between;align-items:baseline;font-size:11px;opacity:.8;margin-bottom:4px;');
				line.append(el('span', '', t(field.key)));
				const shown = `${current[field.key]}`;
				const readout = el('span', 'opacity:.65;font-variant-numeric:tabular-nums;',
					field.signed === true ? `${current[field.key] > 0 ? '+' : ''}${shown}` : `${shown}${field.unit}`);
				readout.dataset.readout = field.key;
				line.append(readout);
				label.append(line);

				const input = el('input', 'width:100%;height:14px;');
				input.type = 'range';
				input.min = String(field.min);
				input.max = String(field.max);
				input.step = String(field.step);
				input.value = String(current[field.key]);
				input.dataset.field = field.key;
				input.addEventListener('input', (event) => setField(field.key, event.target.value));
				label.append(input);

				if (field.patch !== undefined) {
					label.append(el('div', 'margin-top:4px;font-size:10px;line-height:1.5;opacity:.55;', t(`patch_${field.patch}`)));
				}
				if (field.key === 'logoSize') label.append(buildLogoPicker(t));
				pop.append(label);
			}

			pop.append(buildFontSection());
		}

		/**
		 * Logo 替换控件：选图 / 清除。
		 *
		 * 图片以 data URL 存进设置（localStorage 单值上限约 5MB，这里把长边压到
		 * 256px 再存，几十 KB 量级，够清晰也不撑爆存储）。
		 */
		function buildLogoPicker(t) {
			const box = el('div', 'display:flex;align-items:center;gap:6px;margin-top:6px;');
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = 'image/*';
			input.style.display = 'none';

			const pick = el('button', 'font-size:10px;padding:2px 8px;', t('logoPick'));
			pick.type = 'button';
			pick.addEventListener('click', () => input.click());

			const clear = el('button', 'font-size:10px;padding:2px 8px;', t('logoClear'));
			clear.type = 'button';
			clear.addEventListener('click', () => {
				current = { ...current, logoImage: '' };
				writeSettings(current);
				emit();
			});

			const hint = el('span', 'font-size:10px;opacity:.5;', (current.logoImage ?? '') === '' ? t('logoDefault') : t('logoCustom'));

			input.addEventListener('change', async () => {
				const file = input.files?.[0];
				if (file === undefined) return;
				try {
					const dataUrl = await shrinkImage(file, 256);
					current = { ...current, logoImage: dataUrl };
					writeSettings(current);
					emit();
					hint.textContent = t('logoCustom');
				} catch {
					hint.textContent = t('logoFailed');
				}
				input.value = '';
			});

			box.append(pick, clear, hint, input);
			return box;
		}

		/** 把图片缩到指定长边，返回 JPEG/PNG 的 data URL。 */
		function shrinkImage(file, maxSide) {
			return new Promise((resolve, reject) => {
				readImageFile(file).then((dataUrl) => {
					const img = new Image();
					img.onload = () => {
						const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
						const canvas = document.createElement('canvas');
						canvas.width = Math.max(1, Math.round(img.width * scale));
						canvas.height = Math.max(1, Math.round(img.height * scale));
						const context = canvas.getContext('2d');
						if (context === null) {
							reject(new Error('no 2d context'));
							return;
						}
						context.drawImage(img, 0, 0, canvas.width, canvas.height);
						// PNG 保留透明底，适合图标
						resolve(canvas.toDataURL('image/png'));
					};
					img.onerror = () => reject(new Error('decode failed'));
					img.src = dataUrl;
				}).catch(reject);
			});
		}

		/**
		 * 字体选择区：搜索与选择合并成一个可搜索控件。
		 *
		 * 之前是「一个 select + 一个搜索框」，用户得先在搜索框打字、再点开
		 * select 挑结果，两步才落到一个字体。现在合成一个组合框：
		 * - 输入即过滤，列表直接浮在下方；
		 * - 点条目或键盘上下 + 回车即选中，一步到位；
		 * - 失焦收起。
		 */
		function buildFontSection() {
			const t = mkT();
			const box = el('div', 'margin:10px 0 4px;position:relative;');
			box.append(el('div', 'font-size:11px;opacity:.8;margin-bottom:4px;', t('fontFamily')));

			const input = el('input', 'width:100%;box-sizing:border-box;padding:5px 7px;'
				+ 'border-radius:6px;border:1px solid var(--dsw-alias-border-l2);'
				+ 'background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));color:inherit;'
				+ 'font-family:inherit;font-size:11px;outline:none;');
			input.type = 'text';
			input.autocomplete = 'off';
			input.spellcheck = false;

			const list = el('div', 'position:absolute;left:0;right:0;top:100%;margin-top:2px;z-index:3;'
				+ 'max-height:220px;overflow-y:auto;border:1px solid var(--dsw-alias-border-l2);'
				+ 'border-radius:8px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));'
				+ 'box-shadow:var(--dsw-elevation-panel,0 8px 24px rgba(0,0,0,.35));display:none;');

			/** 由「默认 / 预设 / 系统字体」拼出完整条目表。 */
			const options = () => {
				const rows = [{ value: '', label: t('fontDefault'), kind: 'default' }];
				for (const preset of FONT_PRESETS) {
					if (preset.stack === '') continue;
					rows.push({ value: preset.stack, label: t(preset.key), kind: 'preset' });
				}
				for (const family of fontCache ?? []) {
					rows.push({ value: family, label: family, kind: 'system' });
				}
				return rows;
			};

			let active = 0;
			let shown = [];

			const paint = () => {
				const keyword = input.value.trim().toLowerCase();
				const all = options();
				shown = keyword === ''
					? all
					: all.filter((row) => row.label.toLowerCase().includes(keyword) || row.value.toLowerCase().includes(keyword));
				shown = shown.slice(0, 300);
				if (active >= shown.length) active = Math.max(0, shown.length - 1);

				list.replaceChildren();
				if (shown.length === 0) {
					list.append(el('div', 'padding:8px 10px;font-size:11px;opacity:.55;', t('fontNoMatch')));
				}
				shown.forEach((row, index) => {
					const css = 'padding:6px 10px;font-size:11px;cursor:pointer;'
						+ (index === active ? 'background:var(--dsw-alias-interactive-bg-hover);' : '');
					const item = el('div', css, row.label);
					item.dataset.value = row.value;
					item.addEventListener('pointerdown', (event) => {
						event.preventDefault();
						choose(row);
					});
					list.append(item);
				});
				list.style.display = 'block';
			};

			const choose = (row) => {
				setFont(row.value);
				input.value = row.value === '' ? '' : row.label;
				input.placeholder = row.label;
				list.style.display = 'none';
				input.blur();
			};

			const currentLabel = current.fontFamily === ''
				? t('fontDefault')
				: (FONT_PRESETS.find((preset) => preset.stack === current.fontFamily) !== undefined
					? t(FONT_PRESETS.find((preset) => preset.stack === current.fontFamily).key)
					: current.fontFamily);
			input.placeholder = currentLabel;

			input.addEventListener('focus', () => {
				input.select();
				active = 0;
				paint();
			});
			input.addEventListener('input', () => { active = 0; paint(); });
			input.addEventListener('keydown', (event) => {
				if (event.key === 'ArrowDown') {
					event.preventDefault();
					active = Math.min(active + 1, shown.length - 1);
					paint();
				} else if (event.key === 'ArrowUp') {
					event.preventDefault();
					active = Math.max(active - 1, 0);
					paint();
				} else if (event.key === 'Enter') {
					event.preventDefault();
					if (shown[active] !== undefined) choose(shown[active]);
				} else if (event.key === 'Escape') {
					list.style.display = 'none';
					input.blur();
				}
			});
			input.addEventListener('blur', () => {
				// 延迟收起，让 pointerdown 先命中条目
				window.setTimeout(() => { list.style.display = 'none'; }, 120);
			});

			box.append(input, list);

			// 打开面板即拉全量字体，列表随时可挑。
			loadSystemFonts().then(() => {
				if (document.activeElement === input) paint();
			});
			return box;
		}

		function refreshReadouts() {
			const pop = document.getElementById(POPOVER_ID);
			if (pop === null) return;
			for (const node of pop.querySelectorAll('[data-readout]')) {
				const field = LIVE.find((candidate) => candidate.key === node.dataset.readout);
				if (field === undefined) continue;
				const value = current[node.dataset.readout];
				node.textContent = field.signed === true
					? `${value > 0 ? '+' : ''}${value}`
					: `${value}${field.unit}`;
			}
			for (const node of pop.querySelectorAll('[data-field]')) {
				if (node.value !== String(current[node.dataset.field])) node.value = String(current[node.dataset.field]);
			}
			// 复选框也要同步：点了「默认」之后功能已恢复，但勾选状态如果不跟着更新，
			// 看上去就像开关没被取消（实际踩过这个坑）。
			for (const node of pop.querySelectorAll('[data-toggle]')) {
				const want = current[node.dataset.toggle] === true;
				if (node.checked !== want) node.checked = want;
			}
		}

		/* ------------------------------------------------------------------ *
		 * 自绘 caption 按钮（Apple 风格）
		 *
		 * 原生按钮是 Electron 按 titleBarOverlay.height 画的原生控件：高度缩到很小
		 * 会被裁像素，外观也改不了。所以 asar 补丁把主窗口改成 frame:false，原生
		 * 按钮消失，这里画三个圆点。窗口控制走 preload 暴露的 __DSH_WINDOW__；
		 * 没有这个桥（主安装）时整块不渲染，不会留下三个点不了的按钮。
		 * ------------------------------------------------------------------ */

		const CAPTION_ID = 'dsh-sidebar-density-caption';
		// Windows 的顺序是「最小化 → 最大化 → 关闭」（macOS 才是红黄绿在左）。
		// 颜色仍用 macOS 的那套红黄绿，但排列按 Windows 来，符合本机习惯。
		const DOTS = [
			{ action: 'minimize', label: '最小化', color: '#febc2e' },
			{ action: 'maximize', label: '最大化', color: '#28c840' },
			{ action: 'close', label: '关闭', color: '#ff5f57' },
		];

		function mountCaption() {
			const api = window.__DSH_WINDOW__;
			if (api === undefined || api === null) return false;
			if (document.getElementById(CAPTION_ID) !== null) {
				positionCaption();
				return true;
			}
			const bar = document.createElement('div');
			bar.id = CAPTION_ID;
			bar.style.cssText = 'position:fixed;z-index:1105;display:flex;align-items:center;gap:8px;'
				+ '-webkit-app-region:no-drag;';
			for (const dot of DOTS) {
				const button = document.createElement('button');
				button.type = 'button';
				button.title = dot.label;
				button.setAttribute('aria-label', dot.label);
				button.style.cssText = 'width:12px;height:12px;padding:0;border:none;border-radius:50%;'
					+ `background:${dot.color};cursor:pointer;opacity:.92;transition:filter .12s;`;
				button.addEventListener('pointerenter', () => { button.style.filter = 'brightness(1.2)'; });
				button.addEventListener('pointerleave', () => { button.style.filter = ''; });
				button.addEventListener('click', (event) => {
					event.stopPropagation();
					api.control(dot.action);
				});
				bar.append(button);
			}
			document.body.append(bar);
			positionCaption();
			return true;
		}

		/**
		 * 贴在窗口右上角（原生按钮原来的位置），垂直居中于顶栏。
		 *
		 * 不放左上角：那里是折叠按钮与「应用 / 编辑」菜单的地盘，叠上去会挡住
		 * 可点区域。右上角本来就是 caption 按钮的位置，替换后位置关系不变。
		 */
		function positionCaption() {
			const bar = document.getElementById(CAPTION_ID);
			if (bar === null) return;
			const height = current.captionHeight;
			bar.style.right = '14px';
			bar.style.top = `${Math.max(0, Math.round((height - 12) / 2))}px`;
		}

		/* ------------------------------------------------------------------ *
		 * 触发按钮：账户区（走窄门）同一行右侧
		 * ------------------------------------------------------------------ */

		function iconSvg() {
			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.setAttribute('viewBox', '0 0 16 16');
			svg.setAttribute('width', '14');
			svg.setAttribute('height', '14');
			svg.setAttribute('fill', 'currentColor');
			svg.setAttribute('aria-hidden', 'true');
			for (const y of [3.5, 7.25, 11]) {
				const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
				rect.setAttribute('x', '2');
				rect.setAttribute('y', String(y));
				rect.setAttribute('width', '12');
				rect.setAttribute('height', '1.5');
				rect.setAttribute('rx', '0.75');
				svg.append(rect);
			}
			return svg;
		}

		let trigger = null;

		function mountTrigger() {
			const root = markColumn();
			if (root === null) return false;
			const foot = root.lastElementChild;
			if (foot === null || foot === undefined) return false;

			if (trigger === null) {
				trigger = document.createElement('button');
				trigger.id = TRIGGER_ID;
				trigger.type = 'button';
				trigger.title = mkT()('title');
				trigger.setAttribute('aria-label', mkT()('title'));
				trigger.setAttribute('aria-haspopup', 'dialog');
				trigger.setAttribute('aria-expanded', 'false');
				trigger.append(iconSvg());
				trigger.addEventListener('click', (event) => {
					event.stopPropagation();
					togglePopover();
				});
			}
			if (trigger.isConnected) return true;

			const buttons = [...foot.querySelectorAll('button')].filter((node) => node.id !== TRIGGER_ID);
			const account = buttons[buttons.length - 1];
			const row = account?.parentElement ?? foot;
			row.style.display = 'flex';
			row.style.alignItems = 'center';
			row.style.gap = '4px';
			if (account !== undefined) account.style.flex = '1';
			row.append(trigger);
			return true;
		}

		function togglePopover() {
			window.clearTimeout(closeTimer);
			const existing = document.getElementById(POPOVER_ID);
			if (existing !== null) {
				// 正在退场又点了一次：直接复活，不重建。
				if (existing.hasAttribute('data-closing')) {
					existing.removeAttribute('data-closing');
					trigger?.setAttribute('aria-expanded', 'true');
					return;
				}
				closePopover();
				return;
			}
			const pop = buildPopover();
			renderInto(pop);
			document.body.append(pop);
			positionPopover();
			trigger?.setAttribute('aria-expanded', 'true');
			pop.addEventListener('pointerdown', (event) => event.stopPropagation());
		}

		/** 收起：先播 130ms 的退场动画，再移除节点。重复调用是幂等的。 */
		function closePopover() {
			const pop = document.getElementById(POPOVER_ID);
			trigger?.setAttribute('aria-expanded', 'false');
			if (pop === null) return;
			if (pop.hasAttribute('data-closing')) return;
			window.clearTimeout(closeTimer);
			pop.setAttribute('data-closing', '');
			closeTimer = window.setTimeout(() => pop.remove(), 140);
		}

		/* ------------------------------------------------------------------ *
		 * 字典
		 * ------------------------------------------------------------------ */

		const COPY = {
			zh: {
				title: '左侧栏密度',
				reset: '默认',
				gap: '面板间距',
				logoGap: 'Logo 与插件间距',
				sessionRow: '会话行高',
				panelRow: '插件按钮行高',
				fontDelta: '字号增减',
				logoSize: 'Logo 尺寸',
				newSession: '新会话高度',
				captionHeight: '顶栏高度',
				captionFont: '顶栏字号',
				hideNewSession: '隐藏新会话按钮',
				panelColumns: '插件按钮双栏',
				widthUnlock: '解除左栏宽度限制',
				newSessionHint: '提示：点左上角 logo 也能新建会话（DSH 默认行为），隐藏按钮不影响它。',
				fontFamily: '字体',
				fontDefault: 'DSH 默认（不改）',
				fontPingFang: '苹方',
				fontSystemUi: '系统 UI',
				fontYahei: '微软雅黑',
				fontMono: '等宽',
				fontSerif: '衬线',
				fontSearch: '搜索系统字体…',
				fontUnavailable: '当前环境无法读取系统字体',
				fontSystemGroup: '系统字体',
				fontLoading: '正在读取系统字体…',
				fontNoMatch: '没有匹配的字体',
				logoPick: '选择图片',
				logoClear: '恢复默认',
				logoDefault: '当前：默认 logo',
				logoCustom: '当前：自定义图',
				logoFailed: '读取失败',
				patch_caption: '需 asar 补丁：原生窗口按钮高度写死在主进程里，补丁才会跟着变',
				patch_font: '需 asar 补丁：菜单栏字号在 preload 的内联样式里，补丁已改为读变量',
				patch_width: '需 asar 补丁：宽度上下限（264–420）是硬编码常量，补丁已放宽到 120–900',
				footerHint: '拖动即时生效，设置自动记住。',
			},
			en: {
				title: 'Sidebar density',
				reset: 'Reset',
				gap: 'Panel gap',
				logoGap: 'Logo-to-panels gap',
				sessionRow: 'Session row',
				panelRow: 'Panel button row',
				fontDelta: 'Type size delta',
				logoSize: 'Logo size',
				newSession: 'New Session height',
				captionHeight: 'Caption height',
				captionFont: 'Caption type size',
				hideNewSession: 'Hide New Session',
				panelColumns: 'Two-column panel buttons',
				widthUnlock: 'Unlock sidebar width',
				newSessionHint: 'Tip: clicking the logo also starts a new session (DSH default), so hiding the button is safe.',
				fontFamily: 'Font',
				fontDefault: 'DSH default (unchanged)',
				fontPingFang: 'PingFang',
				fontSystemUi: 'System UI',
				fontYahei: 'Microsoft YaHei',
				fontMono: 'Monospace',
				fontSerif: 'Serif',
				fontSearch: 'Search system fonts…',
				fontUnavailable: 'System fonts are unavailable here',
				fontSystemGroup: 'System fonts',
				fontLoading: 'Reading system fonts…',
				fontNoMatch: 'No matching font',
				logoPick: 'Choose image',
				logoClear: 'Restore',
				logoDefault: 'Current: default',
				logoCustom: 'Current: custom',
				logoFailed: 'Read failed',
				patch_caption: 'Needs the asar patch: native button height is hard-coded in the main process',
				patch_font: 'Needs the asar patch: the menu type size lives in preload inline CSS',
				patch_width: 'Needs the asar patch: the 264–420 clamp is a hard-coded constant',
				footerHint: 'Live preview; values are remembered.',
			},
		};

		let activeLocale = 'zh';

		function mkT() {
			return (key) => COPY[activeLocale]?.[key] ?? COPY.en?.[key] ?? key;
		}

		return {
			inject: ['slots', 'locale'],
			apply(ctx) {
				ctx.effect(() => ctx.locale.register(NS, { zh: COPY.zh, en: COPY.en }), 'dsh-sidebar-density: dictionaries');

				const syncLocale = () => {
					activeLocale = /^zh/i.test(ctx.locale.getSnapshot().active) ? 'zh' : 'en';
					const pop = document.getElementById(POPOVER_ID);
					if (pop !== null) renderInto(pop);
				};
				syncLocale();
				ctx.effect(() => ctx.locale.subscribe(syncLocale), 'dsh-sidebar-density: locale');

				ctx.effect(() => {
					applyStyles();
					return () => document.getElementById(STYLE_ID)?.remove();
				}, 'dsh-sidebar-density: live styles');

				ctx.effect(() => {
					mountTrigger();
					mountCaption();
					let scheduled = false;
					const observer = new MutationObserver(() => {
						if (scheduled) return;
						scheduled = true;
						requestAnimationFrame(() => {
							scheduled = false;
							mountTrigger();
							mountCaption();
							positionPopover();
						});
					});
					observer.observe(document.body, { childList: true, subtree: true });

					const onPointerDown = (event) => {
						const pop = document.getElementById(POPOVER_ID);
						if (pop === null) return;
						if (event.target instanceof Node && (pop.contains(event.target) || trigger?.contains(event.target))) return;
						closePopover();
					};
					const onKeyDown = (event) => {
						if (event.key === 'Escape') closePopover();
					};
					const onResize = () => positionPopover();
					document.addEventListener('pointerdown', onPointerDown, true);
					document.addEventListener('keydown', onKeyDown, true);
					window.addEventListener('resize', onResize);

					return () => {
						observer.disconnect();
						document.removeEventListener('pointerdown', onPointerDown, true);
						document.removeEventListener('keydown', onKeyDown, true);
						window.removeEventListener('resize', onResize);
						closePopover();
						trigger?.remove();
						trigger = null;
						document.getElementById(CAPTION_ID)?.remove();
					};
				}, 'dsh-sidebar-density: trigger + popover');
			},
		};
	},
});
