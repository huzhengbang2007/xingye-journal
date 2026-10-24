param([string]$Destination = (Join-Path $env:LOCALAPPDATA 'XingyeJournal'), [switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object Windows.Forms.Form
$form.Text = '星野记安装向导 · HOSHINO TEAM'
$form.ClientSize = [Drawing.Size]::new(580, 410)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = [Drawing.Font]::new('Microsoft YaHei UI', 10)
$form.BackColor = [Drawing.Color]::White
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'icon.ico')) { $form.Icon = [Drawing.Icon]::new((Join-Path $PSScriptRoot 'icon.ico')) }
function Add-Label($text, $x, $y, $width, $height) {
    $label = New-Object Windows.Forms.Label
    $label.Text = $text; $label.SetBounds($x,$y,$width,$height)
    $form.Controls.Add($label)
    return $label
}
$title = Add-Label '安装星野记 3.0.0-rc' 28 24 520 38
$title.Font = [Drawing.Font]::new('Microsoft YaHei UI', 19, [Drawing.FontStyle]::Bold)
$subtitle = Add-Label 'HOSHINO TEAM · 本地加密日程与日记' 30 71 520 28
$locationLabel = Add-Label '安装位置' 30 116 490 24
$location = New-Object Windows.Forms.TextBox
$location.Text = $Destination; $location.SetBounds(30,145,420,29); $form.Controls.Add($location)
$browse = New-Object Windows.Forms.Button
$browse.Text = '浏览…'; $browse.SetBounds(460,143,90,31); $form.Controls.Add($browse)
$desktop = New-Object Windows.Forms.CheckBox
$desktop.Text = '在桌面创建星野记图标'; $desktop.Checked = $true
$desktop.SetBounds(30,191,500,28); $form.Controls.Add($desktop)
$menu = New-Object Windows.Forms.CheckBox
$menu.Text = '添加到开始菜单'; $menu.Checked = $true
$menu.SetBounds(30,222,500,28); $form.Controls.Add($menu)
$launch = New-Object Windows.Forms.CheckBox
$launch.Text = '安装完成后启动星野记'; $launch.Checked = $true
$launch.SetBounds(30,253,500,28); $form.Controls.Add($launch)
$status = Add-Label '更新前请关闭星野记。已有日记、日程与配对信息会保留。' 30 292 520 42
$progress = New-Object Windows.Forms.ProgressBar
$progress.SetBounds(30,341,340,22); $progress.Visible = $false; $form.Controls.Add($progress)
$install = New-Object Windows.Forms.Button
$install.Text = '开始安装'; $install.SetBounds(410,346,140,38); $form.Controls.Add($install)
$form.AcceptButton = $install
$script:worker = $null
$script:complete = $false
$script:timer = New-Object Windows.Forms.Timer
$script:timer.Interval = 250
$browse.Add_Click({
    $dialog = New-Object Windows.Forms.FolderBrowserDialog
    $dialog.Description = '选择星野记安装文件夹'; $dialog.SelectedPath = $location.Text
    if ($dialog.ShowDialog($form) -eq 'OK') { $location.Text = $dialog.SelectedPath }
    $dialog.Dispose()
})
$install.Add_Click({
    if ($script:complete) {
        if ($launch.Checked) {
            try { Start-Process -FilePath (Join-Path $location.Text 'xingye-desktop.exe') -WorkingDirectory $location.Text }
            catch { [Windows.Forms.MessageBox]::Show($form, $_.Exception.Message, '启动失败') | Out-Null; return }
        }
        $form.Close(); return
    }
    try {
        if (-not [IO.Path]::IsPathRooted($location.Text.Trim())) { throw '请选择完整的安装路径。' }
        $location.Text = [IO.Path]::GetFullPath($location.Text.Trim())
        if ([IO.Path]::GetPathRoot($location.Text) -eq $location.Text) { throw '请选择一个文件夹，不能直接安装到磁盘根目录。' }
        $script:log = Join-Path ([IO.Path]::GetTempPath()) ('xingye-setup-' + [Guid]::NewGuid().ToString('N'))
        $arguments = @('-NoLaunch')
        if (-not $desktop.Checked) { $arguments += '-NoShortcut' }
        if (-not $menu.Checked) { $arguments += '-NoStartMenu' }
        # Encode paths as PowerShell literals before launching the isolated installation worker.
        $command = "$" + "ProgressPreference = 'SilentlyContinue'; & '" + (Join-Path $PSScriptRoot 'install.ps1').Replace("'", "''") + "' -Destination '" + $location.Text.Replace("'", "''") + "' " + ($arguments -join ' ') + '; exit 0'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $script:worker = Start-Process powershell.exe -ArgumentList @('-NoProfile','-OutputFormat','Text','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded) -WindowStyle Hidden -PassThru -RedirectStandardOutput ($script:log + '.out') -RedirectStandardError ($script:log + '.err')
        # Retain the process handle so Windows PowerShell can read ExitCode after it exits.
        $null = $script:worker.Handle
        foreach ($control in @($location,$browse,$desktop,$menu,$launch,$install)) { $control.Enabled = $false }
        $status.Text = '正在验证 HOSHINO TEAM 签名并安装，请稍候…'
        $progress.Visible = $true; $progress.Style = 'Marquee'
        $script:timer.Start()
    } catch { [Windows.Forms.MessageBox]::Show($form, $_.Exception.Message, '无法开始安装') | Out-Null }
})
$script:timer.Add_Tick({
    if (-not $script:worker.HasExited) { return }
    $script:timer.Stop()
    $script:worker.WaitForExit()
    $exitCode = $script:worker.ExitCode
    $details = (@([IO.File]::ReadAllText($script:log + '.out'), [IO.File]::ReadAllText($script:log + '.err')) -join "`r`n").Trim()
    foreach ($suffix in @('.out','.err')) { Remove-Item -LiteralPath ($script:log + $suffix) -ErrorAction SilentlyContinue }
    $script:worker.Dispose(); $script:worker = $null
    $progress.Style = 'Blocks'; $progress.Value = 100
    if ($exitCode -eq 0) {
        $script:complete = $true
        $title.Text = '安装完成'
        $status.Text = '星野记已安装。点击“完成”结束安装向导。'
        $install.Text = '完成'; $install.Enabled = $true; $launch.Enabled = $true
    } else {
        $progress.Visible = $false
        $status.Text = '安装未完成。请查看错误信息，处理后可重新安装。'
        foreach ($control in @($location,$browse,$desktop,$menu,$launch,$install)) { $control.Enabled = $true }
        [Windows.Forms.MessageBox]::Show($form, $details, '安装失败：请先关闭正在运行的星野记，并检查安装位置') | Out-Null
    }
})
$form.Add_FormClosing({
    param($sender,$eventArgs)
    if ($script:worker) { $eventArgs.Cancel = $true; $status.Text = '正在安装，请等待完成后关闭，以免中断更新。' }
})
$form.Add_FormClosed({ $script:timer.Dispose() })
if (-not $PrepareOnly) { [void]$form.ShowDialog(); $form.Dispose() }
