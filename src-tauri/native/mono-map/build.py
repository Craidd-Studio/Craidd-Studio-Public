#!/usr/bin/env python3
"""Developer/release-packaging build. Never called by the installed IDE."""
import hashlib,json,pathlib,platform,subprocess
root=pathlib.Path(__file__).resolve().parent
if platform.machine()!='x86_64' or platform.libc_ver()[0]!='glibc':raise SystemExit('This artifact is qualified only for Linux x86_64 GNU')
source=root/'mono_map.c';output=root/'linux-x86_64-gnu/libcraidd_mono_map.so';flags=['-std=c11','-O2','-g0','-fPIC','-fvisibility=hidden','-shared','-Wall','-Wextra','-Werror','-Wl,-z,relro,-z,now','-Wl,--build-id=sha1']
subprocess.run(['cc',*flags,str(source),'-ldl','-pthread','-o',str(output)],check=True)
output.chmod(0o644)
manifest={'version':'1.0.0','target':'linux-x86_64-gnu','minimumGlibc':'2.34','sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'compiler':subprocess.check_output(['cc','--version'],text=True).splitlines()[0],'flags':flags,'mapLimitBytes':16*1024*1024,'nameLimitBytes':4096,'supportedInitialization':'dlsym(mono_jit_init_version)','startupCoverage':'incomplete','runtimeBuild':False}
(root/'linux-x86_64-gnu/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))
