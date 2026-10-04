#Requires -Version 5.1
<#
.SYNOPSIS
    把本仓库推送到 GitHub。

.DESCRIPTION
    仓库已经在本地初始化并提交好了, 这个脚本只负责挂远端和推送。
    推送时会弹出凭据窗口, 密码位置要填 Personal Access Token(不是登录密码),
    生成地址: https://github.com/settings/tokens

    如果 PowerShell 拦脚本, 先在当前窗口执行:
        Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

    注意: 本文件必须保存为 "UTF-8 with BOM"。Windows PowerShell 5.1 会按系统
    代码页读取无 BOM 的 .ps1, 中文会被读成乱码并报语法错误。

.EXAMPLE
    .\push-to-github.ps1 -User kushyan

.EXAMPLE
    .\push-to-github.ps1 -User kushyan -Repo wechat-intent-helper
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "你的 GitHub 用户名")]
    [string]$User,

    [string]$Repo = "wechat-intent-helper",

    [string]$Branch = "main",

    [string]$Message = "chore: 同步本地改动",

    [switch]$SkipCommit
)

$ErrorActionPreference = "Stop"

<#
    调用 git 的安全封装。
    Windows PowerShell 5.1 里原生命令一旦往 stderr 写东西, 在
    $ErrorActionPreference = "Stop" 下会变成终止错误(比如 "no such remote"),
    所以这里临时降级为 Continue, 只看退出码。
#>
function Invoke-Git {
    param([string[]]$GitArgs)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $lines = @(& git @GitArgs 2>&1 | ForEach-Object { [string]$_ })
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{
        Lines = $lines
        Code  = $code
        Text  = (($lines -join "`n").Trim())
    }
}

# 始终以脚本所在目录(仓库根目录)为准, 避免在错误的目录里提交
$repoRoot = $PSScriptRoot
if (-not $repoRoot) { $repoRoot = (Get-Location).Path }
Set-Location -Path $repoRoot
Write-Host "[i] 仓库目录: $repoRoot" -ForegroundColor Cyan

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "没有找到 git, 请先安装: https://git-scm.com/download/win"
}

# 1. 确认是 git 仓库, 不是就初始化
if (-not (Test-Path (Join-Path $repoRoot ".git"))) {
    Write-Host "[i] 还没初始化, 执行 git init" -ForegroundColor Yellow
    $init = Invoke-Git -GitArgs @("init")
    if ($init.Code -ne 0) { throw "git init 失败: $($init.Text)" }
}

# 2. 补上提交身份(只写进本仓库, 不动全局配置)
$name = (Invoke-Git -GitArgs @("config", "user.name")).Text
if (-not $name) {
    Invoke-Git -GitArgs @("config", "user.name", $User) | Out-Null
    Write-Host "[i] 已为本仓库设置 user.name = $User" -ForegroundColor Yellow
}
$email = (Invoke-Git -GitArgs @("config", "user.email")).Text
if (-not $email) {
    $noreply = $User + "@users.noreply.github.com"
    Invoke-Git -GitArgs @("config", "user.email", $noreply) | Out-Null
    Write-Host "[i] 已为本仓库设置 user.email = $noreply" -ForegroundColor Yellow
}

# 3. 提交(没有改动就跳过)
if (-not $SkipCommit) {
    Invoke-Git -GitArgs @("add", "-A") | Out-Null
    $pending = (Invoke-Git -GitArgs @("status", "--porcelain")).Text
    if ($pending) {
        $commit = Invoke-Git -GitArgs @("commit", "-m", $Message)
        if ($commit.Code -ne 0) { throw "git commit 失败: $($commit.Text)" }
        Write-Host "[i] 已提交待推送的改动" -ForegroundColor Green
    } else {
        Write-Host "[i] 没有待提交的改动" -ForegroundColor DarkGray
    }
}

# 4. 挂远端
$url = "https://github.com/$User/$Repo.git"
$remotes = (Invoke-Git -GitArgs @("remote")).Lines
if ($remotes -contains "origin") {
    $existing = (Invoke-Git -GitArgs @("remote", "get-url", "origin")).Text
    if ($existing -ne $url) {
        Invoke-Git -GitArgs @("remote", "set-url", "origin", $url) | Out-Null
        Write-Host "[i] origin 已改为 $url" -ForegroundColor Yellow
    } else {
        Write-Host "[i] origin 已经是 $url" -ForegroundColor DarkGray
    }
} else {
    $add = Invoke-Git -GitArgs @("remote", "add", "origin", $url)
    if ($add.Code -ne 0) { throw "添加远端失败: $($add.Text)" }
    Write-Host "[i] 已添加 origin = $url" -ForegroundColor Green
}

# 5. 推送
Invoke-Git -GitArgs @("branch", "-M", $Branch) | Out-Null
Write-Host "[i] 正在推送到 $url ($Branch) ..." -ForegroundColor Cyan
$push = Invoke-Git -GitArgs @("push", "-u", "origin", $Branch)
if ($push.Code -ne 0) {
    Write-Host ""
    Write-Host $push.Text -ForegroundColor DarkGray
    throw ("推送失败。请检查: 远端仓库是否已创建; 密码位置是否填了 Personal Access Token; " +
        "本机 hosts 是否屏蔽了 github.com(见 PUBLISH.md)。")
}

Write-Host ""
Write-Host "[OK] 推送完成" -ForegroundColor Green
Write-Host "接下来手动开一次网页发布(只需一次):" -ForegroundColor Cyan
Write-Host "    1. 打开 https://github.com/$User/$Repo/settings/pages"
Write-Host "    2. Source 选 GitHub Actions"
Write-Host "    3. 等 Actions 里的 Deploy 跑完, 访问:"
Write-Host "       https://$User.github.io/$Repo/" -ForegroundColor Green
