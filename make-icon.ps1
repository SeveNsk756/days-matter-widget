Add-Type -AssemblyName System.Drawing

# 图标输出到仓库内的 assets/，与项目位置无关
$outDir = Join-Path $PSScriptRoot "assets"
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

function New-RoundRect([double]$x, [double]$y, [double]$w, [double]$h, [double]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc([float]$x, [float]$y, [float]$d, [float]$d, 180, 90)
    $path.AddArc([float]($x + $w - $d), [float]$y, [float]$d, [float]$d, 270, 90)
    $path.AddArc([float]($x + $w - $d), [float]($y + $h - $d), [float]$d, [float]$d, 0, 90)
    $path.AddArc([float]$x, [float]($y + $h - $d), [float]$d, [float]$d, 90, 90)
    $path.CloseFigure()
    return $path
}

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

# 底板：深色圆角方块 + 渐变
$pad = 8.0
$side = $size - 2 * $pad
$path = New-RoundRect $pad $pad $side $side 54
$rect = New-Object System.Drawing.Rectangle([int]$pad, [int]$pad, [int]$side, [int]$side)
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 46, 56, 92),
    [System.Drawing.Color]::FromArgb(255, 13, 16, 27),
    115.0)
$g.FillPath($bgBrush, $path)
$bgBrush.Dispose()

# 顶部内高光
$specPath = New-RoundRect ($pad + 1) ($pad + 1) ($side - 2) ($side - 2) 53
$specPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(46, 255, 255, 255), 1.4)
$g.DrawPath($specPen, $specPath)
$specPen.Dispose()
$specPath.Dispose()

# 中间渐变圆环
$ringRect = New-Object System.Drawing.Rectangle(56, 56, 144, 144)
$ringBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $ringRect,
    [System.Drawing.Color]::FromArgb(255, 158, 216, 255),
    [System.Drawing.Color]::FromArgb(255, 60, 128, 255),
    60.0)
$ringPen = New-Object System.Drawing.Pen($ringBrush, 20.0)
$ringPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$ringPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawEllipse($ringPen, $ringRect)
$ringPen.Dispose()
$ringBrush.Dispose()

# 环心亮点
$coreRect = New-Object System.Drawing.Rectangle(112, 112, 32, 32)
$coreBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $coreRect,
    [System.Drawing.Color]::FromArgb(255, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(220, 140, 200, 255),
    90.0)
$g.FillEllipse($coreBrush, $coreRect)
$coreBrush.Dispose()

$g.Dispose()

$pngPath = Join-Path $outDir "icon.png"
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# 生成 256x256 的 ICO（PNG 压缩格式，Vista+ 支持）
$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$icoBytes = New-Object System.Collections.Generic.List[byte]
$icoBytes.AddRange([byte[]](0, 0, 1, 0, 1, 0))          # ICONDIR: reserved, type=1, count=1
$icoBytes.AddRange([byte[]](0, 0, 0, 0, 1, 0, 32, 0))    # 宽高 0(=256), 调色盘 0, reserved, planes=1, bpp=32
$icoBytes.AddRange([BitConverter]::GetBytes([int]$pngBytes.Length))
$icoBytes.AddRange([BitConverter]::GetBytes([int]22))
$icoBytes.AddRange($pngBytes)

$icoPath = Join-Path $outDir "icon.ico"
[System.IO.File]::WriteAllBytes($icoPath, $icoBytes.ToArray())
$bmp.Dispose()

"icon.png: " + (Get-Item -LiteralPath $pngPath).Length + " bytes"
"icon.ico: " + (Get-Item -LiteralPath $icoPath).Length + " bytes"
