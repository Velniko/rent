# DeepL / Google 翻译接口

rent 和 rent-web 使用共享 D1 的 `translationConfig`、`translation_cache` 和
`translation_daily_usage`。上线前在 rent 应用 `0178_add_translation_cache.sql`，两站
继续使用相同的 `SETTINGS_ENCRYPTION_KEY`。

管理员在 `/admin/api-settings` 填写 DeepL / Google Cloud Translation API Key，
选择默认服务商、DeepL API Free / Pro、每日 UTF-8 字节上限，并启用 API 翻译。
密钥以 AES-GCM 加密保存；留空保留，两个密钥可以单独清除。默认每日上限 100000 字节。

## 请求

两个站点均支持同源 JSON POST：

- `/api/translate`：使用后台默认服务商，可通过 `provider` 选择。
- `/api/translate/deepl`：指定 DeepL。
- `/api/translate/google`：指定 Google Cloud Translation Basic v2。

```js
const response = await fetch('/api/translate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    texts: ['轻薄笔记本', '适合短期办公'],
    sourceLang: 'zh',
    targetLang: 'en',
    provider: 'deepl', // 可省略
  }),
});
const result = await response.json();
// { ok: true, provider, sourceLang, targetLang,
//   translations: [{ text, cached, sourceBytes, translatedBytes }, ...] }
```

已加载网站页面脚本时也可调用：

```js
const [name] = await window.SiteTranslation.translate(['轻薄笔记本'], {
  sourceLang: 'zh', targetLang: 'en', provider: 'google',
});
```

支持 `zh / en / de / fr / es / it / ja / ko / pt / nl / pl / ru / ar`，源语言还可为
`auto`。每次 1–20 段，每段最多 4096 字节，合计最多 10000 字节；按 IP 每分钟最多
20 次请求。跨站浏览器调用会被现有来源校验拦截。服务商和密钥始终留在服务器。

## 缓存与额度

缓存键为服务商、源语言、目标语言、完整原文的 SHA-256；仅翻译未缓存的不同原文，
返回顺序与输入一致。原文、译文及各自的 UTF-8 字节数持久保存，原文变动会产生新键。
两站同时遇到同一条新内容时，数据库锁保证只有一个请求调用服务商；其他请求返回
409，网站脚本稍后重试。锁 60 秒后可重领，上游请求超时为 10 秒。

每日额度按墨尔本日期累计，仅在调用服务商前为新原文预留；失败或结果不确定的上游
调用也占额度，防止持续失败造成无限调用。缓存命中不占额度，停用翻译、清除密钥或
额度耗尽后仍可读取已有缓存。只缓存完整、有效的成功响应，不缓存错误信息。

错误状态：400 参数无效、409 正在翻译、413 内容过长、429 请求或每日额度超限、
502 上游翻译失败、503 未启用／未配置／数据库暂不可用。

## 页面接入

现有中英词典保持优先用于界面文案。公开设备名称与介绍使用
`data-api-translate` 标记，英文模式按需调用接口，切回中文恢复原文。
只标记纯文本叶节点，同时加 `data-i18n-ignore`（rent）或 `data-no-translate`
（rent-web），防止两个翻译器互相覆盖。API 返回值使用 `textContent`，不解释为 HTML。
客户资料、表单输入、合同和法律文本不自动发送到翻译服务。

## 服务商文档

- [DeepL Translate Text](https://developers.deepl.com/api-reference/translate/request-translation)
- [Google Cloud Translation Basic v2](https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate)
- [Google API Key 请求头](https://docs.cloud.google.com/apis/docs/system-parameters)
