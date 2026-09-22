$ErrorActionPreference = 'Stop'
$first = Read-Host 'Initial password for adel (at least 12 characters; hidden)' -AsSecureString
$second = Read-Host 'Confirm password (hidden)' -AsSecureString
$firstPtr = [IntPtr]::Zero
$secondPtr = [IntPtr]::Zero
try {
    $firstPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
    $secondPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
    $payload = @{
        password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPtr)
        confirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPtr)
    } | ConvertTo-Json -Compress
    Push-Location (Split-Path -Parent $PSScriptRoot)
    try {
        # Private stdin only: no password in command arguments, environment, or files.
        $payload | node --import tsx scripts/prepare-super-admin.ts
        if ($LASTEXITCODE -ne 0) { throw 'Password preparation failed. No account was created.' }
        $privateFile = Join-Path (Get-Location) '.test-tools/super-admin-setup/credential.json'
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls.exe $privateFile /inheritance:r /grant:r "${identity}:(F)" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Remove-Item -LiteralPath $privateFile -Force
            throw 'Could not restrict file permissions. Prepared hash removed.'
        }
        Write-Host 'Password hash prepared privately for adel. No account created; no production change.'
    } finally { Pop-Location }
} finally {
    $payload = $null
    if ($firstPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPtr) }
    if ($secondPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPtr) }
    $first.Dispose()
    $second.Dispose()
}
