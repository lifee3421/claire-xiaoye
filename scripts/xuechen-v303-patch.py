from pathlib import Path

path = Path('public/xuechen/index.html')
text = path.read_text(encoding='utf-8')


def once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, found {count}')
    text = text.replace(old, new, 1)


# 1) Make the quick bedtime-prep picker deliberately click-safe.
once(
    '/* v30.2 · quick ritual combo picker */\n',
    '''/* v30.3 · reliable ritual picker + silent direct goodnight */
#quickRitualLauncher .quick-recipe{
  pointer-events:auto;
  position:relative;
  z-index:1;
  touch-action:manipulation;
}
/* v30.2 · quick ritual combo picker */
''',
    'v30.3 picker css',
)

for old, new, label in [
    ('<button class="quick-recipe" data-ritual-quick="light">', '<button type="button" class="quick-recipe" data-ritual-quick="light">', 'light button type'),
    ('<button class="quick-recipe" data-ritual-quick="daily">', '<button type="button" class="quick-recipe" data-ritual-quick="daily">', 'daily button type'),
    ('<button class="quick-recipe" data-ritual-quick="full">', '<button type="button" class="quick-recipe" data-ritual-quick="full">', 'full button type'),
    ('<button class="quick-recipe" data-ritual-quick="custom">', '<button type="button" class="quick-recipe" data-ritual-quick="custom">', 'custom button type'),
    ('<button class="btn quick-primary" id="quickRitualStartBtn">开始睡前准备</button>', '<button type="button" class="btn quick-primary" id="quickRitualStartBtn">开始睡前准备</button>', 'ritual start button type'),
]:
    once(old, new, label)

# Dynamic saved-template cards: use one stable delegated click handler on the persistent launcher.
once(
'''    const b=document.createElement("button");
    b.className="quick-recipe"+(choice===`saved:${item.id}`?" active":"");
    const total=(item.modules||[]).reduce((sum,m)=>sum+Number((item.minutes||{})[m]||0),0);
    b.innerHTML=`<b>${item.name}</b><span>我的模板 · ${(item.modules||[]).length} 步 · 约 ${total}min</span>`;
    b.onclick=()=>{
      if(ritualRunning)return;
      state.ritualTonightChoice=`saved:${item.id}`;
      save();
      renderRitualPresets();
      renderRitualRunner();
    };
    quickRitualSavedGrid.appendChild(b);''',
'''    const b=document.createElement("button");
    b.type="button";
    b.dataset.ritualSaved=item.id;
    b.className="quick-recipe"+(choice===`saved:${item.id}`?" active":"");
    const total=(item.modules||[]).reduce((sum,m)=>sum+Number((item.minutes||{})[m]||0),0);
    b.innerHTML=`<b>${item.name}</b><span>我的模板 · ${(item.modules||[]).length} 步 · 约 ${total}min</span>`;
    quickRitualSavedGrid.appendChild(b);''',
    'saved ritual delegated buttons',
)

once(
'''quickRitualBtns.forEach(btn=>{
  btn.onclick=()=>{
    if(ritualRunning||recipeRunning)return;
    state.ritualTonightChoice=btn.dataset.ritualQuick;
    save();
    renderRitualPresets();
    renderRitualRunner();
  };
});''',
'''quickRitualBtns.forEach(btn=>{ btn.type="button"; });
quickRitualLauncher.addEventListener("click",event=>{
  const btn=event.target.closest("[data-ritual-quick],[data-ritual-saved]");
  if(!btn || !quickRitualLauncher.contains(btn) || ritualRunning || recipeRunning)return;
  event.preventDefault();
  event.stopPropagation();
  const savedId=btn.getAttribute("data-ritual-saved");
  const quickId=btn.getAttribute("data-ritual-quick");
  const choice=savedId?`saved:${savedId}`:quickId;
  if(!choice)return;
  state.ritualTonightChoice=choice;
  save();
  renderRitualPresets();
  renderRitualRunner();
});''',
    'stable quick ritual event delegation',
)

# 2) Direct goodnight is silent again: no audio asset, no playVoice, immediate candidate.
once(
    '<b>晚安</b><span>听雪尘说一句晚安，然后直接睡。</span>',
    '<b>晚安</b><span>什么都不播，直接睡。</span>',
    'silent goodnight copy',
)
once(
    '<script src="/xuechen/audio-data-c.js"></script>\n',
    '',
    'remove goodnight audio script',
)
once(
    'const GOODNIGHT_AUDIO=XUECHEN_AUDIO["a33"];\n',
    '',
    'remove goodnight audio const',
)
once(
'''let goodnightPlaying=false;
async function chooseNightPath(path){
  if(state.promiseStatus==="candidate"||state.promiseStatus==="exception"||goodnightPlaying)return;''',
'''async function chooseNightPath(path){
  if(state.promiseStatus==="candidate"||state.promiseStatus==="exception")return;''',
    'remove goodnight playing guard',
)
once(
'''  if(path==="goodnight"){
    goodnightPlaying=true;
    setRecipeStatus("晚安","雪尘说完这一句，就不再打扰你了。");
    try{
      await playVoice(GOODNIGHT_AUDIO,"晚安");
      commitSleepReached("goodnight");
    }finally{
      goodnightPlaying=false;
    }
    return;
  }''',
'''  if(path==="goodnight"){
    commitSleepReached("goodnight");
    return;
  }''',
    'silent direct goodnight path',
)

# Keep comment accurate.
text = text.replace(
    '/* v30.1 · playlist next + morning advance mode + spoken goodnight */',
    '/* v30.1 · playlist next + morning advance mode */',
    1,
)

path.write_text(text, encoding='utf-8')
print('patched', path)
