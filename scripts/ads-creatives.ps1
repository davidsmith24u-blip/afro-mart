# Build paid-ad creative assets for Afro Mart.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ads-creatives.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$pub = Join-Path $root 'public'
$out = Join-Path $root 'docs\ads\creatives'
New-Item -ItemType Directory -Force -Path $out | Out-Null

$greenDeep = [System.Drawing.Color]::FromArgb(22, 51, 31)
$green = [System.Drawing.Color]::FromArgb(32, 72, 47)
$gold = [System.Drawing.Color]::FromArgb(244, 207, 122)
$cream = [System.Drawing.Color]::FromArgb(253, 244, 231)
$ink = [System.Drawing.Color]::FromArgb(42, 20, 20)
$clay = [System.Drawing.Color]::FromArgb(168, 64, 29)
$white = [System.Drawing.Color]::White

function Load-Image([string]$path) {
  return [System.Drawing.Image]::FromFile((Resolve-Path $path))
}

function New-Canvas([int]$w, [int]$h, [System.Drawing.Color]$bg) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear($bg)
  return @{ Bitmap = $bmp; Graphics = $g }
}

function Get-RoundPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Draw-CropFill($g, $img, [single]$x, [single]$y, [single]$w, [single]$h, [single]$r = 0) {
  $scale = [Math]::Max($w / $img.Width, $h / $img.Height)
  $sw = $w / $scale
  $sh = $h / $scale
  $sx = ($img.Width - $sw) / 2
  $sy = ($img.Height - $sh) / 2
  $dest = New-Object System.Drawing.RectangleF($x, $y, $w, $h)
  $src = New-Object System.Drawing.RectangleF($sx, $sy, $sw, $sh)
  if ($r -gt 0) {
    $path = Get-RoundPath $x $y $w $h $r
    $old = $g.Clip
    $g.SetClip($path)
    $g.DrawImage($img, $dest, $src, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Clip = $old
    $path.Dispose()
  } else {
    $g.DrawImage($img, $dest, $src, [System.Drawing.GraphicsUnit]::Pixel)
  }
}

function Draw-Text($g, [string]$text, [string]$family, [single]$size, [System.Drawing.FontStyle]$style, [System.Drawing.Color]$color, [single]$x, [single]$y, [single]$w, [single]$h, [string]$align = 'Near') {
  $font = New-Object System.Drawing.Font($family, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush($color)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::$align
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Near
  $fmt.Trimming = [System.Drawing.StringTrimming]::None
  $g.DrawString($text, $font, $brush, (New-Object System.Drawing.RectangleF($x, $y, $w, $h)), $fmt)
  $brush.Dispose(); $font.Dispose(); $fmt.Dispose()
}

function Draw-Pill($g, [string]$text, [single]$x, [single]$y, [single]$w, [single]$h, [System.Drawing.Color]$bg, [System.Drawing.Color]$fg, [single]$fontSize = 30) {
  $path = Get-RoundPath $x $y $w $h ($h / 2)
  $brush = New-Object System.Drawing.SolidBrush($bg)
  $g.FillPath($brush, $path)
  Draw-Text $g $text 'Segoe UI' $fontSize ([System.Drawing.FontStyle]::Bold) $fg ($x + 24) ($y + ($h - $fontSize) / 2 - 3) ($w - 48) ($fontSize + 12) 'Center'
  $brush.Dispose(); $path.Dispose()
}

function Draw-Logo($g, [single]$x, [single]$y, [single]$size) {
  $logo = Load-Image (Join-Path $pub 'logo.png')
  $path = Get-RoundPath $x $y $size $size ($size * 0.22)
  $brush = New-Object System.Drawing.SolidBrush($cream)
  $g.FillPath($brush, $path)
  $old = $g.Clip
  $g.SetClip($path)
  $g.DrawImage($logo, (New-Object System.Drawing.RectangleF($x, $y, $size, $size)))
  $g.Clip = $old
  $brush.Dispose(); $path.Dispose(); $logo.Dispose()
}

function Save-Jpeg($bmp, [string]$name) {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 90L)
  $path = Join-Path $out $name
  $bmp.Save($path, $codec, $params)
  Write-Output "$name  $($bmp.Width)x$($bmp.Height)"
}

# ---------------------------------------------------------------- 1. Meta square hero
$c = New-Canvas 1080 1080 $greenDeep
$hero = Load-Image (Join-Path $pub 'hero-market.jpg')
Draw-CropFill $c.Graphics $hero 0 0 1080 1080 0
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.PointF(0, 0)),
  (New-Object System.Drawing.PointF(1080, 0)),
  [System.Drawing.Color]::FromArgb(235, 22, 51, 31),
  [System.Drawing.Color]::FromArgb(40, 22, 51, 31))
$c.Graphics.FillRectangle($grad, 0, 0, 1080, 1080)
$grad.Dispose()
Draw-Logo $c.Graphics 72 64 112
Draw-Text $c.Graphics 'AFRO MART' 'Segoe UI' 26 ([System.Drawing.FontStyle]::Bold) $gold 204 88 500 34 'Near'
Draw-Text $c.Graphics 'YOUR TASTE OF HOME' 'Segoe UI' 24 ([System.Drawing.FontStyle]::Bold) $gold 76 330 700 34 'Near'
Draw-Text $c.Graphics "African flavours,`ndelivered to`nyour door." 'Georgia' 78 ([System.Drawing.FontStyle]::Bold) $white 72 380 760 290 'Near'
Draw-Text $c.Graphics "Garri, egusi, ponmo, crayfish,`nchin chin & more." 'Segoe UI' 31 ([System.Drawing.FontStyle]::Regular) $cream 78 700 660 90 'Near'
Draw-Pill $c.Graphics 'SHOP AFROMARTZ.BIZ' 76 820 410 66 $gold $greenDeep 27
Draw-Text $c.Graphics 'Free delivery over €50  ·  WELCOME10 for 10% off' 'Segoe UI' 22 ([System.Drawing.FontStyle]::Regular) $cream 78 910 720 40 'Near'
Save-Jpeg $c.Bitmap 'meta-hero-1080x1080.jpg'
$hero.Dispose(); $c.Graphics.Dispose(); $c.Bitmap.Dispose()

# ---------------------------------------------------------------- 2. Meta product grid
$c = New-Canvas 1080 1080 $cream
$g = $c.Graphics
$band = New-Object System.Drawing.SolidBrush($greenDeep)
$g.FillRectangle($band, 0, 0, 1080, 170)
$band.Dispose()
Draw-Logo $g 60 35 100
Draw-Text $g 'AFRO MART' 'Segoe UI' 28 ([System.Drawing.FontStyle]::Bold) $white 184 52 420 40 'Near'
Draw-Text $g 'Nigerian groceries, delivered.' 'Segoe UI' 20 ([System.Drawing.FontStyle]::Regular) $gold 184 96 620 34 'Near'
Draw-Text $g "Your Nigerian kitchen,`ndelivered." 'Georgia' 60 ([System.Drawing.FontStyle]::Bold) $greenDeep 60 208 960 150 'Near'

$cards = @(
  @{ img='rice-flour-1kg.jpg'; name='Rice flour 1kg'; price='€5.99' },
  @{ img='chilli-300g.jpg'; name='Chilli powder 300g'; price='€3.99' },
  @{ img='iru-200g.jpg'; name='Iru 200g'; price='€5.99' },
  @{ img='chinchin-1kg.jpg'; name='Chin chin 1kg'; price='€8.99' }
)
$positions = @(@(60,380), @(550,380), @(60,660), @(550,660))
for ($i = 0; $i -lt 4; $i++) {
  $x = $positions[$i][0]; $y = $positions[$i][1]
  $path = Get-RoundPath $x $y 470 250 22
  $card = New-Object System.Drawing.SolidBrush($white)
  $g.FillPath($card, $path)
  $card.Dispose(); $path.Dispose()
  $img = Load-Image (Join-Path $pub ('products\' + $cards[$i].img))
  Draw-CropFill $g $img ($x + 18) ($y + 18) 180 214 16
  Draw-Text $g $cards[$i].name 'Segoe UI' 24 ([System.Drawing.FontStyle]::Bold) $ink ($x + 214) ($y + 54) 238 70 'Near'
  Draw-Text $g $cards[$i].price 'Georgia' 30 ([System.Drawing.FontStyle]::Bold) $clay ($x + 214) ($y + 130) 238 50 'Near'
  Draw-Text $g 'Shop now →' 'Segoe UI' 18 ([System.Drawing.FontStyle]::Bold) $green ($x + 214) ($y + 184) 238 30 'Near'
  $img.Dispose()
}
Draw-Pill $g 'WELCOME10  ·  10% OFF YOUR FIRST ORDER' 60 946 700 62 $greenDeep $gold 22
Draw-Text $g 'Free delivery over €50 within Bochum' 'Segoe UI' 20 ([System.Drawing.FontStyle]::Regular) $greenDeep 780 958 250 40 'Far'
Save-Jpeg $c.Bitmap 'meta-products-1080x1080.jpg'
$c.Graphics.Dispose(); $c.Bitmap.Dispose()

# ---------------------------------------------------------------- 3. Meta / TikTok story
$c = New-Canvas 1080 1920 $greenDeep
$g = $c.Graphics
$hero = Load-Image (Join-Path $pub 'hero-market.jpg')
Draw-CropFill $g $hero 0 760 1080 1160 0
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.PointF(0, 700)),
  (New-Object System.Drawing.PointF(0, 1400)),
  [System.Drawing.Color]::FromArgb(255, 22, 51, 31),
  [System.Drawing.Color]::FromArgb(0, 22, 51, 31))
$g.FillRectangle($grad, 0, 700, 1080, 700)
$grad.Dispose()
Draw-Logo $g 72 80 120
Draw-Text $g 'AFRO MART' 'Segoe UI' 28 ([System.Drawing.FontStyle]::Bold) $gold 216 108 600 40 'Near'
Draw-Text $g 'YOUR TASTE OF HOME' 'Segoe UI' 24 ([System.Drawing.FontStyle]::Bold) $gold 76 300 700 34 'Near'
Draw-Text $g "Missing home?`nWe deliver it." 'Georgia' 96 ([System.Drawing.FontStyle]::Bold) $white 72 350 900 270 'Near'
Draw-Text $g "Garri, egusi, ponmo, crayfish, iru,`nchin chin & all your kitchen staples." 'Segoe UI' 32 ([System.Drawing.FontStyle]::Regular) $cream 76 650 860 100 'Near'
Draw-Pill $g 'SHOP AFROMARTZ.BIZ' 76 1660 470 78 $gold $greenDeep 30
Draw-Text $g 'Free delivery over €50  ·  WELCOME10' 'Segoe UI' 24 ([System.Drawing.FontStyle]::Regular) $cream 76 1770 760 40 'Near'
Save-Jpeg $c.Bitmap 'story-1080x1920.jpg'
$hero.Dispose(); $g.Dispose(); $c.Bitmap.Dispose()

# ---------------------------------------------------------------- 4. Google display banner
$c = New-Canvas 1200 628 $greenDeep
$g = $c.Graphics
$hero = Load-Image (Join-Path $pub 'hero-market.jpg')
Draw-CropFill $g $hero 520 0 680 628 0
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.PointF(0, 0)),
  (New-Object System.Drawing.PointF(1200, 0)),
  [System.Drawing.Color]::FromArgb(255, 22, 51, 31),
  [System.Drawing.Color]::FromArgb(30, 22, 51, 31))
$g.FillRectangle($grad, 0, 0, 1200, 628)
$grad.Dispose()
Draw-Logo $g 48 42 88
Draw-Text $g 'AFRO MART' 'Segoe UI' 24 ([System.Drawing.FontStyle]::Bold) $gold 152 64 400 34 'Near'
Draw-Text $g "African groceries,`ndelivered across Germany." 'Georgia' 46 ([System.Drawing.FontStyle]::Bold) $white 48 170 700 150 'Near'
Draw-Text $g "Garri, egusi, ponmo, crayfish & more.`nFree pickup in Bochum." 'Segoe UI' 24 ([System.Drawing.FontStyle]::Regular) $cream 52 340 650 70 'Near'
Draw-Pill $g 'Shop afromartz.biz' 52 450 330 58 $gold $greenDeep 24
Draw-Text $g 'WELCOME10 · 10% off' 'Segoe UI' 20 ([System.Drawing.FontStyle]::Bold) $cream 408 464 300 36 'Near'
Save-Jpeg $c.Bitmap 'google-display-1200x628.jpg'
$hero.Dispose(); $g.Dispose(); $c.Bitmap.Dispose()

# ---------------------------------------------------------------- 5. Carousel product cards
$carousel = @(
  @{ img='rice-flour-1kg.jpg'; name='Tuwo / rice flour'; size='1kg'; price='€5.99' },
  @{ img='chilli-300g.jpg'; name='Chilli powder'; size='300g'; price='€3.99' },
  @{ img='iru-200g.jpg'; name='Iru (locust beans)'; size='200g'; price='€5.99' },
  @{ img='ponmo-150g.jpg'; name='Fresh ponmo'; size='150g'; price='€7.99' },
  @{ img='dry-crayfish-60g.jpg'; name='Dried crayfish'; size='60g'; price='€2.50' },
  @{ img='chinchin-1kg.jpg'; name='Chin chin'; size='1kg'; price='€8.99' }
)
foreach ($item in $carousel) {
  $c = New-Canvas 1080 1080 $cream
  $g = $c.Graphics
  $band = New-Object System.Drawing.SolidBrush($greenDeep)
  $g.FillRectangle($band, 0, 0, 1080, 132)
  $band.Dispose()
  Draw-Text $g 'AFRO MART' 'Segoe UI' 26 ([System.Drawing.FontStyle]::Bold) $white 64 40 380 38 'Near'
  Draw-Text $g 'afromartz.biz' 'Segoe UI' 20 ([System.Drawing.FontStyle]::Regular) $gold 64 84 380 30 'Near'
  Draw-Text $g 'Nigerian groceries, delivered.' 'Segoe UI' 20 ([System.Drawing.FontStyle]::Regular) $cream 520 52 500 36 'Far'
  $img = Load-Image (Join-Path $pub ('products\' + $item.img))
  Draw-CropFill $g $img 190 178 700 610 28
  Draw-Text $g $item.name 'Georgia' 52 ([System.Drawing.FontStyle]::Bold) $greenDeep 70 820 940 70 'Center'
  Draw-Text $g ($item.size + '  ·  ' + $item.price) 'Segoe UI' 34 ([System.Drawing.FontStyle]::Bold) $clay 70 900 940 50 'Center'
  Draw-Pill $g 'SHOP NOW' 390 975 300 58 $gold $greenDeep 24
  $slug = [System.IO.Path]::GetFileNameWithoutExtension($item.img)
  Save-Jpeg $c.Bitmap ("carousel-" + $slug + "-1080x1080.jpg")
  $img.Dispose(); $g.Dispose(); $c.Bitmap.Dispose()
}

Write-Output "Creative files written to $out"
