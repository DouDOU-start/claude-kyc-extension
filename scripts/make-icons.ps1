[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$output = Join-Path $repoRoot "extension\icons"
New-Item -ItemType Directory -Force -Path $output | Out-Null
Add-Type -AssemblyName System.Drawing

function New-RoundedPath {
  param([float]$Width, [float]$Height, [float]$Radius)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2
  $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
  $path.AddArc($Width - $diameter, 0, $diameter, $diameter, 270, 90)
  $path.AddArc($Width - $diameter, $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc(0, $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

foreach ($size in 16, 32, 48, 128) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $background = New-RoundedPath $size $size ($size * 0.23)
  $backgroundBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 189, 91, 58))
  $graphics.FillPath($backgroundBrush, $background)

  $scale = $size / 128.0
  $points = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(64 * $scale, 24 * $scale),
    [System.Drawing.PointF]::new(101 * $scale, 38 * $scale),
    [System.Drawing.PointF]::new(101 * $scale, 65 * $scale),
    [System.Drawing.PointF]::new(99 * $scale, 79 * $scale),
    [System.Drawing.PointF]::new(91 * $scale, 92 * $scale),
    [System.Drawing.PointF]::new(64 * $scale, 105 * $scale),
    [System.Drawing.PointF]::new(37 * $scale, 92 * $scale),
    [System.Drawing.PointF]::new(29 * $scale, 79 * $scale),
    [System.Drawing.PointF]::new(27 * $scale, 65 * $scale),
    [System.Drawing.PointF]::new(27 * $scale, 38 * $scale)
  )
  $shield = New-Object System.Drawing.Drawing2D.GraphicsPath
  $shield.AddPolygon($points)
  $shieldPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 255, 248, 241), [Math]::Max(1.4, 5.5 * $scale))
  $shieldPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawPath($shieldPen, $shield)

  $check = New-Object System.Drawing.Drawing2D.GraphicsPath
  $check.AddLine(44 * $scale, 66 * $scale, 58 * $scale, 79 * $scale)
  $check.AddLine(58 * $scale, 79 * $scale, 85 * $scale, 49 * $scale)
  $checkPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 255, 248, 241), [Math]::Max(1.6, 7 * $scale))
  $checkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $checkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $checkPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawPath($checkPen, $check)

  $bitmap.Save((Join-Path $output ("icon-{0}.png" -f $size)), [System.Drawing.Imaging.ImageFormat]::Png)

  $checkPen.Dispose()
  $check.Dispose()
  $shieldPen.Dispose()
  $shield.Dispose()
  $backgroundBrush.Dispose()
  $background.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
