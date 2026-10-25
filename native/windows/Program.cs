using System;
using System.IO;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static void Main()
    {
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            try
            {
                var ex = e.ExceptionObject as Exception;
                File.AppendAllText(
                    Path.Combine(AppContext.BaseDirectory, "app.err.log"),
                    DateTime.Now.ToString("o") + " FATAL: " + (ex?.ToString() ?? "(null)") + "\n");
            }
            catch { }
        };
        ApplicationConfiguration.Initialize();
        Application.ThreadException += (_, e) =>
        {
            try
            {
                File.AppendAllText(
                    Path.Combine(AppContext.BaseDirectory, "app.err.log"),
                    DateTime.Now.ToString("o") + " UI: " + e.Exception.ToString() + "\n");
            }
            catch { }
            MessageBox.Show("StremioFlix hit an error:\n" + e.Exception.Message,
                "StremioFlix", MessageBoxButtons.OK, MessageBoxIcon.Error);
        };
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.Run(new MainForm());
    }
}
