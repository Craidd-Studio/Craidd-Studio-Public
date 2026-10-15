using UnityEditor;

// Component disable/scene unload is NOT Play end. SessionState survives domain reloads.
[InitializeOnLoad]
public static class ProbePlayLifecycle
{
    const string WasPlaying = "CraiddDebugProbe.WasPlaying";
    static ProbePlayLifecycle() { EditorApplication.playModeStateChanged += Changed; }
    static void Changed(PlayModeStateChange state)
    {
        if (state == PlayModeStateChange.EnteredPlayMode) SessionState.SetBool(WasPlaying, true);
        if (state == PlayModeStateChange.EnteredEditMode && SessionState.GetBool(WasPlaying, false))
        {
            SessionState.EraseBool(WasPlaying);
            NativeProbe.craidd_probe_play_end();
        }
    }
}
