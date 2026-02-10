$base = "http://127.0.0.1:3000"

$scanBody = @{ sla_sec = 180; limit = 10 } | ConvertTo-Json
$execBody = @{ limit = 10 } | ConvertTo-Json

try {
  $scan = Invoke-RestMethod -Method POST -Uri "$base/api/payments/compensation/scan" -ContentType "application/json" -Body $scanBody
  $exec = Invoke-RestMethod -Method POST -Uri "$base/api/payments/compensation/execute" -ContentType "application/json" -Body $execBody

  Write-Output ("[OK] mode={0} scan_marked={1} exec_refunded={2} exec_skipped={3}" -f $exec.mode, $scan.marked_count, $exec.refunded_count, $exec.skipped_count)
}
catch {
  Write-Output ("[FAIL] " + $_.Exception.Message)
  exit 1
}
