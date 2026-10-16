using System;
using System.Runtime.InteropServices;
using UnityEngine;

public sealed class NativeProbe : MonoBehaviour
{
    const string Library = "craidd_unity_probe";
    [DllImport(Library)] public static extern int craidd_probe_allow_attach();
    [DllImport(Library)] public static extern int craidd_probe_anchored(int count);
    [DllImport(Library)] public static extern int craidd_probe_mix(int seed, int iterations);
    [DllImport(Library)] public static extern void craidd_probe_allocate(int bytes, int retain);
    [DllImport(Library)] public static extern void craidd_probe_clear();
    [DllImport(Library)] public static extern ulong craidd_probe_live();
    [DllImport(Library)] public static extern int craidd_probe_stateful(int delta);
    [DllImport(Library)] public static extern void craidd_probe_workers_start();
    [DllImport(Library)] public static extern void craidd_probe_workers_stop();
    [DllImport(Library)] public static extern void craidd_probe_play_end();
    public int seed = 7;
    public int iterations = 20000;
    public bool runWorkers;
    public bool retainNativeAllocations;
    public int result;
    public ulong nativeLiveBytes;
    public long managedLiveBytes;
    public bool showProfilerOverlay = true;
    public int targetFrameRate = 60;
    byte[] managedRetained;
    bool workersActive;
    int frames;
    string lastAction = "Ready";

    void OnEnable()
    {
        Application.runInBackground = true;
        QualitySettings.vSyncCount = 0;
        Application.targetFrameRate = targetFrameRate;
    }

    void OnGUI()
    {
        if (!showProfilerOverlay) return;
        GUILayout.BeginArea(new Rect(12, 12, 310, 150), GUI.skin.box);
        GUILayout.Label("Craidd native profiling probe");
        GUILayout.Label($"Native live: {nativeLiveBytes:N0} bytes · Frames: {frames}");
        GUILayout.BeginHorizontal();
        if (GUILayout.Button("Allocate 1 MiB", GUILayout.Height(28))) AllocateNative();
        if (GUILayout.Button("Clear", GUILayout.Height(28))) ClearNative();
        GUILayout.EndHorizontal();
        GUILayout.Label(lastAction);
        GUILayout.EndArea();
    }

    void Awake()
    {
        if (!Application.isEditor && Array.IndexOf(Environment.GetCommandLineArgs(), "--craidd-allow-attach") >= 0)
        {
            if (craidd_probe_allow_attach() != 0) throw new Exception("Fixture ptrace opt-in failed");
            Debug.Log("CRAIDD_UNITY_ATTACH_READY");
        }
    }
    void Update()
    {
        int input = seed + frames;
        int count = iterations;
        result = craidd_probe_mix(input, count) ^ craidd_probe_anchored(count); // MANAGED_BREAK_HERE
        if (runWorkers != workersActive)
        {
            if (runWorkers) craidd_probe_workers_start(); else craidd_probe_workers_stop();
            workersActive = runWorkers;
        }
        if (++frames % 120 == 0) craidd_probe_allocate(4096, retainNativeAllocations ? 1 : 0);
        nativeLiveBytes = craidd_probe_live();
        managedLiveBytes = GC.GetTotalMemory(false); // gauge, never a retained-object proof
        // Headless player smoke exits itself, allowing repeatable noninteractive validation.
        if (Array.IndexOf(Environment.GetCommandLineArgs(), "--craidd-smoke") >= 0 && frames == 30)
        {
            int first = craidd_probe_mix(7, 200);
            if (first != craidd_probe_mix(7, 200)) throw new Exception("Native scalar mismatch");
            craidd_probe_allocate(8192, 1);
            if (craidd_probe_live() < 8192) throw new Exception("Native allocation missing");
            ClearNative();
            if (craidd_probe_live() != 0) throw new Exception("Native cohort not cleared");
            Debug.Log("CRAIDD_UNITY_PLAYER_SMOKE_OK");
            Application.Quit(0);
        }
    }
    [ContextMenu("Probe/Allocate managed 1 MiB")] public void AllocateManaged() { managedRetained = new byte[1024 * 1024]; }
    [ContextMenu("Probe/Release managed reference")] public void ReleaseManaged() { managedRetained = null; }
    [ContextMenu("Probe/Collect managed garbage")] public void CollectManaged() { GC.Collect(); }
    [ContextMenu("Probe/Allocate retained native 1 MiB")]
    public void AllocateNative()
    {
        ulong before = craidd_probe_live();
        craidd_probe_allocate(1024 * 1024, 1);
        nativeLiveBytes = craidd_probe_live();
        lastAction = $"Allocate: {before:N0} → {nativeLiveBytes:N0} bytes";
        Debug.Log($"[Craidd Probe] Allocate retained native 1 MiB: {before} -> {nativeLiveBytes} bytes (Play={Application.isPlaying}, active={isActiveAndEnabled})", this);
    }
    [ContextMenu("Probe/Clear native allocations")]
    public void ClearNative()
    {
        ulong before = craidd_probe_live();
        craidd_probe_clear();
        nativeLiveBytes = craidd_probe_live();
        lastAction = $"Clear: {before:N0} → {nativeLiveBytes:N0} bytes";
        Debug.Log($"[Craidd Probe] Clear native allocations: {before} -> {nativeLiveBytes} bytes", this);
    }
    [ContextMenu("Probe/Stateful call - not value LDI")] public void Stateful() { Debug.Log(craidd_probe_stateful(1)); }
    void OnApplicationQuit()
    {
        if (Application.isEditor) return;
        craidd_probe_workers_stop();
        craidd_probe_clear();
        craidd_probe_play_end(); // verified player application quit, after native cleanup
    }
    void OnDisable()
    {
        craidd_probe_workers_stop(); workersActive = false;
        ulong before = craidd_probe_live();
        craidd_probe_clear();
        nativeLiveBytes = craidd_probe_live();
        if (before != 0) Debug.Log($"[Craidd Probe] Component disabled: clearing {before} native bytes (Play={Application.isPlaying})", this);
    }
}
