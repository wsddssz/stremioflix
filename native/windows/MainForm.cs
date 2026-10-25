// Main window: ONE app window.
// - WebView2 fills the window and shows the Netflix UI (dev server or dist).
// - libmpv renders video into a child panel behind the UI; when browsing,
//   the panel is hidden and only the UI shows. When playing, the UI's
//   <video> element is hidden and mpv shows through (transparent overlay
//   technique via JS bridge + window layering).
using System;
using System.IO;
using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

public class MainForm : Form
{
    WebView2 _web;
    Panel _videoPanel;
    Label _splash;
    bool _playing;

    public MainForm()
    {
        Text = "StremioFlix";
        Width = 1280;
        Height = 800;
        BackColor = System.Drawing.Color.Black;

        _videoPanel = new Panel { Dock = DockStyle.Fill, BackColor = System.Drawing.Color.Black, Visible = false };
        Controls.Add(_videoPanel);

        _web = new WebView2 { Dock = DockStyle.Fill };
        // Transparent so the embedded mpv video surface behind the UI shows through
        // during playback (the page turns its own background transparent via CSS class).
        _web.DefaultBackgroundColor = System.Drawing.Color.Transparent;
        ((System.ComponentModel.ISupportInitialize)_web).BeginInit();
        Controls.Add(_web);
        ((System.ComponentModel.ISupportInitialize)_web).EndInit();
        _web.BringToFront();

        _splash = new Label
        {
            Dock = DockStyle.Fill,
            TextAlign = System.Drawing.ContentAlignment.MiddleCenter,
            ForeColor = System.Drawing.Color.White,
            BackColor = System.Drawing.Color.FromArgb(20, 20, 20),
            Font = new System.Drawing.Font("Segoe UI", 14),
            Text = "Loading StremioFlix…"
        };
        Controls.Add(_splash);
        _splash.BringToFront();

        Load += async (_, __) =>
        {
            try
            {
                var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync();
                await _web.EnsureCoreWebView2Async(env);
                _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                _web.CoreWebView2.AddHostObjectToScript("nativeHost", new NativeBridge(this));
                _web.CoreWebView2.WebMessageReceived += OnWebMessage;
                WireMpvEvents();
                // NOTE: mpv is initialized lazily on first play (see HandleCmd
                // "mpv-play"). Initializing native libmpv here would put native
                // code on the startup path — any fault there kills the process
                // while the splash is still up ("stuck then crashes").
                var target = AppUrl();
                Log("navigating to " + target);
                _web.NavigationCompleted += (_, args) => {
                    BeginInvoke(new Action(() => {
                        _splash.Visible = false;
                        if (!args.IsSuccess)
                            PostToUi("mpv-error", "UI failed to load: " + args.WebErrorStatus);
                    }));
                };
                _web.Source = new Uri(target);
                // Watchdog: never leave the splash up forever. If navigation
                // never completes, report diagnostics instead of hanging.
                var watchdog = new System.Windows.Forms.Timer { Interval = 20000 };
                watchdog.Tick += (_, ___) => {
                    watchdog.Stop();
                    if (_splash.Visible)
                    {
                        var webRoot = Path.Combine(AppContext.BaseDirectory, "web");
                        _splash.Text = "Still loading…\nURL: " + target +
                            "\nweb dir: " + webRoot + " (" + (Directory.Exists(webRoot) ? "found" : "MISSING") + ")" +
                            "\nindex.html: " + (File.Exists(Path.Combine(webRoot, "index.html")) ? "found" : "MISSING") +
                            "\nlibmpv: " + (MpvHost.Available ? "found" : "missing (playback disabled until installed)") +
                            "\nWebView2: " + _web.CoreWebView2?.Environment?.BrowserVersionString;
                    }
                };
                watchdog.Start();
            }
            catch (Exception ex)
            {
                _splash.Text = "WebView2 failed to start:\n" + ex.Message;
            }
        };

        FormClosing += (_, __) => { LocalServer.Stop(); MpvHost.Shutdown(); };
        Resize += (_, __) => { if (_playing) PositionVideo(); };
    }

    static string AppUrl()
    {
        // Serve the bundled UI over loopback HTTP: WebView2 blocks ES modules /
        // fetch on file:// (opaque origin -> black screen). Falls back to file://
        // and finally the Vite dev server for development.
        var webRoot = Path.Combine(AppContext.BaseDirectory, "web");
        if (LocalServer.Start(webRoot))
            return "http://127.0.0.1:" + LocalServer.Port + "/index.html?native=1";
        var dist = Path.Combine(webRoot, "index.html");
        if (File.Exists(dist)) return new Uri(dist).AbsoluteUri + "?native=1";
        return "http://localhost:5173/?native=1";
    }

    void WireMpvEvents()
    {
        MpvHost.TimeUpdate += (t) => PostToUi("mpv-time", t.ToString(System.Globalization.CultureInfo.InvariantCulture));
        MpvHost.PauseChange += (p) => PostToUi("mpv-pause", p ? "1" : "0");
        MpvHost.DurationUpdate += (d) => PostToUi("mpv-duration", d.ToString(System.Globalization.CultureInfo.InvariantCulture));
        MpvHost.PlaybackEnded += () => BeginInvoke(new Action(() => ShowUi()));
        MpvHost.PlaybackError += (msg) => PostToUi("mpv-error", msg);
    }

    void PostToUi(string type, string value)
    {
        try
        {
            BeginInvoke(new Action(() =>
            {
                try
                {
                    var v = (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
                    _web.CoreWebView2?.PostWebMessageAsJson("{\"type\":\"" + type + "\",\"value\":\"" + v + "\"}");
                }
                catch { }
            }));
        }
        catch { }
    }

    void OnWebMessage(object sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            string cmd = root.TryGetProperty("cmd", out var c) ? c.GetString() ?? "" : "";
            string url = root.TryGetProperty("url", out var u) ? u.GetString() ?? "" : "";
            string title = root.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "";
            string a = root.TryGetProperty("a", out var a1) ? a1.GetString() ?? "" : "";
            string b = root.TryGetProperty("b", out var b1) ? b1.GetString() ?? "" : "";
            double val = 0;
            if (root.TryGetProperty("value", out var vv) && vv.ValueKind == JsonValueKind.Number) vv.TryGetDouble(out val);
            BeginInvoke(new Action(() => HandleCmd(cmd, url, title, val, a, b)));
        }
        catch { }
    }

    void Log(string m)
    {
        try { Console.WriteLine("[host " + DateTime.Now.ToString("HH:mm:ss.fff") + "] " + m); } catch { }
    }

    void HandleCmd(string cmd, string url, string title, double val, string a = "", string b = "")
    {
        Log("cmd=" + cmd + (string.IsNullOrEmpty(url) ? "" : " url=" + (url.Length <= 200 ? url : url.Substring(0, 200) + "...")));
        switch (cmd)
        {
            case "mpv-play":
                // Lazy native init: keep ALL libmpv calls off the startup path.
                // Startup crashes ("stuck on splash then dies") come from native
                // faults during Load — here a failure just reports mpv-error.
                try
                {
                    if (!MpvHost.Ready) MpvHost.Init(_videoPanel.Handle);
                }
                catch (Exception iex) { Log("mpv init fault: " + iex.Message); }
                if (!MpvHost.Ready)
                {
                    Log("mpv not ready: " + (MpvHost.LastError ?? "unknown"));
                    PostToUi("mpv-error", MpvHost.LastError ?? "Native player failed to start.");
                    return;
                }
                _playing = true;
                _videoPanel.Visible = true;
                PositionVideo();
                MpvHost.Play(url, title);
                break;
            case "mpv-stop":
                MpvHost.Stop();
                ShowUi();
                break;
            case "mpv-pause": MpvHost.TogglePause(); break;
            case "mpv-seek": MpvHost.Seek(val); break;
            case "mpv-seek-rel": MpvHost.SeekRel(val); break;
            case "mpv-volume": MpvHost.SetVolume(val); break;
            case "mpv-speed": MpvHost.SetSpeed(val); break;
            case "mpv-sub": MpvHost.CycleSub(); break;
            case "mpv-audio": MpvHost.CycleAudio(); break;
            case "mpv-tracks":
                PostToUi("mpv-tracks", MpvHost.TracksJson());
                break;
            case "mpv-select-track":
                MpvHost.SelectTrack(a, b);
                PostToUi("mpv-tracks", MpvHost.TracksJson());
                break;
            case "mpv-set":
                MpvHost.SetSubOption(a, b);
                break;
            case "app-fullscreen":
                if (FormBorderStyle == FormBorderStyle.None)
                {
                    FormBorderStyle = FormBorderStyle.Sizable;
                    WindowState = FormWindowState.Normal;
                }
                else
                {
                    WindowState = FormWindowState.Normal;
                    FormBorderStyle = FormBorderStyle.None;
                    WindowState = FormWindowState.Maximized;
                }
                break;
        }
    }

    void PositionVideo()
    {
        // Video panel fills the window behind the transparent WebView2 UI.
        _videoPanel.BringToFront();
        _web.BringToFront();
    }

    void ShowUi()
    {
        _playing = false;
        PostToUi("mpv-ended", "1");
    }
}
