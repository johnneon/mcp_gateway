param(
    [Parameter(Mandatory = $true)][int]$Issue
)

$ErrorActionPreference = 'Stop'

$Owner = 'johnneon'
$ProjectNumber = 2
$Repo = 'johnneon/mcp_gateway'

$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe' }

function Invoke-GhJson {
    $output = & $gh @args
    if ($LASTEXITCODE -ne 0) { throw "gh $($args -join ' ') failed with exit code $LASTEXITCODE" }
    ($output -join "`n") | ConvertFrom-Json
}

$projectId = (Invoke-GhJson project view $ProjectNumber --owner $Owner --format json).id

$item = (Invoke-GhJson project item-list $ProjectNumber --owner $Owner --format json --limit 1000).items |
    Where-Object { $_.content.number -eq $Issue -and $_.content.repository -eq $Repo }
if (-not $item) { throw "Issue #$Issue of $Repo is not on project $ProjectNumber" }

$queryFile = New-TemporaryFile
$payload = @{
    query     = 'query($login: String!, $number: Int!) { user(login: $login) { projectV2(number: $number) { field(name: "Iteration") { ... on ProjectV2IterationField { id configuration { iterations { id title startDate duration } } } } } } }'
    variables = @{ login = $Owner; number = $ProjectNumber }
}
[IO.File]::WriteAllText($queryFile, ($payload | ConvertTo-Json -Compress -Depth 4))
try {
    $raw = & $gh api graphql --input $queryFile
    if ($LASTEXITCODE -ne 0) { throw "gh api graphql failed with exit code $LASTEXITCODE" }
}
finally {
    Remove-Item $queryFile
}

$data = ($raw -join "`n") | ConvertFrom-Json
$field = $data.data.user.projectV2.field
if (-not $field.id) { throw 'Iteration field was not found on the project' }

$today = (Get-Date).Date
$current = $null
foreach ($iteration in $field.configuration.iterations) {
    $start = [datetime]::ParseExact($iteration.startDate, 'yyyy-MM-dd', [cultureinfo]::InvariantCulture)
    $end = $start.AddDays([int]$iteration.duration)
    if ($today -ge $start -and $today -lt $end) {
        if (-not $current -or $start -gt $current.Start) {
            $current = [pscustomobject]@{ Id = $iteration.id; Title = $iteration.title; Start = $start }
        }
    }
}
if (-not $current) {
    throw "No current iteration covers $($today.ToString('yyyy-MM-dd')). Create one on the Task tracker board."
}

& $gh project item-edit --id $item.id --project-id $projectId --field-id $field.id --iteration-id $current.Id | Out-Null
if ($LASTEXITCODE -ne 0) { throw "gh project item-edit failed with exit code $LASTEXITCODE" }

"#$Issue -> $($current.Title)"
