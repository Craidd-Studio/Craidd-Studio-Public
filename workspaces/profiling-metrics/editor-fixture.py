"""Deterministic multi-series editor fixture; no session-clock alignment implied."""
import csv, math, pathlib, sys
root=pathlib.Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True)
with (root/'server-metrics.csv').open('w') as main,(root/'server-sections.csv').open('w') as companion:
    a,b=csv.writer(main),csv.writer(companion)
    a.writerow(['elapsed_s','loop_ms_mean','loop_ms_p95','loop_ms_p99','loop_ms_max','physics_ms','ai_ms','entity_count','rx_kb_s','note'])
    b.writerow(['elapsed_s','recv','update','send','other'])
    for i in range(20000):
        slow=18 if i in (4200,11999,15100) else 0
        mean=7+math.sin(i*.035)*.8+math.sin(i*.7)*.35
        a.writerow([round(i*.1,1),round(mean,3),round(mean+3+slow*.4,3),round(mean+6+slow*.7,3),round(mean+10+slow,3),round(3+math.sin(i*.04)*.3,3),round(2+math.sin(i*.05)*.2,3),9000+i%200,round(100+i%50*.8,2),'slow window' if slow else 'steady'])
    # Reversed order proves companions join by declared keys, never row position.
    for i in reversed(range(20000)):
        b.writerow([round(i*.1,1),1,3.5,1.2,.7])
