// Minimal loopback HTTP server for the bundled web UI.
//
// Why not file://: WebView2 treats file:// pages as opaque origins — ES modules,
// fetch and CSS are blocked by CORS, so the SPA renders a black screen. Serving
// the same bytes over http://127.0.0.1 makes everything behave exactly like a
// normal web deployment. Uses raw TcpListener: no HTTP.sys URL ACLs, no admin.
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

static class LocalServer
{
    static TcpListener _listener;
    static Thread _thread;
    static volatile bool _running;
    static string _root;

    public static int Port { get; private set; }

    public static bool Start(string root)
    {
        _root = Path.GetFullPath(root);
        if (!Directory.Exists(_root) || !File.Exists(Path.Combine(_root, "index.html"))) return false;
        for (int attempt = 0; attempt < 8; attempt++)
        {
            try
            {
                Port = 5199 - attempt;
                _listener = new TcpListener(IPAddress.Loopback, Port);
                _listener.Start();
                _running = true;
                _thread = new Thread(Loop) { IsBackground = true, Name = "webui-server" };
                _thread.Start();
                return true;
            }
            catch { _listener = null; }
        }
        return false;
    }

    static void Loop()
    {
        while (_running)
        {
            try
            {
                var client = _listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(_ => Handle(client));
            }
            catch { if (!_running) return; }
        }
    }

    static void Handle(TcpClient client)
    {
        try
        {
            using (client)
            using (var stream = client.GetStream())
            {
                stream.ReadTimeout = 5000;
                var buf = new byte[16384];
                int n = stream.Read(buf, 0, buf.Length);
                if (n <= 0) return;
                var req = Encoding.ASCII.GetString(buf, 0, n);
                var line = req.Split(new[] { "\r\n" }, StringSplitOptions.None)[0];
                var parts = line.Split(' ');
                if (parts.Length < 2 || parts[0] != "GET")
                {
                    Send(stream, 405, "text/plain", Encoding.ASCII.GetBytes("Method Not Allowed"));
                    return;
                }
                var path = Uri.UnescapeDataString(parts[1].Split('?')[0]);
                if (string.IsNullOrEmpty(path) || path == "/") path = "/index.html";
                var full = Path.GetFullPath(Path.Combine(_root, path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar)));
                if (!full.StartsWith(_root, StringComparison.OrdinalIgnoreCase))
                {
                    Send(stream, 403, "text/plain", Encoding.ASCII.GetBytes("Forbidden"));
                    return;
                }
                if (!File.Exists(full))
                {
                    // SPA fallback: any unknown path serves the app shell.
                    full = Path.Combine(_root, "index.html");
                    if (!File.Exists(full))
                    {
                        Send(stream, 404, "text/plain", Encoding.ASCII.GetBytes("Not Found"));
                        return;
                    }
                }
                Send(stream, 200, Mime(full), File.ReadAllBytes(full));
            }
        }
        catch { /* per-connection errors are expected */ }
    }

    static string Mime(string p)
    {
        switch (Path.GetExtension(p).ToLowerInvariant())
        {
            case ".html": return "text/html; charset=utf-8";
            case ".js":
            case ".mjs": return "application/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json":
            case ".map": return "application/json; charset=utf-8";
            case ".svg": return "image/svg+xml";
            case ".png": return "image/png";
            case ".jpg":
            case ".jpeg": return "image/jpeg";
            case ".webp": return "image/webp";
            case ".gif": return "image/gif";
            case ".ico": return "image/x-icon";
            case ".woff": return "font/woff";
            case ".woff2": return "font/woff2";
            case ".ttf": return "font/ttf";
            default: return "application/octet-stream";
        }
    }

    static void Send(NetworkStream s, int code, string mime, byte[] body)
    {
        var reason = code == 200 ? "OK" : code == 404 ? "Not Found" : code == 403 ? "Forbidden" : "Error";
        var head = "HTTP/1.1 " + code + " " + reason + "\r\n" +
                   "Content-Type: " + mime + "\r\n" +
                   "Content-Length: " + body.Length + "\r\n" +
                   "Cache-Control: no-cache\r\n" +
                   "Connection: close\r\n\r\n";
        var hb = Encoding.ASCII.GetBytes(head);
        s.Write(hb, 0, hb.Length);
        s.Write(body, 0, body.Length);
    }

    public static void Stop()
    {
        _running = false;
        try { _listener?.Stop(); } catch { }
    }
}
