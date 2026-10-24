using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("Xingye Journal Installer")]
[assembly: AssemblyCompany("HOSHINO TEAM")]
[assembly: AssemblyProduct("Xingye Journal")]
[assembly: AssemblyVersion("__ASSEMBLY_VERSION__")]
[assembly: AssemblyFileVersion("__ASSEMBLY_VERSION__")]

internal static class Installer
{
    private static string Quote(string value) { return "'" + value.Replace("'", "''") + "'"; }
    private static string logPath;

    private static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(logPath));
            File.AppendAllText(logPath, DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine, new UTF8Encoding(false));
        }
        catch { /* A logging failure must not change a completed installation result. */ }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        bool quiet = Array.Exists(args, a => String.Equals(a, "/quiet", StringComparison.OrdinalIgnoreCase) || String.Equals(a, "/S", StringComparison.OrdinalIgnoreCase));
        bool noDesktop = false, noStartMenu = false;
        string destination = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "XingyeJournal");
        string work = null;
        Mutex mutex = null;
        bool ownsMutex = false;
        logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Hoshino", "InstallerLogs", "setup-" + Guid.NewGuid().ToString("N") + ".log");
        int result = 1603;
        try
        {
            foreach (string arg in args)
            {
                if (String.Equals(arg, "/quiet", StringComparison.OrdinalIgnoreCase) || String.Equals(arg, "/S", StringComparison.OrdinalIgnoreCase) || String.Equals(arg, "/norestart", StringComparison.OrdinalIgnoreCase)) continue;
                if (String.Equals(arg, "/nodesktop", StringComparison.OrdinalIgnoreCase)) { noDesktop = true; continue; }
                if (String.Equals(arg, "/nostartmenu", StringComparison.OrdinalIgnoreCase)) { noStartMenu = true; continue; }
                if (arg.StartsWith("/dir=", StringComparison.OrdinalIgnoreCase)) { destination = arg.Substring(5); continue; }
                if (arg.StartsWith("/log=", StringComparison.OrdinalIgnoreCase)) { logPath = Path.GetFullPath(arg.Substring(5)); continue; }
                throw new ArgumentException("Unknown installer argument: " + arg);
            }
            if (!Path.IsPathRooted(destination)) throw new ArgumentException("An absolute installation directory is required.");
            destination = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar);
            if (String.Equals(destination.TrimEnd('\\'), Path.GetPathRoot(destination).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Do not install into a drive root.");
            if (!Environment.Is64BitOperatingSystem) { result = 1633; return result; }
            string sid = WindowsIdentity.GetCurrent().User.Value;
            mutex = new Mutex(false, @"Local\Hoshino.Xingye.Setup." + sid);
            try { ownsMutex = mutex.WaitOne(0); } catch (AbandonedMutexException) { ownsMutex = true; }
            if (!ownsMutex) { result = 1618; return result; }

            work = Path.Combine(Path.GetTempPath(), "xingye-bootstrap-" + Guid.NewGuid().ToString("N"));
            DirectorySecurity security = new DirectorySecurity();
            security.SetAccessRuleProtection(true, false);
            security.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            Directory.CreateDirectory(work, security);
            foreach (string name in new string[] { "payload.zip", "install.ps1", "setup-wizard.ps1", "icon.ico" })
            {
                using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
                {
                    if (resource == null) throw new InvalidDataException("Installer resource is missing.");
                    using (FileStream file = new FileStream(Path.Combine(work, name), FileMode.CreateNew, FileAccess.Write, FileShare.None)) resource.CopyTo(file);
                }
            }
            string script = Path.Combine(work, quiet ? "install.ps1" : "setup-wizard.ps1");
            string command = "$ErrorActionPreference='Stop'; & " + Quote(script) + " -Destination " + Quote(destination);
            if (quiet) command += " -NoLaunch";
            if (noDesktop) command += " -NoShortcut";
            if (noStartMenu) command += " -NoStartMenu";
            command += "; if ($null -eq $LASTEXITCODE) { exit 1603 }; exit $LASTEXITCODE";
            ProcessStartInfo start = new ProcessStartInfo();
            // Use the system Windows PowerShell, never a PATH-provided executable.
            start.FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            start.Arguments = "-NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(command));
            start.WorkingDirectory = work;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardOutput = quiet;
            start.RedirectStandardError = quiet;
            Log("Starting __PRODUCT_VERSION__ installer; quiet=" + quiet);
            using (Process process = Process.Start(start))
            {
                if (process == null) throw new InvalidOperationException("Failed to start installation worker.");
                Task<string> stdout = quiet ? process.StandardOutput.ReadToEndAsync() : null;
                Task<string> stderr = quiet ? process.StandardError.ReadToEndAsync() : null;
                process.WaitForExit();
                result = process.ExitCode;
                if (quiet) { Task.WaitAll(stdout, stderr); Log(stdout.Result); Log(stderr.Result); }
            }
            return result;
        }
        catch (ArgumentException error) { result = 87; Log(error.Message); if (!quiet) MessageBox.Show(error.Message, "星野记安装参数无效"); return result; }
        catch (UnauthorizedAccessException error) { result = 5; Log(error.Message); if (!quiet) MessageBox.Show(error.Message, "星野记安装失败"); return result; }
        catch (InvalidDataException error) { result = 13; Log(error.Message); if (!quiet) MessageBox.Show(error.Message, "星野记安装包损坏"); return result; }
        catch (IOException error) { int code = error.HResult & 0xffff; result = (code == 112 || code == 39) ? 112 : 1603; Log(error.Message); if (!quiet) MessageBox.Show(error.Message, "星野记安装失败"); return result; }
        catch (Exception error) { result = 1603; Log(error.Message); if (!quiet) MessageBox.Show(error.Message, "星野记安装失败"); return result; }
        finally
        {
            Log("Exit code: " + result);
            if (ownsMutex) mutex.ReleaseMutex();
            if (mutex != null) mutex.Dispose();
            // Delete only this process's newly created extraction directory.
            if (work != null)
            {
                string resolved = Path.GetFullPath(work);
                string prefix = Path.GetFullPath(Path.GetTempPath()).TrimEnd('\\') + "\\";
                if (resolved.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(resolved).StartsWith("xingye-bootstrap-", StringComparison.Ordinal))
                    try { Directory.Delete(resolved, true); } catch (Exception error) { Log("Temporary cleanup: " + error.Message); }
            }
        }
    }
}
