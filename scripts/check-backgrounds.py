# Regression check: no background x palette combination may render a near-empty dark frame (run: .venv/bin/python3 scripts/check-backgrounds.py)
import json,subprocess,sys,cv2,numpy as np
D={'editorial':(["#080706","#17120b","#4f3d17"],"#d4af37"),'cine':(["#040408","#0f0f1b","#33243f"],"#e9c46a"),'tech':(["#03040b","#08112e","#27227a"],"#6ee7ff"),'corp':(["#050a18","#0a1d45","#1c4ed0"],"#60a5fa"),'organic':(["#04120d","#0b3a2c","#0f6b56"],"#86efac"),'pop':(["#14060a","#3a0e12","#9a2d12"],"#ffb020")}
worst=1; bad=[]
for name,(cols,acc) in D.items():
  for bt in ["bokeh","beams","contours","geo","grid","mesh","waves","aurora","gradient","solid","particles"]:
    j=dict(out=f"/tmp/bg_check.mp4",w=216,h=384,fps=10,seconds=3,beat=.5,beatT0=0,seed=2,bg=dict(type=bt,colors=cols,accent=acc,speed=1,dim=.45),text=dict(color="#fff",font="modern",upper=False,anim="words"),fx=dict(grain=.3,vignette=.8),motif="none",scene=dict(kind="text",title="Nova Speaker",composition="default"))
    subprocess.run([".venv/bin/python3","src/lib/auto/scene_render.py"],input=json.dumps(j),text=True,check=True,capture_output=True)
    cap=cv2.VideoCapture("/tmp/bg_check.mp4"); fr=[]
    while True:
      ok,f=cap.read()
      if not ok: break
      fr.append((cv2.cvtColor(f,cv2.COLOR_BGR2GRAY)>26).mean())   # fraction of pixels above 10% luma
    m=min(fr); worst=min(worst,m)
    if m<0.04: print("DARK",name,bt,round(m,3)); bad.append((name,bt))
print("worst lit fraction",round(worst,3)); sys.exit(1 if bad else 0)
