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
.PARAMETER Restricted
    Αρχείο με τους αριθμούς στους οποίους δεν συνδέουμε κλήσεις.
    Προεπιλογή: ΠΕΡΙΟΡΙΣΜΕΝΟΙ.txt δίπλα στο script.

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
    [string]$Directory,
    [string]$Restricted
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ── Σταθερές ─────────────────────────────────────────────────────────
$DataBegin = '<!--CATALOG-DATA-BEGIN-->'
$DataEnd = '<!--CATALOG-DATA-END-->'
$BackupsToKeep = 10
$Invariant = [System.Globalization.CultureInfo]::InvariantCulture
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
# Ο φάκελος του script. Το $PSScriptRoot μπορεί να είναι κενό σε ορισμένους τρόπους
# εκτέλεσης (π.χ. από τον επεξεργαστή PowerShell), οπότε υπάρχουν εναλλακτικές.
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir -and $MyInvocation.MyCommand.Path) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ScriptDir) { $ScriptDir = (Get-Location).Path }
$RestrictedFileName = 'ΠΕΡΙΟΡΙΣΜΕΝΟΙ.txt'

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

# Τα αρχεία του φακέλου με την κατάληξη, το πιο πρόσφατο πρώτο (χωρίς αρχεία κλειδώματος).
function Get-DataFiles([string]$Folder, [string]$Extension) {
    return @(Get-ChildItem -LiteralPath $Folder -File |
            Where-Object { $_.Extension -ieq $Extension -and -not $_.Name.StartsWith('~$') -and -not $_.Name.StartsWith('.~lock') } |
            Sort-Object LastWriteTime -Descending)
}

# Το πιο πρόσφατο αρχείο· προειδοποίηση αν υπάρχουν περισσότερα.
function Select-Newest([object[]]$Files, [string]$Extension) {
    if ($Files.Count -gt 1) {
        Write-Warn "Βρέθηκαν $($Files.Count) αρχεία $Extension στον φάκελο data — χρησιμοποιείται το πιο πρόσφατο: $($Files[0].Name)"
    }
    return $Files[0].FullName
}

# Excel «Κείμενο Unicode» αποθηκεύει το DECT ως .txt, που αλλιώς θα διαβαζόταν
# ως τηλεφωνικός κατάλογος. Το αναγνωρίζουμε από τις επικεφαλίδες των στηλών του.
$DectSniffEncodings = @([System.Text.Encoding]::UTF8, [System.Text.Encoding]::Unicode, [System.Text.Encoding]::BigEndianUnicode)
foreach ($codePage in 1253, 737) {
    try { $DectSniffEncodings += [System.Text.Encoding]::GetEncoding($codePage) } catch { }
}

function Test-DectTable([string]$Path) {
    $bytes = Read-SharedBytes $Path
    $length = [Math]::Min($bytes.Length, 65536)
    foreach ($encoding in $DectSniffEncodings) {
        $text = $encoding.GetString($bytes, 0, $length)
        if ($text.Contains('ΑΡΙΘΜΟΣ') -and $text.Contains('ΟΝΟΜΑΤΕΠΩΝΥΜΟ')) { return $true }
    }
    return $false
}

# Αριθμοί στους οποίους δεν συνδέουμε κλήσεις: ο αριθμός στην αρχή κάθε γραμμής.
# Οι γραμμές που ξεκινούν με # αγνοούνται, όπως και ό,τι ακολουθεί τον αριθμό.
function Read-RestrictedNumbers([string]$Path) {
    $list = New-Object System.Collections.Generic.List[string]
    # Αν λείπει, σταματάμε: αλλιώς θα χάνονταν σιωπηλά όλες οι κόκκινες σημάνσεις.
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Δεν βρέθηκε το αρχείο $RestrictedFileName ('$Path'). Επαναφέρετέ το δίπλα στο update.cmd (αν δεν θέλετε κανέναν περιορισμένο αριθμό, αφήστε το κενό)."
    }
    # Σημειωματάριο: UTF-8, UTF-16 (με BOM) ή ANSI — τα ψηφία διαβάζονται σωστά σε όλα.
    $bytes = Read-SharedBytes $Path
    $reader = New-Object System.IO.StreamReader((New-Object System.IO.MemoryStream(, $bytes)), [System.Text.Encoding]::UTF8, $true)
    try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
    foreach ($line in ($text -split "`r`n|`r|`n")) {
        $m = [regex]::Match($line, '^\s*(\d+)')
        if ($m.Success -and -not $list.Contains($m.Groups[1].Value)) { $list.Add($m.Groups[1].Value) }
    }
    return , $list.ToArray()
}

function Find-HtmlFile {
    $default = Join-Path $ScriptDir 'katalogos.html'
    if (Test-Path -LiteralPath $default -PathType Leaf) { return $default }

    # Άλλο όνομα (π.χ. «katalogos (1).html» ή «katalogos.html.html»): η πιο πρόσφατη
    # σελίδα του φακέλου που έχει τους δείκτες δεδομένων.
    $pages = @(Get-ChildItem -LiteralPath $ScriptDir -File |
            Where-Object { $_.Extension -ieq '.html' -or $_.Extension -ieq '.htm' } |
            Sort-Object LastWriteTime -Descending)
    foreach ($f in $pages) {
        if ([System.IO.File]::ReadAllText($f.FullName).Contains($DataBegin)) {
            Write-Warn "Δεν βρέθηκε το katalogos.html — χρησιμοποιείται η σελίδα «$($f.Name)»."
            return $f.FullName
        }
    }

    $message = "Δεν βρέθηκε η σελίδα katalogos.html στον φάκελο:`n      $ScriptDir`n"
    if ($pages.Count -gt 0) {
        $message += "    Στον φάκελο υπάρχουν μόνο: $(($pages | ForEach-Object { $_.Name }) -join ', ') (χωρίς δεδομένα καταλόγου).`n"
    } else {
        $message += "    Ο φάκελος δεν περιέχει κανένα αρχείο .html.`n"
    }
    $inTemp = $env:TEMP -and $ScriptDir.StartsWith($env:TEMP, [System.StringComparison]::OrdinalIgnoreCase)
    if ($ScriptDir -match '\\Temp\d*_[^\\]*\.zip' -or $inTemp) {
        $message += "    Φαίνεται ότι εκτελείτε το update.cmd μέσα από αρχείο .zip. Κάντε πρώτα δεξί κλικ στο .zip → «Εξαγωγή όλων» και εκτελέστε το από τον φάκελο που θα δημιουργηθεί."
    } else {
        $message += "    Βάλτε το katalogos.html στον ίδιο φάκελο με το update.cmd (με αυτό ακριβώς το όνομα) και δοκιμάστε ξανά."
    }
    throw $message
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
    $dectTxt = @()
    $dirTxt = @()
    if (-not $Dect -or -not $Directory) {
        foreach ($f in (Get-DataFiles $DataDir '.txt')) {
            if (Test-DectTable $f.FullName) { $dectTxt += $f } else { $dirTxt += $f }
        }
    }
    if (-not $Dect) {
        $csvFiles = @(Get-DataFiles $DataDir '.csv')
        if ($csvFiles.Count -gt 0) {
            $Dect = Select-Newest $csvFiles '.csv'
        } elseif ($dectTxt.Count -gt 0) {
            $Dect = $dectTxt[0].FullName
            Write-Warn "Δεν βρέθηκε .csv — το DECT διαβάζεται από το «$($dectTxt[0].Name)»."
        } else {
            throw "Δεν βρέθηκε αρχείο DECT (.csv) στον φάκελο '$DataDir'."
        }
    }
    if (-not $Directory) {
        foreach ($f in $dectTxt) {
            if ($f.FullName -ne $Dect) {
                Write-Warn "Το «$($f.Name)» έχει τις στήλες του DECT (ΑΡΙΘΜΟΣ, ΟΝΟΜΑΤΕΠΩΝΥΜΟ) — δεν χρησιμοποιείται ως τηλεφωνικός κατάλογος."
            }
        }
        if ($dirTxt.Count -eq 0) {
            $message = "Δεν βρέθηκε αρχείο καταλόγου (.txt) στον φάκελο '$DataDir'."
            if ($dectTxt.Count -gt 0) {
                $message += "`n    Τα αρχεία .txt του φακέλου είναι εξαγωγές του DECT. Αποθηκεύστε τον κατάλογο από το Word ως «Απλό κείμενο» (.txt)."
            }
            throw $message
        }
        $Directory = Select-Newest $dirTxt '.txt'
    }
    $Dect = (Resolve-Path -LiteralPath $Dect).Path
    $Directory = (Resolve-Path -LiteralPath $Directory).Path
    if (-not $Restricted) { $Restricted = Join-Path $ScriptDir $RestrictedFileName }

    Write-Host "Σελίδα:     $Html"
    Write-Host "DECT:       $Dect"
    Write-Host "Κατάλογος:  $Directory"
    Write-Host "Περιορ.:    $Restricted"
    Write-Host ''

    $page = [System.IO.File]::ReadAllText($Html, [System.Text.Encoding]::UTF8)
    $begin = $page.IndexOf($DataBegin)
    $end = $page.IndexOf($DataEnd)
    if ($begin -lt 0 -or $end -lt $begin) { throw "Η σελίδα '$Html' δεν περιέχει τους δείκτες δεδομένων." }

    $dectSource = ConvertTo-SourceJson $Dect
    Write-Ok ("DECT: {0:N0} bytes" -f $dectSource.size)
    $dirSource = ConvertTo-SourceJson $Directory
    Write-Ok ("Κατάλογος: {0:N0} bytes" -f $dirSource.size)

    $restrictedNumbers = Read-RestrictedNumbers $Restricted
    Write-Ok "Περιορισμένοι αριθμοί («Μη συνδέετε»): $($restrictedNumbers.Length)"
    $restrictedJson = '[' + (($restrictedNumbers | ForEach-Object { ConvertTo-JsonText ([string]$_) }) -join ',') + ']'
    $json = '{"schema":2' +
        ',"generatedAt":' + (ConvertTo-JsonText (Get-IsoDate (Get-Date))) +
        ',"generator":' + (ConvertTo-JsonText ('update.ps1 / PowerShell ' + $PSVersionTable.PSVersion.ToString())) +
        ',"dect":' + $dectSource.json +
        ',"directory":' + $dirSource.json +
        ',"restricted":' + $restrictedJson + '}'

    $block = $DataBegin + '<script id="catalog-data" type="application/json">' + $json + '</script>' + $DataEnd
    $newPage = $page.Substring(0, $begin) + $block + $page.Substring($end + $DataEnd.Length)

    $tmp = $Html + '.tmp'
    try {
        # Αντίγραφο ασφαλείας (κρατούνται τα $BackupsToKeep πιο πρόσφατα)
        $backupDir = Join-Path (Split-Path -Parent $Html) 'backup'
        if (-not (Test-Path -LiteralPath $backupDir)) { [void](New-Item -ItemType Directory -Path $backupDir) }
        $stamp = (Get-Date).ToString('yyyyMMdd_HHmmss', $Invariant)
        $backup = Join-Path $backupDir ([System.IO.Path]::GetFileNameWithoutExtension($Html) + "_$stamp.html")
        Copy-Item -LiteralPath $Html -Destination $backup
        Get-ChildItem -LiteralPath $backupDir -Filter '*.html' -File | Sort-Object LastWriteTime -Descending |
            Select-Object -Skip $BackupsToKeep | Remove-Item -Force

        # Ασφαλής εγγραφή: πρώτα σε προσωρινό αρχείο και μετά αντικατάσταση.
        [System.IO.File]::WriteAllText($tmp, $newPage, $Utf8NoBom)
        [System.IO.File]::Copy($tmp, $Html, $true)
    } catch {
        $reason = $_.Exception.Message
        if ($_.Exception.InnerException) { $reason = $_.Exception.InnerException.Message }
        throw "Δεν ήταν δυνατή η αποθήκευση της σελίδας '$Html'.`n" +
            "    Ελέγξτε ότι το αρχείο δεν είναι «Μόνο για ανάγνωση» (δεξί κλικ → Ιδιότητες) και ότι ο φάκελος επιτρέπει αλλαγές`n" +
            "    (όχι CD/USB μόνο για ανάγνωση ή κοινόχρηστος φάκελος χωρίς δικαίωμα εγγραφής). ($reason)"
    } finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }

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
