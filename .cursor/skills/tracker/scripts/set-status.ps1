param(
    [Parameter(Mandatory = $true)][int]$Issue,
    [Parameter(Mandatory = $true)][string]$Status
)

$ErrorActionPreference = 'Stop'

$Owner = 'johnneon'
$ProjectNumber = 2
$Repo = 'johnneon/mcp_gateway'

$allowedStatuses = @('Backlog', 'Ready', 'In progress', 'In review', 'Done')
if ($allowedStatuses -notcontains $Status) {
    throw "Status '$Status' is not an option of the Status field"
}

$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe' }

function Invoke-GhJson {
    $output = & $gh @args
    if ($LASTEXITCODE -ne 0) { throw "gh $($args -join ' ') failed with exit code $LASTEXITCODE" }
    ($output -join "`n") | ConvertFrom-Json
}

$projectId = (Invoke-GhJson project view $ProjectNumber --owner $Owner --format json).id
$field = (Invoke-GhJson project field-list $ProjectNumber --owner $Owner --format json).fields |
    Where-Object { $_.name -eq 'Status' }
$option = $field.options | Where-Object { $_.name -eq $Status }
if (-not $option) { throw "Status '$Status' is not an option of the Status field" }

$item = (Invoke-GhJson project item-list $ProjectNumber --owner $Owner --format json --limit 1000).items |
    Where-Object { $_.content.number -eq $Issue -and $_.content.repository -eq $Repo }
if (-not $item) { throw "Issue #$Issue of $Repo is not on project $ProjectNumber" }

& $gh project item-edit --id $item.id --project-id $projectId --field-id $field.id --single-select-option-id $option.id | Out-Null
if ($LASTEXITCODE -ne 0) { throw "gh project item-edit failed with exit code $LASTEXITCODE" }

"#$Issue -> $Status"
