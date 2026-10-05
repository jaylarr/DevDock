param([Parameter(Mandatory=$true)][string]$DataDirectory)
# Observe folders and numeric history IDs only; no commands or output are collected.
if ($global:DevDockPromptInstalled) { return }
$global:DevDockPromptInstalled = $true
$global:DevDockActivityDirectory = $DataDirectory
$global:DevDockPreviousPrompt = $function:prompt
$global:DevDockActivitySession = [Guid]::NewGuid().ToString()
$global:DevDockActivityLastPath = ''
$global:DevDockActivityLastHistory = -1
$global:DevDockActivityAt = [DateTime]::UtcNow.ToString('o')
$global:DevDockOwnerStartedAt = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
function global:Send-DevDockActivity {
  try {
    $policyPath = Join-Path $global:DevDockActivityDirectory 'policy.json'
    if (!(Test-Path -LiteralPath $policyPath) -or !(Get-Content -LiteralPath $policyPath -Raw | ConvertFrom-Json).enabled) { return }
    if ($PWD.Provider.Name -ne 'FileSystem') { return }
    $currentPath = $PWD.Path
    $history = Get-History -Count 1
    $historyId = if ($history) { $history.Id } else { 0 }
    if ($currentPath -ne $global:DevDockActivityLastPath -or $historyId -ne $global:DevDockActivityLastHistory) {
      $global:DevDockActivityAt = [DateTime]::UtcNow.ToString('o')
      $global:DevDockActivityLastPath = $currentPath
      $global:DevDockActivityLastHistory = $historyId
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $session = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes('terminal:' + $global:DevDockActivitySession)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    $reports = Join-Path $global:DevDockActivityDirectory 'reports'
    [IO.Directory]::CreateDirectory($reports) | Out-Null
    $file = Join-Path $reports ($session + '.json')
    $temporary = $file + '.' + [Guid]::NewGuid().ToString() + '.tmp'
    $report = @{ version=1; source='terminal'; session=$session; pid=$PID; ownerStartedAt=$global:DevDockOwnerStartedAt; seenAt=[DateTime]::UtcNow.ToString('o'); state='open'; folders=@(@{path=$currentPath;activityAt=$global:DevDockActivityAt}) }
    [IO.File]::WriteAllText($temporary, ($report | ConvertTo-Json -Compress -Depth 5), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $file -Force
  } catch { }
}
function global:prompt {
  try { if ($global:DevDockPreviousPrompt) { & $global:DevDockPreviousPrompt } else { 'PS ' + $PWD.Path + '> ' } }
  finally { Send-DevDockActivity }
}
Send-DevDockActivity
