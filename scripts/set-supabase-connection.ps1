$ErrorActionPreference = 'Stop'
# Separate ignored file: never overwrite the project's existing credentials.
$target = Join-Path (Split-Path $PSScriptRoot -Parent) '.env.supabase'
$entries = @()
$templates = @{}
foreach ($name in @('DATABASE_URL', 'DIRECT_URL')) {
    $secure = Read-Host "$name template (hidden; paste URI containing [YOUR-PASSWORD])" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim()
        if ($value -cnotmatch '^postgres(?:ql)?://[^:/?#\s]+:\[YOUR-PASSWORD\]@' -or
            ([regex]::Matches($value, '\[YOUR-PASSWORD\]')).Count -ne 1) {
            throw 'Use a PostgreSQL template with [YOUR-PASSWORD] in the password position. Nothing saved.'
        }
        $templates[$name] = $value
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        $secure.Dispose()
        $value = $null
    }
}
$secure = Read-Host 'Supabase database password (hidden; enter the original password, not URL-encoded)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ([string]::IsNullOrEmpty($password)) { throw 'Password cannot be empty. Nothing saved.' }
    # Preserve every password character, including leading/trailing spaces.
    $encoded = [Uri]::EscapeDataString($password)
    foreach ($name in @('DATABASE_URL', 'DIRECT_URL')) {
        $value = $templates[$name].Replace('[YOUR-PASSWORD]', $encoded)
        $uri = $null
        if (-not [Uri]::TryCreate($value, [UriKind]::Absolute, [ref]$uri) -or
            $uri.Scheme -notin @('postgres', 'postgresql') -or
            $uri.Host -notmatch '(^|\.)supabase\.(com|co)$' -or
            -not $uri.UserInfo.Contains(':') -or
            $uri.Fragment -or $uri.AbsolutePath -eq '/' -or
            $value -match '[\s"\x27]' -or $value.Contains('[YOUR-PASSWORD]')) {
            throw 'Invalid Supabase PostgreSQL template. Nothing saved.'
        }
        if ($name -eq 'DIRECT_URL' -and $uri.Port -eq 6543) {
            throw 'DIRECT_URL must use the direct connection or session pooler (5432), not transaction pooling. Nothing saved.'
        }
        $entries += ($name + '="' + $value + '"')
    }
    [IO.File]::WriteAllLines($target, $entries, (New-Object Text.UTF8Encoding($false)))
} catch {
    # Deliberately omit exception details: URI parsing/I/O exceptions may contain input.
    throw 'Setup failed. Check both Supabase templates, password, and file permissions. No credentials displayed.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    $secure.Dispose()
    $password = $null
    $encoded = $null
    $value = $null
    $uri = $null
    $entries = $null
    $templates = $null
}
Write-Host 'Supabase connections saved in ignored .env.supabase. No credentials displayed; existing .env unchanged.'
