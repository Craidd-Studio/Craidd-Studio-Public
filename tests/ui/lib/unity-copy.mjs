import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { ROOT } from "./harness.mjs";

export async function disposableUnity(output, namespace, { graphics = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "cui-"));
  const project = join(root, "workspaces/unity");
  const files = execFileSync("git", ["ls-files", "-z", "workspaces/unity", "src-tauri/native/profiling"], { cwd: ROOT }).toString().split("\0").filter(Boolean);
  for (const file of files) {
    const dest = join(root, file); await mkdir(dirname(dest), { recursive: true }); await copyFile(join(ROOT, file), dest);
  }
  // No Library, generated plugin, user settings, untracked files or credentials
  // are copied. Build and Editor execution are confined to this project.
  await copyFile(join(ROOT, "tests/fixtures/attach-profiling/UnityProfilingHarness.cs"), join(project, "Assets/Editor/UnityProfilingHarness.cs"));
  await copyFile(join(ROOT,"tests/fixtures/attach-profiling/scoped_ranges.cpp"),join(project,"Native/scoped_ranges.cpp"));
  const cmake=join(project,"Native/CMakeLists.txt");
  await writeFile(cmake,(await readFile(cmake,"utf8"))+"\ntarget_sources(craidd_unity_probe PRIVATE scoped_ranges.cpp)\n");
  const log = [];
  async function run(exe, args) {
    const child = spawn(exe, args, { cwd: project, stdio: ["ignore", "pipe", "pipe"] });
    for (const s of [child.stdout, child.stderr]) s.on("data", d => log.push(d.toString()));
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    if (code !== 0) throw new Error(`${exe} exited ${code}: ${log.join("").slice(-5000)}`);
  }
  await run("cmake", ["-S", join(project, "Native"), "-B", join(project, "Native/build"), "-DCMAKE_BUILD_TYPE=Debug"]);
  await run("cmake", ["--build", join(project, "Native/build"), "-j2"]);
  await writeFile(join(output, "native-build.log"), log.join(""));
  const manifest = {};
  for (const file of [...files, "workspaces/unity/Assets/Editor/UnityProfilingHarness.cs", "workspaces/unity/Native/scoped_ranges.cpp"]) {
    manifest[file] = createHash("sha256").update(await readFile(join(root,file))).digest("hex");
  }
  await writeFile(join(output,"source-manifest.json"),JSON.stringify({
    revision:execFileSync("git",["rev-parse","HEAD"],{cwd:ROOT}).toString().trim(),
    files:manifest, pluginSha256:createHash("sha256").update(await readFile(join(project,"Assets/Plugins/x86_64/libcraidd_unity_probe.so"))).digest("hex")
  },null,2));
  const version = /m_EditorVersion:\s*(\S+)/.exec(await readFile(join(project, "ProjectSettings/ProjectVersion.txt"), "utf8"))[1];
  const editor = process.env.UNITY_EDITOR ?? join(homedir(), "Unity/Hub/Editor", version, "Editor/Unity");
  if (!existsSync(editor)) throw new Error(`Set UNITY_EDITOR to the installed ${version} Editor executable`);
  const signals = join(output, "signals"); await mkdir(signals, { recursive: true });
  const env = { ...process.env, CRAIDD_UNITY_SIGNALS: signals, CRAIDD_PROFILE_NAMESPACE: namespace, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}` };
  delete env.CRAIDD_PROFILE_SOCKET;
  const child = spawn(editor, [...(graphics ? [] : ["-batchmode", "-nographics"]), "-projectPath", project, "-executeMethod", "UnityProfilingHarness.Run", "-logFile", join(output, "unity.log")], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.on("error", error => log.push(String(error)));
  for (const s of [child.stdout, child.stderr]) s.on("data", d => log.push(d.toString()));
  let commandId = 0;
  const copy = {
    project, root, child, version, editor, signals,
    async status() { return JSON.parse(await readFile(join(signals, "status.json"), "utf8")); },
    async waitFor(description, probe, timeout = 60000) {
      const until = Date.now() + timeout; let last;
      while (Date.now() < until) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Disposable Unity exited ${child.exitCode}: ${description}; see ${output}/unity.log`);
        try { last = await probe(); if (last) return last; } catch (error) { if (error.fatal) throw error; last = String(error); }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Disposable Unity timeout: ${description}; ${JSON.stringify(last)}; see ${output}/unity.log`);
    },
    async command(action, fps = 60) {
      const id = ++commandId;
      const path = join(signals, "command.json");
      await writeFile(path + ".tmp", JSON.stringify({ id, action, fps }));
      const { rename } = await import("node:fs/promises"); await rename(path + ".tmp", path);
      return copy.waitFor(action, async () => {
        const state = await copy.status();
        if (state.error) throw Object.assign(new Error(state.error), { fatal: true });
        return state.lastCommand >= id ? state : false;
      });
    },
    async close() {
      const running=()=>child.exitCode===null&&child.signalCode===null;
      if (running()) {
        // Exit may terminate the Editor before the command acknowledgement is
        // read. Either a status acknowledgement or process exit is sufficient.
        await copy.command("exit").catch(() => {});
        if (running()) await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
        if (running()) {
          child.kill("SIGTERM"); // only our own spawned disposable Editor
          await Promise.race([new Promise(resolve=>child.once("exit",resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);
        }
      }
      await writeFile(join(output, "unity-launch.log"), log.join(""));
      if (!running()) {
        const {rm}=await import("node:fs/promises");
        for(const cache of ["Library","Temp","Logs","UserSettings","obj"])
          await rm(join(project,cache),{recursive:true,force:true});
      }
    },
  };
  return copy;
}
