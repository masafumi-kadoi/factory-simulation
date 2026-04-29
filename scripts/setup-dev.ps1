# =============================================================================
# setup-dev.ps1 - スペック駆動開発環境のセットアップ (Windows PowerShell)
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/setup-dev.ps1
#
# Idempotent: 何度実行しても安全です。
# =============================================================================

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TemplateRepo = "https://github.com/masafumi-kadoi/skills-template.git"
$AnthropicsRepo = "https://github.com/anthropics/skills.git"
$OpenaiRepo = "https://github.com/openai/skills.git"

Write-Host "=== スペック駆動開発環境セットアップ ==="
Write-Host "リポジトリルート: $RepoRoot"

# ─────────────────────────────────────────────
# Step 1: Clone skills-template to temp dir
# ─────────────────────────────────────────────
$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("skills-template-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))

try {
    Write-Host ""
    Write-Host "[1/7] skills-template をクローン中..."
    git clone --depth 1 $TemplateRepo $TmpDir 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: skills-template のクローンに失敗しました"
        Write-Host "URL: $TemplateRepo"
        exit 1
    }

    # ─────────────────────────────────────────────
    # Step 2: Copy original-skills
    # ─────────────────────────────────────────────
    Write-Host "[2/7] original-skills をコピー中..."
    $target = Join-Path $RepoRoot "original-skills"
    if (-not (Test-Path $target)) {
        Copy-Item -Recurse (Join-Path $TmpDir "original-skills") $target
        Write-Host "  -> original-skills/ を作成しました"
    } else {
        Write-Host "  -> original-skills/ は既に存在します（スキップ）"
    }

    # ─────────────────────────────────────────────
    # Step 3: Copy .claude/ (commands, agents, settings.json)
    # ─────────────────────────────────────────────
    Write-Host "[3/7] .claude/ 設定をコピー中..."
    $claudeDir = Join-Path $RepoRoot ".claude"
    New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null

    $settingsTarget = Join-Path $claudeDir "settings.json"
    if (-not (Test-Path $settingsTarget)) {
        Copy-Item (Join-Path $TmpDir ".claude" "settings.json") $settingsTarget
        Write-Host "  -> .claude/settings.json を作成しました"
    } else {
        Write-Host "  -> .claude/settings.json は既に存在します（スキップ）"
    }

    $commandsTarget = Join-Path $claudeDir "commands"
    if (-not (Test-Path $commandsTarget)) {
        Copy-Item -Recurse (Join-Path $TmpDir ".claude" "commands") $commandsTarget
        Write-Host "  -> .claude/commands/ を作成しました"
    } else {
        Write-Host "  -> .claude/commands/ は既に存在します（スキップ）"
    }

    $agentsTarget = Join-Path $claudeDir "agents"
    if (-not (Test-Path $agentsTarget)) {
        Copy-Item -Recurse (Join-Path $TmpDir ".claude" "agents") $agentsTarget
        Write-Host "  -> .claude/agents/ を作成しました"
    } else {
        Write-Host "  -> .claude/agents/ は既に存在します（スキップ）"
    }

    # ─────────────────────────────────────────────
    # Step 4: Copy .githooks/
    # ─────────────────────────────────────────────
    Write-Host "[4/7] .githooks/ をコピー中..."
    $hooksTarget = Join-Path $RepoRoot ".githooks"
    if (-not (Test-Path $hooksTarget)) {
        Copy-Item -Recurse (Join-Path $TmpDir ".githooks") $hooksTarget
        Write-Host "  -> .githooks/ を作成しました"
    } else {
        Write-Host "  -> .githooks/ は既に存在します（スキップ）"
    }

    # ─────────────────────────────────────────────
    # Step 5: Clone vendor repos
    # ─────────────────────────────────────────────
    Write-Host "[5/7] vendor リポジトリをクローン中..."
    $vendorDir = Join-Path $RepoRoot "vendor"
    New-Item -ItemType Directory -Force -Path $vendorDir | Out-Null

    $anthropicsTarget = Join-Path $vendorDir "anthropics-skills"
    if (-not (Test-Path (Join-Path $anthropicsTarget ".git"))) {
        Write-Host "  -> anthropics/skills をクローン中..."
        git clone --depth 1 $AnthropicsRepo $anthropicsTarget 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  WARNING: anthropics/skills のクローンに失敗しました（スキップ）"
        }
    } else {
        Write-Host "  -> vendor/anthropics-skills/ は既に存在します（スキップ）"
    }

    $openaiTarget = Join-Path $vendorDir "openai-skills"
    if (-not (Test-Path (Join-Path $openaiTarget ".git"))) {
        Write-Host "  -> openai/skills をクローン中..."
        git clone --depth 1 $OpenaiRepo $openaiTarget 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  WARNING: openai/skills のクローンに失敗しました（スキップ）"
        }
    } else {
        Write-Host "  -> vendor/openai-skills/ は既に存在します（スキップ）"
    }

    # ─────────────────────────────────────────────
    # Step 6: Create symlinks/junctions for skills
    # ─────────────────────────────────────────────
    Write-Host "[6/7] スキルリンクを作成中..."

    $claudeSkillsDir = Join-Path $RepoRoot ".claude" "skills"
    $codexSkillsDir = Join-Path $RepoRoot ".agents" "skills"
    New-Item -ItemType Directory -Force -Path $claudeSkillsDir | Out-Null
    New-Item -ItemType Directory -Force -Path $codexSkillsDir | Out-Null

    function Link-Skill {
        param(
            [string]$Source,
            [string]$Name,
            [string]$TargetDir
        )
        $linkPath = Join-Path $TargetDir $Name
        if (Test-Path $linkPath) { return }

        # Try symbolic link first, fall back to junction, then copy
        try {
            New-Item -ItemType SymbolicLink -Path $linkPath -Target $Source -ErrorAction Stop | Out-Null
        } catch {
            try {
                New-Item -ItemType Junction -Path $linkPath -Target $Source -ErrorAction Stop | Out-Null
            } catch {
                Copy-Item -Recurse $Source $linkPath
            }
        }
    }

    # 6a: original-skills (highest priority - linked first)
    $osDir = Join-Path $RepoRoot "original-skills"
    if (Test-Path $osDir) {
        Get-ChildItem -Directory $osDir | ForEach-Object {
            Link-Skill $_.FullName $_.Name $claudeSkillsDir
            Link-Skill $_.FullName $_.Name $codexSkillsDir
        }
        Write-Host "  -> original-skills のリンクを作成しました"
    }

    # 6b: vendor/anthropics-skills
    $asDir = Join-Path $RepoRoot "vendor" "anthropics-skills" "skills"
    if (Test-Path $asDir) {
        Get-ChildItem -Directory $asDir | ForEach-Object {
            Link-Skill $_.FullName $_.Name $claudeSkillsDir
            Link-Skill $_.FullName $_.Name $codexSkillsDir
        }
        Write-Host "  -> anthropics-skills のリンクを作成しました"
    }

    # 6c: vendor/openai-skills
    $oaiDir = Join-Path $RepoRoot "vendor" "openai-skills" "skills" ".curated"
    if (Test-Path $oaiDir) {
        Get-ChildItem -Directory $oaiDir | ForEach-Object {
            Link-Skill $_.FullName $_.Name $claudeSkillsDir
            Link-Skill $_.FullName $_.Name $codexSkillsDir
        }
        Write-Host "  -> openai-skills のリンクを作成しました"
    }

    # ─────────────────────────────────────────────
    # Step 7: Working directories & git hooks
    # ─────────────────────────────────────────────
    Write-Host "[7/7] 作業ディレクトリ作成 & Git hooks 有効化..."

    New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot "docs" "ideas") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot ".steering") | Out-Null
    Write-Host "  -> docs/ideas/ を作成しました"
    Write-Host "  -> .steering/ を作成しました"

    git -C $RepoRoot config core.hooksPath .githooks
    Write-Host "  -> core.hooksPath を .githooks に設定しました"

    Write-Host ""
    Write-Host "=== セットアップ完了 ==="
    Write-Host ""
    Write-Host "利用可能なコマンド:"
    Write-Host "  /setup-project   - 初回プロジェクトセットアップ（6つの仕様ドキュメント作成）"
    Write-Host "  /add-feature     - 新機能の追加"
    Write-Host "  /review-docs     - ドキュメントレビュー"
} finally {
    if (Test-Path $TmpDir) {
        Remove-Item -Recurse -Force $TmpDir
    }
}
