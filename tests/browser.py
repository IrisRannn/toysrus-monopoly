"""Real-browser acceptance checks. Needs running dev app and Python Playwright.
Creates its own room, approved questions are never fabricated in the live room.
"""
import json, re, os, io, math, struct, wave
from playwright.sync_api import sync_playwright, expect
BASE=os.environ.get('E2E_BASE_URL','http://127.0.0.1:5180')
DELAY_ENDPOINT=os.environ.get('E2E_DELAY_ENDPOINT')
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    ctx=browser.new_context(viewport={'width':1440,'height':1000})
    def page(context=ctx):
        x=context.new_page();x.on('pageerror',lambda e: errors.append(str(e)));return x
    host=page();host.goto(BASE+'/host?room=')
    # Open creation screen explicitly even if another dev room exists.
    if host.locator('.host-app').count():
        host.evaluate("localStorage.clear()")
        host.reload()
    expect(host.locator('input[type=password]')).to_have_count(0)
    host.get_by_role('button',name='＋ 创建新房间',exact=True).click()
    host.wait_for_url(re.compile(r'.*/host\?room=\d{6}'))
    code=host.url.split('room=')[1]
    expect(host.get_by_role('heading',name='现场控制',exact=True)).to_be_visible()
    token=host.evaluate(f"localStorage.getItem('monopoly:{code}:host')")
    def api(kind,payload={}):
        response=ctx.request.post(BASE+f'/api/rooms/{code}/commands',headers={'x-game-role':'host','Authorization':'Bearer '+token},data={'type':kind,'payload':payload})
        assert response.ok, response.text()
    def state(role='host',credential=token):
        r=ctx.request.get(BASE+f'/api/rooms/{code}/state',headers={'x-game-role':role,'Authorization':'Bearer '+credential})
        assert r.ok,r.text();return r.json()
    assert len(state()['questions'])==19
    host.get_by_role('button',name='题库管理',exact=True).click()
    expect(host.get_by_role('heading',name='全部题目 · 19',exact=True)).to_be_visible()
    expect(host.get_by_role('combobox',name='所属格子',exact=True)).to_have_value('0')
    host.reload()
    assert len(state()['questions'])==19
    host.get_by_role('button',name='现场控制',exact=True).click()
    print('PASS built-in 19-question shared bank loads automatically and survives page refresh',flush=True)
    if ctx.request.get(BASE+'/api/health').json()['mode']=='development':
        for path in ['/data/game.sqlite?raw','/@fs/workspace/toysrus-monopoly/data/game.sqlite?raw','/server/lib/engine.js?raw']:
            assert ctx.request.get(BASE+path).status==403
        print('PASS development private database/source downloads denied',flush=True)
    players=[]
    for name in ['东区','中南区','北区','西区','上海SSC']:
        mobile=page(browser.new_context(viewport={'width':390,'height':844}))
        mobile.goto(BASE+f'/player?room={code}')
        mobile.get_by_placeholder('怎么称呼你？').fill('浏览器测试-'+name)
        mobile.get_by_role('button',name=re.compile('^'+name)).click()
        mobile.get_by_role('button',name='加入游戏 →',exact=True).click()
        expect(mobile.locator('.player-hero h1')).to_contain_text(name)
        players.append(mobile)
    expect(host.locator('.team-overview').get_by_text('1 人加入 · 1 人在线')).to_have_count(5)
    screen=page();screen.set_viewport_size({'width':1920,'height':1080})
    screen.add_init_script('''
      window.__soundNotes=[];
      const OriginalAudioContext=window.AudioContext;
      window.AudioContext=class extends OriginalAudioContext {
        createOscillator(){
          const node=super.createOscillator(); let frequency=0;
          const set=node.frequency.setValueAtTime.bind(node.frequency);
          node.frequency.setValueAtTime=(value,time)=>{frequency=value;return set(value,time)};
          const start=node.start.bind(node);
          node.start=(time)=>{window.__soundNotes.push({frequency,type:node.type,at:performance.now()});return start(time)};
          return node;
        }
      };
    ''')
    screen.goto(BASE+f'/screen?room={code}')
    screen.get_by_role('button',name='开启大屏声音',exact=True).click()
    expect(screen.get_by_role('button',name='静音大屏',exact=True)).to_be_visible()
    assert all(m.locator('audio').count()==0 for m in players)
    assert host.locator('audio').count()==0
    # A generated test tone checks upload/playback; it is not the event's BGM.
    output=io.BytesIO()
    with wave.open(output,'wb') as wav:
        wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(8000)
        wav.writeframes(b''.join(struct.pack('<h',int(1500*math.sin(2*math.pi*330*i/8000))) for i in range(8000)))
    host.locator('.audio-controls input[type=file]').set_input_files({'name':'浏览器测试音.wav','mimeType':'audio/wav','buffer':output.getvalue()})
    expect(host.locator('.bgm-file-name')).to_have_text('浏览器测试音.wav')
    host.get_by_role('button',name='播放背景音乐',exact=True).click()
    screen.wait_for_function("document.querySelector('audio')?.paused === false && document.querySelector('audio').currentTime>0.1")
    assert screen.locator('audio').evaluate('(x)=>x.loop')
    screen.evaluate('window.__bgmStarted=performance.now()')
    screen.wait_for_function("performance.now()-window.__bgmStarted>1300 && !document.querySelector('audio').paused")
    assert abs(screen.locator('audio').evaluate('(x)=>x.volume')-.25)<.01
    host.get_by_role('slider',name=re.compile('音乐音量')).press('End')
    screen.wait_for_function("document.querySelector('audio').volume === 1")
    api('audioSettings',{'bgmVolume':.25})
    screen.wait_for_function("document.querySelector('audio').volume === .25")
    screen.get_by_role('button',name='静音大屏',exact=True).click()
    screen.wait_for_function("document.querySelector('audio').paused")
    screen.get_by_role('button',name='恢复大屏声音',exact=True).click()
    screen.wait_for_function("!document.querySelector('audio').paused")
    host.get_by_role('button',name='暂停背景音乐',exact=True).click()
    screen.wait_for_function("document.querySelector('audio').paused")
    print('PASS BGM upload, loop playback, host pause and local screen mute; employee phones stay silent',flush=True)
    expect(screen.locator('.game-token')).to_have_count(5)
    screen.wait_for_function("document.querySelector('.board-original')?.naturalWidth === 1920 && document.querySelector('.board-original')?.naturalHeight === 1080")
    assert not screen.locator('.asset-missing').count()
    screen.screenshot(path='/workspace/monopoly-screen-ready.png')
    boxes=screen.locator('.game-token').evaluate_all('(nodes)=>nodes.map(n=>({left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom}))')
    def no_overlap(rects):
        return all(a['right']<=b['left'] or b['right']<=a['left'] or a['bottom']<=b['top'] or b['bottom']<=a['top'] for i,a in enumerate(rects) for b in rects[i+1:])
    assert no_overlap(boxes),boxes
    assert screen.evaluate('document.documentElement.scrollHeight === innerHeight')
    print('PASS five teams join, host counts, five named non-overlapping tokens, 16:9 screen without scroll',flush=True)
    for team in ['east','central','north','west','shanghai']:
        api('manualMove',{'team':team,'position':1,'reason':'独立测试房间同格验证'})
    expect(screen.locator('.game-token[data-position="1"]')).to_have_count(5)
    same_tile=screen.locator('.game-token').evaluate_all('(nodes)=>nodes.map(n=>({left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom}))')
    assert no_overlap(same_tile),same_tile
    assert max(r['right'] for r in same_tile)-min(r['left'] for r in same_tile)<400, 'enlarged same-tile group must stay within its cluster'
    screen.screenshot(path='/workspace/monopoly-same-tile.png')
    def normalized():
        return screen.locator('.game-token').evaluate_all('(nodes)=>{const r=document.querySelector(".board-canvas").getBoundingClientRect();return nodes.map(n=>{const b=n.getBoundingClientRect();return [(b.left-r.left)/r.width,(b.top-r.top)/r.height]})}')
    original=normalized()
    screen.set_viewport_size({'width':1280,'height':720})
    expect(screen.locator('.screen-stage')).to_have_css('width','1280px')
    scaled=normalized()
    assert all(abs(a-b)<0.002 for old,new in zip(original,scaled) for a,b in zip(old,new))
    screen.set_viewport_size({'width':1920,'height':1080})
    api('reset',{'confirm':code})
    expect(screen.locator('.game-token[data-position="0"]')).to_have_count(5)
    print('PASS five teams on tile01 do not overlap; resizing 1920x1080 to1280x720 retains normalized coordinates',flush=True)
    expect(host.get_by_role('checkbox',name='普通线上回合结束后自动切换下一队',exact=True)).to_be_checked()
    # Every possible roll from17 finishes without a quiz: verify real automatic
    # handoff using the backend's random dice, never sending a host next command.
    api('manualMove',{'team':'east','position':17,'reason':'独立测试房间验证普通回合自动切队'})
    host.get_by_role('button',name='▶ 开始游戏',exact=True).click()
    east=players[0]
    east.get_by_role('button',name='成为本回合投骰代表',exact=True).click()
    if DELAY_ENDPOINT: ctx.request.post(BASE+DELAY_ENDPOINT,data={'ms':600})
    east.get_by_role('button',name='🎲 投骰子',exact=True).click()
    if DELAY_ENDPOINT:
        expect(east.get_by_role('button',name='正在投骰…',exact=True)).to_be_disabled()
        ctx.request.post(BASE+DELAY_ENDPOINT,data={'ms':0})
    expect(host.locator('.current-turn')).to_contain_text('点')
    assert screen.locator('.screen-dice .dice-stage').bounding_box()['width']>150
    expect(host.locator('.current-turn h2')).to_contain_text('中南区',timeout=15000)
    expect(players[1].get_by_role('button',name='成为本回合投骰代表',exact=True)).to_be_visible()
    after=state();assert after['teams']['east']['position']>=18
    assert after['currentTeam']=='central' and after['phase']=='awaiting_dice'
    expect(screen.locator('[data-team=east]')).to_have_attribute('data-position',str(after['teams']['east']['position']))
    screen.reload();expect(screen.locator('[data-team=east]')).to_have_attribute('data-position',str(after['teams']['east']['position']))
    screen.get_by_role('button',name='开启大屏声音',exact=True).click()
    east.reload();expect(east.locator('.player-hero')).to_contain_text('浏览器测试-东区')
    host.reload();expect(host.locator('.current-turn')).to_contain_text('中南区')
    print('PASS ordinary online turn automatically hands off to central without host next; three-screen sync and page refresh recovery',flush=True)
    # Deterministically configure a dedicated test turn via authorized reset/order controls.
    api('reset',{'confirm':code});api('setOrder',{'order':['shanghai','east','central','north','west']});api('start')
    expect(host.get_by_role('heading',name='现场投掷后，点击实际点数')).to_be_visible()
    host.locator('.physical-buttons').get_by_role('button',name='6',exact=True).click()
    dinosaur=screen.locator('.special-event[data-tile="6"]')
    expect(dinosaur).to_be_visible(timeout=15000)
    expect(dinosaur.locator('h2')).to_have_text('糟糕！调皮恐龙拦住去路！')
    expect(dinosaur.locator('.special-event-action')).to_have_text('后退2格')
    screen.wait_for_function("window.__soundNotes.some(n=>n.frequency===261.63)")
    assert screen.evaluate("window.__soundNotes.some(n=>n.frequency===150 || n.frequency===195)")
    api('pause')
    held=state();assert held['teams']['shanghai']['position']==6 and held['phase']=='tile_event'
    presentation_id=held['presentation']['id']
    screen.reload();expect(dinosaur).to_be_visible()
    assert state()['presentation']['id']==presentation_id
    screen.screenshot(path='/workspace/monopoly-dinosaur-effect.png',animations='disabled')
    screen.emulate_media(reduced_motion='reduce')
    assert dinosaur.locator('.special-event-card').evaluate('(x)=>getComputedStyle(x).animationName')=='none'
    screen.emulate_media(reduced_motion='no-preference')
    screen.get_by_role('button',name='开启大屏声音',exact=True).click()
    api('resume')
    host.wait_for_function("document.querySelector('.current-turn')?.innerText.includes('本队回合完成')",timeout=15000)
    after_dinosaur=state()
    assert after_dinosaur['teams']['shanghai']['position']==4
    assert after_dinosaur['quiz'] is None and after_dinosaur['presentation'] is None
    assert after_dinosaur['usedQuestions']==[]
    expect(screen.locator('.special-event')).to_have_count(0)
    host.on('dialog',lambda d:d.accept())
    host.get_by_role('button',name=re.compile('↶ 撤销')).click()
    expect(host.locator('.physical-buttons')).to_be_visible()
    assert state()['teams']['shanghai']['position']==0
    print('PASS dinosaur 6-to-4 spotlight, pause/refresh recovery, reduced motion, no chained quiz and safe undo',flush=True)
    host.locator('.physical-buttons').get_by_role('button',name='2',exact=True).click()
    reward=screen.locator('.special-event[data-tile="2"]')
    expect(reward).to_be_visible(timeout=15000)
    expect(reward.locator('.special-event-action')).to_have_text('前进5格')
    screen.wait_for_function("window.__soundNotes.some(n=>n.frequency===1046.5)")
    api('audioSettings',{'effectsEnabled':False})
    screen.evaluate('window.__soundNotes=[]')
    host.wait_for_function("document.querySelector('.current-turn')?.innerText.includes('本队回合完成')",timeout=15000)
    assert state()['teams']['shanghai']['position']==7 and state()['quiz'] is None
    assert screen.evaluate('window.__soundNotes.length')==0
    api('audioSettings',{'effectsEnabled':True})
    host.get_by_role('button',name=re.compile('↶ 撤销')).click()
    expect(host.locator('.physical-buttons')).to_be_visible()
    # Land on04, import a clearly marked test question via management UI.
    host.get_by_role('button',name='题库管理',exact=True).click()
    host.get_by_label('题目内容',exact=True).fill('自动化验证题（非正式题库）：请选择甲')
    for letter,text in [('A','甲'),('B','乙'),('C','丙'),('D','丁')]:host.get_by_label(letter+' 选项',exact=True).fill(text)
    host.get_by_label('答案解析',exact=True).fill('仅用于独立测试房间')
    host.get_by_role('button',name='保存题目',exact=True).click()
    expect(host.get_by_role('heading',name='自动化验证题（非正式题库）：请选择甲',exact=True)).to_be_visible()
    host.get_by_role('button',name='现场控制',exact=True).click()
    host.locator('.physical-buttons').get_by_role('button',name='4',exact=True).click()
    expect(screen.locator('.special-event[data-kind="quiz"]')).to_be_visible(timeout=15000)
    expect(host.get_by_role('button',name='开始答题',exact=True)).to_be_visible(timeout=15000)
    host.get_by_role('combobox',name='选择题目',exact=True).select_option(label='自动化验证题（非正式题库）：请选择甲')
    host.get_by_role('button',name='开始答题',exact=True).click()
    sh=players[4]
    expect(sh.get_by_role('heading',name='自动化验证题（非正式题库）：请选择甲',exact=True)).to_be_visible()
    # Sound controls stay usable above the question and final-result overlays.
    screen.get_by_role('button',name='静音大屏',exact=True).click()
    screen.get_by_role('button',name='恢复大屏声音',exact=True).click()
    player_token=sh.evaluate(f"localStorage.getItem('monopoly:{code}:player')")
    # All five players share a browser context; identities stay in each socket.
    assert 'answer' not in state('screen','')['quiz']['question']
    sh.get_by_role('button',name=re.compile('^A')).click()
    if DELAY_ENDPOINT: ctx.request.post(BASE+DELAY_ENDPOINT,data={'ms':600})
    sh.get_by_role('button',name='提交答案',exact=True).click()
    if DELAY_ENDPOINT:
        expect(sh.get_by_role('button',name='正在提交…',exact=True)).to_be_disabled()
        ctx.request.post(BASE+DELAY_ENDPOINT,data={'ms':0})
    expect(sh.get_by_text('已提交 A，截止前可修改。',exact=True)).to_be_visible()
    sh.get_by_role('button',name=re.compile('^B')).click()
    sh.get_by_role('button',name='更新我的答案',exact=True).click()
    expect(sh.get_by_text('已提交 B，截止前可修改。',exact=True)).to_be_visible()
    sh.get_by_role('button',name=re.compile('^A')).click()
    sh.get_by_role('button',name='更新我的答案',exact=True).click()
    expect(host.locator('.host-quiz')).to_contain_text('1 / 1 人已提交')
    host.get_by_text('查看员工答题明细',exact=True).click()
    expect(host.locator('.answer-details').get_by_text(re.compile('浏览器测试-上海SSC · A'))).to_be_visible()
    host.get_by_role('button',name='提前结束答题',exact=True).click()
    host.get_by_role('button',name='公布答案',exact=True).click()
    success=screen.locator('.special-event[data-kind="correct"]')
    expect(success).to_be_visible()
    expect(success.locator('h2')).to_have_text('回答正确！')
    expect(success.locator('.special-event-action')).to_have_text('前进3格')
    expect(screen.locator('.screen-quiz')).to_have_count(0)
    expect(sh.get_by_text('答对了，向前出发！',exact=True)).to_be_visible()
    host.wait_for_function("document.querySelector('.current-turn')?.innerText.includes('本队回合完成')",timeout=15000)
    assert state()['teams']['shanghai']['position']==7
    expect(screen.get_by_text('回答正确！',exact=True)).to_be_visible()
    host.get_by_role('button',name='题库管理',exact=True).click()
    expect(host.get_by_text('使用记录（1次）',exact=True)).to_be_visible()
    print('PASS question UI and usage history, private correct answer, editable single vote, reveal and +3 reward',flush=True)
    # Verify calibrator saves and exports actual percentage data.
    host.get_by_role('button',name='棋盘校准',exact=True).click()
    expect(host.locator('.calibration-point')).to_have_count(20)
    point=host.locator('.calibration-point').first
    box=point.bounding_box()
    host.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
    host.mouse.down();host.mouse.move(box['x']+box['width']/2+15,box['y']+box['height']/2+6,steps=5);host.mouse.up()
    host.get_by_role('button',name='保存并同步坐标',exact=True).click()
    expect(host.get_by_text('坐标已保存，其他页面将实时更新。',exact=True)).to_be_visible()
    assert abs(state()['positions'][0]['x']-16)>0.1
    host.get_by_role('button',name='现场控制',exact=True).click()
    host.get_by_role('button',name='结束游戏',exact=True).click()
    expect(screen.get_by_role('heading',name='每一步，都精彩。',exact=True)).to_be_visible()
    screen.get_by_role('button',name='静音大屏',exact=True).click()
    expect(screen.get_by_role('button',name='恢复大屏声音',exact=True)).to_be_visible()
    host.get_by_role('button',name='排名与抽奖',exact=True).click()
    if host.locator('.tie-confirm').count():
        for checkbox in host.locator('.tie-confirm input[type=checkbox]').all(): checkbox.check()
        host.get_by_role('button',name='记录并确认资格',exact=True).click()
    expect(host.get_by_role('button',name='导出抽奖候选名单 ↓',exact=True)).to_be_visible()
    with host.expect_download() as download_info:
        host.get_by_role('button',name='导出抽奖候选名单 ↓',exact=True).click()
    result=download_info.value
    assert result.suggested_filename == 'lottery-candidates.csv'
    with open(result.path(),encoding='utf-8-sig') as f:
        assert '三等奖' in f.read()
    host.screenshot(path='/workspace/monopoly-host.png',full_page=True)
    screen.screenshot(path='/workspace/monopoly-screen.png')
    assert not errors,errors
    print('PASS calibrator, rankings, prize candidates; no browser page errors; test room '+code,flush=True)
    browser.close()
