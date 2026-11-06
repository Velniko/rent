# R2 文件存储、甲骨文归档与身份认证

非归档文件默认使用 Cloudflare R2（`rent-storage`，binding 为 `STORAGE_BACKUP`）；归档数据使用甲骨文 OCI Archive，并在 R2 保留在线副本。Worker 与 D1 保持在线处理业务，D1 保留原始业务记录作备用。对象按 `standard|archive/分类/YYYY/MM/DD/随机编号` 自动分类，不使用客户姓名、证件号或原文件名。

## 当前配置

- 文件 R2 桶：`rent-storage`，位置提示 Oceania，默认 Standard。
- 站内文件地址：`https://dashboard.geekslope.de5.net/media/随机编号`。
- OCI：`ap-melbourne-1`，namespace `axhjbzmoazyq`，Archive 桶 `bucket-20261011-2116`。
- 密钥使用 Worker secrets：`STORAGE_ENCRYPTION_KEY`、`OCI_ACCESS_KEY_ID`、`OCI_SECRET_ACCESS_KEY`。不要提交 `.dev.vars` 或在聊天/日志中输出密钥。

R2 身份文件上传不依赖 OCI 凭据。没有 OCI 凭据时归档任务暂不运行；配置完成后自动继续。可以在“API 设置 → 对象存储”检查配置、待同步数量和归档文件，并手动处理一批。

## OCI 凭据与新环境部署

1. 在 OCI 用户资料的 **Customer secret keys / 客户密钥** 创建 S3 凭据。Access Key 对应 `OCI_ACCESS_KEY_ID`，Secret Key 对应 `OCI_SECRET_ACCESS_KEY`，后者仅在创建时显示。使用只可访问指定桶的专用用户，不用账户管理员凭据。桶必须私有，不配置公开访问或预认证下载链接。
2. 对于已创建的 Archive 桶，直接使用 `OCI_ARCHIVE_BUCKET`。只有要另建桶时才需要 OCI CLI 和 `OCI_COMPARTMENT_ID`；`bash scripts/create-oci-storage.sh` 可创建并校验可选的 media/private Standard 桶及 Archive 桶。普通文件默认只写 R2；同时设置 `OCI_MEDIA_BUCKET` / `OCI_PRIVATE_BUCKET` 时才额外镜像对应类型至 OCI。
3. 新环境先 `npx wrangler r2 bucket create rent-storage --location oc` 并确认 `wrangler.jsonc` 的 R2 binding；再填写该环境实际的 OCI 区域、namespace、Archive 桶名和正式站点 HTTPS origin。
4. 使用 `npx wrangler secret put 名称` 交互输入 secrets，或从权限为 0600 的临时文件经标准输入写入。文件加密密钥至少 32 字符且应为随机值，单独安全备份。**不得直接轮换文件加密密钥；必须先完成所有已有文件的重新加密，否则无法解密原文件。**
5. 运行 `npm test`、`npx tsc --noEmit`、`npm run cf-typegen`；应用 `npm run db:migrate:remote` 后 `npm run deploy`。

## 图片迁移与归档

每 15 分钟处理最多 5 张历史图片和 5 条归档记录，每小时修复缺失副本。操作可重试，有持久迁移进度；任务错误进入现有异常任务记录。

图片迁移覆盖付款凭证、余额充值凭证、损坏照片、合同操作数据中的损坏照片、设备出租计划照片及品牌/付款二维码设置。只从 `res.cloudinary.com` 和明确配置的 `IMAGE_MIGRATION_HOSTS` 下载，禁止重定向，限制大小并校验图片签名。白名单仅填写可信域名，逗号分隔，不支持通配符。复制成功才替换站内引用，原链接保存至对象清单。外链 SVG、第三方 favicon、远程脚本和法律正文不迁移。

现有证据照片的 Cloudinary 上传日期/编号水印继续保留，水印后的文件存 R2，因此这部分仍需 Cloudinary 配置。身份文件只经私有 R2/可选 OCI 私有镜像，不经过 Cloudinary。

已完成/取消订单及其合同、付款、发票、收据、退款和财务台账写入 OCI Archive；推荐与优惠码记录按已启用的 ARCHIVE 保留策略处理。JSON 快照带来源表、原记录、格式版本和归档时间，D1 原记录保留，不执行删除。文件摘要防止损坏；一端暂时失败时保留另一端成功副本，后续自动补齐。

OCI Archive 对象上传后需先还原才能直接读取；网站下载通常回退到 R2 在线副本。若 R2 副本丢失，需先在 OCI 控制台还原对象，再运行“重试同步”。Archive 最低存储计费期 90 天。参考 [OCI Archive 文档](https://docs.oracle.com/en-us/iaas/Content/Archive/Concepts/archivestorageoverview.htm)、[OCI S3 凭据说明](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi.htm)。

## 身份认证与隐私

“个人信息 → 身份认证”上传签证或身份证件（驾照、护照等；JPG/PNG/WebP，最大 5MB）。认证成功后不可更换证件，数据库也锁定证件归属、类型和首次认证时间。管理员可将失效认证标记为过期，不能替换原证据。

客户只看到状态和拒绝原因。仅 ADMIN 可在客户详情进入审核，填写用途后查看原图，成功查看后才可批准；STAFF / MANAGER 无权限，通用 `/media` 接口一律拒绝身份文件。证件与归档使用绑定对象 ID 的 AES-GCM 加密，两端只保存密文。

每次认证历史访问、原图请求、成功调取、审核和到期清理均记录审计。读取前审计失败即拒绝读取，不缓存、不嵌入、不暴露存储下载凭据，日志不含证件内容/完整号码；身份访问日志和认证审计记录禁止 UPDATE/DELETE。按原有 IDENTITY_DOCUMENTS 策略到期删除两端材料（默认审核后 365 天），保留认证事实与审计。审计可追踪系统访问，不能阻止获授权管理员截屏。

只有上传材料获批且当前认证有效的客户才可能获得低风险等级押金减免；旧版手动“已验证”需补交材料。周/月租与优惠码优惠不变，已付款/已签合同的历史押金不重算。

## 分页上传与自动检查

身份认证入口分别通向签证、驾照、护照、其他身份证件四个独立页面。服务端按路由固定证件类型；上传后使用 Cloudflare 托管的 Workers AI 视觉模型检查实际类型、正反面/资料页、单份证件及清晰度。无匹配结果、低置信度、服务异常或审计写入失败均拒绝本次提交，不保存错误图片，不自动批准身份认证。通过自动检查后仍由管理员查看材料并最终审核。

模型只返回分类、页面类型、清晰度及置信度；不提取或保存姓名、证件号、国籍等识别文本，不进行真伪或本人身份判定。使用 `@cf/qwen/qwen3.8-27b`，通过 `AI` binding 调用，关闭输出存储，不启用 AI Gateway 请求日志。Cloudflare 的[模型文档](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/)标明此模型为 Cloudflare 托管、零数据保留。旧认证记录保留；新增迁移 0190 保存细分类型和检查结果，并保护已认证材料的不可更改属性。

身份文件支持 JPG、PNG、WebP 或 PDF，均不超过 5MB。PDF 经文件签名校验后通过 Workers AI 的 toMarkdown 转换正文及嵌入图像说明，再做同样的证件类型检查；原 PDF 以密文保存，仅管理员可带审计查看。转换失败、加密/损坏、无法提取可识别内容或内容过长时拒绝提交，提示重新上传。转换正文仅在请求内存中使用，不写数据库或日志。
