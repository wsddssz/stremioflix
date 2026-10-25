Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 64,64
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(229,9,20))
$rect = New-Object System.Drawing.RectangleF 2,2,60,60
$g.FillEllipse($brush, $rect)
$pts = New-Object System.Drawing.Point[] 3
$pts[0] = New-Object System.Drawing.Point 25,18
$pts[1] = New-Object System.Drawing.Point 25,46
$pts[2] = New-Object System.Drawing.Point 47,32
$g.FillPolygon([System.Drawing.Brushes]::White, $pts)
$g.Dispose()
$hicon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hicon)
$fs = [System.IO.File]::Create('c:\Users\Kepdns\Desktop\stremioflix\native\windows\app.ico')
$icon.Save($fs)
$fs.Dispose()
$bmp.Dispose()
Write-Output 'ICON_OK'
