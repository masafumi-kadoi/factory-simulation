#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# setup-dev.sh - スペック駆動開発環境のセットアップ
#
# Usage: bash scripts/setup-dev.sh
#
# Idempotent: 何度実行しても安全です。
# =============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_REPO="https://github.com/masafumi-kadoi/skills-template.git"
ANTHROPICS_REPO="https://github.com/anthropics/skills.git"
OPENAI_REPO="https://github.com/openai/skills.git"

echo "=== スペック駆動開発環境セットアップ ==="
echo "リポジトリルート: $REPO_ROOT"

# ─────────────────────────────────────────────
# Step 1: Clone skills-template to temp dir
# ─────────────────────────────────────────────
TMPDIR_TEMPLATE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEMPLATE"' EXIT

echo ""
echo "[1/7] skills-template をクローン中..."
if ! git clone --depth 1 "$TEMPLATE_REPO" "$TMPDIR_TEMPLATE" 2>/dev/null; then
  echo "ERROR: skills-template のクローンに失敗しました"
  echo "URL: $TEMPLATE_REPO"
  exit 1
fi

# ─────────────────────────────────────────────
# Step 2: Copy original-skills
# ─────────────────────────────────────────────
echo "[2/7] original-skills をコピー中..."
if [ ! -d "$REPO_ROOT/original-skills" ]; then
  cp -R "$TMPDIR_TEMPLATE/original-skills" "$REPO_ROOT/original-skills"
  echo "  -> original-skills/ を作成しました"
else
  echo "  -> original-skills/ は既に存在します（スキップ）"
fi

# ─────────────────────────────────────────────
# Step 3: Copy .claude/ (commands, agents, settings.json)
# ─────────────────────────────────────────────
echo "[3/7] .claude/ 設定をコピー中..."
mkdir -p "$REPO_ROOT/.claude"

if [ ! -f "$REPO_ROOT/.claude/settings.json" ]; then
  cp "$TMPDIR_TEMPLATE/.claude/settings.json" "$REPO_ROOT/.claude/settings.json"
  echo "  -> .claude/settings.json を作成しました"
else
  echo "  -> .claude/settings.json は既に存在します（スキップ）"
fi

if [ ! -d "$REPO_ROOT/.claude/commands" ]; then
  cp -R "$TMPDIR_TEMPLATE/.claude/commands" "$REPO_ROOT/.claude/commands"
  echo "  -> .claude/commands/ を作成しました"
else
  echo "  -> .claude/commands/ は既に存在します（スキップ）"
fi

if [ ! -d "$REPO_ROOT/.claude/agents" ]; then
  cp -R "$TMPDIR_TEMPLATE/.claude/agents" "$REPO_ROOT/.claude/agents"
  echo "  -> .claude/agents/ を作成しました"
else
  echo "  -> .claude/agents/ は既に存在します（スキップ）"
fi

# ─────────────────────────────────────────────
# Step 4: Copy .githooks/ (with original-skills support)
# ─────────────────────────────────────────────
echo "[4/7] .githooks/ をコピー中..."
if [ ! -d "$REPO_ROOT/.githooks" ]; then
  cp -R "$TMPDIR_TEMPLATE/.githooks" "$REPO_ROOT/.githooks"
  chmod +x "$REPO_ROOT/.githooks/post-checkout" \
           "$REPO_ROOT/.githooks/post-merge" \
           "$REPO_ROOT/.githooks/sync-skill-symlinks.sh"
  echo "  -> .githooks/ を作成しました"
else
  echo "  -> .githooks/ は既に存在します（スキップ）"
fi

# ─────────────────────────────────────────────
# Step 5: Clone vendor repos
# ─────────────────────────────────────────────
echo "[5/7] vendor リポジトリをクローン中..."
mkdir -p "$REPO_ROOT/vendor"

if [ ! -d "$REPO_ROOT/vendor/anthropics-skills/.git" ]; then
  echo "  -> anthropics/skills をクローン中..."
  git clone --depth 1 "$ANTHROPICS_REPO" "$REPO_ROOT/vendor/anthropics-skills" 2>/dev/null || {
    echo "  WARNING: anthropics/skills のクローンに失敗しました（スキップ）"
  }
else
  echo "  -> vendor/anthropics-skills/ は既に存在します（スキップ）"
fi

if [ ! -d "$REPO_ROOT/vendor/openai-skills/.git" ]; then
  echo "  -> openai/skills をクローン中..."
  git clone --depth 1 "$OPENAI_REPO" "$REPO_ROOT/vendor/openai-skills" 2>/dev/null || {
    echo "  WARNING: openai/skills のクローンに失敗しました（スキップ）"
  }
else
  echo "  -> vendor/openai-skills/ は既に存在します（スキップ）"
fi

# ─────────────────────────────────────────────
# Step 6: Create symlinks (.claude/skills/ + .agents/skills/)
# ─────────────────────────────────────────────
echo "[6/7] スキルシンボリックリンクを作成中..."

claude_skills_dir="$REPO_ROOT/.claude/skills"
codex_skills_dir="$REPO_ROOT/.agents/skills"
mkdir -p "$claude_skills_dir" "$codex_skills_dir"

link_skill() {
  local relative_src="$1"
  local name="$2"
  local target_dir="$3"
  local target="$target_dir/$name"

  if [ -L "$target" ] || [ -e "$target" ]; then
    return 0
  fi
  ln -s "$relative_src" "$target"
}

# 6a: original-skills (highest priority - linked first)
if [ -d "$REPO_ROOT/original-skills" ]; then
  for d in "$REPO_ROOT"/original-skills/*/; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    link_skill "../../original-skills/$name" "$name" "$claude_skills_dir"
    link_skill "../../original-skills/$name" "$name" "$codex_skills_dir"
  done
  echo "  -> original-skills のリンクを作成しました"
fi

# 6b: vendor/anthropics-skills
if [ -d "$REPO_ROOT/vendor/anthropics-skills/skills" ]; then
  for d in "$REPO_ROOT"/vendor/anthropics-skills/skills/*/; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    link_skill "../../vendor/anthropics-skills/skills/$name" "$name" "$claude_skills_dir"
    link_skill "../../vendor/anthropics-skills/skills/$name" "$name" "$codex_skills_dir"
  done
  echo "  -> anthropics-skills のリンクを作成しました"
fi

# 6c: vendor/openai-skills
if [ -d "$REPO_ROOT/vendor/openai-skills/skills/.curated" ]; then
  for d in "$REPO_ROOT"/vendor/openai-skills/skills/.curated/*/; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    link_skill "../../vendor/openai-skills/skills/.curated/$name" "$name" "$claude_skills_dir"
    link_skill "../../vendor/openai-skills/skills/.curated/$name" "$name" "$codex_skills_dir"
  done
  echo "  -> openai-skills のリンクを作成しました"
fi

# ─────────────────────────────────────────────
# Step 7: Working directories & git hooks
# ─────────────────────────────────────────────
echo "[7/7] 作業ディレクトリ作成 & Git hooks 有効化..."

mkdir -p "$REPO_ROOT/docs/ideas"
mkdir -p "$REPO_ROOT/.steering"
echo "  -> docs/ideas/ を作成しました"
echo "  -> .steering/ を作成しました"

git -C "$REPO_ROOT" config core.hooksPath .githooks
echo "  -> core.hooksPath を .githooks に設定しました"

echo ""
echo "=== セットアップ完了 ==="
echo ""
echo "利用可能なコマンド:"
echo "  /setup-project   - 初回プロジェクトセットアップ（6つの仕様ドキュメント作成）"
echo "  /add-feature     - 新機能の追加"
echo "  /review-docs     - ドキュメントレビュー"
