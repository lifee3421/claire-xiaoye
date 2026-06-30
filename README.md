# Claire 的小椰奖励商场

这是一个考研奖励银行系统，不是普通商城。它把每日学习、运动、睡眠和娱乐边界结算成“生成时间余额”，再把余额的一部分分配给明日游戏类娱乐，剩余部分按 `10min = 1分` 转入奖励银行。

## 核心机制

```text
前日结算 -> 次日娱乐额度 -> 剩余转奖励银行 -> 商场兑换阶段性战利品
```

每日结算公式：

```text
学习入账 + 运动入账 + 睡眠调整 - 游戏类娱乐超额 - 有益娱乐修正
= 当日生成时间余额

floor((可用余额 - 明日游戏额度) / 10)
= 奖励银行新增积分
```

学习入账是分段计算，不是简单相加：

- 0-120min：`0.10`
- 120-360min：`0.20`
- 360-480min：`0.25`
- 480min 以上：`0.30`

有益娱乐前 60min 保护，60-120min 的超出部分按 1/2 温柔修正，超过 120min 标记为“兴趣扩张”。

## 已实现页面

- 首页：奖励银行、明日游戏额度、今日生成余额、最近结算、最近目标
- 每日结算：学习、运动、睡眠、游戏超额、有益娱乐、明日游戏额度、结算预览
- 奖励商场：分类筛选、状态筛选、稀有度、进度条、预计解锁天数、兑换
- 目标估算：单/多商品购物篮、每日强度输入、截止日期、强度预设对比
- 商品管理：新增、编辑、删除商品，支持稀有度、优先级、状态、限时日期、重复兑换
- 分类管理：新增、编辑、删除分类
- 历史记录：结算记录和兑换记录
- 设置：昵称、银行积分校准、默认明日游戏额度、有益娱乐保护额度

## 本地运行

```bash
npm install
npm run dev
```

当前环境如果没有系统 Node/npm，可以使用项目内已安装的 pnpm 运行；部署到 Vercel 时使用标准 npm 即可。

## Firebase 配置

复制环境变量示例：

```bash
cp .env.example .env
```

填写 Firebase Web App 配置：

```env
VITE_FIREBASE_API_KEY=xxx
VITE_FIREBASE_AUTH_DOMAIN=xxx
VITE_FIREBASE_PROJECT_ID=xxx
VITE_FIREBASE_STORAGE_BUCKET=xxx
VITE_FIREBASE_MESSAGING_SENDER_ID=xxx
VITE_FIREBASE_APP_ID=xxx
```

没有填写 `.env` 时，应用会进入本地演示模式，数据保存在浏览器 `localStorage`。填写后启用 Google 登录和 Firestore 多设备同步。

## Firebase 设置步骤

1. 在 Firebase Console 创建项目。
2. 添加 Web App，复制配置到 `.env`。
3. 在 Authentication 中启用 Google 登录。
4. 创建 Firestore Database。
5. 设置 Firestore 安全规则。

推荐规则：

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Firestore 数据结构

```text
users/{uid}
users/{uid}/categories/{categoryId}
users/{uid}/products/{productId}
users/{uid}/settlements/{settlementId}
users/{uid}/redemptions/{redemptionId}
```

所有数据都按 Firebase `user.uid` 隔离。

## 部署到 Vercel

1. 将项目推送到 GitHub。
2. 在 Vercel 导入仓库。
3. Framework Preset 选择 `Vite`。
4. Build Command 使用 `npm run build`。
5. Output Directory 使用 `dist`。
6. 在 Vercel Project Settings 添加 `.env` 中的所有 `VITE_FIREBASE_*` 环境变量。
7. 在 Firebase Authentication 的 Authorized domains 中加入 Vercel 域名。
8. 重新部署。

## 核心计算文件

核心计算集中在：

```text
src/utils/calculations.js
```

包含：

- `calculateStudyCredit`
- `calculateExerciseCredit`
- `calculateBeneficialEntertainmentAdjustment`
- `calculateGameOverrun`
- `calculateGeneratedMinutes`
- `calculateBankPointsAdded`
- `estimateDaysToProduct`
- `estimateDaysToCart`
- `calculateDaysLeft`
- `compareIntensityPresets`

## 后续可扩展

- 成就徽章系统
- 连续学习 streak
- 每周总结图表
- 商品稀有度动画
- 小椰对话气泡
- Google Calendar 同步
- 数据导入/导出
- 主题皮肤
- 复盘模板生成
