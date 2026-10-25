// COM-visible host object: window.chrome.webview.hostObjects.nativeHost
// Lets the web UI query native capabilities without localhost.
using System;
using System.Runtime.InteropServices;

[ComVisible(true)]
[ClassInterface(ClassInterfaceType.AutoDual)]
public class NativeBridge
{
    readonly MainForm _form;
    public NativeBridge(MainForm form) { _form = form; }

    public bool get_HasMpv() { return MpvHost.Available && MpvHost.Ready; }
    public string get_MpvError() { return MpvHost.LastError ?? ""; }
    public string get_Version() { return "1.0.0"; }
    public string get_Platform() { return "windows"; }
}
