# PC Rental

一个运行在 Cloudflare Workers 上的电脑设备租赁管理系统，提供客户、员工和管理员三类工作区，覆盖设备出租、合同签署、付款、归还、退款、发票和推荐佣金等业务流程。

> **许可证：** 允许非商业使用、运行、修改和再分发。分发原版或修改版时必须附带许可证并保留版权声明；商业使用需要版权所有者事先书面授权。详见 [LICENSE](LICENSE)。

## 功能

### 客户端

- 注册、登录和账户安全管理
- 浏览设备并创建租赁订单
- 在线查看和签署合同
- 使用 Stripe、银行转账或账户余额付款
- 提交银行转账凭证
- 查看租赁进度、订单和发票
- 选择退款方式并参与推荐计划

### 员工端

- 审核和处理待办订单
- 创建合同及签约链接
- 管理设备交付和归还
- 填写设备检查、损坏情况及维修费用
- 跟踪合同和租赁状态

### 管理端

- 管理用户、设备、订单和合同
- 编辑合同模板及运营数据
- 审核银行转账凭证
- 配置 Stripe 支付
- 处理取消退款和押金退款
- 查看财务、发票及佣金提现记录

## C2C 个人设备出租

正式客户在 `/customer/c2c` 主动加入出租计划后，发布设备并查看出租收入，管理员在 `/admin/c2c` 审核设备、设置平台佣金比例及登记人工结算。审核通过的设备进入 `/customer/devices?mode=c2c`，订单继续使用现有审核、合同、支付、交付和归还流程。

- 发布时须上传 A 面顶盖、B 面屏幕、C 面键盘、D 面底盖及屏幕开机画面，可另传配件与接口照片。复用后台 Cloudinary 设置，支持 JPG、PNG、WebP，每张最多 5MB；逐张上传，D1 只保存归属信息及 HTTPS 链接。客户发布页、审核页和租赁页展示照片。未加入、照片不齐或图片不属于当前用户时不能发布。
- 默认佣金 10%，可配置 0–100%，按下单时比例保存，后续调价不改变已有订单的比例。
- 设备主人不能租自己的设备；设备编辑需先下架并重新审核，有进行中订单时不能下架。C2C 订单不支持更换设备。
- 结算以 AUD 实收净租金为基础，排除押金、配送费、服务费、信用卡手续费及逾期收费，并扣除已退租金和差价。订单归还、押金结清且退款和争议处理完毕后，管理员核对主人资料页的银行账户，完成线下转账，再填写流水号登记结算。系统不会发起银行转账或 Stripe Connect 分账。
- 结算金额和收款账户必须与页面展示一致；每单只能登记一次，并保留原金额、佣金、收款账户、操作者及流水号。已结算主人收入计入财务总览和月度统计的支出。结算后的额外退款或拒付需人工对账处理。
- 存在已发布设备或未结清出租订单时，设备主人无法申请删除账户。

部署前执行新增迁移 `migrations/0179_add_c2c_marketplace.sql`、`migrations/0180_add_c2c_membership_photos.sql`；部署命令不会自动迁移数据库。本地预览可运行 `npm run db:migrate:local` 和 `npm run dev -- --local`。

## 技术栈

- Cloudflare Workers
- Cloudflare D1（SQLite）
- Hono
- TypeScript
- Stripe Checkout 与 Webhook
- `sanitize-html`

## 开始使用

### 环境要求

- Node.js 20 或更高版本
- npm
- Wrangler CLI 可登录的 Cloudflare 账户（远程部署时需要）

### 安装

```bash
git clone <repository-url>
cd rent
npm install
```

### 本地数据库

应用本地 D1 migrations：

```bash
npm run db:migrate:local
```

然后启动开发服务器：

```bash
npm run dev
```

Wrangler 会在终端显示本地访问地址。基础迁移包含演示数据，仅适合开发环境；不要在公开部署中继续使用演示身份或默认密码。

## Cloudflare 配置

### 创建 D1 数据库

```bash
npm run db:create
```

创建成功后，将 Cloudflare 返回的 `database_id` 填入 `wrangler.jsonc`。应用使用的 D1 binding 名称为 `RENT`。

首次部署前应用远程 migrations：

```bash
npm run db:migrate:remote
```

部署 Worker：

```bash
npm run deploy
```

部署 Worker 不会自动执行数据库 migrations。更新版本时应先备份 D1、检查待执行 migrations，再分别迁移数据库和部署代码。

### 配置加密主密钥

Stripe、Cloudinary 以及其他后台密钥会使用 AES-GCM 加密后存入 D1。生产环境必须设置独立的加密主密钥：

```bash
openssl rand -base64 32
npx wrangler secret put SETTINGS_ENCRYPTION_KEY
```

请安全备份该值。主密钥丢失后，已有的加密配置无法恢复，需要清除并重新填写。

不要将 `.dev.vars`、Stripe 密钥、Cloudflare API Token 或 `SETTINGS_ENCRYPTION_KEY` 提交到版本控制。

### 配置 SMTP 发信

在管理员「API 设置」中选择 SMTP，填写主机、用户名、密码和发件邮箱。端口 `465` 使用 `SSL/TLS`；端口 `587` 使用 `STARTTLS`。Worker 通过原生 TCP 直接连接 SMTP 服务器，无需 SMTP Relay URL；Cloudflare 禁止连接端口 `25`。

连通性检测会连接服务器并验证登录，不发送邮件。SMTP 支持中文、纯文本、HTML 和收据附件。

### 配置图片上传（Cloudinary Free）

人民币支付宝 / 微信收款码、付款凭证和设备损坏照片通过 Worker 服务端上传到 Cloudinary，D1 只保存返回的 HTTPS 图片地址。请在 Cloudinary 控制台的 API Keys 页面创建凭证，然后登录管理员后台的 `/admin/settings`，在「Cloudinary 图片上传」中填写 Cloud Name、API Key 和 API Secret。密钥会使用 `SETTINGS_ENCRYPTION_KEY` 加密保存；旧部署也可以继续使用 `CLOUDINARY_CLOUD_NAME`、`CLOUDINARY_API_KEY` 和 `CLOUDINARY_API_SECRET` Wrangler Secrets 作为回退。

应用限制单张图片不超过 5MB，仅接受 JPG、PNG 和 WebP。旧的公开图片链接仍可作为兼容输入，但新页面默认使用文件上传。

### 管理员配送管理

管理员可在 `/admin/delivery` 查看所有送货订单、配送费、派送 / 回收状态和追踪链接，并创建 Zoom2u 派送单或回收单。该页面通过 `wrangler.jsonc` 中的 `DELIVERY_SERVICE` Service Binding 调用 `rent-web`，浏览器不会接触配送 Token。

首次启用时，在 rent 和 rent-web 两个 Worker 设置同一个 `SETTINGS_ENCRYPTION_KEY`，执行主应用迁移，然后登录 rent 管理后台的 `/admin/settings`，按 Zoom2u 的字段填写 `Your Zoom2U API key`、`Your Customer API key` 和 `Your Web Hook Url`。Webhook Authorization Secret、内部配送管理 token 和取货地址等属于高级 / 内部配置：

```bash
npx wrangler secret put SETTINGS_ENCRYPTION_KEY
npx wrangler d1 migrations apply rent --remote
```

两个 Worker 必须使用相同的 `SETTINGS_ENCRYPTION_KEY`，否则官网无法解密后台保存的配送 Token。旧版 `ZOOM2U_*` 和 `DELIVERY_ADMIN_TOKEN` Wrangler Secrets 仍可作为兼容回退，但新配置优先使用后台设置。配送记录保存在共享 D1 的 `delivery_bookings` 表中；Zoom2u 的报价、派单和 Webhook 仍由 rent-web 负责。

### 配置送货地址联想

新建合同的送货地址使用 Google Places API (New)，密钥仅由 Worker 服务端读取。启用 Places API (New) 后设置：

```bash
npx wrangler secret put GOOGLE_MAPS_API_KEY
```

未配置密钥时，地址联想会自动降级为手工填写街道、Suburb、州和邮编，不影响创建合同。请在 Google Cloud 中限制该密钥只能调用 Places API，并按实际用量设置预算告警。

## Stripe

1. 登录管理员后台并打开“系统设置”。
2. 启用 Stripe。
3. 填写 Publishable Key、Secret Key 和 Webhook Signing Secret。
4. 在 Stripe Dashboard 创建以下 Webhook endpoint：

```text
https://<your-domain>/webhooks/stripe
```

订阅事件：

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

建议使用 Stripe Snapshot payload。测试模式下必须配套使用 `pk_test_`、`sk_test_` 和测试 endpoint 的 `whsec_`；生产模式应全部使用正式环境密钥。

付款成功跳转本身不会更新订单。只有 Webhook 签名有效，且订单、客户、金额和 AUD 币种全部匹配时，系统才会确认付款。

## 业务说明

### 支付和退款

- Stripe 收款金额由服务端从 D1 订单读取，包括租金和押金，并在全部订单本金上加收 2.5% 支付手续费。
- Tax Invoice / Receipt 由本网站付款成功后自动开具，Stripe 仅作为信用卡支付处理方。
- Stripe 支付手续费单独记账。处理押金退款时会按实际退还的押金金额退回对应的 2.5% 手续费；取消订单和其他退款不退手续费。
- 银行转账需要客户提交 Reference、说明和公开 HTTPS 凭证链接，并由管理员审核。
- 客户可以选择将退款退回账户余额或原支付渠道。
- 银行转账原路退款需要账户名、BSB 和银行账号，并由管理员在线下完成转账后确认。
- 租赁结束后，押金可以全额退回、部分扣除或全部扣除；每笔押金只能完成一次处理。
- 已付款但尚未开始的订单可以取消并全额退款。
- 没有 Stripe PaymentIntent 的历史交易无法通过 Stripe 自动退款。

### 图片凭证

应用不直接存储图片文件。转账凭证和损坏照片使用外部 HTTPS 链接：

- 链接必须可以公开访问。
- 不接受 localhost、回环地址、私有网段或包含用户名密码的 URL。
- 不要上传身份证件、住址等不必要的敏感资料。
- 图床的访问控制、保留期限和删除策略需要由部署者自行配置。

### 合同

管理员可以编辑合同模板并使用 `${variable_name}` 变量。系统支持订单、付款、设备配置、签约信息、归还检查、损坏费用、逾期费用和后台运营数据等变量。

合同签署完成时会保存内容快照和哈希，后续修改模板不会改变已经签署的合同内容。部署者应根据所在地法律审阅合同、隐私政策、电子签名及数据保留要求。

## 数据库维护

本地迁移：

```bash
npm run db:migrate:local
```

查看并应用远程迁移：

```bash
npx wrangler d1 migrations list rent --remote
npm run db:migrate:remote
```

数据库健康检查：

```bash
npx wrangler d1 execute rent --remote --command "PRAGMA integrity_check"
npx wrangler d1 execute rent --remote --command "PRAGMA foreign_key_check"
```

不要在已有数据库上手工重复执行 `migrations/0001_schema.sql`，其中包含仅用于初始化的删表语句。

## 测试

```bash
npm test
npx tsc --noEmit
npm audit
npm run deploy -- --dry-run
```

自动测试覆盖密码哈希、订单状态机、合同变量、图片 URL 校验和 HTML/XSS 清洗。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地 Worker |
| `npm test` | 运行自动测试 |
| `npm run deploy` | 部署 Worker |
| `npm run db:create` | 创建远程 D1 数据库 |
| `npm run db:init` | 初始化本地 D1 数据库 |
| `npm run db:migrate:local` | 应用本地 migrations |
| `npm run db:migrate:remote` | 应用远程 migrations |
| `npm run db:execute` | 在远程 D1 执行 SQL |
| `npm run cf-typegen` | 生成 Cloudflare binding 类型 |

## 项目结构

```text
src/index.ts          Worker 路由和中间件
src/site.ts           数据访问、合同变量和通用业务逻辑
src/stripe.ts         Stripe 配置加密和 API 封装
src/actions/          表单、支付及业务操作
src/pages/            管理员、员工、客户和公共页面
migrations/           D1 数据库 migrations
tests/                自动测试
wrangler.jsonc        Worker 和 D1 配置
```

## 安全建议

- 正式部署前更换所有演示密码，并为不同员工创建独立账户。
- 为 Cloudflare 账户启用 MFA，并限制 API Token 权限。
- 定期轮换 Stripe Secret 和 Webhook Secret。
- 更换 `SETTINGS_ENCRYPTION_KEY` 前先规划已有密文的重新配置。
- 定期备份 D1，并演练订单、合同、付款和退款数据恢复。
- 监控登录失败、限流、支付失败和 Webhook 验签错误。
- 不要在日志中记录密码、完整令牌、签名或支付密钥。

## 许可证

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)：

- 允许非商业使用、运行、修改和再分发；
- 分发原版或修改版时，必须提供许可证或官方链接；
- 必须保留 `Required Notice: Copyright (c) 2026 jiongjiong123441.`；
- 商业使用、商业部署和收费服务需要另行取得书面授权。

由于该许可证限制商业用途，它属于非商业源码开放许可证，而不是 OSI 认证的开源许可证。
