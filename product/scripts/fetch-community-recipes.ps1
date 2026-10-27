# Opt-in editorial research only. Uses official development endpoints, no artwork.
$ErrorActionPreference = 'Stop'
$pixelProduct = Split-Path $PSScriptRoot -Parent
$pixelCache = Join-Path $pixelProduct '.tools/catalog-research'
New-Item -ItemType Directory -Force -Path $pixelCache | Out-Null
$pixelIds = Get-Content (Join-Path $pixelProduct 'data/catalog/community-shortlist.json') -Raw | ConvertFrom-Json
$pixelReplacementPath = Join-Path $pixelProduct 'data/catalog/community-editorial-replacements.json'
if (Test-Path -LiteralPath $pixelReplacementPath) {
    $pixelReplacementIds = (Get-Content $pixelReplacementPath -Raw | ConvertFrom-Json).PSObject.Properties.Name
    $pixelIds = @($pixelIds) + @($pixelReplacementIds | Where-Object { $_ -notin $pixelIds })
}
$pixelSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$pixelDone = 0
foreach ($pixelId in $pixelIds) {
    $pixelPath = Join-Path $pixelCache "$pixelId.json"
    if (Test-Path -LiteralPath $pixelPath) {
        $pixelExisting = Get-Content -LiteralPath $pixelPath -Raw | ConvertFrom-Json -Depth 30
        if ($pixelExisting.record.idDrink -eq $pixelId) { $pixelDone++; continue }
    }
    $pixelUrl = "https://www.thecocktaildb.com/api/json/v1/1/lookup.php?i=$pixelId"
    $pixelRecord = $null
    for ($pixelAttempt = 0; $pixelAttempt -lt 3; $pixelAttempt++) {
        try {
            $pixelResponse = Invoke-WebRequest -Uri $pixelUrl -WebSession $pixelSession -TimeoutSec 20
            $pixelBytes = $pixelResponse.RawContentStream.ToArray()
            $pixelDrink = ($pixelResponse.Content | ConvertFrom-Json -Depth 30).drinks
            if (@($pixelDrink).Count -ne 1 -or $pixelDrink[0].idDrink -ne $pixelId) { throw "No unique drink record for $pixelId" }
            $pixelSource = $pixelDrink[0]
            $pixelRecord = [ordered]@{}
            foreach ($pixelField in @('idDrink','strDrink','strCategory','strAlcoholic','strGlass','strInstructions','dateModified','strIBA','strCreativeCommonsConfirmed')) {
                $pixelRecord[$pixelField] = $pixelSource.$pixelField
            }
            $pixelParts = @()
            for ($pixelSlot = 1; $pixelSlot -le 15; $pixelSlot++) {
                $pixelIngredient = $pixelSource."strIngredient$pixelSlot"
                if ($pixelIngredient) { $pixelParts += @{ingredient=$pixelIngredient;measure=$pixelSource."strMeasure$pixelSlot"} }
            }
            $pixelRecord.ingredients = $pixelParts
            $pixelEvidence = [ordered]@{
                lookup_url=$pixelUrl; detail_url="https://www.thecocktaildb.com/drink/$pixelId";
                retrieved_at=[DateTimeOffset]::UtcNow.ToString('o');
                response_sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($pixelBytes)).ToLowerInvariant();
                publisher='TheCocktailDB'; copyright_notice='© 2026 TheCocktailDB'; record=$pixelRecord
            }
            $pixelEvidence | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $pixelPath -Encoding utf8
            break
        } catch {
            $pixelStatus = $_.Exception.Response.StatusCode.value__
            if ($pixelStatus -in @(401,403,429) -or $pixelAttempt -eq 2) { throw }
            Start-Sleep -Milliseconds 500
        }
    }
    $pixelDone++
    if ($pixelDone % 10 -eq 0 -or $pixelDone -eq $pixelIds.Count) { Write-Output "$pixelDone/$($pixelIds.Count) official source lookups cached" }
    Start-Sleep -Milliseconds 150
}
