// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if craidd_studio_lib::process_supervisor_entry() { return; }
    // GTK 3 uses the program name as the Wayland app ID when no GTK app ID is
    // registered. Keep it aligned with the packaged desktop file while still
    // allowing separate Craidd Studio processes.
    glib::set_prgname(Some("craidd-studio"));
    craidd_studio_lib::run()
}
