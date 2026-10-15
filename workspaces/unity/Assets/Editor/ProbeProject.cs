using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class ProbeProject
{
    const string ScenePath = "Assets/Scenes/DebugProbe.unity";
    [MenuItem("Craidd/Prepare debugging fixture")]
    public static void Prepare()
    {
        Directory.CreateDirectory("Assets/Scenes");
        if (!File.Exists(ScenePath))
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("CSharp to Cpp Probe").AddComponent<NativeProbe>();
            EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), ScenePath);
        }
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        EditorSettings.serializationMode = SerializationMode.ForceText;
        PlayerSettings.companyName = "Craidd";
        PlayerSettings.productName = "Craidd Unity Debug Probe";
        PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Standalone, ScriptingImplementation.Mono2x);
        AssetDatabase.Refresh();
        AssetDatabase.SaveAssets();
        int first = NativeProbe.craidd_probe_mix(7, 200);
        if (first != NativeProbe.craidd_probe_mix(7, 200)) throw new Exception("Scalar bridge mismatch");
        NativeProbe.craidd_probe_allocate(8192, 1);
        if (NativeProbe.craidd_probe_live() != 8192) throw new Exception("Allocation mismatch");
        NativeProbe.craidd_probe_clear();
        if (NativeProbe.craidd_probe_live() != 0) throw new Exception("Native cleanup mismatch");
        Debug.Log("CRAIDD_UNITY_EDITOR_INTEROP_OK");
    }
    [MenuItem("Craidd/Build development Linux player")]
    public static void BuildLinux()
    {
        Prepare();
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions {
            scenes = new[] { ScenePath }, locationPathName = "Builds/Linux/CraiddUnityProbe.x86_64",
            target = BuildTarget.StandaloneLinux64,
            options = BuildOptions.Development | BuildOptions.AllowDebugging
        });
        if (report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded)
            throw new Exception("Development player build failed: " + report.summary.result);
        Debug.Log("CRAIDD_UNITY_LINUX_BUILD_OK");
    }
}
