<#
.SYNOPSIS
    Ενημερώνει τα δεδομένα του katalogos.html από τα αρχεία του φακέλου data\:
      - το αρχείο DECT σε μορφή .csv
      - τον τηλεφωνικό κατάλογο σε μορφή .txt

.DESCRIPTION
    Το script ΔΕΝ επεξεργάζεται τα δεδομένα. Ενσωματώνει τα δύο αρχεία
    αυτούσια (byte προς byte, σε base64) στο τμήμα δεδομένων της σελίδας,
    ανάμεσα στους δείκτες CATALOG-DATA-BEGIN / CATALOG-DATA-END.
    Η αναγνώριση κωδικοποίησης (UTF-8, UTF-16, Windows-1253) και η ανάλυση
    γίνονται από την ίδια τη σελίδα όταν ανοίγει.

    Πριν από κάθε αλλαγή κρατείται αντίγραφο ασφαλείας στον φάκελο backup\.
    Λειτουργεί με Windows PowerShell 5.1 (υπάρχει σε όλα τα Windows 10/11).

.PARAMETER Html
    Η σελίδα προς ενημέρωση. Προεπιλογή: katalogos.html δίπλα στο script.
.PARAMETER DataDir
    Φάκελος με τα αρχεία δεδομένων. Προεπιλογή: data\ δίπλα στο script.
.PARAMETER Dect
    Συγκεκριμένο αρχείο DECT (.csv) αντί για αυτόματη αναζήτηση στο DataDir.
.PARAMETER Directory
    Συγκεκριμένο αρχείο καταλόγου (.txt) αντί για αυτόματη αναζήτηση στο DataDir.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File update.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File update.ps1 -Dect "D:\DECT ΑΠΟΓΡΑΦΗ.csv"
#>
[CmdletBinding()]
param(
    [string]$Html,
    [string]$DataDir,
    [string]$Dect,
    [string]$Directory
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ── Περιορισμένοι αριθμοί ────────────────────────────────────────────
# Αριθμοί στους οποίους ΔΕΝ συνδέουμε κλήσεις (εμφανίζονται με κόκκινη απόχρωση).
# Προσωρινή λίστα· θα αντικατασταθεί από ανάγνωση του αρχείου DECT.
$RestrictedNumbers = @("3995", "3955", "3953", "3738", "3974", "3780", "3808", "3535", "3915", "1745", "3997", "3598")

# ── Σταθερές ─────────────────────────────────────────────────────────
$DataBegin = '<!--CATALOG-DATA-BEGIN-->'
$DataEnd = '<!--CATALOG-DATA-END-->'
$BackupsToKeep = 10
$Invariant = [System.Globalization.CultureInfo]::InvariantCulture
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$ScriptDir = $PSScriptRoot

function Write-Ok([string]$Message) { Write-Host "  ✓ $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "  ! $Message" -ForegroundColor Yellow }

# JSON string literal. Τα < > & διαφεύγουν ώστε να είναι ασφαλές μέσα σε <script>.
$JsonEscapeRegex = New-Object System.Text.RegularExpressions.Regex '[\x00-\x1F"\\<>&\u2028\u2029]'
$JsonEscapeEvaluator = [System.Text.RegularExpressions.MatchEvaluator] {
    param($m)
    $c = [int][char]$m.Value
    switch ($c) {
        34 { return '\"' }
        92 { return '\\' }
        10 { return '\n' }
        13 { return '\r' }
        9 { return '\t' }
        default { return ('\u{0:x4}' -f $c) }
    }
}

function ConvertTo-JsonText([string]$Text) {
    if ($null -eq $Text) { $Text = '' }
    return '"' + $JsonEscapeRegex.Replace($Text, $JsonEscapeEvaluator) + '"'
}

function Get-IsoDate([datetime]$Date) {
    return $Date.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $Invariant)
}

# Διαβάζει το αρχείο ακόμη κι αν είναι ανοιχτό σε Excel/Word/Σημειωματάριο.
function Read-SharedBytes([string]$Path) {
    try {
        $stream = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
        try {
            $buffer = New-Object System.IO.MemoryStream
            $stream.CopyTo($buffer)
            return , $buffer.ToArray()
        } finally { $stream.Dispose() }
    } catch {
        throw "Δεν ήταν δυνατή η ανάγνωση του '$Path'. Κλείστε το αρχείο αν είναι ανοιχτό και δοκιμάστε ξανά. ($($_.Exception.Message))"
    }
}

# { "file", "modified", "base64" } για ένα αρχείο προέλευσης.
function ConvertTo-SourceJson([string]$Path) {
    $item = Get-Item -LiteralPath $Path
    $bytes = Read-SharedBytes $Path
    if ($bytes.Length -eq 0) { throw "Το αρχείο '$Path' είναι κενό." }
    $json = '{"file":' + (ConvertTo-JsonText $item.Name) +
        ',"modified":' + (ConvertTo-JsonText (Get-IsoDate $item.LastWriteTime)) +
        ',"base64":"' + [System.Convert]::ToBase64String($bytes) + '"}'
    return @{ json = $json; size = $bytes.Length }
}

# Το πιο πρόσφατο αρχείο με την κατάληξη· προειδοποίηση αν υπάρχουν περισσότερα.
function Find-DataFile([string]$Folder, [string]$Extension, [string]$What) {
    $files = @(Get-ChildItem -LiteralPath $Folder -File |
            Where-Object { $_.Extension -ieq $Extension -and -not $_.Name.StartsWith('~$') -and -not $_.Name.StartsWith('.~lock') } |
            Sort-Object LastWriteTime -Descending)
    if ($files.Count -eq 0) {
        throw "Δεν βρέθηκε αρχείο $What ($Extension) στον φάκελο '$Folder'."
    }
    if ($files.Count -gt 1) {
        Write-Warn "Βρέθηκαν $($files.Count) αρχεία $Extension στον φάκελο data — χρησιμοποιείται το πιο πρόσφατο: $($files[0].Name)"
    }
    return $files[0].FullName
}

function Find-HtmlFile {
    $default = Join-Path $ScriptDir 'katalogos.html'
    if (Test-Path -LiteralPath $default) { return $default }
    foreach ($f in (Get-ChildItem -LiteralPath $ScriptDir -Filter '*.html' -File)) {
        if ([System.IO.File]::ReadAllText($f.FullName).Contains($DataBegin)) { return $f.FullName }
    }
    throw "Δεν βρέθηκε η σελίδα katalogos.html δίπλα στο script ('$ScriptDir')."
}

# ── Κύρια ροή ────────────────────────────────────────────────────────

$exitCode = 1
try {
    Write-Host ''
    Write-Host 'Ενημέρωση τηλεφωνικού καταλόγου' -ForegroundColor Cyan
    Write-Host ''

    if (-not $Html) { $Html = Find-HtmlFile }
    $Html = (Resolve-Path -LiteralPath $Html).Path
    if (-not $DataDir) { $DataDir = Join-Path $ScriptDir 'data' }
    if (-not $Dect -or -not $Directory) {
        if (-not (Test-Path -LiteralPath $DataDir -PathType Container)) {
            throw "Δεν βρέθηκε ο φάκελος δεδομένων '$DataDir'."
        }
    }
    if (-not $Dect) { $Dect = Find-DataFile $DataDir '.csv' 'DECT' }
    if (-not $Directory) { $Directory = Find-DataFile $DataDir '.txt' 'καταλόγου' }
    $Dect = (Resolve-Path -LiteralPath $Dect).Path
    $Directory = (Resolve-Path -LiteralPath $Directory).Path

    Write-Host "Σελίδα:     $Html"
    Write-Host "DECT:       $Dect"
    Write-Host "Κατάλογος:  $Directory"
    Write-Host ''

    $page = [System.IO.File]::ReadAllText($Html, [System.Text.Encoding]::UTF8)
    $begin = $page.IndexOf($DataBegin)
    $end = $page.IndexOf($DataEnd)
    if ($begin -lt 0 -or $end -lt $begin) { throw "Η σελίδα '$Html' δεν περιέχει τους δείκτες δεδομένων." }

    $dectSource = ConvertTo-SourceJson $Dect
    Write-Ok ("DECT: {0:N0} bytes" -f $dectSource.size)
    $dirSource = ConvertTo-SourceJson $Directory
    Write-Ok ("Κατάλογος: {0:N0} bytes" -f $dirSource.size)

    $restrictedJson = '[' + (($RestrictedNumbers | ForEach-Object { ConvertTo-JsonText ([string]$_) }) -join ',') + ']'
    $json = '{"schema":2' +
        ',"generatedAt":' + (ConvertTo-JsonText (Get-IsoDate (Get-Date))) +
        ',"generator":' + (ConvertTo-JsonText ('update.ps1 / PowerShell ' + $PSVersionTable.PSVersion.ToString())) +
        ',"dect":' + $dectSource.json +
        ',"directory":' + $dirSource.json +
        ',"restricted":' + $restrictedJson + '}'

    $block = $DataBegin + '<script id="catalog-data" type="application/json">' + $json + '</script>' + $DataEnd
    $newPage = $page.Substring(0, $begin) + $block + $page.Substring($end + $DataEnd.Length)

    # Αντίγραφο ασφαλείας (κρατούνται τα $BackupsToKeep πιο πρόσφατα)
    $backupDir = Join-Path (Split-Path -Parent $Html) 'backup'
    if (-not (Test-Path -LiteralPath $backupDir)) { [void](New-Item -ItemType Directory -Path $backupDir) }
    $stamp = (Get-Date).ToString('yyyyMMdd_HHmmss', $Invariant)
    $backup = Join-Path $backupDir ([System.IO.Path]::GetFileNameWithoutExtension($Html) + "_$stamp.html")
    Copy-Item -LiteralPath $Html -Destination $backup
    Get-ChildItem -LiteralPath $backupDir -Filter '*.html' -File | Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $BackupsToKeep | Remove-Item -Force

    # Ασφαλής εγγραφή: πρώτα σε προσωρινό αρχείο και μετά αντικατάσταση.
    $tmp = $Html + '.tmp'
    [System.IO.File]::WriteAllText($tmp, $newPage, $Utf8NoBom)
    [System.IO.File]::Copy($tmp, $Html, $true)
    Remove-Item -LiteralPath $tmp -Force

    Write-Host ''
    Write-Ok "Η σελίδα ενημερώθηκε. Αντίγραφο ασφαλείας: $backup"
    Write-Host '    Ανοίξτε τη σελίδα και ελέγξτε την ημερομηνία «Τελευταία ενημέρωση» κάτω από τον τίτλο.'
    $exitCode = 0
} catch {
    Write-Host ''
    Write-Host "  ✗ Σφάλμα: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host '    Η σελίδα ΔΕΝ τροποποιήθηκε.' -ForegroundColor Red
}
exit $exitCode
