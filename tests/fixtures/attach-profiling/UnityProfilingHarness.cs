// Copied ONLY into a disposable project's Assets/Editor by the UI harness.
using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

[InitializeOnLoad]
public static class UnityProfilingHarness
{
    const string Active = "CraiddHarness.Active";
    static double nextPoll;
    static double nextStatus;
    [Serializable] sealed class Command { public int id; public string action; public int fps; }
    [Serializable] sealed class Status
    {
        public int pid; public bool playing; public bool changing;
        public ulong nativeLiveBytes; public int frames; public int overlayDraws;
        public int lastCommand; public bool menuExecuted; public string error;
    }
    static UnityProfilingHarness() { EditorApplication.update += Tick; }
    static string Folder { get { return Environment.GetEnvironmentVariable("CRAIDD_UNITY_SIGNALS"); } }
    public static void Run()
    {
        if (string.IsNullOrEmpty(Folder)) throw new Exception("Disposable signal directory required");
        SessionState.SetBool(Active, true);
        SessionState.SetString("CraiddHarness.Deadline", DateTime.UtcNow.AddMinutes(20).Ticks.ToString());
        EditorSceneManager.OpenScene("Assets/Scenes/DebugProbe.unity");
        Application.runInBackground = true;
        File.WriteAllText(Path.Combine(Folder, "ready"), System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
        WriteStatus();
    }
    static void Tick()
    {
        if (!SessionState.GetBool(Active, false) || string.IsNullOrEmpty(Folder)) return;
        if (DateTime.UtcNow.Ticks > long.Parse(SessionState.GetString("CraiddHarness.Deadline", "0")))
        { EditorApplication.Exit(3); return; }
        if (EditorApplication.timeSinceStartup < nextPoll) return;
        nextPoll = EditorApplication.timeSinceStartup + .02;
        try
        {
            string path = Path.Combine(Folder, "command.json");
            if (File.Exists(path) && !EditorApplication.isCompiling && !EditorApplication.isUpdating)
            {
                var command = JsonUtility.FromJson<Command>(File.ReadAllText(path));
                if (command.id > SessionState.GetInt("CraiddHarness.Command", 0))
                {
                    SessionState.SetInt("CraiddHarness.Command", command.id);
                    SessionState.SetString("CraiddHarness.Error", "");
                    SessionState.SetBool("CraiddHarness.Menu", false);
                    if (command.action == "play")
                    {
                        var probe = UnityEngine.Object.FindAnyObjectByType<NativeProbe>();
                        if (probe == null) throw new Exception("No NativeProbe in disposable scene");
                        probe.targetFrameRate = command.fps;
                        probe.runPeriodicAllocations = false; // exact allocation/snapshot baseline
                        EditorApplication.EnterPlaymode();
                    }
                    else if (command.action == "allocate" || command.action == "clear")
                    {
                        if (!EditorApplication.isPlaying) throw new Exception("Menu action requires Play");
                        string item = command.action == "allocate" ? "Allocate retained native 1 MiB" : "Clear native allocations";
                        bool executed = EditorApplication.ExecuteMenuItem("Craidd/Probe/" + item);
                        SessionState.SetBool("CraiddHarness.Menu", executed);
                        if (!executed) throw new Exception("Menu dispatch rejected: " + item);
                    }
                    else if (command.action == "workers")
                    {
                        var probe = UnityEngine.Object.FindAnyObjectByType<NativeProbe>();
                        if (probe == null) throw new Exception("No active NativeProbe");
                        probe.runWorkers = command.fps != 0;
                    }
                    else if (command.action == "disconnect") NativeProbe.craidd_probe_disconnect_source();
                    else if (command.action == "screenshot")
                    {
                        var viewType = typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView");
                        var view = EditorWindow.GetWindow(viewType);
                        view.Show(); view.Focus(); view.Repaint();
                        ScreenCapture.CaptureScreenshot(Path.Combine(Folder, "overlay.png"));
                    }
                    else if (command.action == "stop") EditorApplication.ExitPlaymode();
                    else if (command.action == "exit") { WriteStatus(); EditorApplication.Exit(0); }
                    else throw new Exception("Unknown command: " + command.action);
                }
            }
        }
        catch (Exception error) { SessionState.SetString("CraiddHarness.Error", error.ToString()); Debug.LogException(error); }
        if (EditorApplication.timeSinceStartup >= nextStatus)
        { nextStatus = EditorApplication.timeSinceStartup + .25; WriteStatus(); }
    }
    static void WriteStatus()
    {
        var probe = UnityEngine.Object.FindAnyObjectByType<NativeProbe>();
        var status = new Status {
            pid = System.Diagnostics.Process.GetCurrentProcess().Id,
            playing = EditorApplication.isPlaying, changing = EditorApplication.isPlayingOrWillChangePlaymode != EditorApplication.isPlaying,
            nativeLiveBytes = NativeProbe.craidd_probe_live(), frames = probe == null ? 0 : probe.FrameCount,
            overlayDraws = probe == null ? 0 : probe.OverlayDrawCount,
            lastCommand = SessionState.GetInt("CraiddHarness.Command", 0),
            menuExecuted = SessionState.GetBool("CraiddHarness.Menu", false),
            error = SessionState.GetString("CraiddHarness.Error", "")
        };
        string file = Path.Combine(Folder, "status.json");
        File.WriteAllText(file + ".tmp", JsonUtility.ToJson(status));
        if (File.Exists(file)) File.Delete(file);
        File.Move(file + ".tmp", file);
    }
}
