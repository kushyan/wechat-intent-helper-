# 把项目发布到 GitHub

这份文档只讲一件事: 怎么把这个文件夹变成一个能在 GitHub 上打开的网站。

**先说清楚一件事**: 整站已经做成纯静态的了(`docs/` 目录), 所以 GitHub Pages 完全够用,
不需要服务器、不需要数据库、不需要任何 key。别人点开链接就能用。

下面三条路线任选一条。**推荐路线一**, 最不容易出错。

---

## 路线一: 网页上传(不需要装任何东西)

1. 打开 <https://github.com/new>
2. **Repository name** 填 `wechat-intent-helper`
3. 选 **Public**(Pages 免费版要求公开仓库; 想私有也可以, 但 Pages 需要付费账号)
4. **不要**勾选 "Add a README file" / ".gitignore" / "license"(本地已经有了)
5. 点 **Create repository**
6. 在新仓库页面点 **uploading an existing file**
7. 把 `wechat-intent` 文件夹里的**所有内容**(包括 `.github`、`docs`、`tools`、`tests`
   这些以点开头的文件夹)拖进去
   - Windows 资源管理器默认隐藏以 `.` 开头的项? 没有, `.github` 是能看到的
   - 注意**不要**把 `__pycache__` 拖进去
8. Commit message 随便写(比如 `init`), 点 **Commit changes**
9. 开启网页: 仓库 **Settings → Pages → Build and deployment → Source** 选
   **GitHub Actions**
10. 回到 **Actions** 标签页, 等 "Deploy site to GitHub Pages" 跑完(约 1 分钟)
11. 打开 `https://<你的用户名>.github.io/wechat-intent-helper/`

---

## 路线二: GitHub Desktop

1. 装好 GitHub Desktop 并登录
2. **File → Add local repository**, 选中 `wechat-intent` 这个文件夹
   - 它会提示"这不是一个 Git 仓库", 点 **create a repository** 即可(本地已经初始化过,
     正常情况会直接识别)
3. 左下角填 commit message, 点 **Commit to main**
4. 点 **Publish repository**, 取消勾选 "Keep this code private", 仓库名填
   `wechat-intent-helper`, 点 **Publish repository**
5. 然后照路线一的第 9–11 步开启 Pages

---

## 路线三: 命令行(仓库已经在本地初始化好了)

仓库里的 `push-to-github.ps1` 就是干这个的:

```powershell
cd wechat-intent
.\push-to-github.ps1 -User 你的GitHub用户名 -Repo wechat-intent-helper
```

如果 PowerShell 拦脚本, 先执行:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

或者手动来:

```powershell
cd wechat-intent
git remote add origin https://github.com/你的用户名/wechat-intent-helper.git
git branch -M main
git push -u origin main
```

推送时会要账号密码: **密码位置要填 Personal Access Token**, 不是登录密码。
在 <https://github.com/settings/tokens> 生成一个 classic token, 勾上 `repo` 权限即可。

---

## 开启 Pages(三条路线都一样)

**Settings → Pages → Build and deployment → Source → GitHub Actions**。

选完之后, 每次往 `main` 分支推送, `.github/workflows/pages.yml` 都会自动重新发布网站。

> 另一种更省事的选法: Source 选 **Deploy from a branch**, 分支选 `main`、目录选 `/docs`。
> 效果一样, 只是每次改完要自己去点一下重新发布。两种方式选一个就行, 不要同时用。

发布完成后地址固定是:

```text
https://<你的用户名>.github.io/wechat-intent-helper/
```

---

## 如果你打不开 github.com

这台机器的 `hosts` 文件(`C:\Windows\System32\drivers\etc\hosts`)里有一批把
`github.com`、`api.github.com`、`raw.githubusercontent.com`、`github.io` 指向
`127.0.0.1` 的记录。只要这些记录还在:

- `git push` 会直接连不上
- 发布成功后, `https://<你的用户名>.github.io/...` 在本机也打不开(别的设备能打开)

要清理的话: **以管理员身份**打开记事本 → 打开那个 hosts 文件 → 删掉所有含 `github`
和 `githubusercontent`、`github.io` 的行 → 保存。改完执行 `ipconfig /flushdns`。

> 删之前建议先把文件复制一份备份。这个文件里还有 Steam / Twitch / YouTube 之类的屏蔽记录,
> 不是你写的就别动。

---

## 推送之后会自检

仓库里带了两条 GitHub Actions:

| 工作流 | 作用 |
| --- | --- |
| `CI` | 跑 Python 单元测试 + 网页引擎与 Python 引擎的对照测试 |
| `Deploy site to GitHub Pages` | 把 `docs/` 发布成网站 |

推上去之后去 **Actions** 看颜色: 两个都绿, 就说明代码和网站都是好的。
