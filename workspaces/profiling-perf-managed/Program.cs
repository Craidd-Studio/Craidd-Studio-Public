// Shared .NET/Mono fixture. Produces its own hot work; stdin "stop" exits normally.
using System;
using System.Runtime.CompilerServices;
using System.Threading;

public static class ManagedPerfFixture
{
    private static volatile bool running = true;
    private static long result;

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static long KnownJitHot(long value)
    {
        unchecked
        {
            for (int index = 0; index < 20000; ++index)
                value = (value * 6364136223846793005L + 1442695040888963407L) ^ (value >> 17);
        }
        return value;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static long KnownJitParent(long value) { return KnownJitHot(value); }

    public static void Main()
    {
        var workers = new Thread[2];
        for (int index = 0; index < workers.Length; ++index)
        {
            int captured = index;
            workers[index] = new Thread(() => {
                long value = captured + 1;
                while (running) value = KnownJitParent(value);
                Interlocked.Exchange(ref result, value);
            });
            workers[index].Name = "jit-hot-" + index;
            workers[index].Start();
        }
        Console.WriteLine("READY");
        string command;
        while ((command = Console.ReadLine()) != null && command != "stop") { }
        running = false;
        foreach (var worker in workers) worker.Join();
        Console.WriteLine("STOPPED " + result);
    }
}
