param(
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [Parameter(Mandatory = $true)][int]$Width,
  [Parameter(Mandatory = $true)][int]$Height,
  [Parameter(Mandatory = $true)][string]$Out
)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $Width, $Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
  $g.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size $Width, $Height))
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $g.Dispose()
  $bmp.Dispose()
}
