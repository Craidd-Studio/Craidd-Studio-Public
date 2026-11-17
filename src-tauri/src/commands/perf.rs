//! IPC boundary resolves target and solution from this window, never a caller-supplied PID.
use crate::{
    perf_capture::{PerfManager, Target},
    perf_model::{Options, TreeQuery},
};
use serde::Deserialize;
use std::path::PathBuf;
use tauri::Manager;

pub(crate) static PAIR: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Discover,
    MonoHelperCapability,
    SymbolSettings,
    SaveSymbolSettings {
        paths: Vec<String>,
        expected: Vec<String>,
    },
    Prepare {
        options: Options,
    },
    Start {
        options: Options,
    },
    Status {
        id: String,
    },
    Stop {
        id: String,
    },
    Tree {
        id: String,
        query: TreeQuery,
    },
    Source {
        id: String,
        #[serde(rename = "frameId")]
        frame_id: u32,
    },
    List,
    Pin {
        id: String,
        pinned: bool,
    },
    Reopen {
        id: String,
    },
}

pub fn refuses_debugger(
    app: &tauri::AppHandle,
    target: &super::processes::ProcessIdentity,
) -> Result<(), String> {
    if let Some(manager) = app.try_state::<PerfManager>() {
        manager.refuse_debugger(&Target {
            pid: target.pid,
            birth: target.birth,
        })?;
    }
    Ok(())
}
pub fn close(app: &tauri::AppHandle, owner: &str) {
    if let Some(manager) = app.try_state::<PerfManager>() {
        manager.close(owner);
    }
}
pub fn shutdown(app: &tauri::AppHandle) {
    if let Some(manager) = app.try_state::<PerfManager>() {
        manager.shutdown();
    }
}

#[tauri::command]
pub async fn perf_action(
    app: tauri::AppHandle,
    w: tauri::WebviewWindow,
    request: Request,
) -> Result<serde_json::Value, String> {
    let owner = w.label().to_owned();
    let manager = app.state::<PerfManager>().inner().clone();
    if matches!(request,Request::MonoHelperCapability){return Ok(crate::mono_jit_helper::capability());}
    if matches!(request, Request::Discover) {
        return tauri::async_runtime::spawn_blocking(crate::perf_capture::discover)
            .await
            .map_err(|e| e.to_string());
    }
    let solution = super::linked_windows::get_application_windows(app.state())?
        .into_iter()
        .find(|m| m.window_label == owner)
        .map(|m| PathBuf::from(m.solution_path))
        .ok_or("This window has no registered solution")?;
    let target = if matches!(request, Request::Start { .. } | Request::Prepare { .. }) {
        let state = app.state::<super::profiling::ProfileManager>();
        let profiles = state.profiles.lock().map_err(|e| e.to_string())?;
        let profile = profiles
            .get(&owner)
            .filter(|p| p.active)
            .ok_or("Select a running target with Profile only before starting perf")?;
        Some((
            profile.id.clone(),
            Target {
                pid: profile.target.pid,
                birth: profile.target.birth,
            },
        ))
    } else {
        None
    };
    tauri::async_runtime::spawn_blocking(move||{
    let _pair=if matches!(request,Request::Start{..}|Request::Prepare{..}){Some(PAIR.lock().map_err(|e|e.to_string())?)}else{None};
    if let Some((_,target))=&target{
        if super::debug::has_attached_target(&app,&super::processes::ProcessIdentity{pid:target.pid,birth:target.birth}){
            return Err("End the target's debugger session before perf; debugger coexistence is not qualified".into());
        }
    }
    match request{
        Request::Discover|Request::MonoHelperCapability=>unreachable!(),
        Request::SymbolSettings=>crate::perf_symbols::locations(&solution).map(|paths|serde_json::json!(paths)),
        Request::SaveSymbolSettings{paths,expected}=>crate::perf_symbols::save_locations(&solution,paths,expected).map(|paths|serde_json::json!(paths)),
        Request::Prepare{options}=>manager.prepare(&solution,&target.unwrap().1,&options),
        Request::Start{options}=>{let (profile,target)=target.unwrap();manager.start(&owner,&solution,&profile,target,options).map(|id|serde_json::json!({"id":id}))},
        Request::Status{id}=>serde_json::to_value(manager.status(&owner,&solution,&id)?).map_err(|e|e.to_string()),
        Request::Stop{id}=>manager.stop(&owner,&solution,&id).map(|_|serde_json::Value::Null),
        Request::Tree{id,query}=>manager.tree(&owner,&solution,&id,&query),
        Request::Source{id,frame_id}=>serde_json::to_value(manager.source(&owner,&solution,&id,frame_id)?).map_err(|e|e.to_string()),
        Request::List=>serde_json::to_value(manager.list(&solution)?).map_err(|e|e.to_string()),
        Request::Pin{id,pinned}=>manager.pin(&solution,&id,pinned).map(|_|serde_json::Value::Null),
        Request::Reopen{id}=>manager.reopen(&owner,&solution,&id).map(|_|serde_json::Value::Null),
    }}).await.map_err(|e|e.to_string())?
}
