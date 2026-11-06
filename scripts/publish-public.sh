#!/usr/bin/env bash
# Publishes the current commit to the public repository (nakshakarapp-hue/nakshakar) as a single new
# commit authored as Nakshakar, on top of what is already there. The private repository keeps the full
# history; the public one gets one commit per release. Pushing to main there redeploys the website.
#
# Needs the GitHub CLI signed in to the nakshakarapp-hue account (gh auth switch -u nakshakarapp-hue)
# and a remote called "public".
set -euo pipefail
cd "$(dirname "$0")/.."
MESSAGE="${1:?Give a message, for example: bash scripts/publish-public.sh 'Nakshakar 2.0.0'}"
EMAIL="${PUBLIC_EMAIL:?Set PUBLIC_EMAIL to the account's no-reply address}"

git fetch public main 2>/dev/null || true
TREE=$(git rev-parse 'HEAD^{tree}')
PARENT=()
if git rev-parse -q --verify refs/remotes/public/main >/dev/null; then
  PARENT=(-p refs/remotes/public/main)
fi
COMMIT=$(GIT_AUTHOR_NAME=Nakshakar GIT_AUTHOR_EMAIL="$EMAIL" \
  GIT_COMMITTER_NAME=Nakshakar GIT_COMMITTER_EMAIL="$EMAIL" \
  git commit-tree "$TREE" "${PARENT[@]}" -m "$MESSAGE")
git push public "$COMMIT:refs/heads/main"
echo "Published $COMMIT"
