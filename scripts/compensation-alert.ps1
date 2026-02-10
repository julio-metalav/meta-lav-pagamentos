$base = "http://127.0.0.1:3000"

try {
  $status = Invoke-RestMethod -Method POST -Uri "$base/api/payments/compensation/status" -ContentType "application/json" -Body "{}"
  $alert = Invoke-RestMethod -Method POST -Uri "$base/api/payments/compensation/alert" -ContentType "application/json" -Body "{}"

  if ($alert.has_alert -eq $true) {
    Write-Output ("[ALERT] mode={0} alerts={1}" -f $status.mode, ($alert.alerts | ConvertTo-Json -Compress))
    exit 2
  }

  Write-Output ("[OK] mode={0} pago={1} expirado={2} estornado={3} stale={4}" -f $status.mode, $status.payments.pago, $status.payments.expirado, $status.payments.estornado, $status.cycles.stale_aguardando_liberacao)
}
catch {
  Write-Output ("[FAIL] " + $_.Exception.Message)
  exit 1
}
