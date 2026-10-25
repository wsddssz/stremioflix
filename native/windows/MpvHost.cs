// Embedded mpv controller (libmpv-2.dll via P/Invoke).
// Renders into the WinForms window handle: ONE app window,
// Netflix UI (WebView2) on top, mpv video surface behind it.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

static class MpvHost
{
    const string Dll = "libmpv-2.dll";

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr mpv_create();
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    static extern int mpv_initialize(IntPtr ctx);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    static extern int mpv_terminate_destroy(IntPtr ctx);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    static extern int mpv_command_string(IntPtr ctx, [MarshalAs(UnmanagedType.LPStr)] string args);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    static extern int mpv_set_option_string(IntPtr ctx, [MarshalAs(UnmanagedType.LPStr)] string name, [MarshalAs(UnmanagedType.LPStr)] string data);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    static extern int mpv_observe_property(IntPtr ctx, ulong replyUserdata, [MarshalAs(UnmanagedType.LPStr)] string name, int format);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr mpv_wait_event(IntPtr ctx, double timeout);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr mpv_error_string(int error);
    [DllImport(Dll, EntryPoint = "mpv_get_property", CallingConvention = CallingConvention.Cdecl)]
    static extern int mpv_get_property_str(IntPtr ctx, [MarshalAs(UnmanagedType.LPStr)] string name, int format, ref IntPtr data);
    [DllImport(Dll, EntryPoint = "mpv_get_property", CallingConvention = CallingConvention.Cdecl)]
    static extern int mpv_get_property_node(IntPtr ctx, [MarshalAs(UnmanagedType.LPStr)] string name, int format, ref MpvNode data);
    [DllImport(Dll, EntryPoint = "mpv_free", CallingConvention = CallingConvention.Cdecl)]
    static extern void mpv_free_str(IntPtr p);
    [DllImport(Dll, EntryPoint = "mpv_free_node_contents", CallingConvention = CallingConvention.Cdecl)]
    static extern void mpv_free_node_contents(ref MpvNode node);

    // mpv_format values (client.h): NONE=0 STRING=1 OSD_STRING=2 FLAG=3
    // INT64=4 DOUBLE=5 NODE=6 NODE_ARRAY=7 NODE_MAP=8 BYTE_ARRAY=9.
    // Observe calls must request the real DOUBLE/NODE formats — requesting the
    // wrong one makes time-pos/duration/track-list events arrive as garbage.
    const int MPV_FORMAT_STRING = 1;
    const int MPV_FORMAT_NODE = 6;
    const int MPV_FORMAT_NODE_ARRAY = 7;
    const int MPV_FORMAT_NODE_MAP = 8;

    [StructLayout(LayoutKind.Explicit, Size = 16)]
    struct MpvNode
    {
        [FieldOffset(0)] public IntPtr Union; // union u (pointer-sized, 8 bytes on x64)
        [FieldOffset(8)] public int Format;   // mpv_format @8, +4 padding = 16 total
    }
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct MpvNodeList
    {
        [FieldOffset(0)] public int Num;
        [FieldOffset(8)] public IntPtr Values; // mpv_node* @8
        [FieldOffset(16)] public IntPtr Keys;   // char** @16
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct MpvEvent
    {
        [FieldOffset(0)] public int event_id;
        [FieldOffset(4)] public int error;
        [FieldOffset(8)] public ulong reply_userdata;
        [FieldOffset(16)] public IntPtr data;
    }

    // C layout of mpv_event_property (client.h):
    //   char* name (ptr 0); mpv_format format (int @ ptrsize); padding; void* data (@ ptrsize*2).
    // Use explicit offsets so x64 padding (name@0 / format@8 / data@16) is exact.
    [StructLayout(LayoutKind.Explicit)]
    struct MpvEventProperty
    {
        [FieldOffset(0)] public IntPtr name;
        [FieldOffset(8)] public int format;
        [FieldOffset(16)] public IntPtr data;
    }

    const int MPV_EVENT_PROPERTY_CHANGE = 22;
    const int MPV_EVENT_END_FILE = 7;
    const int MPV_FORMAT_DOUBLE = 5;
    const int MPV_FORMAT_FLAG = 3;

    static IntPtr _ctx = IntPtr.Zero;
    static Thread _evtThread;
    static volatile bool _running;

    public static event Action<double> TimeUpdate;
    public static event Action<double> DurationUpdate;
    public static event Action<bool> PauseChange;
    public static event Action PlaybackEnded;
    public static event Action<string> PlaybackError;

    static void Log(string m)
    {
        try { Console.WriteLine("[mpv " + DateTime.Now.ToString("HH:mm:ss.fff") + "] " + m); } catch { }
    }

    static string ErrStr(int e)
    {
        try { var p = mpv_error_string(e); return p == IntPtr.Zero ? "?" : (Marshal.PtrToStringAnsi(p) ?? "?"); }
        catch { return "?"; }
    }

    static string Trunc(string s) { return s.Length <= 220 ? s : s.Substring(0, 220) + "..."; }

    public static volatile bool Ready;
    public static string LastError;

    public static bool Available
    {
        get { return File.Exists(Path.Combine(AppContext.BaseDirectory, "libmpv-2.dll")); }
    }

    public static void Init(IntPtr wid)
    {
        if (_ctx != IntPtr.Zero) return;
        if (!Available)
        {
            LastError = "libmpv-2.dll not found in " + AppContext.BaseDirectory;
            Log(LastError);
            return;
        }
        try
        {
            _ctx = mpv_create();
            if (_ctx == IntPtr.Zero) { LastError = "mpv_create() returned null"; Log(LastError); return; }
            Set("vo", "gpu");
            Set("hwdec", "auto");
            Set("wid", wid.ToInt64().ToString());
            Set("idle", "yes");
            Set("force-window", "no");
            Set("osc", "no");
            Set("input-default-bindings", "yes");
            Set("input-vo-keyboard", "yes");
            Set("sub-auto", "fuzzy");
            Set("audio-channels", "auto");
            Set("ytdl", "no");
            var rc = mpv_initialize(_ctx);
            if (rc != 0) { LastError = "mpv_initialize failed: " + rc + " (" + ErrStr(rc) + ")"; Log(LastError); _ctx = IntPtr.Zero; return; }
            mpv_observe_property(_ctx, 1, "time-pos", MPV_FORMAT_DOUBLE);
            mpv_observe_property(_ctx, 2, "pause", MPV_FORMAT_FLAG);
            mpv_observe_property(_ctx, 3, "duration", MPV_FORMAT_DOUBLE);
            _running = true;
            Ready = true;
            Log("initialized vo=gpu wid=0x" + wid.ToInt64().ToString("X"));
            _evtThread = new Thread(EventLoop) { IsBackground = true, Name = "mpv-events" };
            _evtThread.Start();
        }
        catch (DllNotFoundException dex) { LastError = "libmpv-2.dll failed to load: " + dex.Message; Log(LastError); _ctx = IntPtr.Zero; Ready = false; }
        catch (BadImageFormatException bex) { LastError = "libmpv-2.dll bitness mismatch (need x64): " + bex.Message; Log(LastError); _ctx = IntPtr.Zero; Ready = false; }
        catch (Exception ex) { LastError = ex.GetType().Name + ": " + ex.Message; Log(LastError); _ctx = IntPtr.Zero; Ready = false; }
    }

    static void Set(string k, string v)
    {
        if (_ctx != IntPtr.Zero) mpv_set_option_string(_ctx, k, v);
    }

    public static void Play(string url, string title)
    {
        if (_ctx == IntPtr.Zero) { LastError = "mpv not initialized"; Log(LastError); return; }
        var safe = (url ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
        var rc = mpv_command_string(_ctx, "loadfile \"" + safe + "\" replace");
        Log("loadfile rc=" + rc + (rc != 0 ? " (" + ErrStr(rc) + ")" : "") + " url=" + Trunc(url ?? ""));
        if (!string.IsNullOrEmpty(title))
            Cmd("set force-media-title \"" + title.Replace("\"", "'") + "\"");
        Cmd("set pause no");
    }

    public static void Stop() { Cmd("stop"); }
    public static void TogglePause() { Cmd("cycle pause"); }
    public static void SetPaused(bool p) { Cmd("set pause " + (p ? "yes" : "no")); }
    public static void Seek(double s) { Cmd("seek " + F(s) + " absolute"); }
    public static void SeekRel(double s) { Cmd("seek " + F(s) + " relative"); }
    public static void SetVolume(double v) { Cmd("set volume " + Math.Max(0, Math.Min(100, v))); }
    public static void SetSpeed(double r) { Cmd("set speed " + F(r)); }
    public static void CycleSub() { Cmd("cycle sub"); }
    public static void CycleAudio() { Cmd("cycle audio"); }

    // ---------- Track selection & subtitle styling (GUI support) ----------

    static string GetPropString(string name)
    {
        if (_ctx == IntPtr.Zero) return null;
        IntPtr p = IntPtr.Zero;
        if (mpv_get_property_str(_ctx, name, MPV_FORMAT_STRING, ref p) < 0 || p == IntPtr.Zero) return null;
        try { return Marshal.PtrToStringAnsi(p); } finally { mpv_free_str(p); }
    }

    /** Full track list as JSON: {"tracks":[{type,id,lang,title,codec,selected,external}...],"aid":"..","sid":".."} */
    public static string TracksJson()
    {
        if (_ctx == IntPtr.Zero) return "{\"tracks\":[],\"aid\":\"\",\"sid\":\"\"}";
        var node = new MpvNode();
        string tracks = "[]";
        if (mpv_get_property_node(_ctx, "track-list", MPV_FORMAT_NODE, ref node) >= 0)
        {
            try { tracks = NodeToJson(ref node); }
            finally { mpv_free_node_contents(ref node); }
        }
        return "{\"tracks\":" + tracks
            + ",\"aid\":" + JStr(GetPropString("aid") ?? "")
            + ",\"sid\":" + JStr(GetPropString("sid") ?? "no") + "}";
    }

    /** kind: aid | sid | vsid ; id: numeric track id or "no". Validated against injection. */
    public static void SelectTrack(string kind, string id)
    {
        if (kind != "aid" && kind != "sid" && kind != "vsid") return;
        if (string.IsNullOrEmpty(id)) return;
        if (id != "no" && id != "auto" && !System.Text.RegularExpressions.Regex.IsMatch(id, "^\\d{1,6}$")) return;
        Cmd("set " + kind + " " + id);
    }

    static readonly System.Text.RegularExpressions.Regex FontOk = new System.Text.RegularExpressions.Regex("^[A-Za-z0-9 \\-]{0,40}$");
    static readonly System.Text.RegularExpressions.Regex ColorOk = new System.Text.RegularExpressions.Regex("^(#[A-Fa-f0-9]{6}|[A-Za-z]{4,20})$");

    /** Whitelisted runtime subtitle options: sub-font, sub-color, sub-border-color, sub-scale, sub-delay. */
    public static void SetSubOption(string name, string value)
    {
        if (string.IsNullOrEmpty(value)) return;
        switch (name)
        {
            case "sub-font":
                if (FontOk.IsMatch(value)) Cmd("set sub-font \"" + value + "\"");
                break;
            case "sub-color":
            case "sub-border-color":
                if (ColorOk.IsMatch(value)) Cmd("set " + name + " " + (value.StartsWith("#") ? value : "#" + value));
                break;
            case "sub-scale":
                if (double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var sc) && sc >= 0.3 && sc <= 4)
                    Cmd("set sub-scale " + F(sc));
                break;
            case "sub-delay":
                if (double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var dl) && Math.Abs(dl) <= 300)
                    Cmd("set sub-delay " + F(dl));
                break;
        }
    }

    static string JStr(string s)
    {
        var sb = new System.Text.StringBuilder("\"");
        foreach (char c in (s ?? ""))
        {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }

    static string NodeToJson(ref MpvNode n)
    {
        switch (n.Format)
        {
            case 1: return JStr(Marshal.PtrToStringAnsi(n.Union) ?? "");            // STRING
            case 3: return n.Union.ToInt64() != 0 ? "true" : "false";               // FLAG
            case 4: return n.Union.ToInt64()                                        // INT64
                .ToString(System.Globalization.CultureInfo.InvariantCulture);
            case 5: return BitConverter.Int64BitsToDouble(n.Union.ToInt64())        // DOUBLE (bits in union)
                .ToString("R", System.Globalization.CultureInfo.InvariantCulture);
            case 6:                                                                 // NODE (nested) — union is mpv_node*
            {
                if (n.Union == IntPtr.Zero) return "null";
                try
                {
                    var inner = Marshal.PtrToStructure<MpvNode>(n.Union);
                    return NodeToJson(ref inner);
                }
                catch { return "null"; }
            }
            case 7:                                                                 // NODE_ARRAY
            case 8:                                                                 // NODE_MAP
            {
                if (n.Union == IntPtr.Zero) return n.Format == 8 ? "{}" : "[]";
                var l = Marshal.PtrToStructure<MpvNodeList>(n.Union);
                int sz = Marshal.SizeOf<MpvNode>();
                var sb = new System.Text.StringBuilder();
                if (n.Format == 7)
                {
                    sb.Append('[');
                    for (int i = 0; i < l.Num; i++)
                    {
                        var child = Marshal.PtrToStructure<MpvNode>(IntPtr.Add(l.Values, i * sz));
                        if (i > 0) sb.Append(',');
                        sb.Append(NodeToJson(ref child));
                    }
                    sb.Append(']');
                }
                else
                {
                    sb.Append('{');
                    for (int i = 0; i < l.Num; i++)
                    {
                        var child = Marshal.PtrToStructure<MpvNode>(IntPtr.Add(l.Values, i * sz));
                        string key = l.Keys != IntPtr.Zero
                            ? (Marshal.PtrToStringAnsi(Marshal.ReadIntPtr(l.Keys, i * IntPtr.Size)) ?? ("k" + i))
                            : ("k" + i);
                        if (i > 0) sb.Append(',');
                        sb.Append(JStr(key)).Append(':').Append(NodeToJson(ref child));
                    }
                    sb.Append('}');
                }
                return sb.ToString();
            }
            default: return "null";
        }
    }

    static string F(double d) { return d.ToString(System.Globalization.CultureInfo.InvariantCulture); }
    static void Cmd(string c)
    {
        if (_ctx == IntPtr.Zero) return;
        var rc = mpv_command_string(_ctx, c);
        if (rc != 0) Log("command failed rc=" + rc + " (" + ErrStr(rc) + ") :: " + c);
    }

    static void EventLoop()
    {
        while (_running && _ctx != IntPtr.Zero)
        {
            try
            {
                var ptr = mpv_wait_event(_ctx, 0.2);
                if (ptr == IntPtr.Zero) continue;
                MpvEvent ev;
                try { ev = (MpvEvent)Marshal.PtrToStructure(ptr, typeof(MpvEvent)); }
                catch { continue; }
                if (ev.event_id == MPV_EVENT_END_FILE)
                {
                    int reason = -1, err = 0;
                    try
                    {
                        if (ev.data != IntPtr.Zero)
                        {
                            // mpv_event_end_file: int reason @0, int error @4.
                            var buf = new byte[8];
                            Marshal.Copy(ev.data, buf, 0, 8);
                            reason = BitConverter.ToInt32(buf, 0);
                            err = BitConverter.ToInt32(buf, 4);
                        }
                    }
                    catch { reason = -1; err = 0; }
                    Log("end-file reason=" + reason + " error=" + err + (err != 0 ? " (" + ErrStr(err) + ")" : ""));
                    if (reason == 4 && err != 0) // MPV_END_FILE_REASON_ERROR — keep UI open so the error is visible
                    {
                        try { PlaybackError?.Invoke("mpv could not open this stream: " + ErrStr(err) + " (code " + err + ")"); } catch { }
                    }
                    else if (reason == 0) // EOF only — manual stop/quit is handled by the host, never auto-next on user actions
                    {
                        try { PlaybackEnded?.Invoke(); } catch { }
                    }
                }
                else if (ev.event_id == MPV_EVENT_PROPERTY_CHANGE && ev.data != IntPtr.Zero)
                {
                    // mpv_event_property (client.h): char* name; mpv_format format;
                    // void* data — data points AT the value, it is not the value.
                    var prop = (MpvEventProperty)Marshal.PtrToStructure(ev.data, typeof(MpvEventProperty));
                    IntPtr namePtr = prop.name;
                    int fmt = prop.format;
                    IntPtr dataPtr = prop.data;
                    string propName = namePtr != IntPtr.Zero ? (Marshal.PtrToStringAnsi(namePtr) ?? "") : "";
                    if (fmt == MPV_FORMAT_DOUBLE && dataPtr != IntPtr.Zero)
                    {
                        double t = Marshal.PtrToStructure<double>(dataPtr);
                        if (double.IsNaN(t) || double.IsInfinity(t) || t < 0) t = 0;
                        if (ev.reply_userdata == 1) { try { TimeUpdate?.Invoke(t); } catch { } }
                        else if (ev.reply_userdata == 3) { try { DurationUpdate?.Invoke(t); } catch { } }
                    }
                    else if (fmt == MPV_FORMAT_FLAG && ev.reply_userdata == 2 && dataPtr != IntPtr.Zero)
                    {
                        int f;
                        try
                        {
                            var fb = new byte[4];
                            Marshal.Copy(dataPtr, fb, 0, 4);
                            f = BitConverter.ToInt32(fb, 0);
                        }
                        catch { continue; }
                        Log("pause -> " + (f != 0 ? "paused" : "playing") + " (" + propName + ")");
                        try { PauseChange?.Invoke(f != 0); } catch { }
                    }
                }
            }
            catch { Thread.Sleep(200); }
        }
    }

    public static void Shutdown()
    {
        _running = false;
        Ready = false;
        try { _evtThread?.Join(500); } catch { }
        if (_ctx != IntPtr.Zero) { try { mpv_terminate_destroy(_ctx); } catch { } _ctx = IntPtr.Zero; }
    }
}

