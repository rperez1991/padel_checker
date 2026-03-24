# check_reserva.ps1
# Uso:       .\check_reserva.ps1 -FechaDesde "2026-03-04" -Pista "17" -Hora "18:30"
# Con log:   .\check_reserva.ps1 -FechaDesde "2026-03-04" -Pista "17" -Hora "18:30" -Log "reservas_log.txt"

param(
    [string]$FechaDesde = (Get-Date -Format "yyyy-MM-dd"),
    [string]$Pista = "",
    [string]$Hora  = "",
    [string]$Log   = ""
)

$BASE   = "https://reservas.fundacioncrcantabria.es"
$LOGIN  = "30479"
$PASSWD = "Bocata_16"
$UA     = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36"

$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$sess.UserAgent = $UA

$csrf    = ""
$homeReq = Invoke-WebRequest -Uri "$BASE/" -WebSession $sess -UseBasicParsing
if     ($homeReq.Content -match 'name=[''"]_csrf[''"][^>]+value=[''"]([^''"]+)[''"]') { $csrf = $Matches[1] }
elseif ($homeReq.Content -match 'value=[''"]([^''"]+)[''"][^>]+name=[''"]_csrf[''"]') { $csrf = $Matches[1] }
elseif ($homeReq.Content -match '"_csrf"\s*:\s*"([^"]{8,})"')                         { $csrf = $Matches[1] }

$loginBody = "_csrf=$([Uri]::EscapeDataString($csrf))&request_url=&login=$LOGIN&password=$([Uri]::EscapeDataString($PASSWD))"
Invoke-WebRequest -Uri "$BASE/session/create" `
    -Method POST -Body $loginBody `
    -ContentType "application/x-www-form-urlencoded" `
    -WebSession $sess -UseBasicParsing `
    -Headers @{ "Origin" = $BASE; "Referer" = "$BASE/" } | Out-Null

if (-not $Pista) { $Pista = Read-Host "Pista ID (17-22)" }
if (-not $Hora)  { $Hora  = Read-Host "Hora (ej: 10:30)" }
if ($Hora.Length -eq 4) { $Hora = "0$Hora" }

function LogEscribir([string]$texto) {
    if ($Log) { $texto | Out-File -FilePath $Log -Append -Encoding utf8 }
}

Write-Host "Monitorizando pista $Pista | hora $Hora | desde $FechaDesde" -ForegroundColor Cyan
if ($Log) { Write-Host "Log -> $Log" -ForegroundColor DarkGray }
Write-Host "(Ctrl+C para parar)`n" -ForegroundColor DarkGray
LogEscribir "=== INICIO $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | Pista $Pista | Hora $Hora ==="

function Consultar {
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $r  = Invoke-WebRequest `
        -Uri "$BASE/reservas/dia?dia=$FechaDesde&pistas=padel&days_forward=7&days_back=0&_=$ts" `
        -WebSession $sess -UseBasicParsing `
        -Headers @{ "Accept" = "*/*"; "X-Requested-With" = "XMLHttpRequest"; "Referer" = "$BASE/reservas/padel" }
    return $r.Content | ConvertFrom-Json
}

$ultimoResultado = @{}
$primeraVuelta   = $true

while ($true) {
    try {
        $reservas    = Consultar
        $fechaInicio = [DateTime]::ParseExact($FechaDesde, "yyyy-MM-dd", $null)
        $timestamp   = Get-Date -Format "HH:mm:ss"
        $lineas      = @()

        for ($i = 0; $i -le 7; $i++) {
            $fecha = $fechaInicio.AddDays($i).ToString("yyyy-MM-dd")
            $hit   = $reservas | Where-Object {
                $_.pista_id -eq [int]$Pista -and $_.fecha_desde_local -eq "$fecha $Hora"
            } | Select-Object -First 1

            $estado = if ($hit) {
                $n = $hit.name; if ($n) { "OCUPADA - $n" } else { "OCUPADA" }
            } else { "DISPONIBLE" }

            $lineas += [PSCustomObject]@{ Fecha = $fecha; Estado = $estado }
        }

        Clear-Host
        Write-Host "Pista $Pista  |  Hora $Hora  |  $timestamp  (Ctrl+C para parar)" -ForegroundColor Cyan
        Write-Host ("-" * 50) -ForegroundColor DarkGray

        foreach ($linea in $lineas) {
            $cambio = (-not $primeraVuelta) -and ($ultimoResultado[$linea.Fecha] -ne $linea.Estado)
            $color  = if ($linea.Estado -like "OCUPADA*") { "Red" } else { "Green" }
            $texto  = "[$timestamp] $($linea.Fecha) $($linea.Estado)"

            if ($primeraVuelta) {
                Write-Host "  $($linea.Fecha) $($linea.Estado)" -ForegroundColor $color
                LogEscribir $texto
            } elseif ($cambio) {
                Write-Host "* $texto  <-- CAMBIO" -ForegroundColor Yellow
                LogEscribir "$texto  <-- CAMBIO"
            } else {
                Write-Host "  $($linea.Fecha) $($linea.Estado)" -ForegroundColor $color
            }

            $ultimoResultado[$linea.Fecha] = $linea.Estado
        }

        $primeraVuelta = $false

    } catch {
        $err = "[$(Get-Date -Format 'HH:mm:ss')] ERROR: $_"
        Write-Host $err -ForegroundColor DarkGray
        LogEscribir $err
    }

    Start-Sleep -Seconds 1
}