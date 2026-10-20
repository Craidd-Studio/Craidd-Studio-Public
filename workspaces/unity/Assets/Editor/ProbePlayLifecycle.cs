using System;
using UnityEditor;
using UnityEngine;

// Native state and its heartbeat survive managed domain reloads. Every event
// carries the Play generation, so losing a transition cannot strand a session.
[InitializeOnLoad]
public static class ProbePlayLifecycle
{
    const string GenerationKey = "CraiddDebugProbe.PlayGeneration";
    static bool stateSupported = true;
    static void Publish(ulong generation, bool active)
    {
        // A running Editor may still have a previous native library loaded.
        // Updating C# must not break that session or require an automatic restart.
        if (stateSupported)
        {
            try { NativeProbe.craidd_probe_play_state(generation, active ? 1 : 0); return; }
            catch (EntryPointNotFoundException) { stateSupported = false; }
            catch (DllNotFoundException) { stateSupported = false; }
            Debug.LogWarning("[Craidd Probe] Native Play-state support is unavailable in the loaded plugin. Rebuild/reload it when convenient; this Editor will not be restarted.");
        }
        if (!active && generation > 0) NativeProbe.craidd_probe_play_end();
    }
    static ulong Generation { get { ulong.TryParse(SessionState.GetString(GenerationKey, "0"), out ulong value); return value; } }
    static ProbePlayLifecycle()
    {
        EditorApplication.playModeStateChanged += Changed;
        Publish(Generation, EditorApplication.isPlaying);
    }
    static void Changed(PlayModeStateChange state)
    {
        if (state == PlayModeStateChange.EnteredPlayMode)
        {
            ulong generation = Generation + 1;
            SessionState.SetString(GenerationKey, generation.ToString());
            Publish(generation, true);
        }
        if (state == PlayModeStateChange.EnteredEditMode)
            Publish(Generation, false);
    }
}
