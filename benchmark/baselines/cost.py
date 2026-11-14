import json,os,subprocess
from collections import defaultdict
SESS=os.path.expanduser('~/dsh/dsh-test-home/sessions')
ARMS={'solo-dsv4f','solo-glm53f','solo-gem38fh','solo-swe16s','solo-gpt6luna','fn-dsv4f','fn-glm53f','fn-gem38fh','fn-swe16s','fn-gpt6luna'}
EXEC={'dsv4f':'devin/deepseek-v4-flash','glm53f':'glm-5.3-flash','gem38fh':'gemini-3.8-flash-high','swe16s':'devin/swe-1-6-slow','gpt6luna':'gpt-6-luna'}
LEAD='devin/swe-2'
# 示例价卡 USD/Mtok (in, cacheRead, out) — 按公开相近模型估,请替换 cpa 实际价
PRICES={
 'devin/swe-2':            (3.0,  0.30, 15.0),  # premium coding model
 'devin/deepseek-v4-flash':(0.27, 0.07,  1.1),  # deepseek 官方价
 'glm-5.3-flash':          (0.60, 0.15,  2.2),  # GLM-flash 参考
 'gemini-3.8-flash-high':  (0.30, 0.075, 2.5),  # gemini-flash 参考
 'devin/swe-1-6-slow':     (1.0,  0.10,  5.0),  # swe 低速参考
 'gpt-6-luna':             (0.25, 0.03,  2.0),  # mini 级参考
}
latest={}
for l in open('/tmp/fusion-bench/results-2026-11-12.jsonl'):
 try:r=json.loads(l)
 except:continue
 if r.get('ws2') and r.get('arm') in ARMS and r.get('status')=='completed': latest[r['key']]=r
sess={}
for ws in os.listdir(SESS):
 for sid in os.listdir(os.path.join(SESS,ws)):
  p=os.path.join(SESS,ws,sid,'session.v4.jsonl.zstd')
  if os.path.exists(p): sess[sid]=p
def use(sid):
 p=sess.get(sid)
 if not p:return 0,0,0
 out=subprocess.run(['zstd','-dc',p],capture_output=True,text=True).stdout
 i=o=c=0
 for line in out.split('\n'):
  if '"assistant/message"' not in line:continue
  try:e=json.loads(line)
  except:continue
  d=e.get('data',e);u=d.get('usage')
  for s in d.get('stream',[]):
   if isinstance(s,dict) and s.get('chunk',{}).get('usage'):u=s['chunk']['usage']
  if u:i+=u.get('inputTokens',0);o+=u.get('outputTokens',0);c+=u.get('cacheReadTokens',0)
 return i,o,c
agg=defaultdict(lambda:[0,0,0,0])
for k,r in latest.items():
 i,o,c=use(r['sid']);a=agg[r['arm']];a[0]+=1;a[1]+=i;a[2]+=o;a[3]+=c
def cost(model,i,c,o):
 p=PRICES[model];return i*p[0]/1e6+c*p[1]/1e6+o*p[2]/1e6
print('| 臂 | 计费模型 | runs | 输入tok | 缓存读tok | 输出tok | 单任务成本$ | 全套$ |')
print('|---|---|---|---|---|---|---|---|')
for arm in sorted(agg):
 n,i,o,c=agg[arm]
 model = LEAD if arm.startswith('fn-') else EXEC[arm.split('-',1)[1]]
 per=cost(model,i/n,c/n,o/n); suite=cost(model,i,c,o)
 print(f"| {arm} | {model} | {n} | {i/n:,.0f} | {c/n:,.0f} | {o/n:,.0f} | {per:.4f} | {suite:.2f} |")
