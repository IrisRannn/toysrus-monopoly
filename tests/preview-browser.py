"""Horizontal player trial. Requires the isolated tests/slow-server.mjs fixture."""
import os, re
from playwright.sync_api import sync_playwright, expect

BASE=os.environ.get('E2E_BASE_URL','http://127.0.0.1:3003')
ROOM='261219'
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    admin=browser.new_context(viewport={'width':1440,'height':1000})
    marker=admin.request.post(BASE+'/_test/status')
    assert marker.ok and marker.json().get('isolated'), 'Use the isolated browser fixture, never a live event room.'
    official_before=admin.request.get(BASE+'/api/rooms/261218/state',headers={'x-game-role':'screen'})
    if not official_before.ok:
        admin.request.post(BASE+'/api/rooms',data={})
        official_before=admin.request.get(BASE+'/api/rooms/261218/state',headers={'x-game-role':'screen'})
    assert official_before.ok
    official_before=official_before.json()
    def track(page):
        page.on('pageerror',lambda e:errors.append(str(e)))
        return page
    def join(name,team):
        context=browser.new_context(viewport={'width':844,'height':390},is_mobile=True,has_touch=True)
        page=track(context.new_page());page.goto(BASE+'/')
        page.evaluate("localStorage.setItem('monopoly:lastRoom','261218')")
        page.goto(BASE+'/player-preview')
        expect(page.get_by_role('textbox',name='游戏房间号',exact=True)).to_have_value(ROOM)
        expect(page.get_by_role('textbox',name='游戏房间号',exact=True)).to_have_attribute('readonly','')
        page.get_by_placeholder('怎么称呼你？').fill(name)
        page.get_by_role('button',name=re.compile('^'+team)).click()
        page.get_by_role('button',name='加入游戏 →',exact=True).click()
        page.wait_for_url(re.compile(r'.*/player-preview\?room=261219'))
        expect(page.locator('.experience-identity')).to_contain_text(name)
        assert page.evaluate("localStorage.getItem('monopoly:lastRoom')")=='261218'
        assert page.locator('audio,iframe').count()==0
        return page,context
    rep,rep_ctx=join('体验代表','东区')
    viewer,viewer_ctx=join('普通观众','东区')
    central,central_ctx=join('中南代表','中南区')
    sh,sh_ctx=join('上海员工甲','上海SSC')
    sh2,sh2_ctx=join('上海员工乙','上海SSC')
    host=track(admin.new_page());host.goto(BASE+'/host-preview')
    host.get_by_role('button',name='进入主持人控制台 →',exact=True).click()
    host.wait_for_url(re.compile(r'.*/host-preview\?room=261219'))
    expect(host.locator('.preview-notice')).to_contain_text('独立')
    expect(host.get_by_role('checkbox',name='投骰代表仅由主持人指定',exact=True)).to_be_checked()
    expect(host.get_by_role('link',name='查看员工加入链接 ↗')).to_have_attribute('href',BASE+'/player-preview?room='+ROOM)
    credential=host.evaluate("localStorage.getItem('monopoly:261219:host')")
    headers={'x-game-role':'host','Authorization':'Bearer '+credential}
    def state():
        r=admin.request.get(BASE+f'/api/rooms/{ROOM}/state',headers=headers)
        assert r.ok,r.text();return r.json()
    def command(kind,payload={}):
        r=admin.request.post(BASE+f'/api/rooms/{ROOM}/commands',headers=headers,data={'type':kind,'payload':payload})
        assert r.ok,r.text()
    def employee(name):return next(p for p in state()['players'] if p['nickname']==name)['id']
    east_id=employee('体验代表');viewer_id=employee('普通观众');central_id=employee('中南代表')
    host.get_by_role('combobox',name='东区固定投骰代表',exact=True).select_option(east_id)
    host.get_by_role('combobox',name='中南区固定投骰代表',exact=True).select_option(central_id)
    host.reload()
    expect(host.get_by_role('combobox',name='东区固定投骰代表',exact=True)).to_have_value(east_id)
    for page in [rep,viewer,central,sh,sh2]:
        expect(page.get_by_role('button',name='🎲 投骰子',exact=True)).to_have_count(0)
        expect(page.get_by_role('button',name='成为本回合投骰代表',exact=True)).to_have_count(0)
    rep.wait_for_function("document.querySelector('.board-original')?.naturalWidth===1920")
    bounds=rep.locator('.experience-board').bounding_box()
    assert abs(bounds['width']/bounds['height']-16/9)<.001
    assert rep.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight')
    viewer.screenshot(path='/workspace/player-preview-viewer.png')
    viewer.set_viewport_size({'width':390,'height':844})
    expect(viewer.locator('.experience-portrait-hint')).to_be_visible()
    assert viewer.evaluate('document.documentElement.scrollWidth<=innerWidth')
    viewer.screenshot(path='/workspace/player-preview-portrait.png')
    viewer.set_viewport_size({'width':844,'height':390})
    # Reuse the same player credential when switching between original and trial views.
    original_id=viewer.evaluate("localStorage.getItem('monopoly:261219:player')")
    viewer.get_by_role('link',name='原玩家界面 ↗',exact=True).click()
    expect(viewer.locator('.player-hero')).to_contain_text('普通观众')
    viewer.get_by_role('link',name='返回横屏体验',exact=True).click()
    expect(viewer.locator('.experience-identity')).to_contain_text('普通观众')
    assert viewer.evaluate("localStorage.getItem('monopoly:261219:player')")==original_id
    assert len(state()['players'])==5
    print('PASS independent 261219 joins, original session retained, full original 16:9 board, portrait fallback and interface switch',flush=True)
    command('manualMove',{'team':'east','position':17,'reason':'独立体验测试普通回合'})
    host.get_by_role('button',name='▶ 开始游戏',exact=True).click()
    expect(rep.get_by_role('button',name='🎲 投骰子',exact=True)).to_be_enabled()
    expect(viewer.get_by_role('button',name='🎲 投骰子',exact=True)).to_have_count(0)
    expect(central.get_by_role('button',name='🎲 投骰子',exact=True)).to_have_count(0)
    host.get_by_role('combobox',name='东区固定投骰代表',exact=True).select_option(viewer_id)
    expect(viewer.get_by_role('button',name='🎲 投骰子',exact=True)).to_be_enabled()
    expect(rep.get_by_role('button',name='🎲 投骰子',exact=True)).to_have_count(0)
    host.get_by_role('combobox',name='东区固定投骰代表',exact=True).select_option(east_id)
    expect(rep.get_by_role('button',name='🎲 投骰子',exact=True)).to_be_enabled()
    expect(viewer.get_by_role('button',name='🎲 投骰子',exact=True)).to_have_count(0)
    for kind in ['claimRepresentative','assignRepresentative','setTeamRepresentative','roll']:
        rejected=viewer_ctx.request.post(BASE+f'/api/rooms/{ROOM}/commands',headers={'x-game-role':'player','Authorization':'Bearer '+original_id},data={'type':kind,'payload':{'team':'east','playerId':viewer_id}})
        assert rejected.status==400,(kind,rejected.text())
    button=rep.get_by_role('button',name='🎲 投骰子',exact=True).bounding_box()
    assert button['x']>=bounds['x']+bounds['width']
    assert button['y']+button['height']<=390
    assert rep.locator('.experience-progress').evaluate('(x)=>x.scrollHeight<=x.clientHeight+1')
    rep.screenshot(path='/workspace/player-preview-representative.png')
    for width,height in [(667,375),(568,320)]:
        rep.set_viewport_size({'width':width,'height':height})
        assert rep.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight')
        assert rep.locator('.experience-progress').evaluate('(x)=>x.scrollHeight<=x.clientHeight+1'),(width,height)
        compact_button=rep.get_by_role('button',name='🎲 投骰子',exact=True).bounding_box()
        assert compact_button['y']+compact_button['height']<=height
    rep.set_viewport_size({'width':844,'height':390})
    admin.request.post(BASE+'/_test/delay',data={'ms':600})
    rep.get_by_role('button',name='🎲 投骰子',exact=True).click()
    expect(rep.get_by_role('button',name='正在投骰…',exact=True)).to_be_disabled()
    admin.request.post(BASE+'/_test/delay',data={'ms':0})
    expect(rep.locator('.screen-dice')).to_be_visible()
    expect(host.locator('.current-turn h2')).to_contain_text('中南区',timeout=16000)
    expect(central.get_by_role('button',name='🎲 投骰子',exact=True)).to_be_enabled()
    assert state()['teams']['central']['representativeId']==central_id
    print('PASS host presets and replaces representatives; ordinary clients cannot self-assign or roll; next team automatically adopts its representative',flush=True)
    command('reset',{'confirm':ROOM})
    assert state()['representativeRoster']['east']==east_id
    command('settings',{'answerSeconds':120})
    command('setOrder',{'order':['shanghai','east','central','north','west']})
    command('saveQuestion',{'tile':0,'text':'体验验收题：请选择甲','options':{'A':'甲','B':'乙','C':'丙','D':'丁'},'answer':'A','explanation':'仅用于独立验收房间'})
    question_id=next(q['id'] for q in state()['questions'] if q['text']=='体验验收题：请选择甲')
    command('start');command('physicalDice',{'value':4})
    expect(host.get_by_role('button',name='开始答题',exact=True)).to_be_visible(timeout=15000)
    command('startQuiz',{'questionId':question_id})
    expect(sh.get_by_role('dialog',name='本队答题窗口')).to_be_visible()
    expect(sh2.get_by_role('dialog',name='本队答题窗口')).to_be_visible()
    expect(viewer.get_by_role('dialog',name='本队答题窗口')).not_to_be_visible()
    expect(central.get_by_role('dialog',name='本队答题窗口')).not_to_be_visible()
    sh.screenshot(path='/workspace/player-preview-quiz-landscape.png')
    submit=sh.get_by_role('button',name='提交答案',exact=True).bounding_box()
    assert submit['y']>=0 and submit['y']+submit['height']<=390,submit
    sh2.set_viewport_size({'width':390,'height':844})
    expect(sh2.get_by_role('button',name='提交答案',exact=True)).to_be_visible()
    sh2.screenshot(path='/workspace/player-preview-quiz-portrait.png')
    command('pause')
    expect(sh.get_by_role('button',name='提交答案',exact=True)).to_be_disabled()
    command('resume')
    sh.get_by_role('button',name=re.compile('^A')).click()
    admin.request.post(BASE+'/_test/delay',data={'ms':600})
    sh.get_by_role('button',name='提交答案',exact=True).click()
    expect(sh.get_by_role('button',name='正在提交…',exact=True)).to_be_disabled()
    admin.request.post(BASE+'/_test/delay',data={'ms':0})
    expect(sh.get_by_role('dialog',name='本队答题窗口')).not_to_be_visible()
    sh.get_by_role('button',name='已提交 A · 修改答案',exact=True).click()
    sh.get_by_role('button',name=re.compile('^B')).click()
    sh.get_by_role('button',name='更新我的答案',exact=True).click()
    expect(sh.get_by_role('dialog',name='本队答题窗口')).not_to_be_visible()
    assert state()['quiz']['submitted']==1
    sh.get_by_role('button',name='已提交 B · 修改答案',exact=True).click()
    sh.get_by_role('button',name=re.compile('^A')).click()
    sh.get_by_role('button',name='更新我的答案',exact=True).click()
    sh2.get_by_role('button',name=re.compile('^A')).click()
    sh2.get_by_role('button',name='提交答案',exact=True).click()
    expect(sh2.get_by_role('dialog',name='本队答题窗口')).not_to_be_visible()
    command('closeQuiz');command('reveal')
    expect(sh.locator('.special-event[data-kind=correct]')).to_be_visible()
    expect(sh.get_by_role('dialog',name='本队答题窗口')).not_to_be_visible()
    expect(host.locator('.current-turn')).to_contain_text('本队回合完成',timeout=15000)
    expect(sh.get_by_role('dialog',name='本队答题窗口')).to_be_visible()
    expect(sh.get_by_text('答对了，向前出发！',exact=True)).to_be_visible()
    sh.get_by_role('button',name='返回棋盘',exact=True).click()
    expect(sh.get_by_role('dialog',name='本队答题窗口')).not_to_be_visible()
    assert state()['teams']['shanghai']['position']==7
    assert state()['quiz']['result']['counts']['A']==2
    command('next')
    expect(rep.get_by_role('button',name='🎲 投骰子',exact=True)).to_be_enabled()
    if official_before:
        official_after=admin.request.get(BASE+'/api/rooms/261218/state',headers={'x-game-role':'screen'}).json()
        for field in ['code','status','phase','turnId','round','teams','usedQuestions']:
            assert official_after.get(field)==official_before.get(field),field
    assert not errors,errors
    print('PASS same quiz controls in landscape and portrait, correct-team popup, pause, durable editable vote, reward animation, original room isolation and no browser errors',flush=True)
    browser.close()
