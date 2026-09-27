#!/usr/bin/env bash
# Moves a Task tracker card Status. Bash 3.2 compatible.
# Args: <issue-number> <Status>
# Status: Backlog | Ready | In progress | In review | Done
set -euo pipefail

Owner='johnneon'
ProjectNumber=2
Repo='johnneon/mcp_gateway'

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <issue-number> <Status>" >&2
  echo "Status: Backlog | Ready | In progress | In review | Done" >&2
  exit 1
fi

Issue=$1
Status=$2

case "$Status" in
  'Backlog'|'Ready'|'In progress'|'In review'|'Done') ;;
  *)
    echo "Status '$Status' is not an option of the Status field" >&2
    exit 1
    ;;
esac

gh=$(command -v gh) || {
  echo 'gh was not found on PATH' >&2
  exit 1
}

die_gh() {
  echo "gh $* failed" >&2
  exit 1
}

project_json=$("$gh" project view "$ProjectNumber" --owner "$Owner" --format json) || die_gh project view
projectId=$(printf '%s' "$project_json" | jq -r '.id')
if [ -z "$projectId" ] || [ "$projectId" = 'null' ]; then
  echo "Could not resolve project $ProjectNumber for owner $Owner" >&2
  exit 1
fi

fields_json=$("$gh" project field-list "$ProjectNumber" --owner "$Owner" --format json) || die_gh project field-list
field_json=$(printf '%s' "$fields_json" | jq -c '.fields[] | select(.name == "Status")')
if [ -z "$field_json" ] || [ "$field_json" = 'null' ]; then
  echo 'Status field was not found on the project' >&2
  exit 1
fi

fieldId=$(printf '%s' "$field_json" | jq -r '.id')
optionId=$(printf '%s' "$field_json" | jq -r --arg status "$Status" '.options[] | select(.name == $status) | .id')
if [ -z "$optionId" ] || [ "$optionId" = 'null' ]; then
  echo "Status '$Status' is not an option of the Status field" >&2
  exit 1
fi

# Write item-list JSON to a temp file: raw output may contain control characters.
items_file=$(mktemp)
trap 'rm -f "$items_file"' EXIT
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

if ! "$gh" project item-edit \
  --id "$itemId" \
  --project-id "$projectId" \
  --field-id "$fieldId" \
  --single-select-option-id "$optionId" >/dev/null; then
  echo "gh project item-edit failed" >&2
  exit 1
fi

echo "#$Issue -> $Status"
