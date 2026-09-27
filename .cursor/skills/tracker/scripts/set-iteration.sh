#!/usr/bin/env bash
# Sets Iteration on a Task tracker card to the current covering iteration.
# Bash 3.2 compatible. Calendar dates only (DateTime.AddDays equivalent);
# do not use unix-epoch / 86400 day math — DST must not move the boundary.
# Args: <issue-number>
set -euo pipefail

Owner='johnneon'
ProjectNumber=2
Repo='johnneon/mcp_gateway'

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <issue-number>" >&2
  exit 1
fi

Issue=$1

gh=$(command -v gh) || {
  echo 'gh was not found on PATH' >&2
  exit 1
}

die_gh() {
  echo "gh $* failed" >&2
  exit 1
}

# Add calendar days to yyyy-MM-dd (equivalent to DateTime.AddDays).
# Prefer platform calendar arithmetic; never multiply duration by 86400.
ymd_add_days() {
  local start=$1
  local days=$2
  if date --version >/dev/null 2>&1; then
    date -d "${start} + ${days} days" '+%Y-%m-%d'
  else
    date -j -v+"${days}d" -f '%Y-%m-%d' "$start" '+%Y-%m-%d'
  fi
}

# Compare yyyy-MM-dd as calendar dates (lexicographic order matches chronological).
ymd_ge() {
  # $1 >= $2
  [ "$1" \> "$2" ] || [ "$1" = "$2" ]
}

ymd_lt() {
  # $1 < $2
  [ "$1" \< "$2" ]
}

project_json=$("$gh" project view "$ProjectNumber" --owner "$Owner" --format json) || die_gh project view
projectId=$(printf '%s' "$project_json" | jq -r '.id')
if [ -z "$projectId" ] || [ "$projectId" = 'null' ]; then
  echo "Could not resolve project $ProjectNumber for owner $Owner" >&2
  exit 1
fi

items_file=$(mktemp)
query_file=$(mktemp)
trap 'rm -f "$items_file" "$query_file"' EXIT

if ! "$gh" project item-list "$ProjectNumber" --owner "$Owner" --format json --limit 1000 >"$items_file"; then
  die_gh project item-list
fi

itemId=$(jq -r --argjson issue "$Issue" --arg repo "$Repo" \
  '.items[] | select(.content.number == $issue and .content.repository == $repo) | .id' \
  "$items_file")
if [ -z "$itemId" ] || [ "$itemId" = 'null' ]; then
  echo "Issue #$Issue of $Repo is not on project $ProjectNumber" >&2
  exit 1
fi

# GraphQL field named Iteration — same shape as set-iteration.ps1
cat >"$query_file" <<'EOF'
{"query":"query($login: String!, $number: Int!) { user(login: $login) { projectV2(number: $number) { field(name: \"Iteration\") { ... on ProjectV2IterationField { id configuration { iterations { id title startDate duration } } } } } } }","variables":{"login":"johnneon","number":2}}
EOF

raw=$("$gh" api graphql --input "$query_file") || die_gh api graphql

fieldId=$(printf '%s' "$raw" | jq -r '.data.user.projectV2.field.id')
if [ -z "$fieldId" ] || [ "$fieldId" = 'null' ]; then
  echo 'Iteration field was not found on the project' >&2
  exit 1
fi

today=$(date '+%Y-%m-%d')

currentId=
currentTitle=
currentStart=

# Iterate iterations; among covers (today >= start && today < end), prefer latest start.
while IFS= read -r iterLine || [ -n "${iterLine:-}" ]; do
  [ -z "${iterLine:-}" ] && continue
  iterId=$(printf '%s' "$iterLine" | jq -r '.id')
  iterTitle=$(printf '%s' "$iterLine" | jq -r '.title')
  iterStart=$(printf '%s' "$iterLine" | jq -r '.startDate')
  iterDuration=$(printf '%s' "$iterLine" | jq -r '.duration')
  end=$(ymd_add_days "$iterStart" "$iterDuration")
  if ymd_ge "$today" "$iterStart" && ymd_lt "$today" "$end"; then
    if [ -z "$currentStart" ] || ymd_lt "$currentStart" "$iterStart"; then
      currentId=$iterId
      currentTitle=$iterTitle
      currentStart=$iterStart
    fi
  fi
done <<EOF
$(printf '%s' "$raw" | jq -c '.data.user.projectV2.field.configuration.iterations[]')
EOF

if [ -z "$currentId" ]; then
  echo "No current iteration covers $today. Create one on the Task tracker board." >&2
  exit 1
fi

if ! "$gh" project item-edit \
  --id "$itemId" \
  --project-id "$projectId" \
  --field-id "$fieldId" \
  --iteration-id "$currentId" >/dev/null; then
  echo "gh project item-edit failed" >&2
  exit 1
fi

echo "#$Issue -> $currentTitle"
