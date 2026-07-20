$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Controller = Join-Path $Root 'scripts\workbuddy-skin.ps1'
$PreviewPath = Join-Path $Root 'assets\miku\miku-reference.jpg'

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="WorkBuddy 换肤工具" Width="860" Height="620"
        WindowStartupLocation="CenterScreen" ResizeMode="NoResize"
        Background="#06141D" Foreground="#E8FFFC">
  <Window.Resources>
    <Style TargetType="Button">
      <Setter Property="Cursor" Value="Hand" />
      <Setter Property="FontSize" Value="14" />
      <Setter Property="FontWeight" Value="SemiBold" />
      <Setter Property="Padding" Value="20,11" />
      <Setter Property="Margin" Value="0,0,10,0" />
      <Setter Property="Foreground" Value="#E8FFFC" />
      <Setter Property="Background" Value="#12303A" />
      <Setter Property="BorderBrush" Value="#31545B" />
      <Setter Property="BorderThickness" Value="1" />
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="Border" CornerRadius="11" Background="{TemplateBinding Background}"
                    BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}"
                    Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" />
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="Border" Property="Background" Value="#174955" />
                <Setter TargetName="Border" Property="BorderBrush" Value="#38F5E5" />
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter Property="Opacity" Value="0.45" />
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>
  <Grid Margin="26">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto" />
      <RowDefinition Height="24" />
      <RowDefinition Height="330" />
      <RowDefinition Height="24" />
      <RowDefinition Height="Auto" />
      <RowDefinition Height="*" />
    </Grid.RowDefinitions>

    <Grid Grid.Row="0">
      <Grid.ColumnDefinitions><ColumnDefinition /><ColumnDefinition Width="Auto" /></Grid.ColumnDefinitions>
      <StackPanel>
        <TextBlock Text="WorkBuddy Skin Lab" FontSize="28" FontWeight="Bold" Foreground="#F2FFFD" />
        <TextBlock Text="外部注入 · 不修改 app.asar · 随时恢复" Margin="0,7,0,0" Foreground="#8DC7C2" FontSize="13" />
      </StackPanel>
      <Border Grid.Column="1" Background="#0A2732" BorderBrush="#2D625F" BorderThickness="1" CornerRadius="16" Padding="12,7">
        <TextBlock Text="MIKU MODE 01" Foreground="#38F5E5" FontWeight="Bold" FontSize="11" />
      </Border>
    </Grid>

    <Border Grid.Row="2" CornerRadius="20" BorderBrush="#346D6A" BorderThickness="1" Background="#0B222D" ClipToBounds="True">
      <Grid>
        <Image x:Name="PreviewImage" Stretch="UniformToFill" Opacity="0.72" />
        <Rectangle>
          <Rectangle.Fill>
            <LinearGradientBrush StartPoint="0,0.5" EndPoint="1,0.5">
              <GradientStop Color="#F206141D" Offset="0" />
              <GradientStop Color="#C006141D" Offset="0.48" />
              <GradientStop Color="#3806141D" Offset="1" />
            </LinearGradientBrush>
          </Rectangle.Fill>
        </Rectangle>
        <StackPanel Margin="30" VerticalAlignment="Center" Width="390" HorizontalAlignment="Left">
          <TextBlock Text="初音未来 · Future Voice" Foreground="#38F5E5" FontWeight="Bold" FontSize="14" />
          <TextBlock Text="给工作流换一层未来感" Foreground="White" FontWeight="Bold" FontSize="34" Margin="0,10,0,0" TextWrapping="Wrap" />
          <TextBlock Text="深海青 × 荧光蓝绿 × 少量粉色。侧栏、首页、输入框和按钮都会同步换肤。" Foreground="#C9EDEA" FontSize="14" Margin="0,12,0,0" TextWrapping="Wrap" LineHeight="23" />
        </StackPanel>
      </Grid>
    </Border>

    <Grid Grid.Row="4">
      <Grid.ColumnDefinitions><ColumnDefinition /><ColumnDefinition Width="Auto" /></Grid.ColumnDefinitions>
      <StackPanel Orientation="Horizontal">
        <Button x:Name="ApplyButton" Content="应用初音皮肤" Background="#0C8E89" BorderBrush="#38F5E5" />
        <Button x:Name="RestoreButton" Content="恢复原始界面" />
        <Button x:Name="VerifyButton" Content="检查皮肤" />
      </StackPanel>
      <Button x:Name="FolderButton" Grid.Column="1" Content="打开目录" Margin="0" />
    </Grid>

    <Border Grid.Row="5" Margin="0,18,0,0" Background="#091D27" CornerRadius="12" BorderBrush="#193943" BorderThickness="1" Padding="14,11" VerticalAlignment="Top">
      <StackPanel Orientation="Horizontal">
        <Ellipse x:Name="StatusDot" Width="8" Height="8" Fill="#38F5E5" Margin="0,0,10,0" />
        <TextBlock x:Name="StatusText" Text="正在读取状态…" Foreground="#B9E4E0" FontSize="13" />
      </StackPanel>
    </Border>
  </Grid>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)
$preview = $window.FindName('PreviewImage')
$statusText = $window.FindName('StatusText')
$statusDot = $window.FindName('StatusDot')
$buttons = @(
  $window.FindName('ApplyButton'),
  $window.FindName('RestoreButton'),
  $window.FindName('VerifyButton'),
  $window.FindName('FolderButton')
)

if (Test-Path -LiteralPath $PreviewPath) {
  $bitmap = New-Object System.Windows.Media.Imaging.BitmapImage
  $bitmap.BeginInit()
  $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
  $bitmap.UriSource = [Uri]::new($PreviewPath)
  $bitmap.EndInit()
  $preview.Source = $bitmap
}

function Set-Busy([bool]$Busy, [string]$Message) {
  foreach ($button in $buttons) { $button.IsEnabled = -not $Busy }
  $statusText.Text = $Message
  $statusDot.Fill = if ($Busy) { '#FF7ABF' } else { '#38F5E5' }
  $window.Dispatcher.Invoke([Action]{}, [Windows.Threading.DispatcherPriority]::Background)
}

function Invoke-Controller([string]$Action, [switch]$RestartExisting, [string]$ScreenshotPath) {
  Set-Busy $true '正在处理，请稍候…'
  try {
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Controller, '-Action', $Action)
    if ($RestartExisting) { $arguments += '-RestartExisting' }
    if ($ScreenshotPath) { $arguments += @('-ScreenshotPath', $ScreenshotPath) }
    $output = & powershell.exe @arguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw $output.Trim() }
    Set-Busy $false $output.Trim()
  } catch {
    Set-Busy $false '操作失败。'
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'WorkBuddy 换肤工具', 'OK', 'Error') | Out-Null
  }
}

$window.FindName('ApplyButton').Add_Click({
  $running = @(Get-Process WorkBuddy -ErrorAction SilentlyContinue).Count -gt 0
  if ($running) {
    $choice = [System.Windows.MessageBox]::Show('应用皮肤需要重启 WorkBuddy。未发送的输入可能会丢失，是否继续？', '应用初音皮肤', 'YesNo', 'Question')
    if ($choice -ne 'Yes') { return }
  }
  Invoke-Controller -Action 'Apply' -RestartExisting:$running
})

$window.FindName('RestoreButton').Add_Click({
  Invoke-Controller -Action 'Restore'
})

$window.FindName('VerifyButton').Add_Click({
  $screenshot = Join-Path $Root 'workbuddy-miku-preview.png'
  Invoke-Controller -Action 'Verify' -ScreenshotPath $screenshot
})

$window.FindName('FolderButton').Add_Click({
  Start-Process explorer.exe -ArgumentList $Root
})

try {
  $status = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Controller -Action Status 2>&1 | Out-String
  $statusText.Text = $status.Trim()
} catch {
  $statusText.Text = '状态读取失败。'
  $statusDot.Fill = '#FF7ABF'
}

$window.ShowDialog() | Out-Null
