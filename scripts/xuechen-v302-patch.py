from pathlib import Path

path = Path('public/xuechen/index.html')
text = path.read_text(encoding='utf-8')


def once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, found {count}')
    text = text.replace(old, new, 1)


once(
    '  <div class="quick-sleep-launcher hidden" id="quickSleepLauncher">',
    '''  <div class="quick-sleep-launcher quick-ritual-launcher hidden" id="quickRitualLauncher">
    <div class="quick-sleep-head">
      <div>
        <div class="section-label">睡前准备</div>
        <div class="quick-sleep-title" id="quickRitualTitle">今晚怎么准备</div>
      </div>
      <div class="small" id="quickRitualSummary"></div>
    </div>

    <div class="quick-recipe-grid" id="quickRitualGrid">
      <button class="quick-recipe" data-ritual-quick="light"><b>轻量收尾</b><span>洗漱 · 护肤 · 准备明天</span></button>
      <button class="quick-recipe" data-ritual-quick="daily"><b>日常准备</b><span>整理 · 洗漱 · 护肤 · 明天</span></button>
      <button class="quick-recipe" data-ritual-quick="full"><b>完整收尾</b><span>复盘 · 整理 · 洗漱 · 拉伸 · 阅读</span></button>
      <button class="quick-recipe" data-ritual-quick="custom"><b>自己选</b><span>使用下面你自己勾选的今晚流程</span></button>
    </div>
    <div class="quick-recipe-grid" id="quickRitualSavedGrid"></div>

    <button class="btn quick-primary" id="quickRitualStartBtn">开始睡前准备</button>
    <div class="small" id="quickRitualHint" style="margin-top:6px">今晚临时选的组合不会改掉你保存的模板。</div>
  </div>

  <div class="quick-sleep-launcher hidden" id="quickSleepLauncher">''',
    'quick ritual launcher html',
)

once(
    '    selectedRitualPreset:"gentle",\n',
    '    selectedRitualPreset:"gentle",\n    ritualTonightChoice:"daily",\n',
    'ritualTonightChoice default',
)

once(
    '  state.nightPath=null;\n  state.sleepReachedAt=null;',
    '  state.nightPath=null;\n  state.ritualTonightChoice="daily";\n  state.sleepReachedAt=null;',
    'night reset ritual choice',
)

once(
    'const exceptionBtn=document.getElementById("exceptionBtn");\nconst quickSleepLauncher=document.getElementById("quickSleepLauncher");',
    '''const exceptionBtn=document.getElementById("exceptionBtn");
const quickRitualLauncher=document.getElementById("quickRitualLauncher");
const quickRitualTitle=document.getElementById("quickRitualTitle");
const quickRitualSummary=document.getElementById("quickRitualSummary");
const quickRitualBtns=[...document.querySelectorAll("[data-ritual-quick]")];
const quickRitualSavedGrid=document.getElementById("quickRitualSavedGrid");
const quickRitualStartBtn=document.getElementById("quickRitualStartBtn");
const quickRitualHint=document.getElementById("quickRitualHint");
const quickSleepLauncher=document.getElementById("quickSleepLauncher");''',
    'quick ritual dom refs',
)

ritual_options = '''const RITUAL_CUSTOM_OPTIONS=[
  {module:"ritual_review",label:"今日复盘",defaultMinutes:10},
  {module:"ritual_tidy",label:"整理环境",defaultMinutes:5},
  {module:"ritual_wash",label:"睡前洗漱",defaultMinutes:10},
  {module:"ritual_skincare",label:"护肤 / 简单护理",defaultMinutes:7},
  {module:"ritual_tomorrow",label:"准备明天的东西",defaultMinutes:5},
  {module:"ritual_schedule",label:"看一眼明日日程",defaultMinutes:4},
  {module:"ritual_stretch",label:"轻度拉伸",defaultMinutes:8},
  {module:"ritual_reading",label:"墨水屏 / 纸质阅读",defaultMinutes:15},
  {module:"ritual_quiet",label:"只听音乐 / 安静坐一会儿",defaultMinutes:10}
];
'''

once(
    ritual_options,
    ritual_options + '''
const QUICK_RITUAL_COMBOS={
  light:{
    name:"轻量收尾",reason:"很困的时候，只做最必要的三件事。",
    steps:[
      {label:"睡前洗漱",minutes:10,module:"ritual_wash"},
      {label:"护肤 / 简单护理",minutes:7,module:"ritual_skincare"},
      {label:"准备明天的东西",minutes:5,module:"ritual_tomorrow"}
    ]
  },
  daily:{
    name:"日常准备",reason:"普通晚上用这一套，够完整，也不会拖太久。",
    steps:[
      {label:"整理环境",minutes:5,module:"ritual_tidy"},
      {label:"睡前洗漱",minutes:10,module:"ritual_wash"},
      {label:"护肤 / 简单护理",minutes:7,module:"ritual_skincare"},
      {label:"准备明天的东西",minutes:5,module:"ritual_tomorrow"},
      {label:"看一眼明日日程",minutes:4,module:"ritual_schedule"}
    ]
  },
  full:{
    name:"完整收尾",reason:"今晚还有余力，就把一天完整地收好。",
    steps:[
      {label:"今日复盘",minutes:10,module:"ritual_review"},
      {label:"整理环境",minutes:5,module:"ritual_tidy"},
      {label:"睡前洗漱",minutes:10,module:"ritual_wash"},
      {label:"护肤 / 简单护理",minutes:7,module:"ritual_skincare"},
      {label:"准备明天的东西",minutes:5,module:"ritual_tomorrow"},
      {label:"看一眼明日日程",minutes:4,module:"ritual_schedule"},
      {label:"轻度拉伸",minutes:8,module:"ritual_stretch"},
      {label:"墨水屏 / 纸质阅读",minutes:15,module:"ritual_reading"}
    ]
  }
};
''',
    'quick ritual combos',
)

once(
    '''function selectedRitual(){
  return currentCustomRitual();
}''',
    '''function selectedRitual(){
  const choice=state.ritualTonightChoice||"daily";
  if(QUICK_RITUAL_COMBOS[choice])return QUICK_RITUAL_COMBOS[choice];
  if(choice.startsWith("saved:")){
    const id=choice.slice(6);
    const item=(state.customRitualTemplates||[]).find(x=>x.id===id);
    if(item){
      const byId=Object.fromEntries(RITUAL_CUSTOM_OPTIONS.map(x=>[x.module,x]));
      return {
        name:item.name,
        reason:"今晚临时套用你保存的模板，不会改掉默认流程。",
        steps:(item.modules||[]).filter(m=>byId[m]).map(module=>({
          label:byId[module].label,
          module,
          minutes:Math.max(1,Math.min(60,Number((item.minutes||{})[module]||byId[module].defaultMinutes)))
        }))
      };
    }
  }
  return currentCustomRitual();
}''',
    'selectedRitual quick override',
)

once(
    '  state.selectedRitualPreset=id;\n  state.ritualCustomName=p.name;',
    '  state.selectedRitualPreset=id;\n  state.ritualTonightChoice="custom";\n  state.ritualCustomName=p.name;',
    'legacy preset becomes custom tonight',
)

once(
    '  state.selectedRitualPreset="custom";\n  state.ritualCustomName=item.name;',
    '  state.selectedRitualPreset="custom";\n  state.ritualTonightChoice="custom";\n  state.ritualCustomName=item.name;',
    'saved apply becomes custom tonight',
)

once(
    '  state.ritualCustomModules=arr;\n  state.selectedRitualPreset="custom";\n  state.ritualCustomName="我的今晚流程";',
    '  state.ritualCustomModules=arr;\n  state.selectedRitualPreset="custom";\n  state.ritualTonightChoice="custom";\n  state.ritualCustomName="我的今晚流程";',
    'move custom marks tonight custom',
)

once(
    '      state.selectedRitualPreset="custom";\n      state.ritualCustomName="我的今晚流程";\n      state.ritualCustomReason="你自己选的睡前准备。";',
    '      state.selectedRitualPreset="custom";\n      state.ritualTonightChoice="custom";\n      state.ritualCustomName="我的今晚流程";\n      state.ritualCustomReason="你自己选的睡前准备。";',
    'checkbox custom marks tonight custom',
)

once(
    '      state.selectedRitualPreset="custom";\n      state.ritualCustomName="我的今晚流程";\n      state.ritualCustomReason="你自己调过时长的睡前准备。";',
    '      state.selectedRitualPreset="custom";\n      state.ritualTonightChoice="custom";\n      state.ritualCustomName="我的今晚流程";\n      state.ritualCustomReason="你自己调过时长的睡前准备。";',
    'minutes custom marks tonight custom',
)

once(
    '  renderCustomRitualEditor();\n}\nfunction renderRitualRunner(){',
    '  renderCustomRitualEditor();\n  renderQuickRitualLauncher();\n}\nfunction renderRitualRunner(){',
    'refresh quick ritual from editor',
)

once(
    '  renderSavedTemplates();\n}\n\nfunction applySavedRitualTemplate(id){',
    '  renderSavedTemplates();\n  renderQuickRitualLauncher();\n}\n\nfunction applySavedRitualTemplate(id){',
    'save template refresh quick',
)

once(
    '  save();\n  renderSavedTemplates();\n}\n\nfunction renderSavedTemplates(){',
    '  save();\n  renderSavedTemplates();\n  renderQuickRitualLauncher();\n}\n\nfunction renderSavedTemplates(){',
    'delete template refresh quick',
)

once(
    'function renderQuickSleepLauncher(){',
    '''function renderQuickRitualLauncher(){
  const p=state.nightPath;
  const relevant=(p==="ritual"||p==="both") &&
    state.promiseStatus!=="candidate" && state.promiseStatus!=="exception";
  quickRitualLauncher.classList.toggle("hidden",!relevant);
  if(!relevant)return;

  let choice=state.ritualTonightChoice||"daily";
  if(choice.startsWith("saved:")){
    const exists=(state.customRitualTemplates||[]).some(x=>`saved:${x.id}`===choice);
    if(!exists){choice="daily";state.ritualTonightChoice=choice;save();}
  }
  quickRitualBtns.forEach(btn=>btn.classList.toggle("active",btn.dataset.ritualQuick===choice));

  quickRitualSavedGrid.innerHTML="";
  (state.customRitualTemplates||[]).forEach(item=>{
    const b=document.createElement("button");
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
    quickRitualSavedGrid.appendChild(b);
  });

  const ritual=selectedRitual();
  const total=ritual.steps.reduce((sum,x)=>sum+x.minutes,0);
  quickRitualTitle.textContent=p==="both"?"先选今晚怎么准备":"今晚怎么准备";
  quickRitualSummary.textContent=`${ritual.name} · ${ritual.steps.length} 步 · 约 ${total}min`;
  quickRitualStartBtn.textContent="开始睡前准备";
  quickRitualHint.textContent=choice==="custom"
    ?"现在用的是你下方自己勾选的今晚流程；需要改项目时往下调整。"
    :"今晚只是临时套用这套组合，不会改掉你保存的模板。";
}

quickRitualBtns.forEach(btn=>{
  btn.onclick=()=>{
    if(ritualRunning||recipeRunning)return;
    state.ritualTonightChoice=btn.dataset.ritualQuick;
    save();
    renderRitualPresets();
    renderRitualRunner();
  };
});

quickRitualStartBtn.onclick=async()=>{
  if(!(state.nightPath==="ritual"||state.nightPath==="both"))return;
  ritualView.classList.remove("hidden");
  await startRitualFlow();
};

function renderQuickSleepLauncher(){''',
    'quick ritual runtime',
)

once(
    '''  quickSleepTitle.textContent=p==="both"?"睡前准备之后，怎么睡":"今晚怎么睡";
  quickSleepSummary.textContent=recipe.name;
  quickSleepStartBtn.textContent=p==="both"?"开始睡前准备":"开始睡眠引导";
  quickSleepHint.textContent=p==="both"
    ?"睡前准备结束后，会自动接上你这里选好的睡眠引导。"
    :"选好以后直接开始，不用再往下翻。";''',
    '''  quickSleepTitle.textContent=p==="both"?"睡前准备之后，怎么睡":"今晚怎么睡";
  quickSleepSummary.textContent=recipe.name;
  quickSleepStartBtn.classList.toggle("hidden",p==="both");
  quickSleepStartBtn.textContent="开始睡眠引导";
  quickSleepHint.textContent=p==="both"
    ?"这里先选好睡眠引导；真正开始请点上面的「开始睡前准备」，结束后会自动接上。"
    :"选好以后直接开始，不用再往下翻。";''',
    'both sleep launcher no duplicate start',
)

once(
    '''quickSleepStartBtn.onclick=async()=>{
  if(state.nightPath==="sleep"){
    sleepView.classList.remove("hidden");
    await startV11();
    return;
  }
  if(state.nightPath==="both"){
    await startRitualFlow();
  }
};''',
    '''quickSleepStartBtn.onclick=async()=>{
  if(state.nightPath==="sleep"){
    sleepView.classList.remove("hidden");
    await startV11();
  }
};''',
    'quick sleep start only sleep path',
)

once(
    '    quickSleepLauncher.classList.add("hidden");\n    if(state.nightPath==="both"||state.nightPath==="sleep"){',
    '    quickRitualLauncher.classList.add("hidden");\n    quickSleepLauncher.classList.add("hidden");\n    if(state.nightPath==="both"||state.nightPath==="sleep"){',
    'hide ritual launcher after fulfillment',
)

once(
    '  renderQuickSleepLauncher();\n}\n\nfunction renderFulfillment(){',
    '  renderQuickRitualLauncher();\n  renderQuickSleepLauncher();\n}\n\nfunction renderFulfillment(){',
    'render both launchers',
)

once(
    '''  if(path==="ritual"){
    await startRitualFlow();
    return;
  }''',
    '''  if(path==="ritual"){
    renderQuickRitualLauncher();
    return;
  }''',
    'ritual path waits for combo selection',
)

once(
    '''  if(path==="both"){
    renderQuickSleepLauncher();
    return;
  }''',
    '''  if(path==="both"){
    renderQuickRitualLauncher();
    renderQuickSleepLauncher();
    return;
  }''',
    'both path renders both pickers',
)

once(
    '    quickSleepLauncher.classList.add("hidden");\n    startGuideBtn.disabled=false;',
    '    quickRitualLauncher.classList.add("hidden");\n    quickSleepLauncher.classList.add("hidden");\n    startGuideBtn.disabled=false;',
    'hide launchers entering guide',
)

once(
    'renderV11();\nrenderQuickSleepLauncher();\nrenderNoteAction();',
    'renderV11();\nrenderQuickRitualLauncher();\nrenderQuickSleepLauncher();\nrenderNoteAction();',
    'initial quick ritual render',
)

once(
    '/* v30.1 · playlist next + morning advance mode + spoken goodnight */',
    '/* v30.2 · quick ritual combo picker */\n/* v30.1 · playlist next + morning advance mode + spoken goodnight */',
    'v30.2 marker',
)

required = [
    'id="quickRitualLauncher"',
    'data-ritual-quick="light"',
    'data-ritual-quick="daily"',
    'data-ritual-quick="full"',
    'data-ritual-quick="custom"',
    'const QUICK_RITUAL_COMBOS=',
    'function renderQuickRitualLauncher()',
    'ritualTonightChoice:"daily"',
    '/* v30.2 · quick ritual combo picker */',
]
for needle in required:
    if needle not in text:
        raise SystemExit(f'missing expected marker: {needle}')

path.write_text(text, encoding='utf-8')
