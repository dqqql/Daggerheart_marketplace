param(
  [Parameter(Mandatory = $true)]
  [string]$EntriesJson,

  [Parameter(Mandatory = $true)]
  [Alias("ZipPath")]
  [string]$ArchivePath,

  [string]$BucketName = "the-great-vault-covers",

  [string]$StartAt = "",

  [int]$RetryCount = 3,

  [switch]$Upload
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $EntriesJson -PathType Leaf)) {
  throw "Entries JSON not found: $EntriesJson"
}
if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
  throw "Cover archive not found: $ArchivePath"
}

$json = Get-Content -LiteralPath $EntriesJson -Raw -Encoding UTF8 | ConvertFrom-Json
$entries = if ($json.entries) { $json.entries } else { $json }
if (-not $entries) {
  throw "No entries found in $EntriesJson"
}

$referenced = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($entry in $entries) {
  $coverPath = [string]$entry.coverPath
  if ([string]::IsNullOrWhiteSpace($coverPath)) { continue }
  $name = Split-Path -Leaf ([Uri]::UnescapeDataString($coverPath))
  if (-not [string]::IsNullOrWhiteSpace($name)) {
    [void]$referenced.Add($name)
  }
}

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("dhm_covers_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
  $extension = [System.IO.Path]::GetExtension($ArchivePath).ToLowerInvariant()
  if ($extension -eq ".zip") {
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $tempDir -Force
  } elseif ($extension -eq ".rar") {
    & tar -xf $ArchivePath -C $tempDir
    if ($LASTEXITCODE -ne 0) {
      throw "tar failed while extracting $ArchivePath"
    }
  } else {
    throw "Unsupported cover archive type: $extension"
  }
  $files = Get-ChildItem -LiteralPath $tempDir -Recurse -File
  $byName = @{}
  foreach ($file in $files) {
    if (-not $byName.ContainsKey($file.Name)) {
      $byName[$file.Name] = $file.FullName
    }
  }

  $missing = @()
  $uploaded = 0
  $skippedBeforeStart = 0
  $started = [string]::IsNullOrWhiteSpace($StartAt)
  foreach ($name in ($referenced | Sort-Object)) {
    if (-not $started) {
      if ([string]::Equals($name, $StartAt, [System.StringComparison]::OrdinalIgnoreCase)) {
        $started = $true
      } else {
        $skippedBeforeStart += 1
        continue
      }
    }
    if (-not $byName.ContainsKey($name)) {
      $missing += $name
      continue
    }
    $localPath = $byName[$name]
    $objectName = "$BucketName/covers/$name"
    if ($Upload) {
      $attempt = 0
      do {
        $attempt += 1
        & npx wrangler r2 object put $objectName --file $localPath --remote --content-type "image/webp" --cache-control "public, max-age=31536000, immutable"
        if ($LASTEXITCODE -eq 0) {
          break
        }
        if ($attempt -lt $RetryCount) {
          Write-Warning "Upload failed for $name; retrying ($attempt/$RetryCount)..."
          Start-Sleep -Seconds ([Math]::Min(10, 2 * $attempt))
        }
      } while ($attempt -lt $RetryCount)

      if ($LASTEXITCODE -ne 0) {
        throw "wrangler failed while uploading $name after $RetryCount attempt(s)"
      }
    } else {
      Write-Host "[dry-run] $localPath -> r2://$objectName"
    }
    $uploaded += 1
  }

  $extra = $files | Where-Object { -not $referenced.Contains($_.Name) } | Select-Object -ExpandProperty Name -Unique | Sort-Object

  Write-Host ""
  Write-Host "Referenced covers: $($referenced.Count)"
  Write-Host "Matched covers: $uploaded"
  if ($skippedBeforeStart -gt 0) {
    Write-Host "Skipped before StartAt: $skippedBeforeStart"
  }
  Write-Host "Missing covers: $($missing.Count)"
  Write-Host "Extra files in zip: $($extra.Count)"

  if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "Missing:"
    $missing | ForEach-Object { Write-Host "  $_" }
  }

  if ($extra.Count -gt 0) {
    Write-Host ""
    Write-Host "Extra sample:"
    $extra | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }
  }

  if (-not $Upload) {
    Write-Host ""
    Write-Host "Dry run only. Re-run with -Upload to upload to R2."
  }
}
finally {
  if (Test-Path -LiteralPath $tempDir) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force
  }
}
