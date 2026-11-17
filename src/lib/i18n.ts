/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// The site is server-rendered in Chinese. This client-side layer keeps the
// language preference consistent across all pages without duplicating page
// templates or persisting presentation state in D1.
//
// 中英文切换的实现分三层：
//   1. 服务端（本文件）：把 src/lib/i18nData.ts 的字典压成「key<TAB>value」
//      的紧凑文本，和运行时一起拼成 /i18n.js；不产生任何额外请求。
//   2. --head 模式（layout.html 里的极小内联脚本）：首屏执行前读取
//      localStorage / navigator.language，尽早写入 <html data-language="en">，
//      避免「先中文再变英文」的闪烁。运行时检测到 data-language 已就绪就
//      直接按英文渲染，不再二次切换。
//   3. 运行时：TreeWalker 扫描文本节点 + 属性 + option + title/meta，MutationObserver
//      只处理新增子树并用 requestAnimationFrame 合并，避免自身递归。
import { i18nDomainGroups } from './i18nData'
import type { I18nDomain } from './i18nData'

export const I18N_STORAGE_KEY = 'rent-language'

// 字典按域分组后逐个注入。任何页面都可以只带需要的域（data-i18n-domains），
// 缺省带全部：宁可多几十 KB（gzip 后很小），也不要出现漏翻。
const ALL_DOMAINS: readonly I18nDomain[] = i18nDomainGroups.map((group) => group.domain)

// 按角色声明页面实际可能出现的字典域。只是「声明」，/i18n.js 仍然注入全量字典。
//
// 为什么不做按域注入（2026-10 实测，gzip -9，字典 4179 条 / 运行时骨架约 19 KB）：
//   全量           260,216 B raw / 92,537 B gzip
//   admin  9 个域  227,454 B raw / 约 76,077 B gzip  → 仅省 16.5 KB gzip
//   staff  9 个域  169,915 B raw / 约 55,407 B gzip  → 省 37.1 KB gzip
//   customer 9 个域 173,302 B raw / 约 56,334 B gzip → 省 36.2 KB gzip
//   游客   7 个域  160,623 B raw / 约 52,200 B gzip  → 省 40.3 KB gzip
// 结论：最坏角色（admin）也只省 16.5 KB gzip，代价却是：
//   1) 首屏请求数 1 → N（每多一个请求就多一次 RTT，慢网下比这点字节更贵）；
//   2) 版本指纹变化时整批失效，命中率不如「单文件缓存一年（immutable）」；
//   3) 最致命：局部导航可能在同一文档内跨角色（员工看客户详情、管理员进客户中心），
//      页面上会出现未注入的域 → 中文残留，而这正是本任务要消灭的问题。
// 漏翻的代价远高于 16.5 KB，因此保持单文件全量注入。
//
// ⚠️ 当前字典实际集中在 common 域（4179 条里 2161 条在 common，其余在
// admin/staff/customer/public/legal，nav/table/forms/status/errors 目前为空）。
// 所以 `data-i18n-domains` 只是**声明性元数据，不参与裁剪**：/i18n.js 始终注入
// 全量字典。看到域声明别以为可以按角色裁剪 —— 现在裁也裁不掉体积。
export function i18nDomainsForRole(role?: string | null, accountType?: string | null): string {
  const base: I18nDomain[] = ['common', 'nav', 'table', 'forms', 'status', 'legal', 'errors']
  if (role === 'ADMIN') return [...base, 'admin', 'staff', 'public'].join(',')
  if (role === 'STAFF') return [...base, 'staff', 'admin', 'public'].join(',')
  if (accountType === 'guest') return [...base, 'customer', 'public'].join(',')
  return [...base, 'customer', 'public'].join(',')
}

// 把字典序列化成紧凑的 `key\tvalue\n` 行，相对 JSON 能省掉大量引号 / 转义，
// 解压后解析也只需一次 split。
//
// 输出按「英文值」排序（方案 B）：相邻行的英文前缀高度相似，deflate 的滑动窗口
// 更容易命中公共子串，实测 gzip 86,130 → 83,597 B（约 -2.9%）。排序是纯输出层的
// 优化，不影响 i18nMessages（服务端测试用的扁平对象保持原样）。
//
// 排序必须稳定且确定：value 相同时回落到 key 比较，key 仍相同则保持原始插入顺序
// （ES2019+ 的 sort 是稳定排序）。这样同一份字典两次调用输出的字节完全一致，
// 内容指纹 languageScriptVersion 才不会随机抖动。
export function serializeDictionary(domains: readonly I18nDomain[] = ALL_DOMAINS): string {
  const entries: Array<[string, string]> = []
  for (const group of i18nDomainGroups) {
    if (!domains.includes(group.domain)) continue
    for (const [key, value] of Object.entries(group.messages)) {
      if (!key || !value) continue
      // 制表符 / 换行在字典 key、value 里都不合法，用空格兜底避免破坏分隔
      entries.push([key.replace(/[\t\n]/g, ' '), value.replace(/[\t\n]/g, ' ')])
    }
  }
  entries.sort((a, b) => {
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1
    return 0
  })
  const lines: string[] = new Array(entries.length)
  for (let i = 0; i < entries.length; i++) lines[i] = `${entries[i][0]}\t${entries[i][1]}`
  return lines.join('\n')
}

// 语言切换器的标记（防止 value 里出现 `</script>` / `${` 之类的注入）。
function escapeForScript(value: string): string {
  return value
    .replace(/<\/script/gi, '<\\/script')
    .replace(/\$\{/g, '\\${')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export const dictionaryText: string = serializeDictionary(ALL_DOMAINS)

// 首屏内联脚本：必须在 <head> 里、页面内容之前同步执行。
// 只做三件事：读偏好 → 写 <html lang/data-language> → 保证极小的体积。
// CSP 需要允许内联脚本（当前策略 script-src 含 'unsafe-inline'）；
// 若安全侧收紧 CSP，请改用 nonce 或对本脚本内容取 hash。
export const languageBootScript = `(function(){try{var k='${I18N_STORAGE_KEY}';var s=null;try{s=localStorage.getItem(k)}catch(e){}var l=s==='en'||s==='zh'?s:((navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||'']).some(function(v){return /^en(?:-|$)/i.test(String(v))})?'en':'zh');var r=document.documentElement;r.setAttribute('data-language',l);r.setAttribute('lang',l==='en'?'en':'zh-CN')}catch(e){}})();`

export const languageScript = String.raw`
(function () {
  'use strict';
  var storageKey = '${I18N_STORAGE_KEY}';
  var root = document.documentElement;

  // ---- 字典 ---------------------------------------------------------------
  // 压缩格式：每行 "中文<TAB>English"。解析一次，常驻内存。
  var rawDictionary = ` + '`' + escapeForScript(dictionaryText) + '`' + String.raw`;
  var translations = Object.create(null);
  (function () {
    var lines = rawDictionary.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) continue;
      var tab = line.indexOf('\t');
      if (tab < 0) continue;
      translations[line.slice(0, tab)] = line.slice(tab + 1);
    }
  })();

  // 长 key 优先：保证「整句」先于「短片段」命中，避免中英混杂。
  var keys = Object.keys(translations).sort(function (a, b) { return b.length - a.length; });
  var fragmentKeys = keys.filter(function (key) { return key.length >= 2; });

  var CJK = /[\u3400-\u9fff]/;
  var JAPANESE_KANA = /[\u3040-\u30ff]/;
  var containsChinese = function (value) { return CJK.test(value); };

  // 记录没命中的中文，方便开发期补译（不影响页面可读性，仍保留中文）。
  var missing = Object.create(null);
  window.__i18nMissing = missing;
  var recordMissing = function (text) {
    if (!containsChinese(text)) return;
    missing[text] = (missing[text] || 0) + 1;
  };

  // ---- 语言状态 -----------------------------------------------------------
  var readLanguage = function () {
    try {
      var stored = localStorage.getItem(storageKey);
      if (stored === 'en' || stored === 'zh') return stored;
    } catch (_) {}
    var browserLanguages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    return browserLanguages.some(function (language) { return /^en(?:-|$)/i.test(String(language)); }) ? 'en' : 'zh';
  };
  var writeLanguage = function (value) { try { localStorage.setItem(storageKey, value); } catch (_) {} };
  var language = readLanguage();

  // ---- 文本翻译 -----------------------------------------------------------
  // 返回值约定：认识就翻；不认识时保留原文并记录到 window.__i18nMissing。
  var cleanChinesePunctuation = function (value) {
    // 英文句子里残留的中文句号 / 分号会让排版很怪，只在整句命中后清理。
    // 中文逗号 / 顿号多半是拼接动态内容用的连接符（如"欢迎回来，"后面接用户名），
    // 片段替换只换得了两侧的中文词，中间的标点不在任何字典 key 里，
    // 删掉会把两段粘在一起不可读，所以换成半角逗号+空格，而不是直接删除。
    return String(value || '').replace(/[。；]/g, '').replace(/[，、]\s*/g, ', ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/\s+$/, '');
  };
  var replaceSafeFragment = function (text, key) {
    var offset = 0;
    var position;
    while ((position = text.indexOf(key, offset)) !== -1) {
      var left = position ? text.charAt(position - 1) : '';
      var right = text.charAt(position + key.length);
      // Only replace a fragment at a non-Chinese boundary. This prevents
      // "待支付" becoming "待Payment" and "设备状态" becoming "Device状态".
      if (!containsChinese(left) && !containsChinese(right)) {
        text = text.slice(0, position) + translations[key] + text.slice(position + key.length);
        offset = position + translations[key].length;
      } else {
        offset = position + key.length;
      }
    }
    return text;
  };
  var couponNotice = /^🎉新优惠现已开启！\s*\n\s*\n使用优惠码 <strong>([^<]+)<\/strong>，即可享受下次租赁 <strong>([^<]+)<\/strong>。\s*\n\s*\n有效期至 <strong>((\d{4})年(\d{1,2})月(\d{1,2})日|长期有效)<\/strong>$/;
  var translateText = function (value) {
    var text = String(value || '');
    if (!text.trim()) return text;
    if (!containsChinese(text)) return text;
    var leading = text.match(/^\s*/)[0];
    var trailing = text.match(/\s*$/)[0];
    var core = text.slice(leading.length, text.length - trailing.length || undefined);
    if (Object.prototype.hasOwnProperty.call(translations, core)) return leading + translations[core] + trailing;
    var notice = core.match(couponNotice);
    if (notice) {
      var dateParts = notice[3].match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
      var expiry = dateParts ? new Date(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3])) : null;
      var expiryText = notice[3] === '长期有效' ? 'No expiry' : expiry && !isNaN(expiry.getTime()) ? expiry.toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric' }) : notice[3];
      return leading + '🎉A new offer is now live!\n\nUse promo code **' + notice[1] + '** to get **' + notice[2].replace(' 的折扣', ' off').replace(' 的优惠', ' off') + '** on your next rental.\n\nValid until **' + expiryText + '**' + trailing;
    }
    // 句子由「中文片段 + 动态数据」拼成时必须按片段替换，否则整句永远对不上。
    // 纯中文也可能是多个已收录短语拼起来的（例如 confirm 里拼的提示），
    // 因此这里不分是否含 ASCII，一律尝试片段替换；只有替换后不再含中文才采用。
    // 单趟替换是顺序敏感的：一个片段的左边界如果还没轮到替换，会卡在「左邻是中文」
    // 的边界检查上，永远错过这次机会（例如"取货地点（选填）"里，"（选填）"排在
    // "取货地点"前面试过一次，当时左边还是中文"点"，被挡住，之后"取货地点"才换完，
    // 但不会回头重试）。多扫几轮到不再变化为止，让后换出来的边界给前面没换成的
    // 片段一次新的机会。
    var replaced = core;
    for (var pass = 0; pass < 3; pass++) {
      var beforePass = replaced;
      for (var i = 0; i < fragmentKeys.length; i++) {
        if (replaced.indexOf(fragmentKeys[i]) !== -1) replaced = replaceSafeFragment(replaced, fragmentKeys[i]);
      }
      if (replaced === beforePass || !containsChinese(replaced)) break;
    }
    if (replaced !== core && !containsChinese(replaced)) return leading + replaced + trailing;
    // 认不出来：保留中文（可读性优先），但记录下来，方便补字典。
    recordMissing(core);
    return replaced !== core ? leading + replaced + trailing : leading + core + trailing;
  };

  // ---- DOM 扫描 -----------------------------------------------------------
  // 每个节点记住「原始中文」，这样反复 apply 是幂等的，也不会破坏 data-i18n-*。
  var SOURCE = '__rentI18nSource';
  var SKIP_SELECTOR = 'script, style, textarea, pre, code, [data-i18n-ignore], [contenteditable="true"]';
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, PRE: 1, CODE: 1, NOSCRIPT: 1, IFRAME: 1, OBJECT: 1, SVG: 1, PATH: 1 };
  var translatedAttributes = ['placeholder', 'title', 'aria-label', 'alt', 'value'];
  var attributeSource = function (element, attribute) {
    var key = 'data-i18n-' + attribute;
    var stored = element.getAttribute(key);
    if (stored !== null && stored !== '') return stored;
    var current = element.getAttribute(attribute);
    if (current === null) return null;
    element.setAttribute(key, current);
    return current;
  };
  var shouldSkipNode = function (node) {
    var parent = node.parentElement;
    if (!parent) return true;
    if (SKIP_TAGS[parent.tagName]) return true;
    return !!(parent.closest && parent.closest(SKIP_SELECTOR));
  };

  var translateTextNode = function (node) {
    if (shouldSkipNode(node)) return;
    var source = node[SOURCE];
    if (source === undefined) {
      source = node.nodeValue || '';
      node[SOURCE] = source;
    }
    if (language !== 'en') {
      if (node.nodeValue !== source) node.nodeValue = source;
      return;
    }
    var next = cleanChinesePunctuation(translateText(source));
    if (next !== node.nodeValue) node.nodeValue = next;
  };

  var translateAttributes = function (element) {
    if (!element.getAttribute) return;
    if (SKIP_TAGS[element.tagName]) return;
    var isButtonish = /^(submit|button|reset)$/i.test(element.getAttribute('type') || '');
    for (var i = 0; i < translatedAttributes.length; i++) {
      var attribute = translatedAttributes[i];
      if (attribute === 'value' && !isButtonish) continue;
      if (!element.hasAttribute(attribute)) continue;
      var source = attributeSource(element, attribute);
      if (source === null) continue;
      var next = language === 'en' ? cleanChinesePunctuation(translateText(source)) : source;
      if (element.getAttribute(attribute) !== next) element.setAttribute(attribute, next);
    }
  };

  // option 的文本也是文本节点，但 <select> 未展开时 TreeWalker 仍然能拿到，
  // 这里显式再处理一次，保证 <option value> 与 label 都一致。
  var translateOptions = function (scope) {
    var options = scope.querySelectorAll ? scope.querySelectorAll('option, optgroup, datalist option') : [];
    for (var i = 0; i < options.length; i++) {
      var option = options[i];
      var label = option.getAttribute('label');
      if (label) {
        var storedLabel = option.getAttribute('data-i18n-label') || label;
        if (!option.hasAttribute('data-i18n-label')) option.setAttribute('data-i18n-label', storedLabel);
        var nextLabel = language === 'en' ? cleanChinesePunctuation(translateText(storedLabel)) : storedLabel;
        if (option.getAttribute('label') !== nextLabel) option.setAttribute('label', nextLabel);
      }
      var value = option.getAttribute('value');
      if (value && containsChinese(value)) {
        var storedValue = option.getAttribute('data-i18n-value') || value;
        if (!option.hasAttribute('data-i18n-value')) option.setAttribute('data-i18n-value', storedValue);
        var nextValue = language === 'en' ? translateText(storedValue) : storedValue;
        if (option.getAttribute('value') !== nextValue) option.setAttribute('value', nextValue);
      }
      if (option.childNodes && option.childNodes.length) {
        for (var j = 0; j < option.childNodes.length; j++) {
          if (option.childNodes[j].nodeType === 3) translateTextNode(option.childNodes[j]);
        }
      }
    }
  };

  // ---- title / meta -------------------------------------------------------
  var originalTitle;
  var originalMeta = Object.create(null);
  var translateTitle = function () {
    if (originalTitle === undefined) originalTitle = document.title || '';
    if (!originalTitle) return;
    var next;
    if (language === 'en') {
      var core = originalTitle.replace(/ - (?:电脑租赁管理系统|PC Rental)$/, '');
      next = cleanChinesePunctuation(translateText(core)) + ' - PC Rental';
    } else {
      next = originalTitle;
    }
    if (document.title !== next) document.title = next;
  };
  var translateMeta = function () {
    var metas = document.querySelectorAll('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]');
    for (var i = 0; i < metas.length; i++) {
      var meta = metas[i];
      var key = meta.getAttribute('name') || meta.getAttribute('property') || '';
      if (!key) continue;
      if (originalMeta[key] === undefined) originalMeta[key] = meta.getAttribute('content') || '';
      var source = originalMeta[key];
      var next = language === 'en' ? cleanChinesePunctuation(translateText(source)) : source;
      if (meta.getAttribute('content') !== next) meta.setAttribute('content', next);
    }
  };

  // ---- confirm / alert ----------------------------------------------------
  // 行内脚本里写死的中文弹窗文案没法加 data 属性（数量太多，且在 src/appClient.js.txt
  // 与各页面内联脚本里），这里在运行时劫持 confirm / alert / prompt 的 message：
  // 只翻译展示文案，不影响返回值；切换语言后不需要「还原」，因为原始文案来自调用方。
  var wrapDialog = function (name) {
    var original = window[name];
    if (typeof original !== 'function' || original.__rentI18n) return;
    var wrapped = function (message) {
      var args = Array.prototype.slice.call(arguments);
      if (language === 'en' && typeof args[0] === 'string') {
        args[0] = cleanChinesePunctuation(translateText(args[0]));
      }
      return original.apply(window, args);
    };
    wrapped.__rentI18n = true;
    window[name] = wrapped;
  };

  // ---- 语言切换按钮 -------------------------------------------------------
  var syncToggles = function () {
    var buttons = document.querySelectorAll('[data-language-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      var nextLabel = language === 'en' ? '中文' : 'English';
      var labelNode = button.querySelector('[data-language-label-text]');
      if (labelNode) {
        if (labelNode.textContent !== nextLabel) labelNode.textContent = nextLabel;
      } else if (button.childElementCount === 0 && button.textContent !== nextLabel) {
        button.textContent = nextLabel;
      }
      var aria = language === 'en' ? 'Switch to Chinese' : '切换到英文';
      if (button.getAttribute('aria-label') !== aria) button.setAttribute('aria-label', aria);
      if (button.getAttribute('title') !== aria) button.setAttribute('title', aria);
      if (button.getAttribute('aria-pressed') !== (language === 'en' ? 'true' : 'false')) {
        button.setAttribute('aria-pressed', language === 'en' ? 'true' : 'false');
      }
    }
  };

  var syncLegalBlocks = function () {
    // 法律页同时渲染中文 / 英文两份 HTML，用 data-lang 标记，只切换显示哪一份；
    // 两份内容都带 data-i18n-ignore，翻译器不会去动它们。
    document.querySelectorAll('.legal-lang').forEach(function (element) {
      var visible = element.getAttribute('data-lang') === language;
      element.hidden = !visible;
      element.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
  };

  // suppressNoFlash：首屏内联脚本已经把 data-language 写好，此时不宜再「闪一下」。
  var syncRoot = function () {
    if (root.getAttribute('data-language') !== language) root.setAttribute('data-language', language);
    var lang = language === 'en' ? 'en' : 'zh-CN';
    if (root.getAttribute('lang') !== lang) root.setAttribute('lang', lang);
  };

  // ---- apply --------------------------------------------------------------
  var apply = function (scope) {
    language = readLanguage();
    syncRoot();
    syncLegalBlocks();
    translateTitle();
    translateMeta();
    var node = scope && scope.nodeType === 1 ? scope : document.body;
    if (!node) return;
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    var current = walker.nextNode ? walker.nextNode() : null;
    while (current) {
      translateTextNode(current);
      current = walker.nextNode();
    }
    if (node.nodeType === 1) translateAttributes(node);
    var attributed = node.querySelectorAll ? node.querySelectorAll('[placeholder], [title], [aria-label], [alt], input[type="submit"], input[type="button"], input[type="reset"]') : [];
    for (var i = 0; i < attributed.length; i++) translateAttributes(attributed[i]);
    translateOptions(node);
    syncToggles();
  };
  window.applySiteLanguage = apply;

  // 反复调用 apply 是安全的：所有原文都存在节点 / 属性上，不会被二次翻译。
  var applyAll = function () { apply(document.body); };

  // ---- 切换 ---------------------------------------------------------------
  var switchLanguage = function (next) {
    if (next !== 'en' && next !== 'zh') next = language === 'en' ? 'zh' : 'en';
    // 表单里未保存的值与焦点：翻译只改文本节点与少数属性（placeholder/title/…），
    // 不动 input.value，也不重建 DOM，所以值天然保留；这里额外保住焦点与选区。
    var active = document.activeElement;
    var selectionStart = null;
    var selectionEnd = null;
    if (active && typeof active.selectionStart === 'number') {
      try {
        selectionStart = active.selectionStart;
        selectionEnd = active.selectionEnd;
      } catch (_) {}
    }
    writeLanguage(next);
    language = next;
    syncRoot();
    applyAll();
    if (active && document.activeElement !== active && active.focus) {
      try { active.focus({ preventScroll: true }); } catch (_) {}
    }
    if (active && selectionStart !== null && typeof active.setSelectionRange === 'function') {
      try { active.setSelectionRange(selectionStart, selectionEnd); } catch (_) {}
    }
    // 高亮的搜索 / 筛选结果等依赖 layout 的组件：等一帧再广播一次，让页面脚本自行重绘。
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(function () {
        try {
          window.dispatchEvent(new CustomEvent('site-language-change', { detail: { language: next } }));
        } catch (_) {}
      });
    }
  };
  window.setSiteLanguage = switchLanguage;

  document.addEventListener('click', function (event) {
    var target = event.target instanceof Element ? event.target.closest('[data-language-toggle]') : null;
    if (!target) return;
    event.preventDefault();
    switchLanguage(language === 'en' ? 'zh' : 'en');
  }, false);

  // ---- MutationObserver ---------------------------------------------------
  // 只处理「新增节点」和「属性被脚本改掉」的情况：
  //   - 翻译自身造成的改动用 attributeFilter 排除（我们只写 text/data-language/…，
  //     写 text 不会触发 characterData 观察，因为观察的是 childList + 白名单属性）；
  //   - 多个 mutation 用 rAF 合并成一次 apply，避免逐条重扫整页。
  var pendingRoots = [];
  var scheduled = false;
  var flush = function () {
    scheduled = false;
    var roots = pendingRoots;
    pendingRoots = [];
    if (!roots.length) return;
    for (var i = 0; i < roots.length; i++) {
      var node = roots[i];
      if (node && node.isConnected) apply(node === document.body ? document.body : node);
    }
  };
  var schedule = function (node) {
    pendingRoots.push(node);
    if (scheduled) return;
    scheduled = true;
    if (window.requestAnimationFrame) window.requestAnimationFrame(flush);
    else window.setTimeout(flush, 16);
  };
  var observer = new MutationObserver(function (mutations) {
    var roots = [];
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (mutation.type === 'childList' && mutation.addedNodes && mutation.addedNodes.length) {
        roots.push(mutation.target);
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          var added = mutation.addedNodes[j];
          if (added && added.nodeType === 1) roots.push(added);
        }
      } else if (mutation.type === 'attributes' && mutation.target) {
        // 脚本改写了 placeholder / title 等，重新按「原始值」翻一遍。
        roots.push(mutation.target);
      }
    }
    if (roots.length) schedule(roots.length === 1 ? roots[0] : document.body);
  });
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: translatedAttributes
    });
  }

  // ---- 启动 ---------------------------------------------------------------
  wrapDialog('confirm');
  wrapDialog('alert');
  wrapDialog('prompt');

  // 首屏内联脚本已经设置了 data-language：说明页面在渲染前就知道语言，
  // 这里直接按该语言渲染一次即可（不再触发第二次切换，避免闪烁）。
  applyAll();
  // 若内联脚本因 CSP 被拦，data-language 会缺失，用 rAF 再兜底一次。
  if (!root.getAttribute('data-language') && window.requestAnimationFrame) {
    window.requestAnimationFrame(function () { applyAll(); });
  }
})();
`;
