using System;
using System.Runtime.CompilerServices;
public static class EmbeddedHot {
 [MethodImpl(MethodImplOptions.NoInlining)] public static ulong KnownManagedHot(ulong value) { for(int i=0;i<100000;i++) value=(value*6364136223846793005UL+(ulong)i)^(value>>13); return value; }
 public static int Run(string[] args) { ulong v=1; for(int i=0;i<(Environment.GetEnvironmentVariable("CRAIDD_MONO_FIXTURE_ITERATIONS")==null?2000:int.Parse(Environment.GetEnvironmentVariable("CRAIDD_MONO_FIXTURE_ITERATIONS")));i++) v=KnownManagedHot(v); Console.WriteLine("MANAGED_DONE "+v); return 0; }
 public static void Main(string[] args) { Run(args); }
}
