# 同词相遇 · 联机版

两个人异地玩的猜词游戏。一个人建房拿 4 位房间码，另一个人填码进来，每轮各写一个词，撞上就赢。

---

## 部署到 Render（全程免费，约 5 分钟）

需要传 4 个文件：

| 文件 | 作用 |
|---|---|
| `index.html` | 游戏界面（含单机版：双人同屏 / 和 AI 玩） |
| `server.js` | 联机服务端，零依赖 |
| `package.json` | 告诉平台怎么启动 |
| `render.yaml` | Render 的配置，省得手填 |

### 1. 注册 GitHub

打开 https://github.com/signup ，用邮箱注册（用户名随便取）。

### 2. 建一个仓库

登录后点右上角 **+** → **New repository**

- Repository name 填 `same-word`
- 选 **Public**
- 不要勾选任何初始化文件
- 点 **Create repository**

### 3. 上传文件

在新仓库页面点 **uploading an existing file**（或 **Add file → Upload files**），
把 `index.html`、`server.js`、`package.json`、`render.yaml` 四个文件一起拖进去，
然后点页面下方绿色的 **Commit changes**。

### 4. 注册 Render

打开 https://dashboard.render.com/register ，直接点 **GitHub** 用刚注册的账号登录，
授权时选 **Only select repositories** → 勾上 `same-word`。

### 5. 部署

Render 控制台点 **New +** → **Blueprint**

- 选刚才那个 `same-word` 仓库
- 它会自己读到 `render.yaml`，点 **Apply** / **Create**
- 等 2～3 分钟，状态变成 **Live**

顶部会显示网址，形如：

```
https://same-word-xxxx.onrender.com
```

**这个网址是固定的**，不会再变。把它发到微信就行。

---

## 怎么玩

1. 打开网址 → 选「联机房间」→「创建房间」，得到 4 位房间码
2. 把链接和房间码发给对方
3. 对方打开链接，填码加入，两个人就进同一局了
4. 每轮各写一个词，双方都交卷后才一起揭晓

---

## 注意事项

- **免费实例 15 分钟没人访问会休眠**，下一次打开要等 30～60 秒（页面会一直转，别关）。
  玩起来之后就一直醒着，不会中途睡。
- 免费额度是每月 750 小时，一个服务用不满。
- 只有两个人能进一个房间，第三个人会提示「房间满了」。
- 房间放在内存里，服务重启后房间就没了（重开一局即可）。

## 本地跑

```bash
node server.js
# 打开 http://127.0.0.1:8099
```

改端口：`PORT=3000 node server.js`
